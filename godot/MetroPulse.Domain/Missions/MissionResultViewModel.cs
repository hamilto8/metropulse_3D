using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MetroPulse.Domain.Missions;

/// <summary>Receipt-time result and persistent history projection; never reads mutable current city state.</summary>
public static partial class MissionResultViewModel
{
    private static readonly string[] SectionOrder =
        [MissionResultSectionIds.Reward, MissionResultSectionIds.City, MissionResultSectionIds.Faction, MissionResultSectionIds.Progression];

    private static readonly IReadOnlyDictionary<string, (string Label, string Tone)> Presentations =
        new Dictionary<string, (string, string)>(StringComparer.Ordinal)
        {
            [MissionResultKinds.Success] = ("Success", "success"),
            [MissionResultKinds.PartialSuccess] = ("Partial success", "partial"),
            [MissionResultKinds.Failure] = ("Mission failed", "failure"),
            [MissionResultKinds.Abandoned] = ("Mission abandoned", "abandoned"),
            [MissionResultKinds.Arrested] = ("Operator arrested", "arrested"),
            [MissionResultKinds.VehicleLoss] = ("Vehicle lost", "vehicle-loss"),
        };

    private static readonly IReadOnlyDictionary<string, (string Title, string Empty)> SectionMetadata =
        new Dictionary<string, (string, string)>(StringComparer.Ordinal)
        {
            [MissionResultSectionIds.Reward] = ("Reward & performance", "No Capital or performance reward was recorded."),
            [MissionResultSectionIds.City] = ("City consequences", "No persistent city condition changed."),
            [MissionResultSectionIds.Faction] = ("Faction consequences", "No faction reputation changed."),
            [MissionResultSectionIds.Progression] = ("Progression & unlocks", "No progression, capability, or follow-up unlocked."),
        };

    private static readonly IReadOnlyDictionary<string, string> EffectLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [OutcomeCommandTypes.CapitalAdjusted] = "Capital",
            [OutcomeCommandTypes.BuildingStateSet] = "Building state",
            [OutcomeCommandTypes.InfrastructureStateSet] = "Infrastructure",
            [OutcomeCommandTypes.IncidentRecorded] = "Incident",
            [OutcomeCommandTypes.IncidentResolved] = "Incident resolved",
            [OutcomeCommandTypes.RepairSet] = "Repair status",
            [OutcomeCommandTypes.ServiceOutageSet] = "Service coverage",
            [OutcomeCommandTypes.TrafficSet] = "Traffic conditions",
            [OutcomeCommandTypes.FactionReputationAdjusted] = "Reputation",
            [OutcomeCommandTypes.ProgressionSet] = "Career tier",
            [OutcomeCommandTypes.UnlockSet] = "Capability",
            [OutcomeCommandTypes.NewsPublished] = "City news",
            [OutcomeCommandTypes.FollowUpMissionSet] = "Follow-up mission",
            [OutcomeCommandTypes.AuthoredFlagSet] = "City state",
        };

    private static readonly IReadOnlyDictionary<string, string> ReasonExplanations =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["timeout"] = "The mission timer expired before the final objective was completed.",
            ["cancelled"] = "You abandoned the mission before its final objective was completed.",
            ["canceled"] = "You abandoned the mission before its final objective was completed.",
            ["abandoned"] = "You abandoned the mission before its final objective was completed.",
            ["released"] = "Control of the required mission vehicle was released during the run.",
            ["vehicle_lost"] = "The required mission vehicle was lost, destroyed, or exchanged during the run.",
            ["vehicle_destroyed"] = "The required mission vehicle was destroyed during the run.",
            ["arrest"] = "Enforcement captured the operator before the mission could be completed.",
            ["arrested"] = "Enforcement captured the operator before the mission could be completed.",
            ["captured"] = "Enforcement captured the operator before the mission could be completed.",
            ["race_lost"] = "A rival reached the finish before the player.",
        };

    public static MissionResultView Build(
        MissionOutcomeExplanation explanation,
        MissionLifecycleState? lifecycle = null,
        MissionDefinition? mission = null,
        MissionRetryDecision? retry = null,
        long? sequence = null,
        IReadOnlyDictionary<string, string>? labels = null)
    {
        ArgumentNullException.ThrowIfNull(explanation);
        if (lifecycle is not null)
        {
            if (lifecycle.Phase != MissionPhases.Result || lifecycle.Run?.TransactionId != explanation.TransactionId
                || lifecycle.Run.Receipt?.TransactionId != explanation.TransactionId)
                throw new InvalidDataException("A current result view requires the matching committed RESULT receipt.");
        }
        MissionResolution? resolution = lifecycle?.Run?.Resolution;
        string kind = Classify(resolution, explanation.Source);
        (string outcomeLabel, string tone) = Presentations[kind];
        var items = SectionOrder.ToDictionary(section => section, _ => new List<MissionResultEffectItem>(), StringComparer.Ordinal);
        foreach (OutcomeEffect effect in explanation.Effects)
        {
            items[SectionFor(effect.Type)].Add(CreateEffectItem(effect, labels));
        }
        AddPerformance(items[MissionResultSectionIds.Reward], resolution);
        MissionResultSection[] sections = SectionOrder.Select(id => new MissionResultSection(
            id,
            SectionMetadata[id].Title,
            SectionMetadata[id].Empty,
            Array.AsReadOnly(items[id].ToArray()))).ToArray();
        MissionResultNextAction next = BuildNextAction(kind, retry);
        string missionTitle = mission?.Title ?? explanation.Title ?? Humanize(explanation.Source.ContentId);
        string[] why = BuildWhy(resolution, explanation, lifecycle?.Run?.Weather);
        int changeCount = sections.Sum(section => section.Items.Count);
        string announcement = string.Join(' ', new[]
        {
            $"{outcomeLabel}: {missionTitle}.",
            explanation.Description,
            $"{changeCount} recorded change{(changeCount == 1 ? string.Empty : "s")}.",
            next.Description,
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
        return new MissionResultView(
            explanation.TransactionId,
            sequence,
            kind,
            outcomeLabel,
            tone,
            missionTitle,
            explanation.Title ?? missionTitle,
            explanation.Description ?? "The mission outcome was committed.",
            Array.AsReadOnly(why),
            lifecycle?.Run?.Attempt,
            Array.AsReadOnly(sections),
            next,
            announcement);
    }

    public static IReadOnlyList<MissionResultView> BuildHistory(
        IEnumerable<MissionOutcomeReceipt> receipts,
        MissionRegistry registry,
        MissionLifecycleState? currentLifecycle = null,
        IReadOnlyDictionary<string, string>? labels = null)
    {
        ArgumentNullException.ThrowIfNull(receipts);
        ArgumentNullException.ThrowIfNull(registry);
        MissionResultView[] history = receipts
            .Where(receipt => receipt.Source.Kind == OutcomeSourceKinds.Mission)
            .OrderByDescending(receipt => receipt.Sequence)
            .Select(receipt => Build(
                new MissionOutcomeExplanation(
                    receipt.TransactionId,
                    receipt.Source,
                    receipt.Summary.Title,
                    receipt.Summary.Description,
                    receipt.Effects),
                currentLifecycle?.Run?.TransactionId == receipt.TransactionId ? currentLifecycle : null,
                registry.Get(receipt.Source.ContentId),
                sequence: receipt.Sequence,
                labels: labels))
            .ToArray();
        return Array.AsReadOnly(history);
    }

    public static string Classify(MissionResolution? resolution, OutcomeSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        string reason = Token(resolution?.Reason ?? source.Reason);
        if (reason is "CANCELLED" or "CANCELED" or "ABANDONED") return MissionResultKinds.Abandoned;
        if (reason is "ARREST" or "ARRESTED" or "CAPTURED") return MissionResultKinds.Arrested;
        if (reason is "VEHICLE_LOSS" or "VEHICLE_LOST" or "VEHICLE_DESTROYED") return MissionResultKinds.VehicleLoss;
        return Token(resolution?.Outcome ?? source.Outcome) switch
        {
            "SUCCESS" or "COMPLETE" or "COMPLETED" => MissionResultKinds.Success,
            "PARTIAL" or "PARTIAL_SUCCESS" => MissionResultKinds.PartialSuccess,
            "ABANDONED" or "ABANDONMENT" or "CANCELLED" or "CANCELED" => MissionResultKinds.Abandoned,
            "ARREST" or "ARRESTED" or "CAPTURED" => MissionResultKinds.Arrested,
            "VEHICLE_LOSS" or "VEHICLE_LOST" or "VEHICLE_DESTROYED" => MissionResultKinds.VehicleLoss,
            _ => MissionResultKinds.Failure,
        };
    }

    private static void AddPerformance(List<MissionResultEffectItem> items, MissionResolution? resolution)
    {
        if (resolution?.Satisfaction is { } satisfaction)
            items.Add(new("performance:satisfaction", "SATISFACTION", "Passenger satisfaction", $"{Math.Round(satisfaction):N0}%", "Satisfaction reflects time used and traffic encountered during the run."));
        if (resolution?.Damage is { } damage)
            items.Add(new("performance:damage", "DAMAGE", "Damage", damage <= 1 ? $"{Math.Round(damage * 100):N0}%" : FormatNumber(damage), "Damage recorded when the mission resolved."));
        if (resolution?.Heat is { } heat)
            items.Add(new("performance:heat", "HEAT", "Heat", FormatNumber(heat), "Enforcement Heat recorded when the mission resolved."));
    }

    private static MissionResultEffectItem CreateEffectItem(OutcomeEffect effect, IReadOnlyDictionary<string, string>? labels)
    {
        string subject = labels?.GetValueOrDefault(effect.SubjectId) ?? Humanize(effect.SubjectId);
        string baseLabel = EffectLabels.GetValueOrDefault(effect.Type) ?? Humanize(effect.Type);
        string label = effect.Type == OutcomeCommandTypes.CapitalAdjusted ? baseLabel : $"{baseLabel} · {subject}";
        return new MissionResultEffectItem(
            $"{effect.Type}:{effect.SubjectId}",
            effect.Type,
            label,
            FormatChange(effect),
            string.IsNullOrWhiteSpace(effect.Explanation) ? "The committed mission outcome changed this value." : effect.Explanation);
    }

    private static string SectionFor(string type) => type switch
    {
        OutcomeCommandTypes.CapitalAdjusted => MissionResultSectionIds.Reward,
        OutcomeCommandTypes.FactionReputationAdjusted => MissionResultSectionIds.Faction,
        OutcomeCommandTypes.ProgressionSet or OutcomeCommandTypes.UnlockSet or OutcomeCommandTypes.FollowUpMissionSet => MissionResultSectionIds.Progression,
        _ => MissionResultSectionIds.City,
    };

    private static string[] BuildWhy(MissionResolution? resolution, MissionOutcomeExplanation explanation, MissionWeatherDecision? weather)
    {
        string? raw = resolution?.Reason ?? explanation.Source.Reason;
        string primary = raw is not null && ReasonExplanations.TryGetValue(raw, out string? known)
            ? known
            : !string.IsNullOrWhiteSpace(raw) ? Humanize(raw) : explanation.Description;
        return new[] { primary, weather?.Disposition == MissionWeatherDispositions.Adapted ? weather.Reason : null }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .Select(value => value!)
            .ToArray();
    }

    private static MissionResultNextAction BuildNextAction(string kind, MissionRetryDecision? retry)
    {
        if (retry?.Allowed == true)
        {
            string remaining = retry.AttemptsRemaining is { } count
                ? $" {count} attempt{(count == 1 ? string.Empty : "s")} remain."
                : string.Empty;
            return new MissionResultNextAction(
                "Retry or return to the city",
                $"{retry.Reason}{remaining}",
                true,
                retry.Checkpoint is null ? "Retry mission" : "Retry from checkpoint",
                "Return to Management");
        }
        if (kind is MissionResultKinds.Success or MissionResultKinds.PartialSuccess)
            return new MissionResultNextAction(
                "Review the changed city",
                "Return to Management to inspect the committed consequences and choose the next priority.",
                false,
                "Retry mission",
                "Return to Management");
        return new MissionResultNextAction(
            "Recover in Management",
            retry?.Reason ?? "Return to Management. The committed result remains in the outcome log.",
            false,
            "Retry mission",
            "Return to Management");
    }

    private static string FormatChange(OutcomeEffect effect)
    {
        if (effect.Type == OutcomeCommandTypes.CapitalAdjusted && Numbers(effect, out double before, out double after))
        {
            double delta = after - before;
            return $"{Currency(before)} → {Currency(after)} ({(delta >= 0 ? "+" : "-")}{Currency(Math.Abs(delta))})";
        }
        if (effect.Type == OutcomeCommandTypes.FactionReputationAdjusted && Numbers(effect, out before, out after))
            return $"{FormatNumber(before)} → {FormatNumber(after)} ({(after - before > 0 ? "+" : string.Empty)}{FormatNumber(after - before)})";
        if (effect.After is { ValueKind: JsonValueKind.True or JsonValueKind.False } boolean) return boolean.GetBoolean() ? "Unlocked" : "Locked";
        if (Numbers(effect, out before, out after))
            return $"{FormatNumber(before)} → {FormatNumber(after)} ({(after - before > 0 ? "+" : string.Empty)}{FormatNumber(after - before)})";
        string? beforeValue = PrimaryValue(effect.Before);
        string? afterValue = PrimaryValue(effect.After);
        if (beforeValue is not null && afterValue is not null && beforeValue != afterValue) return $"{beforeValue} → {afterValue}";
        if (afterValue is not null) return afterValue;
        if (beforeValue is not null && effect.After is null) return $"{beforeValue} → Resolved";
        return effect.Before is null ? "Recorded" : "Updated";
    }

    private static string? PrimaryValue(JsonElement? element)
    {
        if (element is null || element.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
        JsonElement value = element.Value;
        if (value.ValueKind == JsonValueKind.String) return value.GetString();
        if (value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.GetBoolean() ? "Active" : "Resolved";
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out double number)) return FormatNumber(number);
        if (value.ValueKind != JsonValueKind.Object) return value.ToString();
        foreach (string key in new[] { "headline", "status", "state", "access" })
        {
            if (value.TryGetProperty(key, out JsonElement property) && property.ValueKind == JsonValueKind.String)
            {
                string result = Humanize(property.GetString());
                return key == "access" ? $"{result} access" : result;
            }
        }
        if (value.TryGetProperty("active", out JsonElement active) && active.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return active.GetBoolean() ? "Active" : "Resolved";
        if (value.TryGetProperty("unlocked", out JsonElement unlocked) && unlocked.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return unlocked.GetBoolean() ? "Unlocked" : "Locked";
        if (value.TryGetProperty("coverageMultiplier", out JsonElement coverage) && coverage.TryGetDouble(out number))
            return $"{Math.Round(number * 100):N0}% coverage";
        if (value.TryGetProperty("densityMultiplier", out JsonElement density) && density.TryGetDouble(out number))
            return $"{number:F2}× traffic";
        if (value.TryGetProperty("condition", out JsonElement condition) && condition.TryGetDouble(out number))
            return $"{Math.Round(number * 100):N0}% condition";
        if (value.TryGetProperty("value", out JsonElement authoredValue)) return authoredValue.ToString();
        return null;
    }

    private static bool Numbers(OutcomeEffect effect, out double before, out double after)
    {
        before = 0;
        after = 0;
        return effect.Before is { ValueKind: JsonValueKind.Number } beforeElement && beforeElement.TryGetDouble(out before)
            && effect.After is { ValueKind: JsonValueKind.Number } afterElement && afterElement.TryGetDouble(out after);
    }

    private static string Currency(double value) => $"{(value < 0 ? "-" : string.Empty)}${Math.Abs(value).ToString("N0", CultureInfo.GetCultureInfo("en-US"))}";

    private static string FormatNumber(double value) => value.ToString(value % 1 == 0 ? "N0" : "0.###", CultureInfo.GetCultureInfo("en-US"));

    private static string Token(string? value) => Regex().Replace((value ?? string.Empty).Trim().ToUpperInvariant(), "_");

    private static string Humanize(string? value)
    {
        string text = (value ?? string.Empty).Trim();
        if (text.Length == 0) return "Unknown";
        string words = Regex().Replace(text, " ").ToLowerInvariant();
        return CultureInfo.GetCultureInfo("en-US").TextInfo.ToTitleCase(words);
    }

    [GeneratedRegex("[\\s._-]+")]
    private static partial Regex Regex();
}

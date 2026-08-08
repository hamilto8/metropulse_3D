using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;

namespace MetroPulse.Domain.Alerts;

public sealed class AlertService
{
    public const int StateVersion = 2;

    private static readonly HashSet<string> Severities =
        [AlertSeverities.Info, AlertSeverities.Success, AlertSeverities.Warning, AlertSeverities.Critical];
    private static readonly HashSet<string> States =
        [AlertStates.Active, AlertStates.Resolved, AlertStates.Superseded];
    private static readonly HashSet<string> DurationKinds =
        [AlertDurationKinds.Timed, AlertDurationKinds.UntilResolved, AlertDurationKinds.Persistent];
    private static readonly HashSet<string> FocusActions =
        [AlertFocusActions.None, AlertFocusActions.ManagementCamera, AlertFocusActions.StreetWaypoint];
    private static readonly IReadOnlyDictionary<string, int> SeverityRank =
        new ReadOnlyDictionary<string, int>(new Dictionary<string, int>(StringComparer.Ordinal)
        {
            [AlertSeverities.Info] = 0,
            [AlertSeverities.Success] = 1,
            [AlertSeverities.Warning] = 2,
            [AlertSeverities.Critical] = 3,
        });

    private readonly Dictionary<string, AlertRecord> records = new(StringComparer.Ordinal);
    private readonly List<Action<AlertEvent>> listeners = [];
    private readonly Func<DateTimeOffset> now;
    private readonly Func<string> idFactory;
    private readonly int maxRecords;
    private long sequence;
    private int idSequence;

    public AlertService(
        Func<DateTimeOffset>? now = null,
        Func<string>? idFactory = null,
        int maxRecords = 100)
    {
        if (maxRecords < 10) throw new ArgumentOutOfRangeException(nameof(maxRecords));
        this.now = now ?? (() => DateTimeOffset.UtcNow);
        this.idFactory = idFactory ?? (() => $"alert-{++idSequence}");
        this.maxRecords = maxRecords;
    }

    public AlertRecord Publish(AlertInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        string? requestedKey = input.DedupeKey ?? input.Id;
        AlertRecord? sameId = input.Id is null ? null : records.GetValueOrDefault(input.Id);
        if (sameId is not null && sameId.State != AlertStates.Active)
        {
            throw new InvalidOperationException($"Cannot reuse inactive alert ID: {input.Id}");
        }
        AlertRecord? existing = sameId ?? (requestedKey is null
            ? null
            : records.Values.FirstOrDefault(record =>
                record.State == AlertStates.Active && record.DedupeKey == requestedKey));
        if (sameId is not null && input.DedupeKey is not null && input.DedupeKey != sameId.DedupeKey)
        {
            throw new InvalidOperationException($"Alert ID {input.Id} cannot change its dedupe key.");
        }

        AlertRecord record = NormalizeInput(input, existing);
        if (existing is null && records.ContainsKey(record.Id))
        {
            throw new InvalidOperationException($"Duplicate alert ID: {record.Id}");
        }
        records[record.Id] = record;
        foreach (string target in input.Supersedes ?? Array.Empty<string>())
        {
            AlertRecord? prior = Find(target);
            if (prior is not null && prior.State == AlertStates.Active && prior.Id != record.Id)
            {
                ReplaceState(prior, AlertStates.Superseded, $"Superseded by {record.Title}", record.Id, now());
            }
        }
        TrimHistory();
        Notify(new AlertEvent
        {
            Type = existing is null ? "PUBLISHED" : "UPDATED",
            Alert = record,
            Current = EmptySnapshot,
        });
        return record;
    }

    public AlertRecord PublishLegacy(
        string message,
        string level = "info",
        AlertInput? context = null)
    {
        AlertInput input = CreateLegacyAlertInput(message, level, context);
        return Publish(input);
    }

    public AlertRecord? Find(string? idOrDedupeKey)
    {
        if (idOrDedupeKey is null) return null;
        return records.GetValueOrDefault(idOrDedupeKey)
            ?? records.Values.FirstOrDefault(record =>
                record.DedupeKey == idOrDedupeKey && record.State == AlertStates.Active);
    }

    public AlertRecord? Resolve(string idOrDedupeKey, string reason = "Condition resolved")
    {
        AlertRecord? record = Find(idOrDedupeKey);
        if (record is null || record.State != AlertStates.Active) return null;
        AlertRecord resolved = ReplaceState(record, AlertStates.Resolved, reason, null, now());
        Notify(new AlertEvent { Type = "RESOLVED", Alert = resolved, Current = EmptySnapshot });
        return resolved;
    }

    public IReadOnlyList<AlertRecord> Expire(DateTimeOffset? at = null)
    {
        DateTimeOffset expiryTime = (at ?? now()).ToUniversalTime();
        var expired = new List<AlertRecord>();
        foreach (AlertRecord record in records.Values.ToArray())
        {
            if (record.State != AlertStates.Active || record.Duration.Kind != AlertDurationKinds.Timed) continue;
            DateTimeOffset deadline = ParseTime(record.LastObservedAt, "alert.LastObservedAt")
                .AddSeconds(record.Duration.Seconds!.Value);
            if (expiryTime < deadline) continue;
            expired.Add(ReplaceState(
                record,
                AlertStates.Resolved,
                "Timed notification ended",
                null,
                expiryTime));
        }
        IReadOnlyList<AlertRecord> result = Array.AsReadOnly(expired.ToArray());
        if (result.Count > 0)
        {
            Notify(new AlertEvent { Type = "EXPIRED", Alerts = result, Current = EmptySnapshot });
        }
        return result;
    }

    public AlertSnapshot Snapshot()
    {
        AlertRecord[] items = records.Values
            .OrderBy(record => record, AlertComparer.Instance)
            .ToArray();
        return new AlertSnapshot
        {
            Version = StateVersion,
            Revision = sequence,
            Items = Array.AsReadOnly(items),
            Active = Array.AsReadOnly(items.Where(item => item.State == AlertStates.Active).ToArray()),
        };
    }

    public AlertStateDocument Serialize() => new()
    {
        Version = StateVersion,
        Sequence = sequence,
        Items = Array.AsReadOnly(records.Values.ToArray()),
    };

    public AlertSnapshot Restore(AlertStateDocument value)
    {
        ValidateState(value);
        records.Clear();
        sequence = 0;
        idSequence = 0;
        foreach (AlertRecord item in value.Items)
        {
            AlertRecord record = NormalizeInput(ToInput(item), null);
            records.Add(record.Id, record);
            Match match = Regex.Match(record.Id, "^alert-(\\d+)$", RegexOptions.CultureInvariant);
            if (match.Success)
            {
                idSequence = Math.Max(idSequence, int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture));
            }
        }
        sequence = value.Sequence;
        TrimHistory();
        Notify(new AlertEvent { Type = "RESTORED", Current = EmptySnapshot }, increment: false);
        return Snapshot();
    }

    public AlertSnapshot RestoreLegacy(IEnumerable<LegacyAlertItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        LegacyAlertItem[] materialized = items.ToArray();
        foreach (LegacyAlertItem item in materialized)
        {
            ArgumentNullException.ThrowIfNull(item);
            RequireText(item.Message, "legacy alert message");
            RequireText(item.Type, "legacy alert type");
        }
        records.Clear();
        sequence = 0;
        idSequence = 0;
        foreach (LegacyAlertItem item in materialized.Reverse())
        {
            string? startTime = TryParseTime(item.Time, out DateTimeOffset parsed)
                ? FormatTime(parsed)
                : null;
            PublishLegacy(item.Message, item.Type, new AlertInput { StartTime = startTime });
        }
        return Snapshot();
    }

    public Func<bool> Subscribe(Action<AlertEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent)
        {
            listener(new AlertEvent { Type = "SNAPSHOT", Current = Snapshot() });
        }
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public void Destroy() => listeners.Clear();

    public static void ValidateState(AlertStateDocument value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Version != StateVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"Unsupported alert state version: {value.Version}");
        }
        if (value.Sequence < 0) throw new ArgumentOutOfRangeException(nameof(value), "Alert state sequence must be non-negative.");
        ArgumentNullException.ThrowIfNull(value.Items);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        var activeKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (AlertRecord item in value.Items)
        {
            AlertRecord normalized = NormalizeInputStatic(ToInput(item), null, () => item.LastObservedAt, () => item.Id);
            if (!ids.Add(normalized.Id)) throw new InvalidOperationException($"Duplicate alert ID: {normalized.Id}");
            if (normalized.State == AlertStates.Active && !activeKeys.Add(normalized.DedupeKey))
            {
                throw new InvalidOperationException($"Duplicate active alert key: {normalized.DedupeKey}");
            }
        }
    }

    public static AlertInput CreateLegacyAlertInput(
        string message,
        string level = "info",
        AlertInput? context = null)
    {
        string cause = RequireText(message, "alert message");
        context ??= new AlertInput();
        string severity = level.ToLowerInvariant() switch
        {
            "success" => AlertSeverities.Success,
            "warn" or "warning" => AlertSeverities.Warning,
            "danger" or "critical" => AlertSeverities.Critical,
            _ => AlertSeverities.Info,
        };
        string cleanTitle = StripDecorativePrefix(context.Title ?? cause);
        if (cleanTitle.Length > 96) cleanTitle = cleanTitle[..96];
        string type = context.Type ?? LegacyType(cause);
        string dedupeText = Regex.Replace(StripDecorativePrefix(cause).ToLowerInvariant(), "\\d+", "#");
        dedupeText = Regex.Replace(dedupeText, "[^a-z#]+", "-").Trim('-');
        return context with
        {
            Type = type,
            Severity = severity,
            Title = cleanTitle,
            Cause = context.Cause ?? cause,
            Location = context.Location ?? AlertLocation.Named("Citywide"),
            Duration = context.Duration ?? new AlertDuration { Kind = AlertDurationKinds.Timed, Seconds = 120 },
            Recommendation = context.Recommendation ?? (severity == AlertSeverities.Critical
                ? "Move to safety and use the alert action for situational guidance."
                : "No immediate intervention is required; monitor City Tools for changes."),
            RelatedEntityIds = context.RelatedEntityIds ?? Array.Empty<string>(),
            FocusAction = context.FocusAction ?? new AlertFocusAction(),
            DedupeKey = context.DedupeKey ?? $"legacy:{type}:{dedupeText}",
        };
    }

    private AlertRecord NormalizeInput(AlertInput input, AlertRecord? existing) =>
        NormalizeInputStatic(input, existing, () => FormatTime(now()), idFactory);

    private static AlertRecord NormalizeInputStatic(
        AlertInput input,
        AlertRecord? existing,
        Func<string> now,
        Func<string> idFactory)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.Version is not null and not 1)
        {
            throw new ArgumentOutOfRangeException(nameof(input), $"Unsupported alert record version: {input.Version}");
        }
        string observedAt = NormalizeTime(input.LastObservedAt ?? now(), "alert.LastObservedAt");
        AlertLocation location = NormalizeLocation(input.Location);
        string severity = (input.Severity ?? AlertSeverities.Info).ToUpperInvariant();
        if (!Severities.Contains(severity)) throw new ArgumentOutOfRangeException(nameof(input), "Unsupported alert severity.");
        string state = (input.State ?? AlertStates.Active).ToUpperInvariant();
        if (!States.Contains(state)) throw new ArgumentOutOfRangeException(nameof(input), "Unsupported alert state.");
        string id = RequireText(existing?.Id ?? input.Id ?? idFactory(), "alert.Id");
        string startTime = NormalizeTime(existing?.StartTime ?? input.StartTime ?? observedAt, "alert.StartTime");
        string title = RequireText(input.Title ?? input.Cause, "alert.Title");
        string cause = RequireText(input.Cause ?? title, "alert.Cause");
        AlertDuration duration = NormalizeDuration(input.Duration ?? existing?.Duration);
        string? resolvedAt = state == AlertStates.Active
            ? null
            : NormalizeTime(input.ResolvedAt ?? observedAt, "alert.ResolvedAt");
        int occurrences = input.Occurrences is > 0
            ? input.Occurrences.Value
            : (existing?.Occurrences ?? 0) + 1;

        return new AlertRecord
        {
            Version = 1,
            Id = id,
            DedupeKey = RequireText(input.DedupeKey ?? existing?.DedupeKey ?? id, "alert.DedupeKey"),
            Type = NormalizeType(input.Type),
            Severity = severity,
            Title = title,
            Cause = cause,
            Location = location,
            StartTime = startTime,
            LastObservedAt = observedAt,
            Duration = duration,
            State = state,
            Recommendation = RequireText(
                input.Recommendation ?? "Monitor conditions and review City Tools for available actions.",
                "alert.Recommendation"),
            RelatedEntityIds = NormalizeRelatedIds(input.RelatedEntityIds),
            FocusAction = NormalizeFocusAction(input.FocusAction, location),
            Occurrences = occurrences,
            ResolvedAt = resolvedAt,
            ResolutionReason = state == AlertStates.Active
                ? null
                : OptionalText(input.ResolutionReason, "alert.ResolutionReason") ?? "Condition ended",
            SupersededBy = state == AlertStates.Superseded
                ? RequireText(input.SupersededBy, "alert.SupersededBy")
                : null,
        };
    }

    private AlertRecord ReplaceState(
        AlertRecord record,
        string state,
        string reason,
        string? supersededBy,
        DateTimeOffset at)
    {
        var replacement = record with
        {
            State = state,
            ResolvedAt = FormatTime(at),
            ResolutionReason = RequireText(reason, "alert resolution reason"),
            SupersededBy = supersededBy,
        };
        records[record.Id] = replacement;
        return replacement;
    }

    private void TrimHistory()
    {
        if (records.Count <= maxRecords) return;
        var removable = records.Values
            .Where(record => record.State != AlertStates.Active)
            .OrderBy(record => ParseTime(record.LastObservedAt, "alert.LastObservedAt"))
            .ToList();
        while (records.Count > maxRecords && removable.Count > 0)
        {
            records.Remove(removable[0].Id);
            removable.RemoveAt(0);
        }
    }

    private void Notify(AlertEvent detail, bool increment = true)
    {
        if (increment) sequence += 1;
        AlertEvent alertEvent = detail with { Current = Snapshot() };
        foreach (Action<AlertEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(alertEvent);
            }
            catch (Exception)
            {
                // Presentation and persistence listeners cannot interrupt alert authority.
            }
        }
    }

    private static AlertLocation NormalizeLocation(AlertLocation? value)
    {
        value ??= new AlertLocation();
        return value with
        {
            Label = string.IsNullOrWhiteSpace(value.Label) ? "Citywide" : value.Label.Trim(),
            DistrictId = OptionalText(value.DistrictId, "alert.Location.DistrictId"),
            Position = NormalizePosition(value.Position, "alert.Location.Position"),
        };
    }

    private static AlertDuration NormalizeDuration(AlertDuration? value)
    {
        value ??= new AlertDuration();
        string kind = string.IsNullOrWhiteSpace(value.Kind) ? AlertDurationKinds.UntilResolved : value.Kind;
        if (!DurationKinds.Contains(kind)) throw new ArgumentOutOfRangeException(nameof(value), "Unsupported alert duration.");
        double? seconds = kind == AlertDurationKinds.Timed ? value.Seconds : null;
        if (kind == AlertDurationKinds.Timed && (seconds is null || !double.IsFinite(seconds.Value) || seconds <= 0))
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Timed alerts require a positive duration in seconds.");
        }
        return new AlertDuration { Kind = kind, Seconds = seconds };
    }

    private static AlertFocusAction NormalizeFocusAction(AlertFocusAction? value, AlertLocation location)
    {
        value ??= new AlertFocusAction();
        string type = string.IsNullOrWhiteSpace(value.Type) ? AlertFocusActions.None : value.Type;
        if (!FocusActions.Contains(type)) throw new ArgumentOutOfRangeException(nameof(value), "Unsupported alert focus action.");
        AlertPosition? position = NormalizePosition(value.Position ?? location.Position, "alert.FocusAction.Position");
        if (type != AlertFocusActions.None && position is null)
        {
            throw new ArgumentException($"{type} alert actions require a world position.", nameof(value));
        }
        return new AlertFocusAction
        {
            Type = type,
            Label = type == AlertFocusActions.None
                ? null
                : OptionalText(value.Label, "alert.FocusAction.Label")
                    ?? (type == AlertFocusActions.ManagementCamera ? "Focus camera" : "Set waypoint"),
            Position = position,
        };
    }

    private static AlertPosition? NormalizePosition(AlertPosition? position, string name)
    {
        if (position is null) return null;
        if (!double.IsFinite(position.X) || !double.IsFinite(position.Y) || !double.IsFinite(position.Z))
        {
            throw new ArgumentException($"{name} requires finite coordinates.", name);
        }
        return position;
    }

    private static IReadOnlyList<string> NormalizeRelatedIds(IReadOnlyList<string>? value)
    {
        if (value is null) return Array.Empty<string>();
        var ids = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < value.Count; index += 1)
        {
            string id = RequireText(value[index], $"alert.RelatedEntityIds[{index}]");
            if (seen.Add(id)) ids.Add(id);
        }
        return Array.AsReadOnly(ids.ToArray());
    }

    private static string NormalizeType(string? value)
    {
        string type = RequireText(value ?? AlertTypes.System, "alert.Type").ToUpperInvariant();
        if (!Regex.IsMatch(type, "^[A-Z][A-Z0-9_]*$", RegexOptions.CultureInvariant))
        {
            throw new ArgumentException("alert.Type must be a stable uppercase token.", nameof(value));
        }
        return type;
    }

    private static AlertInput ToInput(AlertRecord record) => new()
    {
        Version = record.Version,
        Id = record.Id,
        DedupeKey = record.DedupeKey,
        Type = record.Type,
        Severity = record.Severity,
        Title = record.Title,
        Cause = record.Cause,
        Location = record.Location,
        StartTime = record.StartTime,
        LastObservedAt = record.LastObservedAt,
        Duration = record.Duration,
        State = record.State,
        Recommendation = record.Recommendation,
        RelatedEntityIds = record.RelatedEntityIds,
        FocusAction = record.FocusAction,
        Occurrences = record.Occurrences,
        ResolvedAt = record.ResolvedAt,
        ResolutionReason = record.ResolutionReason,
        SupersededBy = record.SupersededBy,
    };

    private static string LegacyType(string message)
    {
        if (Regex.IsMatch(message, "police|crime|arrest|hit-and-run|assault", RegexOptions.IgnoreCase)) return AlertTypes.Crime;
        if (Regex.IsMatch(message, "traffic|vehicle|motorbike|lane|bridge", RegexOptions.IgnoreCase)) return AlertTypes.Traffic;
        if (Regex.IsMatch(message, "build|structure|parcel|zone|editor", RegexOptions.IgnoreCase)) return AlertTypes.Construction;
        if (Regex.IsMatch(message, "mission|result|payout", RegexOptions.IgnoreCase)) return AlertTypes.Mission;
        if (Regex.IsMatch(message, "capital|market|valuation|cash|economy", RegexOptions.IgnoreCase)) return AlertTypes.Economy;
        if (Regex.IsMatch(message, "weather|rain|storm|mist", RegexOptions.IgnoreCase)) return AlertTypes.Weather;
        return AlertTypes.System;
    }

    private static string StripDecorativePrefix(string value)
    {
        int index = 0;
        while (index < value.Length && !char.IsLetterOrDigit(value[index])) index += 1;
        return value[index..].Trim();
    }

    private static string? OptionalText(string? value, string name) =>
        value is null ? null : RequireText(value, name);

    private static string RequireText(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} must be a non-empty string.", name);
        return value.Trim();
    }

    private static string NormalizeTime(string value, string name) => FormatTime(ParseTime(value, name));

    private static DateTimeOffset ParseTime(string value, string name)
    {
        if (!TryParseTime(value, out DateTimeOffset parsed)) throw new ArgumentException($"{name} must be a valid date.", name);
        return parsed;
    }

    private static bool TryParseTime(string value, out DateTimeOffset parsed) =>
        DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out parsed);

    private static string FormatTime(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static readonly AlertSnapshot EmptySnapshot = new()
    {
        Revision = 0,
        Items = Array.Empty<AlertRecord>(),
        Active = Array.Empty<AlertRecord>(),
    };

    private sealed class AlertComparer : IComparer<AlertRecord>
    {
        public static readonly AlertComparer Instance = new();

        public int Compare(AlertRecord? left, AlertRecord? right)
        {
            if (ReferenceEquals(left, right)) return 0;
            if (left is null) return 1;
            if (right is null) return -1;
            int activeDifference = (right.State == AlertStates.Active ? 1 : 0)
                - (left.State == AlertStates.Active ? 1 : 0);
            if (activeDifference != 0) return activeDifference;
            int severityDifference = SeverityRank[right.Severity] - SeverityRank[left.Severity];
            if (severityDifference != 0) return severityDifference;
            return ParseTime(right.LastObservedAt, "alert.LastObservedAt")
                .CompareTo(ParseTime(left.LastObservedAt, "alert.LastObservedAt"));
        }
    }
}

using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;

namespace MetroPulse.Domain.Missions;

/// <summary>Atomic, idempotent authority for cross-system mission and management consequences.</summary>
public sealed class MissionOutcomeService
{
    public const int StateVersion = 1;

    private static readonly HashSet<string> SourceKinds =
        [OutcomeSourceKinds.Mission, OutcomeSourceKinds.Management, OutcomeSourceKinds.System, OutcomeSourceKinds.Migration];
    private static readonly HashSet<string> RepairStatusValues =
        [RepairStatuses.NotStarted, RepairStatuses.Scheduled, RepairStatuses.InProgress, RepairStatuses.Complete, RepairStatuses.Cancelled];
    private static readonly HashSet<string> WorkOrderTypeValues = [WorkOrderTypes.Repair, WorkOrderTypes.Cleanup];
    private static readonly HashSet<string> AccessStateValues = [AccessStates.Open, AccessStates.Restricted, AccessStates.Closed];
    private static readonly HashSet<string> FollowUpStatusValues =
        [FollowUpStatuses.Locked, FollowUpStatuses.Available, FollowUpStatuses.Completed, FollowUpStatuses.Failed, FollowUpStatuses.Expired];
    private static readonly HashSet<string> ServiceNames = new(ServiceTypes.All, StringComparer.Ordinal);
    private static readonly IReadOnlyDictionary<string, FactionDefinition> Factions =
        ReadOnlyMap(ContentDefinitions.Factions.ToDictionary(item => item.Id, StringComparer.Ordinal));
    private static readonly HashSet<string> ProgressionIds =
        new(ContentDefinitions.Progression.Select(item => item.Id), StringComparer.Ordinal);
    private static readonly HashSet<string> DistrictIds =
        new(ContentDefinitions.Districts.Select(item => item.Id), StringComparer.Ordinal);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly EconomyLedger? economy;
    private readonly GameContentRegistry? content;
    private readonly List<Action<MissionOutcomeEvent>> listeners = [];
    private readonly Dictionary<string, MissionOutcomeReceipt> transactions = new(StringComparer.Ordinal);
    private MutableState state;
    private long sequence;
    private string? activeTransactionId;

    public MissionOutcomeService(
        EconomyLedger? economy = null,
        GameContentRegistry? content = null,
        IReadOnlyDictionary<string, double>? factions = null,
        IReadOnlyDictionary<string, bool>? progression = null)
    {
        this.economy = economy;
        this.content = content;
        state = MutableState.Empty(factions, progression);
        ValidateStoredState(state.ToReadOnly(), content);
    }

    public MissionOutcomeReceipt Apply(MissionOutcomeTransaction transaction)
    {
        NormalizedTransaction normalized = NormalizeTransaction(transaction);
        if (transactions.TryGetValue(normalized.Transaction.TransactionId, out MissionOutcomeReceipt? existing))
        {
            if (existing.Fingerprint != normalized.Fingerprint)
            {
                throw new OutcomeConflictException(normalized.Transaction.TransactionId);
            }
            return existing with { Duplicate = true };
        }

        MutableState draft = state.Clone();
        double initialCapital = economy?.Treasury ?? 0;
        double projectedCapital = initialCapital;
        var effects = new List<OutcomeEffect>(normalized.Transaction.Commands.Count);
        for (int index = 0; index < normalized.Transaction.Commands.Count; index += 1)
        {
            OutcomeCommand command = normalized.Transaction.Commands[index];
            effects.Add(ApplyCommand(
                draft,
                command,
                normalized.Transaction.TransactionId,
                normalized.Transaction.Summary!.Description,
                ref projectedCapital));
        }
        if (projectedCapital < 0)
        {
            throw new OutcomeApplicationException(
                "Outcome would reduce Capital below zero",
                normalized.Transaction.TransactionId);
        }
        if (activeTransactionId is not null)
        {
            throw new OutcomeApplicationException(
                $"Cannot apply {normalized.Transaction.TransactionId} while outcome {activeTransactionId} is committing",
                normalized.Transaction.TransactionId);
        }

        double capitalDelta = projectedCapital - initialCapital;
        MissionOutcomeReceipt receipt;
        activeTransactionId = normalized.Transaction.TransactionId;
        try
        {
            if (capitalDelta > 0)
            {
                economy?.Earn(capitalDelta, "mission-outcome", normalized.Transaction.TransactionId);
            }
            else if (capitalDelta < 0 && economy is not null)
            {
                bool applied = economy.Spend(-capitalDelta, new SpendingContext
                {
                    Source = "mission-outcome",
                    ReferenceId = normalized.Transaction.TransactionId,
                    Category = SpendingCategories.Essential,
                });
                if (!applied)
                {
                    throw new OutcomeApplicationException(
                        "Outcome Capital debit could not be applied",
                        normalized.Transaction.TransactionId);
                }
            }

            state = draft;
            sequence += 1;
            receipt = new MissionOutcomeReceipt
            {
                TransactionId = normalized.Transaction.TransactionId,
                Fingerprint = normalized.Fingerprint,
                Sequence = sequence,
                Source = normalized.Transaction.Source,
                Summary = normalized.Transaction.Summary!,
                Commands = Array.AsReadOnly(normalized.Transaction.Commands.ToArray()),
                Effects = Array.AsReadOnly(effects.ToArray()),
                Duplicate = false,
            };
            transactions.Add(receipt.TransactionId, receipt);
        }
        finally
        {
            activeTransactionId = null;
        }

        Publish("APPLIED", receipt);
        return receipt;
    }

    public bool HasApplied(string transactionId) => transactions.ContainsKey(RequireText(transactionId, "transactionId"));

    public MissionOutcomeReceipt? GetReceipt(string transactionId) =>
        transactions.GetValueOrDefault(RequireText(transactionId, "transactionId"));

    public MissionOutcomeExplanation? Explain(string transactionId)
    {
        MissionOutcomeReceipt? receipt = GetReceipt(transactionId);
        return receipt is null
            ? null
            : new MissionOutcomeExplanation(
                receipt.TransactionId,
                receipt.Source,
                receipt.Summary.Title,
                receipt.Summary.Description,
                Array.AsReadOnly(receipt.Effects.ToArray()));
    }

    public MissionOutcomeSnapshot Snapshot() => new()
    {
        Revision = sequence,
        State = state.ToReadOnly(),
        Transactions = Array.AsReadOnly(transactions.Values.ToArray()),
    };

    public MissionOutcomeStateDocument Serialize() => new()
    {
        Sequence = sequence,
        State = state.ToReadOnly(),
        Transactions = Array.AsReadOnly(transactions.Values.ToArray()),
    };

    public MissionOutcomeSnapshot Restore(MissionOutcomeStateDocument document)
    {
        ValidateState(document, economy, content);
        var restoredTransactions = new Dictionary<string, MissionOutcomeReceipt>(StringComparer.Ordinal);
        foreach (MissionOutcomeReceipt receipt in document.Transactions)
        {
            restoredTransactions.Add(receipt.TransactionId, FreezeReceipt(receipt));
        }
        MutableState restoredState = MutableState.From(document.State);

        state = restoredState;
        transactions.Clear();
        foreach ((string id, MissionOutcomeReceipt receipt) in restoredTransactions) transactions.Add(id, receipt);
        sequence = document.Sequence;
        Publish("RESTORED", null);
        return Snapshot();
    }

    public Func<bool> Subscribe(Action<MissionOutcomeEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent) listener(new MissionOutcomeEvent("SNAPSHOT", null, Snapshot()));
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public void Destroy() => listeners.Clear();

    public static MissionOutcomeStateDocument CreateEmptyState(
        IReadOnlyDictionary<string, double>? factions = null,
        IReadOnlyDictionary<string, bool>? progression = null) => new()
        {
            Sequence = 0,
            State = MutableState.Empty(factions, progression).ToReadOnly(),
            Transactions = Array.Empty<MissionOutcomeReceipt>(),
        };

    public static void ValidateState(
        MissionOutcomeStateDocument document,
        EconomyLedger? economy = null,
        GameContentRegistry? content = null)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (document.Version != StateVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(document), $"Unsupported mission outcome state version: {document.Version}");
        }
        if (document.Sequence < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(document), "mission outcome state sequence must be non-negative.");
        }
        ValidateStoredState(document.State, content);
        ArgumentNullException.ThrowIfNull(document.Transactions);
        var transactionIds = new HashSet<string>(StringComparer.Ordinal);
        var receiptSequences = new HashSet<long>();
        foreach (MissionOutcomeReceipt receipt in document.Transactions)
        {
            ArgumentNullException.ThrowIfNull(receipt);
            string transactionId = RequireText(receipt.TransactionId, "outcome receipt transactionId");
            if (!transactionIds.Add(transactionId)) throw new InvalidOperationException($"Duplicate outcome transaction: {transactionId}");
            RequireText(receipt.Fingerprint, "outcome receipt fingerprint");
            if (receipt.Sequence < 1) throw new ArgumentOutOfRangeException(nameof(document), "Outcome receipt sequence must be positive.");
            if (!receiptSequences.Add(receipt.Sequence)) throw new InvalidOperationException($"Duplicate outcome sequence: {receipt.Sequence}");
            if (receipt.Commands.Count != receipt.Effects.Count)
            {
                throw new ArgumentException($"Outcome transaction {transactionId} command/effect counts must match.", nameof(document));
            }
            var validator = new MissionOutcomeService(economy, content);
            NormalizedTransaction normalized = validator.NormalizeTransaction(new MissionOutcomeTransaction(
                transactionId,
                receipt.Source,
                receipt.Commands,
                receipt.Summary));
            if (normalized.Fingerprint != receipt.Fingerprint)
            {
                throw new InvalidOperationException($"Outcome transaction {transactionId} fingerprint does not match its content.");
            }
            foreach (OutcomeEffect effect in receipt.Effects)
            {
                RequireText(effect.Type, "outcome effect type");
                RequireText(effect.SubjectId, "outcome effect subjectId");
                RequireText(effect.Explanation, "outcome effect explanation");
            }
        }
        if (document.Transactions.Count > document.Sequence)
        {
            throw new ArgumentOutOfRangeException(nameof(document), "Mission outcome sequence cannot precede its transaction count.");
        }
        if (receiptSequences.Count > 0 && receiptSequences.Max() > document.Sequence)
        {
            throw new ArgumentOutOfRangeException(nameof(document), "Mission outcome receipt sequence exceeds state sequence.");
        }
    }

    private NormalizedTransaction NormalizeTransaction(MissionOutcomeTransaction transaction)
    {
        ArgumentNullException.ThrowIfNull(transaction);
        string transactionId = RequireText(transaction.TransactionId, "outcome.transactionId");
        OutcomeSource source = NormalizeSource(transaction.Source);
        OutcomeSummary summary = transaction.Summary is null
            ? new OutcomeSummary(
                $"{source.Kind.ToLowerInvariant()} outcome",
                source.Reason ?? $"Outcome from {source.ContentId}")
            : new OutcomeSummary(
                RequireText(transaction.Summary.Title, "outcome.summary.title"),
                RequireText(transaction.Summary.Description, "outcome.summary.description"));
        ArgumentNullException.ThrowIfNull(transaction.Commands);
        if (transaction.Commands.Count == 0) throw new ArgumentException("outcome.commands must be non-empty.", nameof(transaction));

        var commands = new List<OutcomeCommand>(transaction.Commands.Count);
        var commandIds = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < transaction.Commands.Count; index += 1)
        {
            OutcomeCommand command = NormalizeCommand(transaction.Commands[index], index);
            if (!commandIds.Add(command.CommandId!))
            {
                throw new InvalidOperationException($"Duplicate outcome commandId: {command.CommandId}");
            }
            commands.Add(command);
        }
        var normalized = new MissionOutcomeTransaction(
            transactionId,
            source,
            Array.AsReadOnly(commands.ToArray()),
            summary);
        return new NormalizedTransaction(normalized, Fingerprint(normalized));
    }

    private OutcomeCommand NormalizeCommand(OutcomeCommand command, int index)
    {
        ArgumentNullException.ThrowIfNull(command);
        string commandId = command.CommandId is null
            ? $"command-{index + 1}"
            : RequireText(command.CommandId, $"outcome.commands[{index}].commandId");
        string? reason = OptionalText(command.Reason, $"outcome.commands[{index}].reason");

        return command switch
        {
            CapitalAdjustedCommand value => value with
            {
                Amount = RequireFinite(value.Amount, "CAPITAL_ADJUSTED.amount"),
                CommandId = commandId,
                Reason = reason,
            },
            BuildingStateSetCommand value => NormalizeBuilding(value, commandId, reason),
            InfrastructureStateSetCommand value => value with
            {
                InfrastructureId = RequireText(value.InfrastructureId, "INFRASTRUCTURE_STATE_SET.infrastructureId"),
                DistrictId = KnownDistrict(value.DistrictId, "INFRASTRUCTURE_STATE_SET.districtId", optional: true),
                State = RequireText(value.State, "INFRASTRUCTURE_STATE_SET.state").ToUpperInvariant(),
                Access = EnumValue(value.Access, AccessStateValues, "INFRASTRUCTURE_STATE_SET.access"),
                Condition = NumberInRange(value.Condition, 0, 1, "INFRASTRUCTURE_STATE_SET.condition"),
                Safety = NumberInRange(value.Safety, 0, 1, "INFRASTRUCTURE_STATE_SET.safety"),
                CommandId = commandId,
                Reason = reason,
            },
            IncidentRecordedCommand value => NormalizeIncident(value, commandId, reason),
            IncidentResolvedCommand value => value with
            {
                IncidentId = RequireText(value.IncidentId, "INCIDENT_RESOLVED.incidentId"),
                CommandId = commandId,
                Reason = reason,
            },
            RepairSetCommand value => NormalizeRepair(value, commandId, reason),
            ServiceOutageSetCommand value => NormalizeOutage(value, commandId, reason),
            TrafficSetCommand value => value with
            {
                ScopeId = RequireText(value.ScopeId, "TRAFFIC_SET.scopeId"),
                DistrictId = KnownDistrict(value.DistrictId, "TRAFFIC_SET.districtId", optional: true),
                DensityMultiplier = NumberInRange(value.DensityMultiplier, 0, 5, "TRAFFIC_SET.densityMultiplier"),
                Access = EnumValue(value.Access, AccessStateValues, "TRAFFIC_SET.access"),
                Enforcement = NumberInRange(value.Enforcement, 0, 1, "TRAFFIC_SET.enforcement"),
                HazardLevel = NumberInRange(value.HazardLevel, 0, 1, "TRAFFIC_SET.hazardLevel"),
                CommandId = commandId,
                Reason = reason,
            },
            FactionReputationAdjustedCommand value => value with
            {
                FactionId = KnownFaction(value.FactionId),
                Delta = RequireFinite(value.Delta, "FACTION_REPUTATION_ADJUSTED.delta"),
                CommandId = commandId,
                Reason = reason,
            },
            ProgressionSetCommand value => value with
            {
                ProgressionId = KnownProgression(value.ProgressionId),
                CommandId = commandId,
                Reason = reason,
            },
            UnlockSetCommand value => value with
            {
                UnlockId = RequireText(value.UnlockId, "UNLOCK_SET.unlockId"),
                CommandId = commandId,
                Reason = reason,
            },
            NewsPublishedCommand value => value with
            {
                NewsId = RequireText(value.NewsId, "NEWS_PUBLISHED.newsId"),
                Headline = RequireText(value.Headline, "NEWS_PUBLISHED.headline"),
                Body = RequireText(value.Body, "NEWS_PUBLISHED.body"),
                Priority = NumberInRange(value.Priority, 0, 3, "NEWS_PUBLISHED.priority"),
                CommandId = commandId,
                Reason = reason,
            },
            FollowUpMissionSetCommand value => value with
            {
                MissionId = KnownMission(value.MissionId),
                Status = EnumValue(value.Status, FollowUpStatusValues, "FOLLOW_UP_MISSION_SET.status"),
                CommandId = commandId,
                Reason = reason,
            },
            AuthoredFlagSetCommand value => value with
            {
                FlagId = RequireText(value.FlagId, "AUTHORED_FLAG_SET.flagId"),
                Value = NormalizeAuthoredValue(value.Value),
                CommandId = commandId,
                Reason = reason,
            },
            _ => throw new ArgumentOutOfRangeException(nameof(command), $"Unsupported mission outcome command: {command.GetType().Name}"),
        };
    }

    private BuildingStateSetCommand NormalizeBuilding(BuildingStateSetCommand value, string commandId, string? reason)
    {
        string buildingId = RequireText(value.BuildingId, "BUILDING_STATE_SET.buildingId");
        if (economy?.GetBuilding(buildingId) is null)
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"Unknown economy building: {buildingId}");
        }
        string buildingState = RequireText(value.State, "BUILDING_STATE_SET.state").ToUpperInvariant();
        return value with
        {
            BuildingId = buildingId,
            State = buildingState,
            Operational = value.Operational ?? buildingState == "ACTIVE",
            CommandId = commandId,
            Reason = reason,
        };
    }

    private IncidentRecordedCommand NormalizeIncident(IncidentRecordedCommand value, string commandId, string? reason) => value with
    {
        IncidentId = RequireText(value.IncidentId, "INCIDENT_RECORDED.incidentId"),
        IncidentType = RequireText(value.IncidentType, "INCIDENT_RECORDED.incidentType").ToUpperInvariant(),
        DistrictId = KnownDistrict(value.DistrictId, "INCIDENT_RECORDED.districtId", optional: true),
        Severity = NumberInRange(value.Severity, 0, 10, "INCIDENT_RECORDED.severity"),
        HappinessModifier = RequireFinite(value.HappinessModifier, "INCIDENT_RECORDED.happinessModifier"),
        LandValueModifier = RequireFinite(value.LandValueModifier, "INCIDENT_RECORDED.landValueModifier"),
        Position = NormalizePosition(value.Position, "INCIDENT_RECORDED.position"),
        InfluenceRadius = RequireNonNegative(value.InfluenceRadius, "INCIDENT_RECORDED.influenceRadius"),
        Title = OptionalText(value.Title, "INCIDENT_RECORDED.title"),
        Cause = OptionalText(value.Cause, "INCIDENT_RECORDED.cause"),
        TargetId = OptionalText(value.TargetId, "INCIDENT_RECORDED.targetId"),
        Service = NormalizeService(value.Service, optional: true),
        CommandId = commandId,
        Reason = reason,
    };

    private RepairSetCommand NormalizeRepair(RepairSetCommand value, string commandId, string? reason) => value with
    {
        TargetId = RequireText(value.TargetId, "REPAIR_SET.targetId"),
        WorkType = EnumValue(value.WorkType, WorkOrderTypeValues, "REPAIR_SET.workType"),
        Label = OptionalText(value.Label, "REPAIR_SET.label"),
        IncidentId = OptionalText(value.IncidentId, "REPAIR_SET.incidentId"),
        PrerequisiteTargetId = OptionalText(value.PrerequisiteTargetId, "REPAIR_SET.prerequisiteTargetId"),
        OutageId = OptionalText(value.OutageId, "REPAIR_SET.outageId"),
        InfrastructureId = OptionalText(value.InfrastructureId, "REPAIR_SET.infrastructureId"),
        Service = NormalizeService(value.Service, optional: true),
        DistrictId = KnownDistrict(value.DistrictId, "REPAIR_SET.districtId", optional: true),
        Position = NormalizePosition(value.Position, "REPAIR_SET.position"),
        InteractionRadius = NumberInRange(value.InteractionRadius, 1, 25, "REPAIR_SET.interactionRadius"),
        Status = EnumValue(value.Status, RepairStatusValues, "REPAIR_SET.status"),
        Progress = NumberInRange(value.Progress, 0, 1, "REPAIR_SET.progress"),
        EstimatedCost = RequireNonNegative(value.EstimatedCost, "REPAIR_SET.estimatedCost"),
        CommandId = commandId,
        Reason = reason,
    };

    private ServiceOutageSetCommand NormalizeOutage(ServiceOutageSetCommand value, string commandId, string? reason) => value with
    {
        OutageId = RequireText(value.OutageId, "SERVICE_OUTAGE_SET.outageId"),
        Service = NormalizeService(value.Service)!,
        DistrictId = KnownDistrict(value.DistrictId, "SERVICE_OUTAGE_SET.districtId", optional: true),
        Severity = NumberInRange(value.Severity, 0, 1, "SERVICE_OUTAGE_SET.severity"),
        CoverageMultiplier = NumberInRange(value.CoverageMultiplier, 0, 1, "SERVICE_OUTAGE_SET.coverageMultiplier"),
        TargetId = OptionalText(value.TargetId, "SERVICE_OUTAGE_SET.targetId"),
        Cause = OptionalText(value.Cause, "SERVICE_OUTAGE_SET.cause"),
        Position = NormalizePosition(value.Position, "SERVICE_OUTAGE_SET.position"),
        InfluenceRadius = RequireNonNegative(value.InfluenceRadius, "SERVICE_OUTAGE_SET.influenceRadius"),
        CommandId = commandId,
        Reason = reason,
    };

    private static OutcomeEffect ApplyCommand(
        MutableState state,
        OutcomeCommand command,
        string transactionId,
        string defaultExplanation,
        ref double projectedCapital)
    {
        string explanation = command.Reason ?? defaultExplanation;
        string commandId = command.CommandId!;
        switch (command)
        {
            case CapitalAdjustedCommand value:
                {
                    double before = projectedCapital;
                    projectedCapital += value.Amount;
                    return Effect(OutcomeCommandTypes.CapitalAdjusted, "capital", before, projectedCapital, explanation);
                }
            case BuildingStateSetCommand value:
                return Set(
                    state.BuildingStates,
                    value.BuildingId,
                    new OutcomeBuildingState(value.State, value.Operational!.Value, transactionId, commandId),
                    OutcomeCommandTypes.BuildingStateSet,
                    explanation);
            case InfrastructureStateSetCommand value:
                return Set(
                    state.Infrastructure,
                    value.InfrastructureId,
                    new OutcomeInfrastructureState(
                        value.DistrictId,
                        value.State,
                        value.Access,
                        value.Condition,
                        value.Safety,
                        transactionId,
                        commandId),
                    OutcomeCommandTypes.InfrastructureStateSet,
                    explanation);
            case IncidentRecordedCommand value:
                return Set(
                    state.Incidents,
                    value.IncidentId,
                    new OutcomeIncidentState(
                        value.IncidentType,
                        value.DistrictId,
                        value.Severity,
                        true,
                        value.HappinessModifier,
                        value.LandValueModifier,
                        value.Position,
                        value.InfluenceRadius,
                        transactionId,
                        commandId,
                        value.Title,
                        value.Cause,
                        value.TargetId,
                        value.Service,
                        value.CleanupRequired,
                        value.RepairRequired),
                    OutcomeCommandTypes.IncidentRecorded,
                    explanation);
            case IncidentResolvedCommand value:
                {
                    state.Incidents.TryGetValue(value.IncidentId, out OutcomeIncidentState? before);
                    OutcomeIncidentState? after = before is null
                        ? null
                        : before with { Active = false, TransactionId = transactionId, CommandId = commandId };
                    if (after is not null) state.Incidents[value.IncidentId] = after;
                    return Effect(OutcomeCommandTypes.IncidentResolved, value.IncidentId, before, after, explanation);
                }
            case RepairSetCommand value:
                return Set(
                    state.Repairs,
                    value.TargetId,
                    new OutcomeRepairState(
                        value.WorkType,
                        value.Label,
                        value.IncidentId,
                        value.PrerequisiteTargetId,
                        value.OutageId,
                        value.InfrastructureId,
                        value.Service,
                        value.DistrictId,
                        value.Position,
                        value.InteractionRadius,
                        value.ResolvesIncident,
                        value.Status,
                        value.Progress,
                        value.EstimatedCost,
                        transactionId,
                        commandId),
                    OutcomeCommandTypes.RepairSet,
                    explanation);
            case ServiceOutageSetCommand value:
                return Set(
                    state.ServiceOutages,
                    value.OutageId,
                    new OutcomeServiceOutageState(
                        value.Service,
                        value.TargetId,
                        value.Cause,
                        value.Position,
                        value.InfluenceRadius,
                        value.DistrictId,
                        value.Active,
                        value.Severity,
                        value.CoverageMultiplier,
                        transactionId,
                        commandId),
                    OutcomeCommandTypes.ServiceOutageSet,
                    explanation);
            case TrafficSetCommand value:
                return Set(
                    state.Traffic,
                    value.ScopeId,
                    new OutcomeTrafficState(
                        value.DistrictId,
                        value.DensityMultiplier,
                        value.Access,
                        value.Enforcement,
                        value.HazardLevel,
                        transactionId,
                        commandId),
                    OutcomeCommandTypes.TrafficSet,
                    explanation);
            case FactionReputationAdjustedCommand value:
                {
                    double before = state.Factions.GetValueOrDefault(value.FactionId);
                    FactionDefinition definition = Factions[value.FactionId];
                    double after = Math.Clamp(before + value.Delta, definition.MinReputation, definition.MaxReputation);
                    state.Factions[value.FactionId] = after;
                    return Effect(OutcomeCommandTypes.FactionReputationAdjusted, value.FactionId, before, after, explanation);
                }
            case ProgressionSetCommand value:
                return Set(state.Progression, value.ProgressionId, value.Unlocked, OutcomeCommandTypes.ProgressionSet, explanation);
            case UnlockSetCommand value:
                return Set(state.Unlocks, value.UnlockId, value.Unlocked, OutcomeCommandTypes.UnlockSet, explanation);
            case NewsPublishedCommand value:
                return Set(
                    state.News,
                    value.NewsId,
                    new OutcomeNewsState(value.Headline, value.Body, value.Priority, transactionId, commandId),
                    OutcomeCommandTypes.NewsPublished,
                    explanation);
            case FollowUpMissionSetCommand value:
                return Set(
                    state.FollowUpMissions,
                    value.MissionId,
                    new OutcomeFollowUpState(value.Status, transactionId, commandId),
                    OutcomeCommandTypes.FollowUpMissionSet,
                    explanation);
            case AuthoredFlagSetCommand value:
                return Set(
                    state.Flags,
                    value.FlagId,
                    new OutcomeFlagState(value.Value.Clone(), transactionId, commandId),
                    OutcomeCommandTypes.AuthoredFlagSet,
                    explanation);
            default:
                throw new ArgumentOutOfRangeException(nameof(command), $"Unsupported mission outcome command: {command.GetType().Name}");
        }
    }

    private static OutcomeEffect Set<T>(
        Dictionary<string, T> collection,
        string id,
        T value,
        string type,
        string explanation)
    {
        collection.TryGetValue(id, out T? before);
        collection[id] = value;
        return Effect(type, id, before, value, explanation);
    }

    private static OutcomeEffect Effect(string type, string subjectId, object? before, object? after, string explanation) => new(
        type,
        subjectId,
        ToElement(before),
        ToElement(after),
        explanation);

    private static JsonElement? ToElement(object? value) => value is null
        ? null
        : JsonSerializer.SerializeToElement(value, value.GetType(), JsonOptions);

    private static void ValidateStoredState(MissionOutcomeState value, GameContentRegistry? content)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(value.BuildingStates);
        ArgumentNullException.ThrowIfNull(value.Infrastructure);
        ArgumentNullException.ThrowIfNull(value.Incidents);
        ArgumentNullException.ThrowIfNull(value.Repairs);
        ArgumentNullException.ThrowIfNull(value.ServiceOutages);
        ArgumentNullException.ThrowIfNull(value.Traffic);
        ArgumentNullException.ThrowIfNull(value.Factions);
        ArgumentNullException.ThrowIfNull(value.Progression);
        ArgumentNullException.ThrowIfNull(value.Unlocks);
        ArgumentNullException.ThrowIfNull(value.News);
        ArgumentNullException.ThrowIfNull(value.FollowUpMissions);
        ArgumentNullException.ThrowIfNull(value.Flags);

        foreach ((string id, double reputation) in value.Factions)
        {
            FactionDefinition definition = Factions.GetValueOrDefault(RequireText(id, "outcome faction ID"))
                ?? throw new ArgumentOutOfRangeException(nameof(value), $"Outcome state references unknown faction {id}");
            RequireFinite(reputation, $"outcome state faction {id}");
            if (reputation < definition.MinReputation || reputation > definition.MaxReputation)
            {
                throw new ArgumentOutOfRangeException(nameof(value), $"Outcome state faction {id} is outside its authored range.");
            }
        }
        foreach (string id in value.Progression.Keys)
        {
            if (!ProgressionIds.Contains(id)) throw new ArgumentOutOfRangeException(nameof(value), $"Outcome state references unknown progression {id}");
        }
        foreach (string id in value.Unlocks.Keys) RequireText(id, "outcome unlock ID");
        foreach ((string id, OutcomeFollowUpState followUp) in value.FollowUpMissions)
        {
            if (content is not null && content.Missions.Get(id) is null)
            {
                throw new ArgumentOutOfRangeException(nameof(value), $"Outcome state references unknown follow-up mission {id}");
            }
            EnumValue(followUp.Status, FollowUpStatusValues, $"outcome follow-up {id} status");
        }
        foreach ((string id, OutcomeRepairState repair) in value.Repairs)
        {
            EnumValue(repair.WorkType, WorkOrderTypeValues, $"outcome repair {id} workType");
            EnumValue(repair.Status, RepairStatusValues, $"outcome repair {id} status");
            NumberInRange(repair.Progress, 0, 1, $"outcome repair {id} progress");
            RequireNonNegative(repair.EstimatedCost, $"outcome repair {id} estimatedCost");
            NumberInRange(repair.InteractionRadius, 1, 25, $"outcome repair {id} interactionRadius");
            NormalizePosition(repair.Position, $"outcome repair {id} position");
        }
        foreach ((string id, OutcomeServiceOutageState outage) in value.ServiceOutages)
        {
            NormalizeService(outage.Service);
            NumberInRange(outage.Severity, 0, 1, $"outcome outage {id} severity");
            NumberInRange(outage.CoverageMultiplier, 0, 1, $"outcome outage {id} coverageMultiplier");
            RequireNonNegative(outage.InfluenceRadius, $"outcome outage {id} influenceRadius");
            NormalizePosition(outage.Position, $"outcome outage {id} position");
        }
        foreach ((string id, OutcomeTrafficState traffic) in value.Traffic)
        {
            NumberInRange(traffic.DensityMultiplier, 0, 5, $"outcome traffic {id} densityMultiplier");
            EnumValue(traffic.Access, AccessStateValues, $"outcome traffic {id} access");
            NumberInRange(traffic.Enforcement, 0, 1, $"outcome traffic {id} enforcement");
            NumberInRange(traffic.HazardLevel, 0, 1, $"outcome traffic {id} hazardLevel");
        }
        foreach (string id in value.BuildingStates.Keys) RequireText(id, "outcome building state ID");
        foreach (string id in value.Infrastructure.Keys) RequireText(id, "outcome infrastructure ID");
        foreach (string id in value.Incidents.Keys) RequireText(id, "outcome incident ID");
        foreach (string id in value.News.Keys) RequireText(id, "outcome news ID");
        foreach ((string id, OutcomeFlagState flag) in value.Flags)
        {
            RequireText(id, "outcome flag ID");
            NormalizeAuthoredValue(flag.Value);
        }
    }

    private void Publish(string type, MissionOutcomeReceipt? receipt)
    {
        var outcomeEvent = new MissionOutcomeEvent(type, receipt, Snapshot());
        foreach (Action<MissionOutcomeEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(outcomeEvent);
            }
            catch (Exception)
            {
                // UI, persistence, and diagnostics listeners cannot interrupt outcome authority.
            }
        }
    }

    private static MissionOutcomeReceipt FreezeReceipt(MissionOutcomeReceipt receipt) => receipt with
    {
        Commands = Array.AsReadOnly(receipt.Commands.ToArray()),
        Effects = Array.AsReadOnly(receipt.Effects.Select(effect => effect with
        {
            Before = effect.Before?.Clone(),
            After = effect.After?.Clone(),
        }).ToArray()),
    };

    private static OutcomeSource NormalizeSource(OutcomeSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        string kind = RequireText(source.Kind, "outcome.source.kind").ToUpperInvariant();
        if (!SourceKinds.Contains(kind)) throw new ArgumentOutOfRangeException(nameof(source), $"Unsupported outcome source kind: {kind}");
        return source with
        {
            Kind = kind,
            ContentId = RequireText(source.ContentId, "outcome.source.contentId"),
            Outcome = OptionalText(source.Outcome, "outcome.source.outcome"),
            RunId = OptionalText(source.RunId, "outcome.source.runId"),
            ActorId = OptionalText(source.ActorId, "outcome.source.actorId"),
            Reason = OptionalText(source.Reason, "outcome.source.reason"),
        };
    }

    private string KnownMission(string value)
    {
        string id = RequireText(value, "FOLLOW_UP_MISSION_SET.missionId");
        if (content is not null && content.Missions.Get(id) is null)
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"FOLLOW_UP_MISSION_SET.missionId references unknown mission content ID {id}");
        }
        return id;
    }

    private static string KnownFaction(string value)
    {
        string id = RequireText(value, "FACTION_REPUTATION_ADJUSTED.factionId");
        if (!Factions.ContainsKey(id))
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"FACTION_REPUTATION_ADJUSTED.factionId references unknown faction content ID {id}");
        }
        return id;
    }

    private static string KnownProgression(string value)
    {
        string id = RequireText(value, "PROGRESSION_SET.progressionId");
        if (!ProgressionIds.Contains(id))
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"PROGRESSION_SET.progressionId references unknown progression content ID {id}");
        }
        return id;
    }

    private static string? KnownDistrict(string? value, string label, bool optional = false)
    {
        if (value is null && optional) return null;
        string id = RequireText(value, label);
        if (!DistrictIds.Contains(id)) throw new ArgumentOutOfRangeException(nameof(value), $"{label} references unknown district {id}");
        return id;
    }

    private static string? NormalizeService(string? value, bool optional = false)
    {
        if (value is null && optional) return null;
        string service = RequireText(value, "service").ToLowerInvariant();
        if (!ServiceNames.Contains(service)) throw new ArgumentOutOfRangeException(nameof(value), "service must be power, water, or fire.");
        return service;
    }

    private static OutcomePosition? NormalizePosition(OutcomePosition? value, string label)
    {
        if (value is null) return null;
        RequireFinite(value.X, $"{label}.x");
        RequireFinite(value.Z, $"{label}.z");
        return value;
    }

    private static JsonElement NormalizeAuthoredValue(JsonElement value)
    {
        if (value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False or JsonValueKind.Null))
        {
            throw new ArgumentException("AUTHORED_FLAG_SET.value must be a string, number, boolean, or null.", nameof(value));
        }
        double number = 0;
        if (value.ValueKind == JsonValueKind.Number && !value.TryGetDouble(out number))
        {
            throw new ArgumentException("AUTHORED_FLAG_SET.value must be a finite number.", nameof(value));
        }
        if (value.ValueKind == JsonValueKind.Number) RequireFinite(number, "AUTHORED_FLAG_SET.value");
        return value.Clone();
    }

    private static string Fingerprint(MissionOutcomeTransaction transaction)
    {
        JsonNode node = JsonSerializer.SerializeToNode(new
        {
            transactionId = transaction.TransactionId,
            source = transaction.Source,
            summary = transaction.Summary,
            commands = transaction.Commands,
        }, JsonOptions)!;
        return StableStringify(node);
    }

    private static string StableStringify(JsonNode? node)
    {
        if (node is null) return "null";
        if (node is JsonArray array)
        {
            return $"[{string.Join(',', array.Select(StableStringify))}]";
        }
        if (node is JsonObject value)
        {
            IEnumerable<string> entries = value
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => $"{JsonSerializer.Serialize(pair.Key)}:{StableStringify(pair.Value)}");
            return $"{{{string.Join(',', entries)}}}";
        }
        return node.ToJsonString();
    }

    private static string EnumValue(string value, HashSet<string> allowed, string label)
    {
        string normalized = RequireText(value, label).ToUpperInvariant();
        if (!allowed.Contains(normalized)) throw new ArgumentOutOfRangeException(nameof(value), $"{label} has unsupported value {normalized}.");
        return normalized;
    }

    private static double NumberInRange(double value, double min, double max, string label)
    {
        RequireFinite(value, label);
        if (value < min || value > max) throw new ArgumentOutOfRangeException(nameof(value), $"{label} must be between {min} and {max}.");
        return value;
    }

    private static double RequireNonNegative(double value, string label)
    {
        RequireFinite(value, label);
        if (value < 0) throw new ArgumentOutOfRangeException(nameof(value), $"{label} must be non-negative.");
        return value;
    }

    private static double RequireFinite(double value, string label)
    {
        if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(nameof(value), $"{label} must be finite.");
        return value;
    }

    private static string? OptionalText(string? value, string label) => value is null ? null : RequireText(value, label);

    private static string RequireText(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{label} must be a non-empty string.", label);
        return value.Trim();
    }

    private static IReadOnlyDictionary<string, T> ReadOnlyMap<T>(Dictionary<string, T> value) =>
        new ReadOnlyDictionary<string, T>(value);

    private sealed record NormalizedTransaction(MissionOutcomeTransaction Transaction, string Fingerprint);

    private sealed class MutableState
    {
        public Dictionary<string, OutcomeBuildingState> BuildingStates { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeInfrastructureState> Infrastructure { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeIncidentState> Incidents { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeRepairState> Repairs { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeServiceOutageState> ServiceOutages { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeTrafficState> Traffic { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, double> Factions { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, bool> Progression { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, bool> Unlocks { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeNewsState> News { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeFollowUpState> FollowUpMissions { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, OutcomeFlagState> Flags { get; init; } = new(StringComparer.Ordinal);

        public static MutableState Empty(
            IReadOnlyDictionary<string, double>? factions = null,
            IReadOnlyDictionary<string, bool>? progression = null) => new()
            {
                Factions = factions?.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal) ?? new(StringComparer.Ordinal),
                Progression = progression?.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal) ?? new(StringComparer.Ordinal),
            };

        public static MutableState From(MissionOutcomeState value) => new()
        {
            BuildingStates = value.BuildingStates.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Infrastructure = value.Infrastructure.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Incidents = value.Incidents.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Repairs = value.Repairs.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            ServiceOutages = value.ServiceOutages.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Traffic = value.Traffic.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Factions = value.Factions.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Progression = value.Progression.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Unlocks = value.Unlocks.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            News = value.News.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            FollowUpMissions = value.FollowUpMissions.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
            Flags = value.Flags.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        };

        public MutableState Clone() => From(ToReadOnly());

        public MissionOutcomeState ToReadOnly() => new()
        {
            BuildingStates = ReadOnlyMap(new Dictionary<string, OutcomeBuildingState>(BuildingStates, StringComparer.Ordinal)),
            Infrastructure = ReadOnlyMap(new Dictionary<string, OutcomeInfrastructureState>(Infrastructure, StringComparer.Ordinal)),
            Incidents = ReadOnlyMap(new Dictionary<string, OutcomeIncidentState>(Incidents, StringComparer.Ordinal)),
            Repairs = ReadOnlyMap(new Dictionary<string, OutcomeRepairState>(Repairs, StringComparer.Ordinal)),
            ServiceOutages = ReadOnlyMap(new Dictionary<string, OutcomeServiceOutageState>(ServiceOutages, StringComparer.Ordinal)),
            Traffic = ReadOnlyMap(new Dictionary<string, OutcomeTrafficState>(Traffic, StringComparer.Ordinal)),
            Factions = ReadOnlyMap(new Dictionary<string, double>(Factions, StringComparer.Ordinal)),
            Progression = ReadOnlyMap(new Dictionary<string, bool>(Progression, StringComparer.Ordinal)),
            Unlocks = ReadOnlyMap(new Dictionary<string, bool>(Unlocks, StringComparer.Ordinal)),
            News = ReadOnlyMap(new Dictionary<string, OutcomeNewsState>(News, StringComparer.Ordinal)),
            FollowUpMissions = ReadOnlyMap(new Dictionary<string, OutcomeFollowUpState>(FollowUpMissions, StringComparer.Ordinal)),
            Flags = ReadOnlyMap(new Dictionary<string, OutcomeFlagState>(Flags, StringComparer.Ordinal)),
        };
    }
}

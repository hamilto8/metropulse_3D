using System.Globalization;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Services;

public sealed record IncidentDefinition
{
    public required string Id { get; init; }
    public string? Type { get; init; }
    public string? Title { get; init; }
    public string? Cause { get; init; }
    public string? TargetId { get; init; }
    public string? InfrastructureId { get; init; }
    public string? DistrictId { get; init; }
    public string? Service { get; init; }
    public double Severity { get; init; } = 4;
    public bool CleanupRequired { get; init; } = true;
    public bool RepairRequired { get; init; } = true;
    public double? CleanupCost { get; init; }
    public double? RepairCost { get; init; }
    public double? CoverageMultiplier { get; init; }
    public double? HappinessModifier { get; init; }
    public double? LandValueModifier { get; init; }
    public required OutcomePosition Position { get; init; }
    public double InfluenceRadius { get; init; } = 75;
    public double InteractionRadius { get; init; } = 7;
    public string Access { get; init; } = AccessStates.Restricted;
}

public sealed record IncidentView(string Id, OutcomeIncidentState State)
{
    public bool Active => State.Active;
    public string? Title => State.Title;
}

public sealed record IncidentWorkOrder(
    string Id,
    OutcomeRepairState State,
    bool PrerequisiteMet,
    bool Actionable)
{
    public string Status => State.Status;
    public string WorkType => State.WorkType;
    public double Progress => State.Progress;
    public string? IncidentId => State.IncidentId;
}

public sealed record IncidentSummary(
    IncidentView Incident,
    string Title,
    IReadOnlyList<IncidentWorkOrder> WorkOrders,
    double ResponseCost,
    bool ResponseScheduled);

public sealed record IncidentReportResult(MissionOutcomeReceipt? Receipt, IncidentView Incident, bool Duplicate = false);

public sealed record IncidentFundingResult(
    MissionOutcomeReceipt? Receipt,
    IncidentView Incident,
    IReadOnlyList<IncidentWorkOrder> WorkOrders,
    bool Duplicate = false);

public sealed record StreetWorkResult(
    MissionOutcomeReceipt Receipt,
    IncidentWorkOrder WorkOrder,
    IncidentView? Incident);

/// <summary>Coordinates management funding and street work through idempotent outcome transactions.</summary>
public sealed class IncidentResponseService
{
    private readonly MissionOutcomeService outcomes;
    private readonly EconomyLedger economy;
    private readonly AlertService? alerts;
    private readonly double cleanupCostPerSeverity;
    private readonly double repairCostPerSeverity;

    public IncidentResponseService(
        MissionOutcomeService outcomes,
        EconomyLedger economy,
        AlertService? alerts = null,
        double? cleanupCostPerSeverity = null,
        double? repairCostPerSeverity = null)
    {
        this.outcomes = outcomes ?? throw new ArgumentNullException(nameof(outcomes));
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));
        this.alerts = alerts;
        var incidentBalance = economy.Balance.Incidents
            ?? throw new ArgumentException("Economy balance requires incident costs.", nameof(economy));
        this.cleanupCostPerSeverity = cleanupCostPerSeverity ?? incidentBalance.CleanupCostPerSeverity;
        this.repairCostPerSeverity = repairCostPerSeverity ?? incidentBalance.RepairCostPerSeverity;
    }

    public IncidentReportResult ReportIncident(IncidentDefinition definition)
    {
        NormalizedIncident incident = NormalizeIncident(definition);
        IncidentView? current = FindIncident(incident.Id);
        if (current is not null)
        {
            if (current.Active) return new IncidentReportResult(null, current, true);
            throw new InvalidOperationException($"Incident ID cannot be reused after resolution: {incident.Id}");
        }

        string? outageId = incident.Service is null ? null : $"outage:{incident.Id}";
        string? cleanupId = incident.CleanupRequired ? $"work:{incident.Id}:cleanup" : null;
        string? repairId = incident.RepairRequired ? $"work:{incident.Id}:repair" : null;
        var commands = new List<OutcomeCommand>
        {
            new IncidentRecordedCommand(
                incident.Id,
                incident.Type,
                incident.DistrictId,
                incident.Severity,
                incident.HappinessModifier,
                incident.LandValueModifier,
                incident.Position,
                incident.InfluenceRadius,
                incident.Title,
                incident.Cause,
                incident.TargetId,
                incident.Service,
                incident.CleanupRequired,
                incident.RepairRequired,
                Reason: incident.Cause),
        };
        if (incident.InfrastructureId is not null)
        {
            commands.Add(new InfrastructureStateSetCommand(
                incident.InfrastructureId,
                "DAMAGED",
                incident.DistrictId,
                incident.Access,
                Math.Clamp(1 - incident.Severity / 10, 0.1, 0.9),
                Math.Clamp(1 - incident.Severity / 8, 0.05, 0.9),
                Reason: $"{incident.Title} damaged this asset."));
        }
        if (outageId is not null)
        {
            commands.Add(new ServiceOutageSetCommand(
                outageId,
                incident.Service!,
                incident.DistrictId,
                true,
                Math.Clamp(incident.Severity / 10, 0, 1),
                incident.CoverageMultiplier,
                incident.TargetId,
                incident.Cause,
                incident.Position,
                incident.InfluenceRadius,
                Reason: incident.Cause));
        }
        if (cleanupId is not null)
        {
            commands.Add(NewWorkOrder(
                cleanupId,
                WorkOrderTypes.Cleanup,
                $"Clear {incident.Title.ToLowerInvariant()} debris",
                incident,
                incident.CleanupCost,
                outageId: outageId,
                resolvesIncident: !incident.RepairRequired));
        }
        if (repairId is not null)
        {
            commands.Add(NewWorkOrder(
                repairId,
                WorkOrderTypes.Repair,
                $"Repair {incident.Title.ToLowerInvariant()}",
                incident,
                incident.RepairCost,
                prerequisiteTargetId: cleanupId,
                outageId: outageId,
                resolvesIncident: true));
        }

        MissionOutcomeReceipt receipt = outcomes.Apply(new MissionOutcomeTransaction(
            $"incident:{incident.Id}:reported",
            new OutcomeSource(OutcomeSourceKinds.System, incident.Id, "REPORTED", Reason: incident.Cause),
            Array.AsReadOnly(commands.ToArray()),
            new OutcomeSummary(
                incident.Title,
                $"{incident.Cause} A funded response can create street work objectives.")));
        PublishIncidentAlert(incident, scheduled: false);
        return new IncidentReportResult(receipt, GetIncident(incident.Id)!);
    }

    public IncidentFundingResult ScheduleResponse(string incidentId)
    {
        string id = RequireText(incidentId, nameof(incidentId));
        IncidentView incident = GetIncident(id);
        if (!incident.Active) throw new InvalidOperationException($"Active incident not found: {id}");
        IncidentWorkOrder[] orders = GetWorkOrders().Where(order => order.IncidentId == id).ToArray();
        if (orders.Length == 0) throw new InvalidOperationException($"Incident {id} has no response work orders");
        IncidentWorkOrder[] unscheduled = orders
            .Where(order => order.Status is RepairStatuses.NotStarted or RepairStatuses.Cancelled)
            .ToArray();
        if (unscheduled.Length == 0)
        {
            return new IncidentFundingResult(null, incident, Array.AsReadOnly(orders), true);
        }
        double cost = unscheduled.Sum(order => order.State.EstimatedCost);
        if (!economy.CanAfford(cost))
        {
            throw new InvalidOperationException(
                $"Response requires ${FormatMoney(cost)} Capital; only ${FormatMoney(Math.Floor(economy.Treasury))} is available.");
        }
        var commands = new List<OutcomeCommand>();
        if (cost > 0)
        {
            commands.Add(new CapitalAdjustedCommand(
                -cost,
                Reason: $"Funded cleanup and repair response for {incident.Title ?? id}."));
        }
        commands.AddRange(unscheduled.Select(order => WorkOrderCommand(
            order,
            RepairStatuses.Scheduled,
            0,
            "Management funded this street work order.")));
        MissionOutcomeReceipt receipt = outcomes.Apply(new MissionOutcomeTransaction(
            $"management:incident:{id}:response-funded",
            new OutcomeSource(
                OutcomeSourceKinds.Management,
                id,
                "FUNDED",
                Reason: $"Management committed ${FormatMoney(cost)} to the response."),
            Array.AsReadOnly(commands.ToArray()),
            new OutcomeSummary(
                $"{incident.Title ?? "Incident"} response funded",
                "Cleanup and repair tasks are now available as street objectives.")));
        PublishIncidentAlert(ToNormalized(incident.State, id), scheduled: true);
        IncidentWorkOrder[] fundedOrders = GetWorkOrders().Where(order => order.IncidentId == id).ToArray();
        return new IncidentFundingResult(receipt, GetIncident(id), Array.AsReadOnly(fundedOrders));
    }

    public StreetWorkResult PerformStreetWork(string workOrderId, double progress = 0.5)
    {
        string id = RequireText(workOrderId, nameof(workOrderId));
        IncidentWorkOrder order = GetWorkOrder(id)
            ?? throw new InvalidOperationException($"Work order not found: {id}");
        if (!ActiveStatus(order.Status))
        {
            throw new InvalidOperationException($"Work order {id} must be scheduled before street work begins");
        }
        if (order.State.Position is null) throw new InvalidOperationException($"Work order {id} has no street location");
        IncidentWorkOrder? prerequisite = order.State.PrerequisiteTargetId is null
            ? null
            : GetWorkOrder(order.State.PrerequisiteTargetId);
        if (order.State.PrerequisiteTargetId is not null && prerequisite?.Status != RepairStatuses.Complete)
        {
            throw new InvalidOperationException($"{prerequisite?.State.Label ?? "Required cleanup"} must be completed first");
        }
        if (!double.IsFinite(progress)) throw new ArgumentOutOfRangeException(nameof(progress), "Progress must be finite.");
        double increment = Math.Clamp(progress, 0.01, 1);
        double nextProgress = Math.Clamp(order.Progress + increment, 0, 1);
        bool complete = nextProgress >= 1;
        var commands = new List<OutcomeCommand>
        {
            WorkOrderCommand(
                order,
                complete ? RepairStatuses.Complete : RepairStatuses.InProgress,
                nextProgress,
                complete ? $"{order.State.Label ?? id} completed on site." : $"{order.State.Label ?? id} advanced on site."),
        };
        MissionOutcomeState state = outcomes.Snapshot().State;
        OutcomeIncidentState? incident = order.State.IncidentId is null
            ? null
            : state.Incidents.GetValueOrDefault(order.State.IncidentId);
        OutcomeServiceOutageState? outage = order.State.OutageId is null
            ? null
            : state.ServiceOutages.GetValueOrDefault(order.State.OutageId);
        OutcomeInfrastructureState? infrastructure = order.State.InfrastructureId is null
            ? null
            : state.Infrastructure.GetValueOrDefault(order.State.InfrastructureId);
        if (complete && order.State.ResolvesIncident)
        {
            if (outage?.Active == true)
            {
                commands.Add(new ServiceOutageSetCommand(
                    order.State.OutageId!,
                    outage.Service,
                    outage.DistrictId,
                    false,
                    outage.Severity,
                    outage.CoverageMultiplier,
                    outage.TargetId,
                    outage.Cause,
                    outage.Position,
                    outage.InfluenceRadius,
                    Reason: "Field work restored local service."));
            }
            if (infrastructure is not null)
            {
                commands.Add(new InfrastructureStateSetCommand(
                    order.State.InfrastructureId!,
                    "ACTIVE",
                    infrastructure.DistrictId,
                    AccessStates.Open,
                    1,
                    1,
                    Reason: "Field work restored the damaged asset."));
            }
            if (incident?.Active == true)
            {
                commands.Add(new IncidentResolvedCommand(
                    order.State.IncidentId!,
                    Reason: "All required cleanup and repair work is complete."));
            }
        }
        int step = (int)Math.Round(nextProgress * 1000);
        MissionOutcomeReceipt receipt = outcomes.Apply(new MissionOutcomeTransaction(
            $"street-work:{id}:{step}",
            new OutcomeSource(
                OutcomeSourceKinds.System,
                id,
                complete ? "COMPLETE" : "PROGRESSED",
                ActorId: "player",
                Reason: complete ? "The player completed the field objective." : "The player advanced the field objective."),
            Array.AsReadOnly(commands.ToArray()),
            new OutcomeSummary(
                complete ? $"{order.State.Label ?? "Street work"} complete" : $"{order.State.Label ?? "Street work"} in progress",
                complete && order.State.ResolvesIncident
                    ? "Local service and infrastructure consequences were resolved."
                    : $"{Math.Round(nextProgress * 100)}% of the required field work is complete.")));
        if (complete && order.State.ResolvesIncident) PublishResolution(order, incident);
        return new StreetWorkResult(
            receipt,
            GetWorkOrder(id)!,
            order.State.IncidentId is null ? null : GetIncident(order.State.IncidentId));
    }

    public IncidentView? FindIncident(string id)
    {
        string normalized = RequireText(id, nameof(id));
        OutcomeIncidentState? state = outcomes.Snapshot().State.Incidents.GetValueOrDefault(normalized);
        return state is null ? null : new IncidentView(normalized, state);
    }

    public IncidentView GetIncident(string id) => FindIncident(id)
        ?? throw new InvalidOperationException($"Incident not found: {id}");

    public IncidentWorkOrder? GetWorkOrder(string id)
    {
        string normalized = RequireText(id, nameof(id));
        return GetWorkOrders().FirstOrDefault(order => order.Id == normalized);
    }

    public IReadOnlyList<IncidentWorkOrder> GetWorkOrders()
    {
        IReadOnlyDictionary<string, OutcomeRepairState> repairs = outcomes.Snapshot().State.Repairs;
        IncidentWorkOrder[] orders = repairs
            .Select(pair =>
            {
                OutcomeRepairState state = pair.Value;
                bool prerequisiteMet = state.PrerequisiteTargetId is null
                    || repairs.GetValueOrDefault(state.PrerequisiteTargetId)?.Status == RepairStatuses.Complete;
                string workType = state.WorkType is WorkOrderTypes.Cleanup or WorkOrderTypes.Repair
                    ? state.WorkType
                    : WorkOrderTypes.Repair;
                string status = state.Status is RepairStatuses.NotStarted or RepairStatuses.Scheduled
                    or RepairStatuses.InProgress or RepairStatuses.Complete or RepairStatuses.Cancelled
                    ? state.Status
                    : RepairStatuses.NotStarted;
                OutcomeRepairState normalized = state with { WorkType = workType, Status = status };
                return new IncidentWorkOrder(
                    pair.Key,
                    normalized,
                    prerequisiteMet,
                    ActiveStatus(status) && prerequisiteMet && state.Position is not null);
            })
            .OrderBy(order => order.Id, StringComparer.Ordinal)
            .ToArray();
        return Array.AsReadOnly(orders);
    }

    public IReadOnlyList<IncidentSummary> GetIncidentSummaries()
    {
        IReadOnlyList<IncidentWorkOrder> orders = GetWorkOrders();
        IncidentSummary[] summaries = outcomes.Snapshot().State.Incidents
            .Where(pair => pair.Value.Active)
            .Select(pair =>
            {
                IncidentWorkOrder[] incidentOrders = orders.Where(order => order.IncidentId == pair.Key).ToArray();
                double responseCost = incidentOrders
                    .Where(order => order.Status is RepairStatuses.NotStarted or RepairStatuses.Cancelled)
                    .Sum(order => order.State.EstimatedCost);
                return new IncidentSummary(
                    new IncidentView(pair.Key, pair.Value),
                    pair.Value.Title ?? $"{(pair.Value.Type ?? "Service").Replace('_', ' ')} incident",
                    Array.AsReadOnly(incidentOrders),
                    responseCost,
                    incidentOrders.Length > 0 && incidentOrders.All(order =>
                        order.Status is not (RepairStatuses.NotStarted or RepairStatuses.Cancelled)));
            })
            .ToArray();
        return Array.AsReadOnly(summaries);
    }

    private NormalizedIncident NormalizeIncident(IncidentDefinition value)
    {
        ArgumentNullException.ThrowIfNull(value);
        double severity = ClampFinite(value.Severity, "incident.Severity", 0, 10);
        string? service = value.Service is null ? null : RequireText(value.Service, "incident.Service").ToLowerInvariant();
        if (service is not null && !ServiceTypes.All.Contains(service, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Incident service must be power, water, or fire.");
        }
        if (!value.CleanupRequired && !value.RepairRequired)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "An incident response requires cleanup or repair work.");
        }
        ValidatePosition(value.Position);
        string id = RequireText(value.Id, "incident.Id");
        return new NormalizedIncident(
            id,
            RequireText(value.Type ?? (service is null ? "INFRASTRUCTURE_DAMAGE" : "SERVICE_OUTAGE"), "incident.Type").ToUpperInvariant(),
            RequireText(value.Title ?? "Infrastructure incident", "incident.Title"),
            RequireText(value.Cause ?? "A local asset failed and requires a field response.", "incident.Cause"),
            RequireText(value.TargetId ?? id, "incident.TargetId"),
            OptionalText(value.InfrastructureId, "incident.InfrastructureId"),
            OptionalText(value.DistrictId, "incident.DistrictId"),
            service,
            severity,
            value.CleanupRequired,
            value.RepairRequired,
            Math.Max(0, Finite(value.CleanupCost ?? severity * cleanupCostPerSeverity, "incident.CleanupCost")),
            Math.Max(0, Finite(value.RepairCost ?? severity * repairCostPerSeverity, "incident.RepairCost")),
            ClampFinite(value.CoverageMultiplier ?? Math.Max(0.2, 1 - severity / 10), "incident.CoverageMultiplier", 0, 1),
            Finite(value.HappinessModifier ?? -(severity * 0.5), "incident.HappinessModifier"),
            Finite(value.LandValueModifier ?? -severity, "incident.LandValueModifier"),
            value.Position,
            Math.Max(1, Finite(value.InfluenceRadius, "incident.InfluenceRadius")),
            ClampFinite(value.InteractionRadius, "incident.InteractionRadius", 1, 25),
            value.Access is AccessStates.Open or AccessStates.Restricted or AccessStates.Closed
                ? value.Access
                : AccessStates.Restricted);
    }

    private static NormalizedIncident ToNormalized(OutcomeIncidentState state, string id) => new(
        id,
        state.Type,
        state.Title ?? "Infrastructure incident",
        state.Cause ?? "A local asset failed and requires a field response.",
        state.TargetId ?? id,
        null,
        state.DistrictId,
        state.Service,
        state.Severity,
        state.CleanupRequired,
        state.RepairRequired,
        0,
        0,
        1,
        state.HappinessModifier,
        state.LandValueModifier,
        state.Position ?? new OutcomePosition(0, 0),
        state.InfluenceRadius,
        7,
        AccessStates.Restricted);

    private static RepairSetCommand NewWorkOrder(
        string id,
        string workType,
        string label,
        NormalizedIncident incident,
        double estimatedCost,
        string? prerequisiteTargetId = null,
        string? outageId = null,
        bool resolvesIncident = false) => new(
            id,
            RepairStatuses.NotStarted,
            0,
            estimatedCost,
            workType,
            label,
            incident.Id,
            prerequisiteTargetId,
            outageId,
            incident.InfrastructureId,
            incident.Service,
            incident.DistrictId,
            incident.Position,
            incident.InteractionRadius,
            resolvesIncident,
            Reason: $"{label} is required before the incident can be resolved.");

    private static RepairSetCommand WorkOrderCommand(
        IncidentWorkOrder order,
        string status,
        double progress,
        string reason) => new(
            order.Id,
            status,
            progress,
            order.State.EstimatedCost,
            order.WorkType,
            order.State.Label,
            order.State.IncidentId,
            order.State.PrerequisiteTargetId,
            order.State.OutageId,
            order.State.InfrastructureId,
            order.State.Service,
            order.State.DistrictId,
            order.State.Position,
            order.State.InteractionRadius,
            order.State.ResolvesIncident,
            Reason: reason);

    private void PublishIncidentAlert(NormalizedIncident incident, bool scheduled)
    {
        if (alerts is null) return;
        alerts.Publish(new AlertInput
        {
            DedupeKey = $"service-incident:{incident.Id}",
            Type = AlertTypes.Infrastructure,
            Severity = incident.Severity >= 7 ? AlertSeverities.Critical : AlertSeverities.Warning,
            Title = scheduled ? $"{incident.Title} response ready" : incident.Title,
            Cause = scheduled
                ? "Management funded the response; cleanup and repair now require street work."
                : incident.Cause,
            Location = new AlertLocation
            {
                Label = incident.DistrictId?.Replace('_', ' ').ToLowerInvariant() ?? "Service response site",
                DistrictId = incident.DistrictId,
                Position = new AlertPosition(incident.Position.X, 0, incident.Position.Z),
            },
            Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
            Recommendation = scheduled
                ? "Enter Street Mode, set the waypoint, and complete cleanup before repair."
                : "Inspect the site and fund its response from City Services.",
            RelatedEntityIds = new[] { incident.Id, incident.TargetId }.Distinct(StringComparer.Ordinal).ToArray(),
            FocusAction = new AlertFocusAction
            {
                Type = scheduled ? AlertFocusActions.StreetWaypoint : AlertFocusActions.ManagementCamera,
                Position = new AlertPosition(incident.Position.X, 0, incident.Position.Z),
            },
        });
    }

    private void PublishResolution(IncidentWorkOrder order, OutcomeIncidentState? incident)
    {
        if (alerts is null) return;
        string key = $"service-incident:{order.State.IncidentId}";
        alerts.Resolve(key, "Cleanup and repair objectives completed");
        OutcomePosition position = order.State.Position!;
        alerts.Publish(new AlertInput
        {
            DedupeKey = $"{key}:resolved",
            Type = AlertTypes.Infrastructure,
            Severity = AlertSeverities.Success,
            Title = $"{incident?.Title ?? order.State.Label ?? "Service incident"} resolved",
            Cause = "Field work restored the asset and cleared the local service impact.",
            Location = new AlertLocation
            {
                Label = "Response site",
                Position = new AlertPosition(position.X, 0, position.Z),
            },
            Duration = new AlertDuration { Kind = AlertDurationKinds.Timed, Seconds = 120 },
            Recommendation = "No further action is required. Review City Services for the restored aggregate metric.",
            RelatedEntityIds = new[] { order.State.IncidentId, order.Id }.Where(value => value is not null).Cast<string>().ToArray(),
            FocusAction = new AlertFocusAction { Type = AlertFocusActions.None },
        });
    }

    private static bool ActiveStatus(string status) => status is RepairStatuses.Scheduled or RepairStatuses.InProgress;

    private static double Finite(double value, string label) => double.IsFinite(value)
        ? value
        : throw new ArgumentOutOfRangeException(label, $"{label} must be finite.");

    private static double ClampFinite(double value, string label, double min, double max) =>
        Math.Clamp(Finite(value, label), min, max);

    private static void ValidatePosition(OutcomePosition position)
    {
        ArgumentNullException.ThrowIfNull(position);
        _ = Finite(position.X, "incident.Position.X");
        _ = Finite(position.Z, "incident.Position.Z");
    }

    private static string? OptionalText(string? value, string label) => value is null ? null : RequireText(value, label);

    private static string RequireText(string value, string label) => string.IsNullOrWhiteSpace(value)
        ? throw new ArgumentException($"{label} must be a non-empty string.", label)
        : value.Trim();

    private static string FormatMoney(double value) => value.ToString("#,0", CultureInfo.InvariantCulture);

    private sealed record NormalizedIncident(
        string Id,
        string Type,
        string Title,
        string Cause,
        string TargetId,
        string? InfrastructureId,
        string? DistrictId,
        string? Service,
        double Severity,
        bool CleanupRequired,
        bool RepairRequired,
        double CleanupCost,
        double RepairCost,
        double CoverageMultiplier,
        double HappinessModifier,
        double LandValueModifier,
        OutcomePosition Position,
        double InfluenceRadius,
        double InteractionRadius,
        string Access);
}

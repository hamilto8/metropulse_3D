using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Economy;

public static class EconomyEventTypes
{
    public const string TreasuryChanged = "TREASURY_CHANGED";
    public const string FinePaid = "FINE_PAID";
    public const string EmergencyAssistanceGranted = "EMERGENCY_ASSISTANCE_GRANTED";
    public const string PassiveIncomeChanged = "PASSIVE_INCOME_CHANGED";
    public const string PassiveIncomeEarned = "PASSIVE_INCOME_EARNED";
    public const string OperatingExpensePaid = "OPERATING_EXPENSE_PAID";
    public const string BuildingRegistered = "BUILDING_REGISTERED";
    public const string BuildingRemoved = "BUILDING_REMOVED";
    public const string MissionCompleted = "MISSION_COMPLETED";
    public const string NarrativeAdvanced = "NARRATIVE_ADVANCED";
    public const string ReputationChanged = "REPUTATION_CHANGED";
    public const string IncidentRecorded = "INCIDENT_RECORDED";
    public const string IncidentResolved = "INCIDENT_RESOLVED";
    public const string ServiceChanged = "SERVICE_CHANGED";
    public const string MobilityFeedbackChanged = "MOBILITY_FEEDBACK_CHANGED";
    public const string CityPulseChanged = "CITY_PULSE_CHANGED";
    public const string ZoneChanged = "ZONE_CHANGED";
    public const string DistrictUnlocked = "DISTRICT_UNLOCKED";
    public const string StateRestored = "STATE_RESTORED";
    public const string Snapshot = "SNAPSHOT";
}

public sealed record EconomyMissionCompletion(
    string Id,
    double Reward,
    int NarrativeProgressDelta,
    double ReputationDelta,
    double? Satisfaction,
    long CompletedAtRevision);

public sealed record EconomyMissionCompletionInput(
    string Id,
    int NarrativeProgressDelta = 1,
    double ReputationDelta = 0);

public sealed record EconomyBudgetBreakdown
{
    public required double BaseRevenueRate { get; init; }

    public required double BuildingRevenueRate { get; init; }

    public required double GrossRevenueRate { get; init; }

    public required double UtilityProductivityMultiplier { get; init; }

    public required double MobilityProductivityMultiplier { get; init; }

    public required double ProductivityMultiplier { get; init; }

    public required double AdjustedRevenueRate { get; init; }

    public required double OperatingCostRate { get; init; }

    public required double ManagementCostRate { get; init; }

    public required double NetRate { get; init; }
}

public sealed record EconomyRecoveryState
{
    public bool Active { get; init; }

    public int AssistanceClaims { get; init; }

    public int CompletedRecoveries { get; init; }

    public double TotalAssistance { get; init; }

    public long? StartedAtRevision { get; init; }

    public long? LastAssistanceRevision { get; init; }

    public long? CompletedAtRevision { get; init; }
}

public sealed record EconomyFiscalOverview
{
    public required string Status { get; init; }

    public required string Label { get; init; }

    public required string Explanation { get; init; }

    public required double? RunwayMinutes { get; init; }

    public required double ReserveFloor { get; init; }

    public required double WarningRunwayMinutes { get; init; }

    public required double EmergencyGrant { get; init; }

    public required bool AssistanceEligible { get; init; }

    public required bool RestrictionsActive { get; init; }

    public required IReadOnlyList<string> Restrictions { get; init; }

    public required IReadOnlyList<string> Actions { get; init; }

    public required EconomyRecoveryState Recovery { get; init; }
}

public sealed record EconomyAssistanceReceipt(
    bool Granted,
    double Amount,
    string Reason,
    EconomyFiscalOverview Fiscal);

public sealed record EconomyLedgerSnapshot
{
    public required long Revision { get; init; }

    public required double Treasury { get; init; }

    public required int Population { get; init; }

    public required double Energy { get; init; }

    public required double Happiness { get; init; }

    public required double LandValue { get; init; }

    public required double PassiveIncomeRate { get; init; }

    public required double OperatingCostRate { get; init; }

    public required EconomyBudgetBreakdown BudgetBreakdown { get; init; }

    public required EconomyDemographics Demographics { get; init; }

    public required EconomyDemand Demand { get; init; }

    public required EconomyHappinessBreakdown HappinessBreakdown { get; init; }

    public required EconomyMobilityFeedback Mobility { get; init; }

    public required string FiscalStatus { get; init; }

    public required EconomyFiscalOverview Fiscal { get; init; }

    public required double Reputation { get; init; }

    public required int NarrativeProgress { get; init; }

    public required EconomyCityPulse CityPulse { get; init; }

    public required EconomyServicesSnapshot Services { get; init; }

    public required IReadOnlyList<EconomyBuilding> Buildings { get; init; }

    public required IReadOnlyList<EconomyMissionCompletion> CompletedMissions { get; init; }

    public required IReadOnlyList<EconomyIncident> Incidents { get; init; }

    public required IReadOnlyList<EconomyZoneEffect> Zones { get; init; }

    public required IReadOnlyDictionary<string, EconomyDistrict> Districts { get; init; }

    public required IReadOnlyList<string> UnlockedDistricts { get; init; }
}

public sealed record EconomyEvent(
    string Type,
    EconomyLedgerSnapshot? Previous,
    EconomyLedgerSnapshot Current,
    IReadOnlyDictionary<string, object?> Detail);

/// <summary>
/// Pure, renderer-independent authority for shared Capital and aggregate City Pulse state.
/// Presentation, alerts, traffic derivation, and Godot adapters remain outside this class.
/// </summary>
public sealed class EconomyLedger
{
    private static readonly IReadOnlyDictionary<string, string> ZoneAliases =
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["RES"] = "RESIDENTIAL",
            ["RESIDENTIAL"] = "RESIDENTIAL",
            ["COM"] = "COMMERCIAL",
            ["COMMERCIAL"] = "COMMERCIAL",
            ["OFFICE"] = "COMMERCIAL",
            ["OPS"] = "OPERATIONS",
            ["IND"] = "OPERATIONS",
            ["INDUSTRIAL"] = "OPERATIONS",
            ["OPERATIONS"] = "OPERATIONS",
            ["POWER"] = "POWER_SERVICE",
            ["POWER_SERVICE"] = "POWER_SERVICE",
            ["WATER"] = "WATER_SERVICE",
            ["WATER_SERVICE"] = "WATER_SERVICE",
            ["FIRE"] = "FIRE_SERVICE",
            ["FIRE_SERVICE"] = "FIRE_SERVICE",
            ["SUBURBAN_RESIDENTIAL"] = "SUBURBAN_RESIDENTIAL",
        });

    private static readonly EconomyMobilityFeedback DefaultMobilityFeedback = new();
    private readonly EconomyBalanceDefinition balance;
    private readonly Dictionary<string, EconomyServiceBase> baseServices = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyBuilding> buildings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyMissionCompletion> completedMissions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyIncident> incidents = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyZoneEffect> zones = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyDistrict> districts = new(StringComparer.Ordinal);
    private readonly List<Action<EconomyEvent>> listeners = [];
    private double treasury;
    private double basePassiveIncomeRate;
    private int basePopulation;
    private double baseHappiness;
    private double baseLandValue;
    private double reputation;
    private int narrativeProgress;
    private EconomyMobilityFeedback mobilityFeedback = DefaultMobilityFeedback;
    private EconomyRecoveryState recovery = new();

    public EconomyLedger(
        EconomyBalanceDefinition balance,
        double initialTreasury,
        double passiveIncomeRate,
        double reputation = 0,
        int narrativeProgress = 0,
        int population = 0,
        double happiness = 50,
        double landValue = 100,
        EconomyBaseServices? services = null,
        double? eastDistrictUnlockCost = null,
        bool eastDistrictUnlocked = false)
    {
        this.balance = balance ?? throw new ArgumentNullException(nameof(balance));
        treasury = RequireNonNegative(initialTreasury, nameof(initialTreasury));
        basePassiveIncomeRate = RequireNonNegative(passiveIncomeRate, nameof(passiveIncomeRate));
        this.reputation = RequireFinite(reputation, nameof(reputation));
        narrativeProgress = RequireNonNegativeInteger(narrativeProgress, nameof(narrativeProgress));
        basePopulation = RequireNonNegativeInteger(population, nameof(population));
        baseHappiness = RequirePercentage(happiness, nameof(happiness));
        baseLandValue = RequireNonNegative(landValue, nameof(landValue));
        this.narrativeProgress = narrativeProgress;
        SetBaseServices(NormalizeBaseServices(services ?? new EconomyBaseServices()));
        double unlockCost = RequireNonNegative(
            eastDistrictUnlockCost ?? balance.Progression?.EastDistrictUnlockCost
                ?? throw new ArgumentException("Economy balance requires progression rules.", nameof(balance)),
            nameof(eastDistrictUnlockCost));
        districts.Add(EconomyDistrictIds.EastCyberMetropolis, new EconomyDistrict(
            EconomyDistrictIds.EastCyberMetropolis,
            "East Cyber-Metropolis",
            unlockCost,
            eastDistrictUnlocked));
        _ = FiscalRules;
        _ = FineRules;
    }

    public long Revision { get; private set; }

    public double Treasury => treasury;

    public double Reputation => reputation;

    public int NarrativeProgress => narrativeProgress;

    public double PassiveIncomeRate => GetBudgetBreakdown().NetRate;

    public EconomyRecoveryState Recovery => recovery;

    public EconomyBalanceDefinition Balance => balance;

    public EconomyServicesSnapshot GetServiceState()
    {
        var totals = ServiceTypes.All.ToDictionary(
            service => service,
            service => (baseServices[service].Capacity, baseServices[service].Demand),
            StringComparer.Ordinal);
        foreach (EconomyBuilding building in buildings.Values)
        {
            if (!building.Operational) continue;
            foreach (string service in ServiceTypes.All)
            {
                EconomyBuildingService contribution = building.Services.Get(service);
                (double Capacity, double Demand) total = totals[service];
                totals[service] = (total.Capacity + contribution.Capacity, total.Demand + contribution.Demand);
            }
        }

        EconomyServiceState Build(string service)
        {
            (double capacity, double demand) = totals[service];
            double coverage = demand == 0 ? 1 : Math.Min(1, capacity / demand);
            return new EconomyServiceState(capacity, demand, capacity - demand, coverage, capacity >= demand);
        }

        return new EconomyServicesSnapshot
        {
            Power = Build(ServiceTypes.Power),
            Water = Build(ServiceTypes.Water),
            Fire = Build(ServiceTypes.Fire),
        };
    }

    public EconomyLandValueBreakdown GetLandValueBreakdownAt(double x, double z)
    {
        RequireFinite(x, nameof(x));
        RequireFinite(z, nameof(z));
        double globalModifier = 0;
        double amenityModifier = 0;
        double mayhemModifier = 0;

        foreach (EconomyBuilding building in buildings.Values)
        {
            if (!building.Operational) continue;
            double? weight = ProximityWeight(building.Position, building.AmenityRadius, x, z);
            if (weight is null) globalModifier += building.LandValueModifier;
            else amenityModifier += building.LandValueModifier * weight.Value;
        }
        foreach (EconomyIncident incident in incidents.Values)
        {
            if (!incident.Active) continue;
            double? weight = ProximityWeight(incident.Position, incident.InfluenceRadius, x, z);
            if (weight is null) globalModifier += incident.LandValueModifier;
            else mayhemModifier += incident.LandValueModifier * weight.Value;
        }

        EconomyServicesSnapshot services = GetServiceState();
        double serviceHealth = (services.Power.Coverage + services.Water.Coverage + services.Fire.Coverage) / 3;
        double serviceMultiplier = 0.75 + serviceHealth * 0.25;
        double unscaledValue = baseLandValue + globalModifier + amenityModifier + mayhemModifier;
        return new EconomyLandValueBreakdown(
            x,
            z,
            baseLandValue,
            globalModifier,
            amenityModifier,
            mayhemModifier,
            serviceMultiplier,
            Math.Max(0, unscaledValue * serviceMultiplier));
    }

    public double GetLandValueAt(double x, double z) => GetLandValueBreakdownAt(x, z).LandValue;

    public EconomyBudgetBreakdown GetBudgetBreakdown()
    {
        double buildingRevenueRate = 0;
        double operatingCostRate = 0;
        foreach (EconomyBuilding building in buildings.Values)
        {
            if (!building.Operational) continue;
            buildingRevenueRate += building.GrossIncomeRate;
            operatingCostRate += building.OperatingCostRate;
        }

        EconomyServicesSnapshot services = GetServiceState();
        double criticalCoverage = Math.Min(services.Power.Coverage, services.Water.Coverage);
        double utilityProductivityMultiplier = 0.4 + criticalCoverage * 0.6;
        double productivityMultiplier = utilityProductivityMultiplier * mobilityFeedback.ProductivityMultiplier;
        double grossRevenueRate = basePassiveIncomeRate + buildingRevenueRate;
        double adjustedRevenueRate = grossRevenueRate * productivityMultiplier;
        return new EconomyBudgetBreakdown
        {
            BaseRevenueRate = basePassiveIncomeRate,
            BuildingRevenueRate = buildingRevenueRate,
            GrossRevenueRate = grossRevenueRate,
            UtilityProductivityMultiplier = utilityProductivityMultiplier,
            MobilityProductivityMultiplier = mobilityFeedback.ProductivityMultiplier,
            ProductivityMultiplier = productivityMultiplier,
            AdjustedRevenueRate = adjustedRevenueRate,
            OperatingCostRate = operatingCostRate,
            ManagementCostRate = mobilityFeedback.ManagementCostRate,
            NetRate = adjustedRevenueRate - operatingCostRate - mobilityFeedback.ManagementCostRate,
        };
    }

    public EconomyLedgerSnapshot SetMobilityFeedback(EconomyMobilityFeedback feedback)
    {
        EconomyMobilityFeedback normalized = NormalizeMobilityFeedback(feedback);
        if (MobilityEquals(normalized, mobilityFeedback)) return Snapshot();
        Commit(
            EconomyEventTypes.MobilityFeedbackChanged,
            Detail(("mobilityRevision", normalized.Revision)),
            () => mobilityFeedback = normalized);
        return Snapshot();
    }

    public bool CanAfford(double amount) => treasury >= RequireNonNegative(amount, nameof(amount));

    public SpendingDecision EvaluateSpending(double amount, SpendingContext? context = null)
    {
        RequireNonNegative(amount, nameof(amount));
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        return EconomyPolicy.EvaluateSpending(treasury, budget.NetRate, recovery.Active, amount, context, balance);
    }

    public double Earn(double amount, string source = "manual", string? referenceId = null)
    {
        RequireNonNegative(amount, nameof(amount));
        if (amount == 0) return treasury;
        double nextTreasury = RequireFinite(treasury + amount, "resulting treasury");
        return Commit(
            EconomyEventTypes.TreasuryChanged,
            Detail(("amount", amount), ("source", source), ("referenceId", referenceId), ("direction", "credit")),
            () => treasury = nextTreasury);
    }

    public bool Spend(double amount, SpendingContext? context = null)
    {
        RequireNonNegative(amount, nameof(amount));
        context ??= new SpendingContext();
        if (amount == 0) return true;
        SpendingDecision decision = EvaluateSpending(amount, context);
        if (!decision.Allowed) return false;
        Commit(
            EconomyEventTypes.TreasuryChanged,
            Detail(("amount", amount), ("source", context.Source), ("referenceId", context.ReferenceId), ("direction", "debit")),
            () => treasury -= amount);
        return true;
    }

    public FineReceipt ApplyFine(double requestedAmount, string source = "fine", string? referenceId = null)
    {
        RequireNonNegative(requestedAmount, nameof(requestedAmount));
        double charged = EconomyPolicy.CalculateBoundedFine(requestedAmount, treasury, balance);
        if (charged == 0) return new FineReceipt(requestedAmount, 0, requestedAmount > 0);
        Commit(
            EconomyEventTypes.FinePaid,
            Detail(("requested", requestedAmount), ("charged", charged), ("source", source), ("referenceId", referenceId)),
            () => treasury -= charged);
        return new FineReceipt(requestedAmount, charged, charged < requestedAmount);
    }

    public EconomyFiscalOverview GetFiscalOverview()
    {
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        string status = EconomyPolicy.GetFiscalState(treasury, budget.NetRate, recovery.Active);
        double? runwayMinutes = EconomyPolicy.GetRunwayMinutes(treasury, budget.NetRate);
        bool assistanceEligible = treasury <= 0 && budget.NetRate < 0;
        string label = status switch
        {
            FiscalStates.Stable => "Stable",
            FiscalStates.Deficit => "Deficit",
            FiscalStates.Insolvent => "Insolvent",
            FiscalStates.Recovery => "Recovery",
            _ => throw new InvalidOperationException($"Unknown fiscal state: {status}"),
        };
        string explanation = status switch
        {
            FiscalStates.Stable => "Recurring revenue covers upkeep and policy costs.",
            FiscalStates.Deficit => runwayMinutes is null
                ? "The city is drawing down reserves."
                : $"The city is drawing down reserves with about {Math.Max(1, Math.Ceiling(runwayMinutes.Value))} minutes of runway.",
            FiscalStates.Insolvent => "Capital is exhausted while recurring costs exceed revenue.",
            FiscalStates.Recovery => "Emergency terms remain active until cashflow is non-negative and the reserve is rebuilt.",
            _ => throw new InvalidOperationException($"Unknown fiscal state: {status}"),
        };
        IReadOnlyList<string> restrictions = recovery.Active
            ? Array.AsReadOnly(new[]
            {
                "Essential cleanup, repair, and bounded fines remain payable.",
                "Missions and salvage remain available.",
                "Optional expansion is paused unless an investment restores non-negative cashflow.",
            })
            : Array.Empty<string>();
        IReadOnlyList<string> actions = status == FiscalStates.Stable
            ? Array.AsReadOnly(new[] { "Keep a reserve before adding new recurring costs." })
            : Array.AsReadOnly(new[]
            {
                "Complete a street contract for Capital.",
                "Disable optional operating policies and salvage costly assets.",
                assistanceEligible
                    ? "Claim emergency stabilization assistance."
                    : "Restore non-negative cashflow and rebuild the reserve.",
            });
        return new EconomyFiscalOverview
        {
            Status = status,
            Label = label,
            Explanation = explanation,
            RunwayMinutes = runwayMinutes,
            ReserveFloor = FiscalRules.ReserveFloor,
            WarningRunwayMinutes = FiscalRules.WarningRunwayMinutes,
            EmergencyGrant = FiscalRules.EmergencyGrant,
            AssistanceEligible = assistanceEligible,
            RestrictionsActive = recovery.Active,
            Restrictions = restrictions,
            Actions = actions,
            Recovery = recovery,
        };
    }

    public EconomyAssistanceReceipt RequestEmergencyAssistance(string? referenceId = "fiscal-recovery")
    {
        EconomyFiscalOverview fiscal = GetFiscalOverview();
        if (!fiscal.AssistanceEligible)
        {
            string reason = fiscal.Status == FiscalStates.Stable
                ? "Emergency assistance is reserved for cities with exhausted Capital and negative cashflow."
                : "Use remaining reserves before emergency assistance becomes available.";
            return new EconomyAssistanceReceipt(false, 0, reason, fiscal);
        }

        double amount = FiscalRules.EmergencyGrant;
        Commit(
            EconomyEventTypes.EmergencyAssistanceGranted,
            Detail(("amount", amount), ("referenceId", referenceId)),
            () =>
            {
                treasury += amount;
                recovery = recovery with
                {
                    Active = true,
                    AssistanceClaims = recovery.AssistanceClaims + 1,
                    TotalAssistance = recovery.TotalAssistance + amount,
                    StartedAtRevision = recovery.Active ? recovery.StartedAtRevision : Revision + 1,
                    LastAssistanceRevision = Revision + 1,
                    CompletedAtRevision = null,
                };
                return amount;
            });
        return new EconomyAssistanceReceipt(
            true,
            amount,
            "Stabilization grant issued; recovery spending restrictions are now active.",
            GetFiscalOverview());
    }

    public EconomyLedgerSnapshot SetPassiveIncomeRate(double rate)
    {
        RequireNonNegative(rate, nameof(rate));
        if (rate == basePassiveIncomeRate) return Snapshot();
        double previousRate = basePassiveIncomeRate;
        Commit(
            EconomyEventTypes.PassiveIncomeChanged,
            Detail(("previousRate", previousRate), ("rate", rate)),
            () => basePassiveIncomeRate = rate);
        return Snapshot();
    }

    public double Update(double deltaSeconds)
    {
        RequireNonNegative(deltaSeconds, nameof(deltaSeconds));
        if (deltaSeconds == 0) return 0;
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        double projectedAmount = RequireFinite(budget.NetRate * deltaSeconds, "passive income amount");
        if (projectedAmount == 0) return 0;
        double amount = Math.Max(-treasury, projectedAmount);
        double nextTreasury = treasury + amount;
        string eventType = amount < 0
            ? EconomyEventTypes.OperatingExpensePaid
            : EconomyEventTypes.PassiveIncomeEarned;
        return Commit(
            eventType,
            Detail(("amount", amount), ("projectedAmount", projectedAmount), ("deltaSeconds", deltaSeconds), ("rate", budget.NetRate)),
            () =>
            {
                treasury = nextTreasury;
                return amount;
            });
    }

    public EconomyBuilding RegisterBuilding(EconomyBuilding building)
    {
        EconomyBuilding normalized = NormalizeBuilding(building);
        if (buildings.ContainsKey(normalized.Id))
        {
            throw new InvalidOperationException($"Building already registered: {normalized.Id}");
        }
        return Commit(
            EconomyEventTypes.BuildingRegistered,
            Detail(("buildingId", normalized.Id)),
            () =>
            {
                buildings.Add(normalized.Id, normalized);
                return normalized;
            });
    }

    public EconomyBuilding? RemoveBuilding(string id)
    {
        string normalizedId = RequireId(id, "building id");
        if (!buildings.TryGetValue(normalizedId, out EconomyBuilding? building)) return null;
        return Commit(
            EconomyEventTypes.BuildingRemoved,
            Detail(("buildingId", normalizedId)),
            () =>
            {
                buildings.Remove(normalizedId);
                return building;
            });
    }

    public EconomyBuilding? GetBuilding(string id) =>
        buildings.GetValueOrDefault(RequireId(id, "building id"));

    public EconomyZoneEffect SetZoneEffect(EconomyZoneEffect zone)
    {
        EconomyZoneEffect normalized = NormalizeZone(zone);
        EconomyZoneEffect? previous = zones.GetValueOrDefault(normalized.Id);
        if (previous == normalized) return previous;
        return Commit(
            EconomyEventTypes.ZoneChanged,
            Detail(("zoneId", normalized.Id), ("previousType", previous?.Type), ("type", normalized.Type)),
            () => zones[normalized.Id] = normalized);
    }

    public EconomyZoneEffect? GetZoneEffect(string id) =>
        zones.GetValueOrDefault(RequireId(id, "zone id"));

    public EconomyZoneEffect? RemoveZoneEffect(string id)
    {
        string normalizedId = RequireId(id, "zone id");
        if (!zones.TryGetValue(normalizedId, out EconomyZoneEffect? zone)) return null;
        return Commit(
            EconomyEventTypes.ZoneChanged,
            Detail(("zoneId", normalizedId), ("previousType", zone.Type), ("type", null)),
            () =>
            {
                zones.Remove(normalizedId);
                return zone;
            });
    }

    public bool HasCompletedMission(string id) =>
        completedMissions.ContainsKey(RequireId(id, "mission id"));

    public bool CompleteMission(
        string id,
        double reward = 0,
        int narrativeProgressDelta = 1,
        double reputationDelta = 0,
        double? satisfaction = null)
    {
        string normalizedId = RequireId(id, "mission.Id");
        RequireNonNegative(reward, "mission.Reward");
        RequireNonNegativeInteger(narrativeProgressDelta, nameof(narrativeProgressDelta));
        RequireFinite(reputationDelta, nameof(reputationDelta));
        if (satisfaction is double satisfactionValue) RequirePercentage(satisfactionValue, nameof(satisfaction));
        if (completedMissions.ContainsKey(normalizedId)) return false;

        double nextTreasury = RequireFinite(treasury + reward, "resulting treasury");
        Commit(
            EconomyEventTypes.MissionCompleted,
            Detail(
                ("missionId", normalizedId),
                ("reward", reward),
                ("narrativeProgressDelta", narrativeProgressDelta),
                ("reputationDelta", reputationDelta),
                ("satisfaction", satisfaction)),
            () =>
            {
                treasury = nextTreasury;
                narrativeProgress += narrativeProgressDelta;
                reputation += reputationDelta;
                completedMissions.Add(normalizedId, new EconomyMissionCompletion(
                    normalizedId,
                    reward,
                    narrativeProgressDelta,
                    reputationDelta,
                    satisfaction,
                    Revision + 1));
                return true;
            });
        return true;
    }

    /// <summary>Compatibility adapter for mission owners that publish a definition and resolved payout separately.</summary>
    public bool RecordMissionCompletion(
        EconomyMissionCompletionInput mission,
        double payout,
        double? satisfaction = null)
    {
        ArgumentNullException.ThrowIfNull(mission);
        return CompleteMission(
            mission.Id,
            payout,
            mission.NarrativeProgressDelta,
            mission.ReputationDelta,
            satisfaction);
    }

    public int AdvanceNarrative(int amount = 1, string? referenceId = null)
    {
        RequireNonNegativeInteger(amount, nameof(amount));
        if (amount == 0) return narrativeProgress;
        return Commit(
            EconomyEventTypes.NarrativeAdvanced,
            Detail(("amount", amount), ("referenceId", referenceId)),
            () => narrativeProgress += amount);
    }

    public double AdjustReputation(double delta, string source = "manual", string? referenceId = null)
    {
        RequireFinite(delta, nameof(delta));
        if (delta == 0) return reputation;
        double nextReputation = RequireFinite(reputation + delta, "resulting reputation");
        return Commit(
            EconomyEventTypes.ReputationChanged,
            Detail(("delta", delta), ("source", source), ("referenceId", referenceId)),
            () => reputation = nextReputation);
    }

    public EconomyIncident RecordIncident(EconomyIncident incident)
    {
        EconomyIncident normalized = NormalizeIncident(incident, Revision + 1);
        if (incidents.ContainsKey(normalized.Id))
        {
            throw new InvalidOperationException($"Incident already recorded: {normalized.Id}");
        }
        double nextReputation = RequireFinite(reputation + normalized.ReputationDelta, "resulting reputation");
        return Commit(
            EconomyEventTypes.IncidentRecorded,
            Detail(("incidentId", normalized.Id)),
            () =>
            {
                incidents.Add(normalized.Id, normalized);
                reputation = nextReputation;
                return normalized;
            });
    }

    public bool HasIncident(string id) => incidents.ContainsKey(RequireId(id, "incident id"));

    public bool ResolveIncident(string id)
    {
        string normalizedId = RequireId(id, "incident id");
        if (!incidents.TryGetValue(normalizedId, out EconomyIncident? incident) || !incident.Active) return false;
        Commit(
            EconomyEventTypes.IncidentResolved,
            Detail(("incidentId", normalizedId)),
            () => incidents[normalizedId] = incident with
            {
                Active = false,
                ResolvedAtRevision = Revision + 1,
            });
        return true;
    }

    public EconomyLedgerSnapshot SetService(string service, double? capacity = null, double? demand = null)
    {
        ValidateService(service);
        EconomyServiceBase previous = baseServices[service];
        double normalizedCapacity = capacity is null
            ? previous.Capacity
            : RequireNonNegative(capacity.Value, nameof(capacity));
        double normalizedDemand = demand is null
            ? previous.Demand
            : RequireNonNegative(demand.Value, nameof(demand));
        if (normalizedCapacity == previous.Capacity && normalizedDemand == previous.Demand) return Snapshot();
        Commit(
            EconomyEventTypes.ServiceChanged,
            Detail(("service", service), ("capacity", normalizedCapacity), ("demand", normalizedDemand)),
            () => baseServices[service] = new EconomyServiceBase(normalizedCapacity, normalizedDemand));
        return Snapshot();
    }

    public EconomyLedgerSnapshot AdjustService(string service, double capacityDelta = 0, double demandDelta = 0)
    {
        ValidateService(service);
        RequireFinite(capacityDelta, nameof(capacityDelta));
        RequireFinite(demandDelta, nameof(demandDelta));
        EconomyServiceBase current = baseServices[service];
        return SetService(
            service,
            RequireNonNegative(current.Capacity + capacityDelta, "resulting service capacity"),
            RequireNonNegative(current.Demand + demandDelta, "resulting service demand"));
    }

    public EconomyLedgerSnapshot SetPopulation(int population)
    {
        RequireNonNegativeInteger(population, nameof(population));
        if (population == basePopulation) return Snapshot();
        return SetCityPulseValue("population", population);
    }

    public EconomyLedgerSnapshot AdjustPopulation(int delta) => SetPopulation(checked(basePopulation + delta));

    public EconomyLedgerSnapshot SetHappiness(double happiness)
    {
        RequirePercentage(happiness, nameof(happiness));
        if (happiness == baseHappiness) return Snapshot();
        return SetCityPulseValue("happiness", happiness);
    }

    public EconomyLedgerSnapshot AdjustHappiness(double delta)
    {
        RequireFinite(delta, nameof(delta));
        return SetHappiness(Math.Clamp(baseHappiness + delta, 0, 100));
    }

    public EconomyLedgerSnapshot SetLandValue(double landValue)
    {
        RequireNonNegative(landValue, nameof(landValue));
        if (landValue == baseLandValue) return Snapshot();
        return SetCityPulseValue("landValue", landValue);
    }

    public EconomyLedgerSnapshot AdjustLandValue(double delta)
    {
        RequireFinite(delta, nameof(delta));
        return SetLandValue(Math.Max(0, baseLandValue + delta));
    }

    public bool CanUnlockDistrict(string id)
    {
        EconomyDistrict district = GetDistrict(id);
        return !district.Unlocked && EvaluateSpending(district.UnlockCost, new SpendingContext
        {
            Source = "district-unlock",
            ReferenceId = district.Id,
        }).Allowed;
    }

    public bool UnlockDistrict(string id)
    {
        EconomyDistrict district = GetDistrict(id);
        if (district.Unlocked || !CanUnlockDistrict(district.Id)) return false;
        Commit(
            EconomyEventTypes.DistrictUnlocked,
            Detail(("districtId", district.Id), ("cost", district.UnlockCost)),
            () =>
            {
                treasury -= district.UnlockCost;
                districts[district.Id] = district with { Unlocked = true };
                return true;
            });
        return true;
    }

    public bool UnlockEastDistrict() => UnlockDistrict(EconomyDistrictIds.EastCyberMetropolis);

    public bool IsDistrictUnlocked(string id) => GetDistrict(id).Unlocked;

    public EconomyLedgerState Serialize() => new()
    {
        Version = 1,
        Treasury = treasury,
        BasePassiveIncomeRate = basePassiveIncomeRate,
        BasePopulation = basePopulation,
        BaseHappiness = baseHappiness,
        BaseLandValue = baseLandValue,
        Reputation = reputation,
        NarrativeProgress = narrativeProgress,
        BaseServices = GetBaseServices(),
        Buildings = Array.AsReadOnly(buildings.Values.ToArray()),
        CompletedMissions = Array.AsReadOnly(completedMissions.Values.ToArray()),
        Incidents = Array.AsReadOnly(incidents.Values.ToArray()),
        Zones = Array.AsReadOnly(zones.Values.ToArray()),
        Districts = Array.AsReadOnly(districts.Values.ToArray()),
        Recovery = recovery,
    };

    public EconomyLedgerSnapshot Restore(EconomyLedgerState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.Version != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(state), $"Unsupported economy state version: {state.Version}");
        }

        double restoredTreasury = RequireNonNegative(state.Treasury, "state.Treasury");
        double restoredRate = RequireNonNegative(state.BasePassiveIncomeRate, "state.BasePassiveIncomeRate");
        int restoredPopulation = RequireNonNegativeInteger(state.BasePopulation, "state.BasePopulation");
        double restoredHappiness = RequirePercentage(state.BaseHappiness, "state.BaseHappiness");
        double restoredLandValue = RequireNonNegative(state.BaseLandValue, "state.BaseLandValue");
        double restoredReputation = RequireFinite(state.Reputation, "state.Reputation");
        int restoredNarrative = RequireNonNegativeInteger(state.NarrativeProgress, "state.NarrativeProgress");
        EconomyBaseServices restoredServices = NormalizeBaseServices(state.BaseServices);
        EconomyRecoveryState restoredRecovery = NormalizeRecovery(state.Recovery);
        Dictionary<string, EconomyBuilding> restoredBuildings = ToUniqueDictionary(
            state.Buildings.Select(NormalizeBuilding),
            building => building.Id,
            "building");
        Dictionary<string, EconomyMissionCompletion> restoredMissions = ToUniqueDictionary(
            state.CompletedMissions.Select(NormalizeMission),
            mission => mission.Id,
            "completed mission");
        Dictionary<string, EconomyIncident> restoredIncidents = ToUniqueDictionary(
            state.Incidents.Select(incident => NormalizeIncident(incident, Revision + 1)),
            incident => incident.Id,
            "incident");
        Dictionary<string, EconomyZoneEffect> restoredZones = ToUniqueDictionary(
            state.Zones.Select(NormalizeZone),
            zone => zone.Id,
            "zone");
        Dictionary<string, EconomyDistrict> restoredDistricts = ToUniqueDictionary(
            state.Districts.Select(NormalizeDistrict),
            district => district.Id,
            "district");
        if (!restoredDistricts.ContainsKey(EconomyDistrictIds.EastCyberMetropolis))
        {
            throw new InvalidOperationException("Saved economy state is missing the East Cyber-Metropolis district.");
        }

        Commit(
            EconomyEventTypes.StateRestored,
            Detail(("version", state.Version)),
            () =>
            {
                treasury = restoredTreasury;
                basePassiveIncomeRate = restoredRate;
                basePopulation = restoredPopulation;
                baseHappiness = restoredHappiness;
                baseLandValue = restoredLandValue;
                reputation = restoredReputation;
                narrativeProgress = restoredNarrative;
                SetBaseServices(restoredServices);
                Replace(buildings, restoredBuildings);
                Replace(completedMissions, restoredMissions);
                Replace(incidents, restoredIncidents);
                Replace(zones, restoredZones);
                Replace(districts, restoredDistricts);
                recovery = restoredRecovery;
                mobilityFeedback = DefaultMobilityFeedback;
                return true;
            });
        return Snapshot();
    }

    public EconomyLedgerSnapshot Snapshot()
    {
        EconomyServicesSnapshot services = GetServiceState();
        int population = basePopulation;
        double happiness = baseHappiness;
        double landValue = baseLandValue;
        int employees = 0;
        int jobCapacity = 0;
        int housingCapacity = basePopulation;
        double totalBuildingValue = 0;
        double buildingHappiness = 0;
        double incidentHappiness = 0;
        double zoningHappiness = 0;

        foreach (EconomyBuilding building in buildings.Values)
        {
            totalBuildingValue += building.Value;
            if (!building.Operational) continue;
            population += building.Population;
            employees += building.Employees;
            jobCapacity += building.JobCapacity;
            housingCapacity += building.HousingCapacity ?? 0;
            buildingHappiness += building.HappinessModifier;
            happiness += building.HappinessModifier;
            landValue += building.LandValueModifier;
        }
        foreach (EconomyIncident incident in incidents.Values)
        {
            if (!incident.Active) continue;
            incidentHappiness += incident.HappinessModifier;
            happiness += incident.HappinessModifier;
            landValue += incident.LandValueModifier;
        }
        foreach (EconomyZoneEffect zone in zones.Values)
        {
            zoningHappiness += zone.HappinessModifier;
            happiness += zone.HappinessModifier;
            landValue += zone.LandValueModifier;
        }

        double utilityCoverage = (services.Power.Coverage + services.Water.Coverage) / 2;
        double safetyCoverage = services.Fire.Coverage;
        double serviceHealth = (services.Power.Coverage + services.Water.Coverage + safetyCoverage) / 3;
        double rawServicePenalty = -((1 - utilityCoverage) * 18 + (1 - safetyCoverage) * 10);
        double servicePenalty = rawServicePenalty == 0 ? 0 : rawServicePenalty;
        happiness += servicePenalty;

        int workforce = JavascriptRoundToInt(population * 0.62);
        bool laborMarketEnabled = jobCapacity > 0;
        int employed = laborMarketEnabled ? Math.Min(workforce, jobCapacity) : workforce;
        double unemploymentRate = workforce == 0 ? 0 : (double)(workforce - employed) / workforce;
        double employmentPenalty = laborMarketEnabled ? -(unemploymentRate * 15) : 0;
        happiness += employmentPenalty;
        happiness += mobilityFeedback.SatisfactionModifier;
        landValue *= 0.75 + serviceHealth * 0.25;
        double totalHappiness = Math.Clamp(happiness, 0, 100);

        var happinessBreakdown = new EconomyHappinessBreakdown
        {
            Baseline = baseHappiness,
            Buildings = buildingHappiness,
            Zoning = zoningHappiness,
            Incidents = incidentHappiness,
            Services = servicePenalty,
            Employment = employmentPenalty,
            Traffic = mobilityFeedback.SatisfactionModifier,
            Total = totalHappiness,
        };
        int accessibleEmployed = JavascriptRoundToInt(employed * mobilityFeedback.JobAccessMultiplier);
        var demographics = new EconomyDemographics
        {
            Population = population,
            HousingCapacity = housingCapacity,
            HousingOccupancy = housingCapacity == 0 ? 0 : Math.Min(1, (double)population / housingCapacity),
            Workforce = workforce,
            Employed = employed,
            AccessibleEmployed = accessibleEmployed,
            JobCapacity = jobCapacity,
            AvailableJobs = Math.Max(0, jobCapacity - employed),
            UnemploymentRate = unemploymentRate,
            EmploymentRate = workforce == 0 ? 1 : (double)employed / workforce,
            AccessibleEmploymentRate = workforce == 0 ? 1 : (double)accessibleEmployed / workforce,
        };
        int residentialDemand = Math.Clamp(JavascriptRoundToInt(
            50
            + Math.Min(25, (double)demographics.AvailableJobs / Math.Max(1, workforce) * 50)
            + (totalHappiness - 50) * 0.35
            - Math.Max(0, 0.88 - demographics.HousingOccupancy) * 45), 0, 100);
        int jobsDemand = Math.Clamp(JavascriptRoundToInt(
            unemploymentRate * 100
            + (double)Math.Max(0, population - housingCapacity) / Math.Max(1, population) * 25), 0, 100);
        int serviceDemand = Math.Clamp(JavascriptRoundToInt((1 - serviceHealth) * 100), 0, 100);
        var demand = new EconomyDemand(
            residentialDemand,
            Math.Clamp(JavascriptRoundToInt((residentialDemand + jobsDemand) / 2d), 0, 100),
            jobsDemand,
            serviceDemand);
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        EconomyFiscalOverview fiscal = GetFiscalOverview();
        var pulse = new EconomyCityPulse
        {
            Budget = treasury,
            Cash = treasury,
            Energy = services.Power.Coverage * 100,
            EnergySurplus = services.Power.Surplus,
            ServiceHealth = serviceHealth * 100,
            Population = population,
            Happiness = totalHappiness,
            LandValue = Math.Max(0, landValue),
            Employees = employees,
            TotalBuildingValue = totalBuildingValue,
            Employment = demographics.EmploymentRate * 100,
            AccessibleEmployment = demographics.AccessibleEmploymentRate * 100,
            Unemployment = demographics.UnemploymentRate * 100,
            HousingOccupancy = demographics.HousingOccupancy * 100,
            NetIncomeRate = budget.NetRate,
            FiscalStatus = fiscal.Status,
            Productivity = mobilityFeedback.ProductivityMultiplier * 100,
            DeliveryReliability = mobilityFeedback.DeliveryReliability * 100,
            TrafficCongestion = mobilityFeedback.Congestion * 100,
        };

        var unlockedDistricts = new List<string>();
        foreach (EconomyDistrict district in districts.Values)
        {
            if (!district.Unlocked) continue;
            unlockedDistricts.Add(district.Id);
            if (district.Id == EconomyDistrictIds.EastCyberMetropolis)
            {
                unlockedDistricts.Add(EconomyDistrictIds.EastCyber);
            }
        }

        return new EconomyLedgerSnapshot
        {
            Revision = Revision,
            Treasury = treasury,
            Population = pulse.Population,
            Energy = pulse.Energy,
            Happiness = pulse.Happiness,
            LandValue = pulse.LandValue,
            PassiveIncomeRate = budget.NetRate,
            OperatingCostRate = budget.OperatingCostRate,
            BudgetBreakdown = budget,
            Demographics = demographics,
            Demand = demand,
            HappinessBreakdown = happinessBreakdown,
            Mobility = mobilityFeedback,
            FiscalStatus = fiscal.Status,
            Fiscal = fiscal,
            Reputation = reputation,
            NarrativeProgress = narrativeProgress,
            CityPulse = pulse,
            Services = services,
            Buildings = Array.AsReadOnly(buildings.Values.ToArray()),
            CompletedMissions = Array.AsReadOnly(completedMissions.Values.ToArray()),
            Incidents = Array.AsReadOnly(incidents.Values.ToArray()),
            Zones = Array.AsReadOnly(zones.Values.ToArray()),
            Districts = EconomyCollections.ReadOnlyCopy(districts),
            UnlockedDistricts = Array.AsReadOnly(unlockedDistricts.ToArray()),
        };
    }

    public Func<bool> Subscribe(Action<EconomyEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent)
        {
            listener(new EconomyEvent(EconomyEventTypes.Snapshot, null, Snapshot(), EmptyDetail));
        }
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    private EconomyLedgerSnapshot SetCityPulseValue(string key, double value)
    {
        Commit(
            EconomyEventTypes.CityPulseChanged,
            Detail(("key", key), ("value", value)),
            () =>
            {
                if (key == "population") basePopulation = checked((int)value);
                if (key == "happiness") baseHappiness = value;
                if (key == "landValue") baseLandValue = value;
                return true;
            });
        return Snapshot();
    }

    private FiscalBalanceDefinition FiscalRules => balance.Fiscal
        ?? throw new ArgumentException("Economy balance requires fiscal rules.", nameof(balance));

    private FineBalanceDefinition FineRules => balance.Fines
        ?? throw new ArgumentException("Economy balance requires fine rules.", nameof(balance));

    private T Commit<T>(string type, IReadOnlyDictionary<string, object?> detail, Func<T> mutation)
    {
        EconomyLedgerSnapshot previous = Snapshot();
        T result = mutation();
        ReconcileRecovery();
        Revision += 1;
        var economyEvent = new EconomyEvent(type, previous, Snapshot(), detail);
        foreach (Action<EconomyEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(economyEvent);
            }
            catch (Exception)
            {
                // Rendering, persistence, and mod listeners cannot roll back authority state.
            }
        }
        return result;
    }

    private void ReconcileRecovery()
    {
        if (!recovery.Active) return;
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        if (budget.NetRate < 0 || treasury < FiscalRules.ReserveFloor) return;
        recovery = recovery with
        {
            Active = false,
            CompletedRecoveries = recovery.CompletedRecoveries + 1,
            CompletedAtRevision = Revision + 1,
        };
    }

    private EconomyDistrict GetDistrict(string id)
    {
        string normalizedId = NormalizeDistrictId(id);
        return districts.GetValueOrDefault(normalizedId)
            ?? throw new ArgumentOutOfRangeException(nameof(id), $"Unknown district: {normalizedId}");
    }

    private EconomyBaseServices GetBaseServices() => new()
    {
        Power = baseServices[ServiceTypes.Power],
        Water = baseServices[ServiceTypes.Water],
        Fire = baseServices[ServiceTypes.Fire],
    };

    private void SetBaseServices(EconomyBaseServices services)
    {
        baseServices[ServiceTypes.Power] = services.Power;
        baseServices[ServiceTypes.Water] = services.Water;
        baseServices[ServiceTypes.Fire] = services.Fire;
    }

    private static EconomyBaseServices NormalizeBaseServices(EconomyBaseServices services)
    {
        ArgumentNullException.ThrowIfNull(services);
        EconomyServiceBase Normalize(EconomyServiceBase service, string name)
        {
            ArgumentNullException.ThrowIfNull(service);
            return new EconomyServiceBase(
                RequireNonNegative(service.Capacity, $"services.{name}.Capacity"),
                RequireNonNegative(service.Demand, $"services.{name}.Demand"));
        }
        return new EconomyBaseServices
        {
            Power = Normalize(services.Power, ServiceTypes.Power),
            Water = Normalize(services.Water, ServiceTypes.Water),
            Fire = Normalize(services.Fire, ServiceTypes.Fire),
        };
    }

    private static EconomyBuilding NormalizeBuilding(EconomyBuilding building)
    {
        ArgumentNullException.ThrowIfNull(building);
        string id = RequireId(building.Id, "building.Id");
        string name = string.IsNullOrWhiteSpace(building.Name) ? id : building.Name.Trim();
        string? kind = building.Kind is null ? null : RequireId(building.Kind, "building.Kind");
        string status = RequireId(building.Status, "building.Status");
        EconomyPoint? position = NormalizePosition(building.Position, "building.Position");
        double amenityRadius = RequireNonNegative(building.AmenityRadius, "building.AmenityRadius");
        if (amenityRadius > 0 && position is null)
        {
            throw new ArgumentException("building.Position is required when AmenityRadius is greater than zero.", nameof(building));
        }

        EconomyBuildingServices services = NormalizeBuildingServices(building.Services);
        if (position is null && ServiceTypes.All.Any(service => services.Get(service).Reach > 0))
        {
            throw new ArgumentException("building.Position is required when service reach is greater than zero.", nameof(building));
        }
        int population = RequireNonNegativeInteger(building.Population, "building.Population");
        double passiveRate = RequireNonNegative(building.PassiveIncomeRate, "building.PassiveIncomeRate");
        double grossRate = RequireNonNegative(building.GrossIncomeRate, "building.GrossIncomeRate");
        if (grossRate == 0 && passiveRate > 0) grossRate = passiveRate;

        return building with
        {
            Id = id,
            Name = name,
            Kind = kind,
            Value = RequireNonNegative(building.Value, "building.Value"),
            Employees = RequireNonNegativeInteger(building.Employees, "building.Employees"),
            Population = population,
            Status = status,
            PassiveIncomeRate = passiveRate,
            GrossIncomeRate = grossRate,
            OperatingCostRate = RequireNonNegative(building.OperatingCostRate, "building.OperatingCostRate"),
            JobCapacity = RequireNonNegativeInteger(building.JobCapacity, "building.JobCapacity"),
            HousingCapacity = RequireNonNegativeInteger(building.HousingCapacity ?? population, "building.HousingCapacity"),
            HappinessModifier = RequireFinite(building.HappinessModifier, "building.HappinessModifier"),
            LandValueModifier = RequireFinite(building.LandValueModifier, "building.LandValueModifier"),
            Position = position,
            AmenityRadius = amenityRadius,
            Services = services,
        };
    }

    private static EconomyBuildingServices NormalizeBuildingServices(EconomyBuildingServices services)
    {
        ArgumentNullException.ThrowIfNull(services);
        EconomyBuildingService Normalize(EconomyBuildingService service, string name)
        {
            ArgumentNullException.ThrowIfNull(service);
            return new EconomyBuildingService(
                RequireNonNegative(service.Capacity, $"building.Services.{name}.Capacity"),
                RequireNonNegative(service.Demand, $"building.Services.{name}.Demand"),
                RequireNonNegative(service.Reach, $"building.Services.{name}.Reach"));
        }
        return new EconomyBuildingServices
        {
            Power = Normalize(services.Power, ServiceTypes.Power),
            Water = Normalize(services.Water, ServiceTypes.Water),
            Fire = Normalize(services.Fire, ServiceTypes.Fire),
        };
    }

    private static EconomyZoneEffect NormalizeZone(EconomyZoneEffect zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        string rawType = RequireId(zone.Type, "zone.Type").ToUpperInvariant();
        if (!ZoneAliases.TryGetValue(rawType, out string? type))
        {
            throw new ArgumentOutOfRangeException(nameof(zone), $"Unknown zone type: {zone.Type}");
        }
        return zone with
        {
            Id = RequireId(zone.Id, "zone.Id"),
            Type = type,
            HappinessModifier = RequireFinite(zone.HappinessModifier, "zone.HappinessModifier"),
            LandValueModifier = RequireFinite(zone.LandValueModifier, "zone.LandValueModifier"),
            Position = NormalizePosition(zone.Position, "zone.Position"),
        };
    }

    private static EconomyIncident NormalizeIncident(EconomyIncident incident, long nextRevision)
    {
        ArgumentNullException.ThrowIfNull(incident);
        string id = RequireId(incident.Id, "incident.Id");
        EconomyPoint? position = NormalizePosition(incident.Position, "incident.Position");
        double influenceRadius = RequireNonNegative(incident.InfluenceRadius, "incident.InfluenceRadius");
        if (influenceRadius > 0 && position is null)
        {
            throw new ArgumentException("incident.Position is required when InfluenceRadius is greater than zero.", nameof(incident));
        }
        return incident with
        {
            Id = id,
            Type = RequireId(incident.Type, "incident.Type"),
            Severity = RequireNonNegative(incident.Severity, "incident.Severity"),
            ReputationDelta = RequireFinite(incident.ReputationDelta, "incident.ReputationDelta"),
            HappinessModifier = RequireFinite(incident.HappinessModifier, "incident.HappinessModifier"),
            LandValueModifier = RequireFinite(incident.LandValueModifier, "incident.LandValueModifier"),
            Position = position,
            InfluenceRadius = influenceRadius,
            RecordedAtRevision = nextRevision,
            ResolvedAtRevision = incident.Active ? null : nextRevision,
        };
    }

    private static EconomyMissionCompletion NormalizeMission(EconomyMissionCompletion mission)
    {
        ArgumentNullException.ThrowIfNull(mission);
        if (mission.Satisfaction is double satisfaction) RequirePercentage(satisfaction, "mission.Satisfaction");
        return mission with
        {
            Id = RequireId(mission.Id, "mission.Id"),
            Reward = RequireNonNegative(mission.Reward, "mission.Reward"),
            NarrativeProgressDelta = RequireNonNegativeInteger(
                mission.NarrativeProgressDelta,
                "mission.NarrativeProgressDelta"),
            ReputationDelta = RequireFinite(mission.ReputationDelta, "mission.ReputationDelta"),
            CompletedAtRevision = RequireNonNegativeLong(mission.CompletedAtRevision, "mission.CompletedAtRevision"),
        };
    }

    private static EconomyDistrict NormalizeDistrict(EconomyDistrict district)
    {
        ArgumentNullException.ThrowIfNull(district);
        string id = NormalizeDistrictId(district.Id);
        return district with
        {
            Id = id,
            Name = string.IsNullOrWhiteSpace(district.Name) ? id : district.Name.Trim(),
            UnlockCost = RequireNonNegative(district.UnlockCost, "district.UnlockCost"),
        };
    }

    private static EconomyRecoveryState NormalizeRecovery(EconomyRecoveryState recovery)
    {
        ArgumentNullException.ThrowIfNull(recovery);
        return recovery with
        {
            AssistanceClaims = RequireNonNegativeInteger(recovery.AssistanceClaims, "recovery.AssistanceClaims"),
            CompletedRecoveries = RequireNonNegativeInteger(recovery.CompletedRecoveries, "recovery.CompletedRecoveries"),
            TotalAssistance = RequireNonNegative(recovery.TotalAssistance, "recovery.TotalAssistance"),
            StartedAtRevision = RequireOptionalRevision(recovery.StartedAtRevision, "recovery.StartedAtRevision"),
            LastAssistanceRevision = RequireOptionalRevision(
                recovery.LastAssistanceRevision,
                "recovery.LastAssistanceRevision"),
            CompletedAtRevision = RequireOptionalRevision(recovery.CompletedAtRevision, "recovery.CompletedAtRevision"),
        };
    }

    private static EconomyMobilityFeedback NormalizeMobilityFeedback(EconomyMobilityFeedback feedback)
    {
        ArgumentNullException.ThrowIfNull(feedback);
        ArgumentNullException.ThrowIfNull(feedback.Explanation);
        return feedback with
        {
            Revision = RequireNonNegativeLong(feedback.Revision, "mobility.Revision"),
            ProductivityMultiplier = RequireUnitInterval(
                feedback.ProductivityMultiplier,
                "mobility.ProductivityMultiplier"),
            JobAccessMultiplier = RequireUnitInterval(feedback.JobAccessMultiplier, "mobility.JobAccessMultiplier"),
            SatisfactionModifier = RequireFinite(feedback.SatisfactionModifier, "mobility.SatisfactionModifier"),
            DeliveryReliability = RequireUnitInterval(feedback.DeliveryReliability, "mobility.DeliveryReliability"),
            Congestion = RequireUnitInterval(feedback.Congestion, "mobility.Congestion"),
            BridgeCongestion = RequireUnitInterval(feedback.BridgeCongestion, "mobility.BridgeCongestion"),
            ManagementCostRate = RequireNonNegative(feedback.ManagementCostRate, "mobility.ManagementCostRate"),
            Explanation = Array.AsReadOnly(feedback.Explanation.ToArray()),
        };
    }

    private static bool MobilityEquals(EconomyMobilityFeedback left, EconomyMobilityFeedback right) =>
        left.Revision == right.Revision
        && left.ProductivityMultiplier == right.ProductivityMultiplier
        && left.JobAccessMultiplier == right.JobAccessMultiplier
        && left.SatisfactionModifier == right.SatisfactionModifier
        && left.DeliveryReliability == right.DeliveryReliability
        && left.Congestion == right.Congestion
        && left.BridgeCongestion == right.BridgeCongestion
        && left.ManagementCostRate == right.ManagementCostRate
        && left.Explanation.SequenceEqual(right.Explanation, StringComparer.Ordinal);

    private static EconomyPoint? NormalizePosition(EconomyPoint? position, string name)
    {
        if (position is null) return null;
        return new EconomyPoint(RequireFinite(position.X, $"{name}.X"), RequireFinite(position.Z, $"{name}.Z"));
    }

    private static double? ProximityWeight(EconomyPoint? position, double radius, double x, double z)
    {
        if (position is null || radius <= 0) return null;
        double distance = Math.Sqrt(Math.Pow(position.X - x, 2) + Math.Pow(position.Z - z, 2));
        if (distance >= radius) return 0;
        return 1 - distance / radius;
    }

    private static string NormalizeDistrictId(string id)
    {
        string normalized = RequireId(id, "district id");
        return normalized == EconomyDistrictIds.EastCyber ? EconomyDistrictIds.EastCyberMetropolis : normalized;
    }

    private static void ValidateService(string service)
    {
        if (!ServiceTypes.All.Contains(service, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(
                nameof(service),
                service,
                $"Service must be one of {string.Join(", ", ServiceTypes.All)}.");
        }
    }

    private static Dictionary<string, T> ToUniqueDictionary<T>(
        IEnumerable<T> values,
        Func<T, string> getId,
        string label)
    {
        ArgumentNullException.ThrowIfNull(values);
        var result = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (T value in values)
        {
            string id = getId(value);
            if (!result.TryAdd(id, value)) throw new InvalidOperationException($"Duplicate saved {label}: {id}");
        }
        return result;
    }

    private static void Replace<T>(Dictionary<string, T> target, Dictionary<string, T> source)
    {
        target.Clear();
        foreach ((string key, T value) in source) target.Add(key, value);
    }

    private static readonly IReadOnlyDictionary<string, object?> EmptyDetail =
        new ReadOnlyDictionary<string, object?>(new Dictionary<string, object?>());

    private static IReadOnlyDictionary<string, object?> Detail(params (string Key, object? Value)[] values) =>
        new ReadOnlyDictionary<string, object?>(values.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));

    private static string RequireId(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A non-empty ID is required.", name);
        return value.Trim();
    }

    private static int RequireNonNegativeInteger(int value, string name)
    {
        if (value < 0) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static long RequireNonNegativeLong(long value, string name)
    {
        if (value < 0) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static long? RequireOptionalRevision(long? value, string name) =>
        value is null ? null : RequireNonNegativeLong(value.Value, name);

    private static double RequireUnitInterval(double value, string name)
    {
        RequireFinite(value, name);
        if (value is < 0 or > 1) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static double RequirePercentage(double value, string name)
    {
        RequireFinite(value, name);
        if (value is < 0 or > 100) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static double RequireNonNegative(double value, string name)
    {
        RequireFinite(value, name);
        if (value < 0) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static double RequireFinite(double value, string name)
    {
        if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(name);
        return value;
    }

    private static int JavascriptRoundToInt(double value) => checked((int)Math.Floor(value + 0.5));
}

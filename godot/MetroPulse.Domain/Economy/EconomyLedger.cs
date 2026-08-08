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
    public const string Snapshot = "SNAPSHOT";
}

public sealed record EconomyBuilding(
    string Id,
    double GrossIncomeRate = 0,
    double OperatingCostRate = 0,
    bool Operational = true);

public sealed record EconomyMissionCompletion(
    string Id,
    double Reward,
    int NarrativeProgressDelta,
    double ReputationDelta,
    double? Satisfaction,
    long CompletedAtRevision);

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

    public required double? RunwayMinutes { get; init; }

    public required double ReserveFloor { get; init; }

    public required double WarningRunwayMinutes { get; init; }

    public required double EmergencyGrant { get; init; }

    public required bool AssistanceEligible { get; init; }

    public required bool RestrictionsActive { get; init; }

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

    public required double PassiveIncomeRate { get; init; }

    public required double OperatingCostRate { get; init; }

    public required EconomyBudgetBreakdown BudgetBreakdown { get; init; }

    public required string FiscalStatus { get; init; }

    public required EconomyFiscalOverview Fiscal { get; init; }

    public required double Reputation { get; init; }

    public required int NarrativeProgress { get; init; }

    public required IReadOnlyList<EconomyBuilding> Buildings { get; init; }

    public required IReadOnlyList<EconomyMissionCompletion> CompletedMissions { get; init; }
}

public sealed record EconomyEvent(
    string Type,
    EconomyLedgerSnapshot? Previous,
    EconomyLedgerSnapshot Current,
    IReadOnlyDictionary<string, object?> Detail);

/// <summary>
/// Pure, renderer-independent authority for treasury and transaction state.
/// Demographics, services, land value, and alert presentation remain adapters.
/// </summary>
public sealed class EconomyLedger
{
    private readonly EconomyBalanceDefinition balance;
    private readonly Dictionary<string, EconomyBuilding> buildings = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EconomyMissionCompletion> completedMissions = new(StringComparer.Ordinal);
    private readonly List<Action<EconomyEvent>> listeners = [];
    private double treasury;
    private double basePassiveIncomeRate;
    private double reputation;
    private int narrativeProgress;
    private EconomyRecoveryState recovery = new();

    public EconomyLedger(
        EconomyBalanceDefinition balance,
        double initialTreasury,
        double passiveIncomeRate,
        double reputation = 0,
        int narrativeProgress = 0)
    {
        this.balance = balance ?? throw new ArgumentNullException(nameof(balance));
        treasury = RequireNonNegative(initialTreasury, nameof(initialTreasury));
        basePassiveIncomeRate = RequireNonNegative(passiveIncomeRate, nameof(passiveIncomeRate));
        this.reputation = RequireFinite(reputation, nameof(reputation));
        if (narrativeProgress < 0) throw new ArgumentOutOfRangeException(nameof(narrativeProgress));
        this.narrativeProgress = narrativeProgress;
        _ = FiscalRules;
        _ = FineRules;
    }

    public long Revision { get; private set; }

    public double Treasury => treasury;

    public double Reputation => reputation;

    public int NarrativeProgress => narrativeProgress;

    public double PassiveIncomeRate => GetBudgetBreakdown().NetRate;

    public EconomyRecoveryState Recovery => recovery;

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

        double grossRevenueRate = basePassiveIncomeRate + buildingRevenueRate;
        return new EconomyBudgetBreakdown
        {
            BaseRevenueRate = basePassiveIncomeRate,
            BuildingRevenueRate = buildingRevenueRate,
            GrossRevenueRate = grossRevenueRate,
            UtilityProductivityMultiplier = 1,
            MobilityProductivityMultiplier = 1,
            ProductivityMultiplier = 1,
            AdjustedRevenueRate = grossRevenueRate,
            OperatingCostRate = operatingCostRate,
            ManagementCostRate = 0,
            NetRate = grossRevenueRate - operatingCostRate,
        };
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
        return new EconomyFiscalOverview
        {
            Status = EconomyPolicy.GetFiscalState(treasury, budget.NetRate, recovery.Active),
            RunwayMinutes = EconomyPolicy.GetRunwayMinutes(treasury, budget.NetRate),
            ReserveFloor = FiscalRules.ReserveFloor,
            WarningRunwayMinutes = FiscalRules.WarningRunwayMinutes,
            EmergencyGrant = FiscalRules.EmergencyGrant,
            AssistanceEligible = treasury <= 0 && budget.NetRate < 0,
            RestrictionsActive = recovery.Active,
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
        return Commit(
            EconomyEventTypes.PassiveIncomeChanged,
            Detail(("previousRate", previousRate), ("rate", rate)),
            () =>
            {
                basePassiveIncomeRate = rate;
                return Snapshot();
            });
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
        ArgumentNullException.ThrowIfNull(building);
        string id = RequireId(building.Id, "building.Id");
        var normalized = building with
        {
            Id = id,
            GrossIncomeRate = RequireNonNegative(building.GrossIncomeRate, "building.GrossIncomeRate"),
            OperatingCostRate = RequireNonNegative(building.OperatingCostRate, "building.OperatingCostRate"),
        };
        if (buildings.ContainsKey(id)) throw new InvalidOperationException($"Building already registered: {id}");
        return Commit(
            EconomyEventTypes.BuildingRegistered,
            Detail(("buildingId", id)),
            () =>
            {
                buildings.Add(id, normalized);
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

    public bool CompleteMission(
        string id,
        double reward = 0,
        int narrativeProgressDelta = 1,
        double reputationDelta = 0,
        double? satisfaction = null)
    {
        string normalizedId = RequireId(id, "mission.Id");
        RequireNonNegative(reward, "mission.Reward");
        if (narrativeProgressDelta < 0) throw new ArgumentOutOfRangeException(nameof(narrativeProgressDelta));
        RequireFinite(reputationDelta, nameof(reputationDelta));
        if (satisfaction is < 0 or > 100 || satisfaction is double value && !double.IsFinite(value))
        {
            throw new ArgumentOutOfRangeException(nameof(satisfaction));
        }
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

    public EconomyLedgerSnapshot Snapshot()
    {
        EconomyBudgetBreakdown budget = GetBudgetBreakdown();
        EconomyFiscalOverview fiscal = GetFiscalOverview();
        return new EconomyLedgerSnapshot
        {
            Revision = Revision,
            Treasury = treasury,
            PassiveIncomeRate = budget.NetRate,
            OperatingCostRate = budget.OperatingCostRate,
            BudgetBreakdown = budget,
            FiscalStatus = fiscal.Status,
            Fiscal = fiscal,
            Reputation = reputation,
            NarrativeProgress = narrativeProgress,
            Buildings = Array.AsReadOnly(buildings.Values.ToArray()),
            CompletedMissions = Array.AsReadOnly(completedMissions.Values.ToArray()),
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

    private static readonly IReadOnlyDictionary<string, object?> EmptyDetail =
        new ReadOnlyDictionary<string, object?>(new Dictionary<string, object?>());

    private static IReadOnlyDictionary<string, object?> Detail(params (string Key, object? Value)[] values) =>
        new ReadOnlyDictionary<string, object?>(values.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));

    private static string RequireId(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A non-empty ID is required.", name);
        return value.Trim();
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
}

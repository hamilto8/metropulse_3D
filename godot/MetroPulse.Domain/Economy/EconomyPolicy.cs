using System.Globalization;
using System.Text.Json.Serialization;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Economy;

public static class FiscalStates
{
    public const string Stable = "STABLE";
    public const string Deficit = "DEFICIT";
    public const string Insolvent = "INSOLVENT";
    public const string Recovery = "RECOVERY";
}

public static class SpendingCategories
{
    public const string Essential = "ESSENTIAL";
    public const string Recovery = "RECOVERY";
    public const string Discretionary = "DISCRETIONARY";
}

public sealed record EconomyInvestmentSpec
{
    public double? IncomePerMinute { get; init; }

    public double? RevenuePerMinute { get; init; }

    public double? GrossIncomePerMinute { get; init; }

    public double? OperatingCostPerMinute { get; init; }

    public double? UpkeepPerMinute { get; init; }
}

public sealed record SpendingContext
{
    public string Source { get; init; } = "manual";

    public string? ReferenceId { get; init; }

    public string? Category { get; init; }

    public double? ProjectedNetRateDelta { get; init; }

    public double? RecurringCostRate { get; init; }

    public EconomyInvestmentSpec? Spec { get; init; }
}

public sealed record SpendingDecision
{
    [JsonPropertyName("allowed")]
    public required bool Allowed { get; init; }

    [JsonPropertyName("code")]
    public required string Code { get; init; }

    [JsonPropertyName("reason")]
    public required string Reason { get; init; }

    [JsonPropertyName("remedy")]
    public required string? Remedy { get; init; }

    [JsonPropertyName("category")]
    public required string Category { get; init; }

    [JsonPropertyName("state")]
    public required string State { get; init; }

    [JsonPropertyName("amount")]
    public required double Amount { get; init; }

    [JsonPropertyName("remainingTreasury")]
    public required double RemainingTreasury { get; init; }

    [JsonPropertyName("projectedNetRate")]
    public required double ProjectedNetRate { get; init; }

    [JsonPropertyName("runwayMinutes")]
    public required double? RunwayMinutes { get; init; }

    [JsonPropertyName("warning")]
    public required string? Warning { get; init; }

    [JsonPropertyName("recoveryInvestment")]
    public required bool RecoveryInvestment { get; init; }
}

public sealed record FineReceipt(double Requested, double Charged, bool Capped);

public static class EconomyPolicy
{
    private static readonly HashSet<string> EssentialSources = new(StringComparer.Ordinal)
    {
        "cleanup",
        "fine",
        "incident-response",
        "mission-outcome",
        "repair",
        "service-response",
    };

    private static readonly HashSet<string> RecoverySources = new(StringComparer.Ordinal)
    {
        "building-salvage",
        "emergency-assistance",
        "mission",
        "recovery-contract",
    };

    public static string GetSpendingCategory(string? source = "manual")
    {
        string normalized = string.IsNullOrWhiteSpace(source) ? "manual" : source.Trim().ToLowerInvariant();
        if (EssentialSources.Contains(normalized)
            || normalized.Contains("repair", StringComparison.Ordinal)
            || normalized.Contains("cleanup", StringComparison.Ordinal))
        {
            return SpendingCategories.Essential;
        }

        if (RecoverySources.Contains(normalized)
            || normalized.Contains("salvage", StringComparison.Ordinal)
            || normalized.Contains("recovery", StringComparison.Ordinal))
        {
            return SpendingCategories.Recovery;
        }

        return SpendingCategories.Discretionary;
    }

    public static double? GetRunwayMinutes(double treasury, double netRate)
    {
        double cash = Math.Max(0, FiniteOrZero(treasury));
        double rate = FiniteOrZero(netRate);
        return rate >= 0 ? null : cash / -rate / 60;
    }

    public static string GetFiscalState(double treasury, double netRate, bool recoveryActive = false)
    {
        double cash = Math.Max(0, FiniteOrZero(treasury));
        double rate = FiniteOrZero(netRate);
        if (recoveryActive) return FiscalStates.Recovery;
        if (cash <= 0 && rate < 0) return FiscalStates.Insolvent;
        return rate < 0 ? FiscalStates.Deficit : FiscalStates.Stable;
    }

    public static SpendingDecision EvaluateSpending(
        double treasury,
        double netRate,
        bool recoveryActive,
        double amount,
        SpendingContext? context,
        EconomyBalanceDefinition balance)
    {
        ArgumentNullException.ThrowIfNull(balance);
        FiscalBalanceDefinition fiscal = balance.Fiscal
            ?? throw new ArgumentException("Economy balance requires fiscal rules.", nameof(balance));

        context ??= new SpendingContext();
        double cash = Math.Max(0, FiniteOrZero(treasury));
        double debit = Math.Max(0, FiniteOrZero(amount));
        string category = context.Category ?? GetSpendingCategory(context.Source);
        double projectedDelta = GetProjectedRateDelta(context);
        double projectedNetRate = FiniteOrZero(netRate) + projectedDelta;
        double remainingTreasury = cash - debit;
        string state = GetFiscalState(cash, netRate, recoveryActive);
        bool recoveryInvestment = category == SpendingCategories.Discretionary
            && projectedNetRate >= 0
            && projectedDelta > 0;

        bool allowed = true;
        string code = "ALLOWED";
        string reason = "Capital is available and the purchase preserves a recovery path.";
        string? remedy = null;

        if (debit > cash)
        {
            allowed = false;
            code = "INSUFFICIENT_FUNDS";
            reason = $"This action requires ${FormatInteger(JavascriptRound(debit))}, but only ${FormatInteger(Math.Floor(cash))} is available.";
            remedy = "Complete a contract, salvage an optional asset, or claim emergency assistance when insolvent.";
        }
        else if (category == SpendingCategories.Discretionary
            && (state == FiscalStates.Insolvent || state == FiscalStates.Recovery)
            && !recoveryInvestment)
        {
            allowed = false;
            code = "RECOVERY_RESTRICTION";
            reason = "Optional expansion is paused while the city is under fiscal recovery restrictions.";
            remedy = "Restore non-negative cashflow and rebuild the emergency reserve first.";
        }
        else if (category == SpendingCategories.Discretionary
            && projectedNetRate < 0
            && remainingTreasury < fiscal.ReserveFloor)
        {
            allowed = false;
            code = "RESERVE_AT_RISK";
            reason = $"This action would leave ${FormatInteger(Math.Max(0, Math.Floor(remainingTreasury)))} while the city continues losing Capital.";
            remedy = $"Keep at least ${FormatInteger(fiscal.ReserveFloor)} in reserve or choose a cash-positive investment.";
        }

        double? runwayMinutes = GetRunwayMinutes(Math.Max(0, remainingTreasury), projectedNetRate);
        string? warning = null;
        if (allowed && runwayMinutes is not null && runwayMinutes < fiscal.WarningRunwayMinutes)
        {
            double roundedMinutes = Math.Max(1, Math.Ceiling(runwayMinutes.Value));
            warning = $"Warning: projected reserves last about {roundedMinutes.ToString("0", CultureInfo.InvariantCulture)} minute{(roundedMinutes == 1 ? string.Empty : "s")} at the current cashflow.";
        }

        return new SpendingDecision
        {
            Allowed = allowed,
            Code = code,
            Reason = reason,
            Remedy = remedy,
            Category = category,
            State = state,
            Amount = debit,
            RemainingTreasury = remainingTreasury,
            ProjectedNetRate = projectedNetRate,
            RunwayMinutes = runwayMinutes,
            Warning = warning,
            RecoveryInvestment = recoveryInvestment,
        };
    }

    public static double CalculateBoundedFine(
        double requestedAmount,
        double treasury,
        EconomyBalanceDefinition balance)
    {
        ArgumentNullException.ThrowIfNull(balance);
        FineBalanceDefinition fines = balance.Fines
            ?? throw new ArgumentException("Economy balance requires fine rules.", nameof(balance));
        double requested = Math.Max(0, FiniteOrZero(requestedAmount));
        double cash = Math.Max(0, FiniteOrZero(treasury));
        return Math.Min(requested, Math.Min(fines.Maximum, Math.Floor(cash * fines.TreasuryShare)));
    }

    private static double GetProjectedRateDelta(SpendingContext context)
    {
        if (context.ProjectedNetRateDelta is double projected && double.IsFinite(projected)) return projected;
        if (context.RecurringCostRate is double recurring && double.IsFinite(recurring)) return -Math.Max(0, recurring);
        if (context.Spec is null) return 0;

        double authoredNet = FiniteOrZero(context.Spec.IncomePerMinute ?? 0);
        double gross = FirstFinite(context.Spec.RevenuePerMinute, context.Spec.GrossIncomePerMinute)
            ?? Math.Max(0, authoredNet);
        double upkeep = FirstFinite(context.Spec.OperatingCostPerMinute, context.Spec.UpkeepPerMinute)
            ?? Math.Max(0, -authoredNet);
        return (gross - upkeep) / 60;
    }

    private static double? FirstFinite(params double?[] candidates) =>
        candidates.FirstOrDefault(candidate => candidate is double value && double.IsFinite(value));

    private static double FiniteOrZero(double value) => double.IsFinite(value) ? value : 0;

    private static double JavascriptRound(double value) => Math.Floor(value + 0.5);

    private static string FormatInteger(double value) => value.ToString("N0", CultureInfo.InvariantCulture);
}

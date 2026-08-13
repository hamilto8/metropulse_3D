using System.Globalization;

namespace MetroPulse.Domain.Economy;

public sealed record EastSideDevelopmentSnapshot(
    bool FeatureAvailable,
    bool Unlocked,
    double UnlockCost,
    double Treasury,
    bool CanUnlock,
    string Status,
    string Reason,
    string? Remedy);

/// <summary>Pure projection for the gated East-side district unlock and its economy decision.</summary>
public static class EastSideDevelopmentModel
{
    public static EastSideDevelopmentSnapshot Capture(EconomyLedger economy, bool featureAvailable)
    {
        ArgumentNullException.ThrowIfNull(economy);
        EconomyLedgerSnapshot ledger = economy.Snapshot();
        EconomyDistrict district = ledger.Districts[EconomyDistrictIds.EastCyberMetropolis];
        if (!featureAvailable)
        {
            return new EastSideDevelopmentSnapshot(
                false,
                district.Unlocked,
                district.UnlockCost,
                ledger.Treasury,
                false,
                "UNAVAILABLE",
                "East-side development is outside the active feature scope.",
                "Enable the East-side development feature to manage this district.");
        }
        if (district.Unlocked)
        {
            return new EastSideDevelopmentSnapshot(
                true,
                true,
                district.UnlockCost,
                ledger.Treasury,
                false,
                "UNLOCKED",
                "East Cyber-Metropolis is open for development.",
                null);
        }

        SpendingDecision spending = economy.EvaluateSpending(district.UnlockCost, new SpendingContext
        {
            Source = "district-unlock",
            ReferenceId = district.Id,
        });
        return new EastSideDevelopmentSnapshot(
            true,
            false,
            district.UnlockCost,
            ledger.Treasury,
            spending.Allowed,
            spending.Allowed ? "READY" : "LOCKED",
            spending.Allowed
                ? $"Commit ${district.UnlockCost.ToString("N0", CultureInfo.GetCultureInfo("en-US"))} Capital to open the East side."
                : spending.Reason,
            spending.Allowed ? null : spending.Remedy);
    }
}

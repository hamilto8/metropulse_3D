namespace MetroPulse.Domain.Economy;

public sealed record CityEconomyViewModel(
    long Revision,
    double Treasury,
    int Population,
    double Happiness,
    double LandValue,
    double EnergyCoverage,
    double WaterCoverage,
    double SafetyCoverage,
    double GrossIncomeRate,
    double UpkeepRate,
    double NetIncomeRate,
    int AssetCount,
    int Employees,
    string FiscalStatus,
    string FiscalExplanation)
{
    public static CityEconomyViewModel FromSnapshot(EconomyLedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return new CityEconomyViewModel(
            snapshot.Revision,
            snapshot.Treasury,
            snapshot.Population,
            snapshot.Happiness,
            snapshot.LandValue,
            snapshot.Services.Power.Coverage,
            snapshot.Services.Water.Coverage,
            snapshot.Services.Fire.Coverage,
            snapshot.BudgetBreakdown.GrossRevenueRate,
            snapshot.BudgetBreakdown.OperatingCostRate + snapshot.BudgetBreakdown.ManagementCostRate,
            snapshot.BudgetBreakdown.NetRate,
            snapshot.Buildings.Count,
            snapshot.CityPulse.Employees,
            snapshot.FiscalStatus,
            snapshot.Fiscal.Explanation);
    }
}

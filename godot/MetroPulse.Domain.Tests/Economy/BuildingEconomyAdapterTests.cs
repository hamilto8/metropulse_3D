using System.Text.Json;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.Economy;

public sealed class BuildingEconomyAdapterTests
{
    [Fact]
    public void CatalogAdapterPreservesFinancialCapacityAndServiceMeaning()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyBuilding clinic = BuildingEconomyAdapter.FromCatalog(
            content.GetBuilding("MED_CENTER")!,
            "clinic-1",
            new EconomyPoint(20, 30));
        EconomyBuilding energy = BuildingEconomyAdapter.FromCatalog(
            content.GetBuilding("SOLAR_GRID")!,
            "array-1",
            new EconomyPoint(-20, 10));

        Assert.Equal(0, clinic.GrossIncomeRate);
        Assert.Equal(1_700d / 60, clinic.OperatingCostRate);
        Assert.Equal(310, clinic.JobCapacity);
        Assert.True(clinic.Services.Fire.Demand > 0);
        Assert.Equal(new EconomyPoint(20, 30), clinic.Position);
        Assert.Equal(90, energy.Services.Power.Capacity);
        Assert.Equal(220, energy.Services.Power.Reach);
    }

    [Fact]
    public void AuthoredSkylineRegistersEveryLiveBuildingThroughOneDeterministicAdapter()
    {
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(GameContentRegistry.LoadProduction());
        IReadOnlyList<EconomyBuilding> buildings = BuildingEconomyAdapter.AdaptAuthoredSkyline(layout);

        Assert.Equal(23, buildings.Count);
        Assert.Equal(23, buildings.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal("existing-1", buildings[0].Id);
        Assert.Equal("building-neotech", buildings[0].Name);
        Assert.Equal(new EconomyPoint(-75, -25), buildings[0].Position);
        Assert.Equal(600, buildings[0].Employees);
        Assert.All(buildings, building =>
        {
            Assert.Equal(0, building.GrossIncomeRate);
            Assert.Equal(0, building.OperatingCostRate);
            Assert.True(building.Value >= 150_000);
            Assert.NotNull(building.Position);
        });
    }

    [Fact]
    public void FrozenInitialEconomyScalarsMapToTheCityViewModelExactly()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("economy.json"));
        JsonElement initial = fixture.RootElement.GetProperty("data").GetProperty("initial");
        var ledger = new EconomyLedger(
            content.EconomyBalance,
            content.EconomyBalance.StartingTreasury,
            content.EconomyBalance.BaseRevenuePerSecond,
            population: initial.GetProperty("population").GetInt32(),
            happiness: initial.GetProperty("happiness").GetDouble(),
            landValue: initial.GetProperty("landValue").GetDouble(),
            services: new EconomyBaseServices());

        CityEconomyViewModel view = CityEconomyViewModel.FromSnapshot(ledger.Snapshot());
        Assert.Equal(initial.GetProperty("treasury").GetDouble(), view.Treasury);
        Assert.Equal(initial.GetProperty("population").GetInt32(), view.Population);
        Assert.Equal(initial.GetProperty("happiness").GetDouble(), view.Happiness);
        Assert.Equal(initial.GetProperty("landValue").GetDouble(), view.LandValue);
        Assert.Equal(initial.GetProperty("budgetBreakdown").GetProperty("grossRevenueRate").GetDouble(), view.GrossIncomeRate);
        Assert.Equal(initial.GetProperty("operatingCostRate").GetDouble(), view.UpkeepRate);
        Assert.Equal(initial.GetProperty("services").GetProperty("power").GetProperty("coverage").GetDouble(), view.EnergyCoverage);
        Assert.Equal(initial.GetProperty("services").GetProperty("water").GetProperty("coverage").GetDouble(), view.WaterCoverage);
        Assert.Equal(initial.GetProperty("services").GetProperty("fire").GetProperty("coverage").GetDouble(), view.SafetyCoverage);
    }
}

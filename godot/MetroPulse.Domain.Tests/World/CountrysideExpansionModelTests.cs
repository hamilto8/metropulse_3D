using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.World;

public sealed class CountrysideExpansionModelTests
{
    [Fact]
    public void ProductionPlanIsDeterministicReservedAndCollisionFree()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        CountrysideExpansionPlan first = CountrysideExpansionModel.Create(content);
        CountrysideExpansionPlan second = CountrysideExpansionModel.Create(content);

        Assert.Equal(14, first.Reservations.Count);
        Assert.Equal(17, first.Houses.Count);
        Assert.NotEmpty(first.Trees);
        Assert.Equal(first.Reservations, second.Reservations);
        Assert.Equal(first.Houses, second.Houses);
        Assert.Equal(first.Trees, second.Trees);
        Assert.DoesNotContain(first.Houses, house => house.Id == "suburban-700--125");
        Assert.Equal(first.Scenery.Count, first.Scenery.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count());
        foreach (CountrysideSceneryPlacement scenery in first.Scenery)
        {
            Assert.DoesNotContain(first.Reservations, reserved => PlacementGeometry.Overlaps(scenery.Occupancy, reserved));
            Assert.Single(first.GetConflicts(scenery.Occupancy), item => item.Id == scenery.Id);
        }
    }

    [Fact]
    public void FeatureGateKeepsCountrysidePlacementUnavailableUntilEnabled()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(
            content.EconomyBalance,
            content.EconomyBalance.StartingTreasury,
            content.EconomyBalance.BaseRevenuePerSecond,
            population: 1_200,
            happiness: 70,
            landValue: 100,
            services: new EconomyBaseServices());
        BuildingDefinition road = content.GetBuilding("ROAD_STRAIGHT")!;
        CatalogAccess access = ConstructionVocabulary.GetCatalogAccess(road, [ProgressionTiers.Operator]);
        WorldSurfaceModel surface = new();

        PlacementDecision unavailable = PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(road),
            Position = PlacementWorldRules.SnapAim(500, 300, surface),
            CatalogAccess = access,
            Economy = economy,
            Surface = surface,
            CountrysideExpansionAvailable = false,
        });
        PlacementDecision available = PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(road),
            Position = PlacementWorldRules.SnapAim(500, 300, surface),
            CatalogAccess = access,
            Economy = economy,
            Surface = surface,
            CountrysideExpansionAvailable = true,
        });

        Assert.Contains(unavailable.Blockers, blocker =>
            blocker.Code == PlacementBlockerCodes.DistrictLocked
            && blocker.Message.Contains("Countryside", StringComparison.Ordinal));
        Assert.DoesNotContain(available.Blockers, blocker => blocker.Code == PlacementBlockerCodes.DistrictLocked);
        Assert.True(PlacementWorldRules.IsCountrysideExpansionPosition(500));
        Assert.False(PlacementWorldRules.IsCountrysideExpansionPosition(420));
    }
}

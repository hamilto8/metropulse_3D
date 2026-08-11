using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.Placement;

public sealed class PlacementWorldRulesTests
{
    [Fact]
    public void AimSnapsToTenMetreGridAndConformsToTerrain()
    {
        var surface = new WorldSurfaceModel();
        PlacementVector3 snapped = PlacementWorldRules.SnapAim(452.6, 47.4, surface);
        Assert.Equal(450, snapped.X);
        Assert.Equal(50, snapped.Z);
        Assert.Equal(surface.GetTerrainHeight(450, 50), snapped.Y);

        PlacementVector3 free = PlacementWorldRules.SnapAim(452.6, 47.4, surface, enabled: false);
        Assert.Equal(452.6, free.X);
        Assert.Equal(47.4, free.Z);
    }

    [Fact]
    public void ProductionWorldAdapterFindsValidRoadPlacementAndPrioritizedBlockers()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger economy = CreateEconomy(content);
        BuildingDefinition road = content.GetBuilding("ROAD_STRAIGHT")!;
        CatalogAccess access = ConstructionVocabulary.GetCatalogAccess(road, [ProgressionTiers.Operator]);

        PlacementDecision valid = PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(road),
            Position = new PlacementVector3(-125, 0.4, -75),
            CatalogAccess = access,
            Economy = economy,
            Surface = new WorldSurfaceModel(),
        });
        Assert.True(valid.Valid);
        Assert.Equal("$25,000", valid.Preview!.Summary.Cost);

        PlacementDecision protectedWater = PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(road),
            Position = new PlacementVector3(200, 0, 0),
            CatalogAccess = access,
            Economy = economy,
            Surface = new WorldSurfaceModel(),
            PlayerPosition = new PlacementVector3(200, 0, 0),
        });
        Assert.Equal(PlacementBlockerCodes.DistrictLocked, protectedWater.PrimaryBlocker!.Code);
        Assert.Contains(protectedWater.Blockers, item => item.Code == PlacementBlockerCodes.ProtectedLandmark);
        Assert.Contains(protectedWater.Blockers, item => item.Code == PlacementBlockerCodes.PlayerOccupied);
        Assert.Equal(protectedWater.Blockers.OrderBy(item => item.Priority), protectedWater.Blockers);
    }

    [Fact]
    public void OccupancyZoningAndRoadAccessUseOneStructuredDecision()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger economy = CreateEconomy(content, eastUnlocked: true);
        economy.SetService(ServiceTypes.Power, 120, 90);
        economy.SetService(ServiceTypes.Water, 100, 82);
        economy.SetService(ServiceTypes.Fire, 70, 60);
        BuildingDefinition lofts = content.GetBuilding("METRO_LOFTS")!;
        PlacementWorldOccupant occupant = new(
            "existing-1",
            "NeoTech HQ",
            "BUILDING",
            new PlacementRect(221, 251, -145, -115));
        PlacementZoneParcel zone = PlacementWorldRules.CreateZoneParcel("COMMERCIAL", 240, -120);

        PlacementDecision result = PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(lofts),
            Position = new PlacementVector3(236, 0, -130),
            CatalogAccess = ConstructionVocabulary.GetCatalogAccess(lofts, [ProgressionTiers.Operator]),
            Economy = economy,
            Surface = new WorldSurfaceModel(),
            Occupants = [occupant],
            Zones = [zone],
        });

        Assert.Equal(PlacementBlockerCodes.Collision, result.PrimaryBlocker!.Code);
        Assert.Contains(result.Blockers, item => item.Code == PlacementBlockerCodes.ZoneRestriction);
        Assert.True(result.Preview!.ServiceEffect[ServiceTypes.Power].Adequate);
    }

    [Fact]
    public void ZoneCreationAllowsOnlyTheThreeDevelopmentPolicies()
    {
        PlacementZoneParcel parcel = PlacementWorldRules.CreateZoneParcel("IND", 16, -14);
        Assert.Equal("OPERATIONS", parcel.ZoneType);
        Assert.Equal(30, parcel.X);
        Assert.Equal(0, parcel.Z);
        Assert.Throws<InvalidOperationException>(() =>
            PlacementWorldRules.CreateZoneParcel("POWER", 0, 0));
    }

    private static EconomyLedger CreateEconomy(GameContentRegistry content, bool eastUnlocked = false) => new(
        content.EconomyBalance,
        content.EconomyBalance.StartingTreasury,
        content.EconomyBalance.BaseRevenuePerSecond,
        population: 1_200,
        happiness: 70,
        landValue: 100,
        services: new EconomyBaseServices(),
        eastDistrictUnlocked: eastUnlocked);
}

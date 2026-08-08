using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using Xunit;

namespace MetroPulse.Domain.Tests.Placement;

public sealed class PlacementIntelligenceTests
{
    [Fact]
    public void FootprintGeometryRotatesMeasuresOverlapAndRoadAccessExactly()
    {
        PlacementFootprint oriented = PlacementGeometry.GetOrientedFootprint(30, 50, Math.PI / 2);
        Assert.Equal(new PlacementFootprint(50, 30), oriented);

        PlacementRect rect = PlacementGeometry.CreateRect(10, -5, 30, 50, Math.PI / 2);
        Assert.Equal(new PlacementRect(-17, 37, -22, 12), rect);
        Assert.True(PlacementGeometry.Overlaps(rect, new PlacementRect(36, 50, 0, 20)));
        Assert.False(PlacementGeometry.Overlaps(rect, new PlacementRect(37, 50, 0, 20)));
        Assert.Equal(12, PlacementGeometry.Distance(rect, new PlacementRect(49, 60, -10, 10)));
        Assert.True(PlacementGeometry.IsInside(rect, new PlanarBounds(-20, 40, -30, 20)));
        Assert.False(PlacementGeometry.IsInside(rect, new PlanarBounds(-16, 40, -30, 20)));
        Assert.True(PlacementGeometry.IsPlayerOccupied(rect, new PlacementVector3(40.9, 100, 0)));
        Assert.False(PlacementGeometry.IsPlayerOccupied(rect, new PlacementVector3(41, 0, 0)));
        Assert.True(PlacementGeometry.HasRoadAccess(
            rect,
            [new PlacementRect(49, 60, -10, 10)]));
        Assert.False(PlacementGeometry.HasRoadAccess(
            rect,
            [new PlacementRect(49.01, 60, -10, 10)]));
    }

    [Fact]
    public void TerrainSlopeAndWaterSamplesAreDeterministicAndSanitized()
    {
        var rect = new PlacementRect(0, 10, 0, 10);
        double slope = PlacementGeometry.GetSlopeDegrees(
            rect,
            new PlacementTerrainHeights(0, 10, 0, 10));
        Assert.Equal(45, slope, 12);
        Assert.Equal(
            0,
            PlacementGeometry.GetSlopeDegrees(
                rect,
                new PlacementTerrainHeights(double.NaN, 0, double.PositiveInfinity, 0)));

        IReadOnlyList<PlacementVector3> samples = PlacementGeometry.GetWaterSamplePoints(rect, double.NaN);
        Assert.Equal(5, samples.Count);
        Assert.Equal(new PlacementVector3(5, 0, 5), samples[0]);
        Assert.Equal(new PlacementVector3(10, 0, 10), samples[4]);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<PlacementVector3>)samples).Add(new PlacementVector3(0, 0, 0)));
    }

    [Fact]
    public void PlacementDecisionsPrioritizeImmutableBlockersWithConcreteRemedies()
    {
        PlacementDecision result = PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = OrdinarySpec,
            Position = new PlacementVector3(10, 0, 10),
            Access = new PlacementAccess(false, "BROKER", "Unlocks at Broker tier"),
            District = new PlacementDistrictAccess(false, "EAST", "East is locked."),
            InBounds = false,
            ProtectedLandmark = "Central Park",
            Water = true,
            SlopeDegrees = 15,
            MaxSlopeDegrees = 8,
            PlayerOccupied = true,
            RoadOverlap = true,
            Collision = new PlacementCollision("BUILDING", "existing-1", "NeoTech HQ"),
            Zone = new PlacementZone("COMMERCIAL", "Commercial"),
            ZoneCompatible = false,
            HasRoadAccess = false,
            EconomySnapshot = HealthyEconomy(),
            AvailableCredits = 10,
        });

        Assert.False(result.Valid);
        Assert.Equal(PlacementBlockerCodes.ContentLocked, result.PrimaryBlocker!.Code);
        Assert.Contains("Broker", result.PrimaryBlocker.Remedy, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(result.Blockers, blocker => blocker.Code == PlacementBlockerCodes.RoadAccess);
        Assert.Contains(result.Blockers, blocker => blocker.Code == PlacementBlockerCodes.InsufficientFunds);
        Assert.Equal(result.Blockers.OrderBy(blocker => blocker.Priority), result.Blockers);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<PlacementBlocker>)result.Blockers).Add(result.PrimaryBlocker));
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, object?>)result.PrimaryBlocker.Detail).Add("changed", true));
    }

    [Fact]
    public void InvalidTargetFailsClosedWithoutForecastOrSecondaryBlockers()
    {
        PlacementDecision missing = PlacementIntelligence.Evaluate();
        PlacementDecision malformed = PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = OrdinarySpec,
            Position = new PlacementVector3(double.NaN, 0, 0),
            Access = new PlacementAccess(false),
        });

        foreach (PlacementDecision result in new[] { missing, malformed })
        {
            Assert.False(result.Valid);
            Assert.Single(result.Blockers);
            Assert.Equal(PlacementBlockerCodes.InvalidInput, result.PrimaryBlocker!.Code);
            Assert.Null(result.Preview);
            Assert.Null(result.Position);
        }
    }

    [Fact]
    public void OrdinaryDevelopmentRequiresRoadAccessAndProjectedCriticalServices()
    {
        PlacementDecision noRoad = PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = OrdinarySpec,
            Position = new PlacementVector3(0, 0, 0),
            HasRoadAccess = false,
            EconomySnapshot = HealthyEconomy(),
            AvailableCredits = 650_000,
        });
        Assert.Equal([PlacementBlockerCodes.RoadAccess], noRoad.Blockers.Select(blocker => blocker.Code));

        PlacementDecision noWater = PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = OrdinarySpec,
            Position = new PlacementVector3(0, 0, 0),
            EconomySnapshot = HealthyEconomy() with
            {
                Services = new PlacementServicesSnapshot
                {
                    Power = new PlacementServiceSnapshot(120, 90),
                    Water = new PlacementServiceSnapshot(90, 85),
                    Fire = new PlacementServiceSnapshot(70, 60),
                },
            },
            AvailableCredits = 650_000,
        });
        Assert.Equal(PlacementBlockerCodes.ServiceShortage, noWater.PrimaryBlocker!.Code);
        Assert.Equal("water", noWater.PrimaryBlocker.Detail["service"]);
        Assert.Equal(5d, noWater.PrimaryBlocker.Detail["shortage"]);
    }

    [Fact]
    public void ForecastCoversFinanceCapacityDemandServicesCommunityAndRisk()
    {
        PlacementPreview preview = PlacementIntelligence.CreatePreview(
            OrdinarySpec,
            HealthyEconomy(),
            availableCredits: 650_000);

        Assert.Equal(350_000, preview.Cost);
        Assert.Equal(0, preview.OperatingCost);
        Assert.Equal(1_900, preview.GrossIncome);
        Assert.Equal(1_900, preview.NetCashflow);
        Assert.Equal("MEDIUM", preview.Payback.Category);
        Assert.Equal("Medium · 185 min", preview.Payback.Label);
        Assert.Equal(180, preview.Capacity.Residents);
        Assert.Equal("residential", preview.DemandEffect.Type);
        Assert.Equal(22, preview.ServiceEffect[ServiceTypes.Power].ProjectedSurplus);
        Assert.Equal(8, preview.ServiceEffect[ServiceTypes.Water].ProjectedSurplus);
        Assert.Equal(1, preview.Happiness);
        Assert.Equal(0.6, preview.LandValue, 12);
        Assert.Equal(new PlacementRisk("LOW", "No material forecast risk"), Assert.Single(preview.Risks));
        Assert.Equal("$350,000", preview.Summary.Cost);
        Assert.Equal("+$1,900/min", preview.Summary.NetCashflow);
    }

    [Fact]
    public void FiscalRestrictionIsSpecificBlockerAndVisibleForecastRisk()
    {
        SpendingDecision restriction = RestrictedSpendingDecision();
        PlacementDecision result = PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = OrdinarySpec,
            Position = new PlacementVector3(0, 0, 0),
            EconomySnapshot = HealthyEconomy(),
            AvailableCredits = 100_000,
            SpendingDecision = restriction,
        });

        Assert.False(result.Valid);
        Assert.Contains(result.Blockers, blocker => blocker.Code == PlacementBlockerCodes.FiscalRestriction);
        Assert.Contains(
            result.Preview!.Risks,
            risk => risk.Label.Contains("recovery restrictions", StringComparison.Ordinal));
    }

    [Fact]
    public void ServicePrerequisitesRespectInfrastructureAndExplicitOverrides()
    {
        PlacementEconomySnapshot empty = new();
        PlacementDecision road = ValidAt(new PlacementSpec
        {
            Id = "ROAD",
            Name = "Road",
            Category = "INFRASTRUCTURE",
            GeneratorType = "ROAD_SEGMENT",
            Cost = 10,
        }, empty);
        Assert.True(road.Valid);

        PlacementDecision energy = ValidAt(new PlacementSpec
        {
            Id = "SOLAR",
            Name = "Solar",
            Category = "FACILITIES",
            GeneratorType = "ENERGY_ARRAY",
            WaterDemand = 4,
            PowerSupply = 50,
        }, empty);
        Assert.Equal(PlacementBlockerCodes.ServiceShortage, energy.PrimaryBlocker!.Code);
        Assert.Equal(ServiceTypes.Water, energy.PrimaryBlocker.Detail["service"]);

        PlacementDecision explicitFire = ValidAt(new PlacementSpec
        {
            Id = "DEPOT",
            Name = "Depot",
            Category = "INFRASTRUCTURE",
            RequiredServices = ["fire", "unknown"],
            FireDemand = 3,
        }, empty);
        Assert.Single(explicitFire.Blockers);
        Assert.Equal(ServiceTypes.Fire, explicitFire.PrimaryBlocker!.Detail["service"]);
    }

    [Fact]
    public void CanonicalBuildingAdapterProducesFiniteForecastForEveryAuthoredSpec()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();
        PlacementPreview[] previews = registry.BuildingRecords
            .Select(PlacementSpec.FromBuilding)
            .Select(spec => PlacementIntelligence.CreatePreview(spec, HealthyEconomy()))
            .ToArray();

        Assert.Equal(19, previews.Length);
        Assert.All(previews, preview =>
        {
            Assert.True(double.IsFinite(preview.Cost));
            Assert.True(double.IsFinite(preview.NetCashflow));
            Assert.Equal(3, preview.ServiceEffect.Count);
        });
        PlacementPreview metroLofts = previews.Single(preview => preview.SpecId == "METRO_LOFTS");
        Assert.Equal("Metro Cyber Lofts", metroLofts.Name);
        Assert.Equal(350_000, metroLofts.Cost);
        Assert.Equal(1_900, metroLofts.NetCashflow);
    }

    [Fact]
    public void ExplicitRevenueAndUpkeepProduceTruthfulNetWhilePublicServiceHasNoPayback()
    {
        PlacementPreview enterprise = PlacementIntelligence.CreatePreview(new PlacementSpec
        {
            Id = "ENTERPRISE",
            Name = "Enterprise",
            RevenuePerMinute = 2_500,
            OperatingCostPerMinute = 700,
            Cost = 90_000,
        });
        Assert.Equal(1_800, enterprise.NetCashflow);
        Assert.Equal("FAST", enterprise.Payback.Category);

        PlacementPreview publicService = PlacementIntelligence.CreatePreview(new PlacementSpec
        {
            Id = "SERVICE",
            Name = "Service",
            IncomePerMinute = -450,
            Cost = 100_000,
        });
        Assert.Equal(450, publicService.OperatingCost);
        Assert.Equal(-450, publicService.NetCashflow);
        Assert.Equal("PUBLIC_SERVICE", publicService.Payback.Category);
        Assert.Null(publicService.Payback.Minutes);
        Assert.Equal("−$450/min", publicService.Summary.NetCashflow);
    }

    private static PlacementDecision ValidAt(PlacementSpec spec, PlacementEconomySnapshot economy) =>
        PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = spec,
            Position = new PlacementVector3(0, 0, 0),
            EconomySnapshot = economy,
            AvailableCredits = 1_000_000,
        });

    private static PlacementEconomySnapshot HealthyEconomy() => new()
    {
        Demand = new PlacementDemandSnapshot(72, 40, 30, 10),
        Services = new PlacementServicesSnapshot
        {
            Power = new PlacementServiceSnapshot(120, 90),
            Water = new PlacementServiceSnapshot(100, 82),
            Fire = new PlacementServiceSnapshot(70, 60),
        },
    };

    private static SpendingDecision RestrictedSpendingDecision() => new()
    {
        Allowed = false,
        Code = "RECOVERY_RESTRICTION",
        Reason = "Optional expansion is paused while the city is under fiscal recovery restrictions.",
        Remedy = "Restore non-negative cashflow and rebuild the emergency reserve first.",
        Category = SpendingCategories.Discretionary,
        State = FiscalStates.Recovery,
        Amount = 350_000,
        RemainingTreasury = -250_000,
        ProjectedNetRate = 0,
        RunwayMinutes = null,
        Warning = null,
        RecoveryInvestment = false,
    };

    private static readonly PlacementSpec OrdinarySpec = new()
    {
        Id = "METRO_LOFTS",
        Name = "Metro Cyber Lofts",
        Category = "RESIDENTIAL",
        GeneratorType = "RESIDENTIAL",
        Footprint = new PlacementFootprint(30, 30),
        Cost = 350_000,
        IncomePerMinute = 1_900,
        Residents = 180,
        PowerDemand = 8,
        WaterDemand = 10,
        Happiness = 1,
    };
}

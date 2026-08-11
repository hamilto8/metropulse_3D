using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Services;
using Xunit;

namespace MetroPulse.Domain.Tests.Services;

public sealed class CityServiceModelTests
{
    [Fact]
    public void AggregateCapacityAndLocalFacilityReachMatchBrowserReference()
    {
        (_, _, CityServiceModel model) = CreateHarness();

        ServiceCoverageReading aggregate = model.GetCoverage(ServiceTypes.Power);
        ServiceCoverageReading nearFacility = model.GetCoverage(
            ServiceTypes.Power,
            new ServiceCoverageSelector(Position: new OutcomePosition(-20, 0)));
        ServiceCoverageReading bridge = model.GetCoverage(
            ServiceTypes.Power,
            new ServiceCoverageSelector(Position: new OutcomePosition(210, 0)));

        Assert.Equal(1, aggregate.Coverage);
        Assert.Equal(150, aggregate.Facts.Aggregate.Capacity);
        Assert.Equal(1, nearFacility.Coverage);
        Assert.Equal(1, nearFacility.Facts.NetworkAccess);
        Assert.Equal("PRIMARY_BRIDGE_CORRIDOR", bridge.DistrictId);
        Assert.Equal(0.76, bridge.Coverage);
        Assert.Equal(ServiceHealth.Strained, bridge.Health);
        Assert.Contains("76% local access", bridge.Explanation, StringComparison.Ordinal);
    }

    [Fact]
    public void SpatialOutageFallsOffWithoutFlatteningDistrictOrCity()
    {
        (_, MissionOutcomeService outcomes, CityServiceModel model) = CreateHarness();
        outcomes.Apply(new MissionOutcomeTransaction(
            "system:bridge-outage",
            new OutcomeSource(OutcomeSourceKinds.System, "bridge-outage", "REPORTED"),
            [new ServiceOutageSetCommand(
                "bridge-outage",
                ServiceTypes.Power,
                "PRIMARY_BRIDGE_CORRIDOR",
                true,
                0.8,
                0.25,
                "relay",
                "Relay failure",
                new OutcomePosition(210, 0),
                80)],
            new OutcomeSummary("Bridge outage", "A local relay failed.")));

        ServiceCoverageReading site = model.GetCoverage(
            ServiceTypes.Power,
            new ServiceCoverageSelector(Position: new OutcomePosition(210, 0)));
        ServiceCoverageReading districtEdge = model.GetCoverage(
            ServiceTypes.Power,
            new ServiceCoverageSelector(Position: new OutcomePosition(300, 100)));
        CityServiceSnapshot aggregate = model.Snapshot();

        Assert.Equal(0.19, site.Coverage, 9);
        Assert.True(site.OutageActive);
        Assert.Equal(ServiceHealth.Critical, site.Health);
        Assert.False(districtEdge.OutageActive);
        Assert.Equal(0.76, districtEdge.Coverage);
        Assert.InRange(aggregate.Energy.Coverage, 0.8, 0.999999);
        Assert.Equal(0, aggregate.ActiveIncidentCount);
    }

    [Fact]
    public void MissionQueriesUseTheSameLocalServiceExplanation()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes, CityServiceModel model) = CreateHarness();
        var conditions = new CityConditionService(economy, outcomes, serviceModel: model);

        CityConditionResult result = conditions.Query(new CityConditionRequest
        {
            Type = CityConditionTypes.ServiceCoverage,
            Service = ServiceTypes.Fire,
            DistrictId = "PRIMARY_BRIDGE_CORRIDOR",
            X = 220,
            Z = 0,
        });

        Assert.Equal(0.58, result.Value.GetProperty("coverage").GetDouble());
        Assert.Equal(ServiceHealth.Critical, result.Value.GetProperty("health").GetString());
        Assert.Contains("Safety response", result.Value.GetProperty("explanation").GetString(), StringComparison.Ordinal);
        Assert.Equal(0.58, result.Facts.GetProperty("networkAccess").GetDouble());
    }

    [Fact]
    public void SubscriptionsObserveBothAuthoritiesAndCanBeReleased()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes, CityServiceModel model) = CreateHarness();
        var readings = new List<CityServiceSnapshot>();
        Func<bool> unsubscribe = model.Subscribe(value => readings.Add(value.Current), emitCurrent: true);
        economy.SetService(ServiceTypes.Power, capacity: 100, demand: 200);
        outcomes.Apply(new MissionOutcomeTransaction(
            "system:flag-only",
            new OutcomeSource(OutcomeSourceKinds.System, "flag-only", "SET"),
            [new AuthoredFlagSetCommand("service.test", OutcomeValues.From(true))],
            new OutcomeSummary("Flag set", "A revision-only outcome.")));
        Assert.True(unsubscribe());
        economy.SetService(ServiceTypes.Power, capacity: 100, demand: 210);

        Assert.Equal(3, readings.Count);
        Assert.True(readings[1].Energy.Coverage < readings[0].Energy.Coverage);
        model.Destroy();
    }

    private static (EconomyLedger Economy, MissionOutcomeService Outcomes, CityServiceModel Model) CreateHarness()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(
            content.EconomyBalance,
            20_000,
            0,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(100, 100),
                Water = new EconomyServiceBase(100, 100),
                Fire = new EconomyServiceBase(100, 100),
            });
        economy.RegisterBuilding(new EconomyBuilding("west-energy-array")
        {
            Name = "West energy array",
            Position = new EconomyPoint(-20, 0),
            Services = new EconomyBuildingServices
            {
                Power = new EconomyBuildingService(50, 0, 120),
            },
        });
        var outcomes = new MissionOutcomeService(economy, content);
        return (economy, outcomes, new CityServiceModel(economy, outcomes));
    }
}

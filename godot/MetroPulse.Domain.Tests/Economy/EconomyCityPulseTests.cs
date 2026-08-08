using System.Text.Json;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using Xunit;

namespace MetroPulse.Domain.Tests.Economy;

public sealed class EconomyCityPulseTests
{
    [Fact]
    public void LaborMarketProducesExplainableDemographicsDemandAndHappiness()
    {
        var ledger = Create(population: 100, happiness: 70);
        ledger.RegisterBuilding(new EconomyBuilding("workshop") { JobCapacity = 31 });

        EconomyLedgerSnapshot state = ledger.Snapshot();
        Assert.Equal(62, state.Demographics.Workforce);
        Assert.Equal(31, state.Demographics.Employed);
        Assert.Equal(0.5, state.Demographics.UnemploymentRate);
        Assert.Equal(-7.5, state.HappinessBreakdown.Employment);
        Assert.Equal(62.5, state.CityPulse.Happiness);
        Assert.True(state.Demand.Operations > 0);
    }

    [Fact]
    public void BuildingsAndUtilitiesMatchAggregateCityPulseFormulas()
    {
        var ledger = Create(
            population: 100,
            happiness: 50,
            landValue: 200,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(80, 40),
                Water = new EconomyServiceBase(20, 10),
                Fire = new EconomyServiceBase(5, 5),
            });
        ledger.RegisterBuilding(new EconomyBuilding("garden-tower")
        {
            Name = "Garden Tower",
            Kind = "RESIDENTIAL",
            Value = 480_000,
            Employees = 12,
            Population = 40,
            HappinessModifier = 8,
            LandValueModifier = 15,
            Services = new EconomyBuildingServices
            {
                Power = new EconomyBuildingService(20, 60),
                Water = new EconomyBuildingService(Demand: 10),
                Fire = new EconomyBuildingService(Demand: 5),
            },
        });

        EconomyLedgerSnapshot state = ledger.Snapshot();
        Assert.Equal(140, state.CityPulse.Population);
        Assert.Equal(53, state.CityPulse.Happiness);
        Assert.Equal(206.04166666666666, state.CityPulse.LandValue, 9);
        Assert.Equal(12, state.CityPulse.Employees);
        Assert.Equal(480_000, state.CityPulse.TotalBuildingValue);
        Assert.Equal(100, state.Services.Power.Capacity);
        Assert.Equal(100, state.Services.Power.Demand);
        Assert.Equal(100, state.CityPulse.Energy);
        Assert.Equal(1, state.Services.Water.Coverage);
        Assert.Equal(0.5, state.Services.Fire.Coverage);

        Assert.NotNull(ledger.RemoveBuilding("garden-tower"));
        Assert.Equal(100, ledger.Snapshot().CityPulse.Population);
        Assert.Null(ledger.RemoveBuilding("missing"));
    }

    [Fact]
    public void ServiceShortagesReduceRevenueHappinessAndLandValue()
    {
        var ledger = Create(
            passiveIncomeRate: 100,
            happiness: 80,
            landValue: 200,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(50, 100),
                Water = new EconomyServiceBase(25, 100),
                Fire = new EconomyServiceBase(0, 100),
            });

        Assert.Equal(55, ledger.PassiveIncomeRate, 9);
        EconomyLedgerSnapshot shortage = ledger.Snapshot();
        Assert.Equal(58.75, shortage.CityPulse.Happiness);
        Assert.Equal(162.5, shortage.CityPulse.LandValue);
        Assert.Equal(25, shortage.CityPulse.ServiceHealth);

        ledger.SetService(ServiceTypes.Water, capacity: 100, demand: 100);
        ledger.SetService(ServiceTypes.Fire, capacity: 100, demand: 100);
        Assert.Equal(70, ledger.PassiveIncomeRate, 9);
        Assert.True(ledger.Snapshot().CityPulse.Happiness > shortage.CityPulse.Happiness);
    }

    [Fact]
    public void ParcelLandValueUsesSpatialAmenityAndMayhemFalloff()
    {
        var ledger = Create(landValue: 100);
        ledger.RegisterBuilding(new EconomyBuilding("river-park")
        {
            LandValueModifier = 20,
            Position = new EconomyPoint(0, 0),
            AmenityRadius = 100,
        });
        ledger.RecordIncident(new EconomyIncident
        {
            Id = "tower-rubble",
            Type = "BUILDING_DESTROYED",
            LandValueModifier = -30,
            Position = new EconomyPoint(0, 0),
            InfluenceRadius = 50,
        });

        EconomyLandValueBreakdown center = ledger.GetLandValueBreakdownAt(0, 0);
        Assert.Equal(20, center.AmenityModifier);
        Assert.Equal(-30, center.MayhemModifier);
        Assert.Equal(90, center.LandValue);
        Assert.Equal(100, ledger.GetLandValueAt(25, 0));
        Assert.Equal(105, ledger.GetLandValueAt(75, 0));
        Assert.Equal(100, ledger.GetLandValueAt(100, 0));
        Assert.Equal(90, ledger.Snapshot().CityPulse.LandValue);

        Assert.True(ledger.ResolveIncident("tower-rubble"));
        Assert.Equal(120, ledger.GetLandValueAt(0, 0));
        Assert.Throws<ArgumentException>(() => ledger.RegisterBuilding(
            new EconomyBuilding("invalid-amenity") { AmenityRadius = 25 }));
        Assert.Throws<ArgumentException>(() => ledger.RecordIncident(
            new EconomyIncident { Id = "invalid-zone", InfluenceRadius = 25 }));
    }

    [Fact]
    public void ZonesAndIncidentsReplaceResolveAndPreservePersistentConsequences()
    {
        var ledger = Create(happiness: 99, landValue: 100, reputation: 10);
        ledger.SetZoneEffect(new EconomyZoneEffect("0,0", "RESIDENTIAL", 4, 2, new EconomyPoint(0, 0)));
        Assert.Equal(100, ledger.Snapshot().CityPulse.Happiness);

        EconomyZoneEffect replaced = ledger.SetZoneEffect(
            new EconomyZoneEffect("0,0", "INDUSTRIAL", -2, -1, new EconomyPoint(0, 0)));
        Assert.Equal("OPERATIONS", replaced.Type);
        Assert.Equal(97, ledger.Snapshot().CityPulse.Happiness);
        Assert.NotNull(ledger.RemoveZoneEffect("0,0"));
        Assert.Equal(99, ledger.Snapshot().CityPulse.Happiness);

        ledger.RecordIncident(new EconomyIncident
        {
            Id = "bridge-chaos",
            Type = "TRAFFIC_JAM",
            Severity = 4,
            ReputationDelta = -5,
            HappinessModifier = -20,
            LandValueModifier = -30,
        });
        Assert.Equal(5, ledger.Reputation);
        Assert.Equal(79, ledger.Snapshot().CityPulse.Happiness);
        Assert.Equal(70, ledger.Snapshot().CityPulse.LandValue);
        Assert.True(ledger.HasIncident("bridge-chaos"));
        Assert.True(ledger.ResolveIncident("bridge-chaos"));
        Assert.False(ledger.ResolveIncident("bridge-chaos"));
        Assert.Equal(5, ledger.Reputation);
        Assert.Equal(99, ledger.Snapshot().CityPulse.Happiness);
    }

    [Fact]
    public void MobilityFeedbackDrivesProductivityAccessSatisfactionAndManagementCost()
    {
        var ledger = Create(
            passiveIncomeRate: 20,
            population: 4_000,
            happiness: 75,
            services: FullyServed());
        ledger.RegisterBuilding(new EconomyBuilding("operations-hub", 80, 10) { JobCapacity = 3_500 });
        ledger.SetMobilityFeedback(new EconomyMobilityFeedback
        {
            Revision = 4,
            ProductivityMultiplier = 0.8,
            JobAccessMultiplier = 0.75,
            SatisfactionModifier = -6,
            DeliveryReliability = 0.7,
            Congestion = 0.6,
            BridgeCongestion = 0.5,
            ManagementCostRate = 2,
            Explanation = new[] { "Bridge congestion reduces access." },
        });

        EconomyLedgerSnapshot state = ledger.Snapshot();
        Assert.Equal(0.8, state.BudgetBreakdown.MobilityProductivityMultiplier);
        Assert.Equal(68, state.BudgetBreakdown.NetRate, 9);
        Assert.True(state.Demographics.AccessibleEmployed < state.Demographics.Employed);
        Assert.Equal(-6, state.HappinessBreakdown.Traffic);
        Assert.Equal(70, state.CityPulse.DeliveryReliability);
        Assert.Equal(60, state.CityPulse.TrafficCongestion);
        Assert.Throws<ArgumentOutOfRangeException>(() => ledger.SetMobilityFeedback(
            new EconomyMobilityFeedback { Congestion = 1.1 }));
    }

    [Fact]
    public void CityPulseSettersAndDistrictUnlockPreserveInvariants()
    {
        var ledger = Create(initialTreasury: 99, eastDistrictUnlockCost: 100);
        ledger.SetService(ServiceTypes.Power, 90, 100);
        ledger.AdjustService(ServiceTypes.Power, 10, -20);
        ledger.SetPopulation(2_450);
        ledger.AdjustPopulation(50);
        ledger.SetHappiness(95);
        ledger.AdjustHappiness(10);
        ledger.SetLandValue(120);
        ledger.AdjustLandValue(-20);

        EconomyLedgerSnapshot state = ledger.Snapshot();
        Assert.Equal(100, state.Services.Power.Capacity);
        Assert.Equal(80, state.Services.Power.Demand);
        Assert.Equal(2_500, state.CityPulse.Population);
        Assert.Equal(100, state.CityPulse.Happiness);
        Assert.Equal(100, state.CityPulse.LandValue);
        Assert.False(ledger.UnlockEastDistrict());
        ledger.Earn(1);
        Assert.True(ledger.CanUnlockDistrict(EconomyDistrictIds.EastCyber));
        Assert.True(ledger.UnlockDistrict(EconomyDistrictIds.EastCyber));
        Assert.Equal(0, ledger.Treasury);
        Assert.False(ledger.UnlockEastDistrict());
        Assert.Equal(
            new[] { EconomyDistrictIds.EastCyberMetropolis, EconomyDistrictIds.EastCyber },
            ledger.Snapshot().UnlockedDistricts);

        Assert.Throws<ArgumentOutOfRangeException>(() => ledger.SetService("police"));
        Assert.Throws<ArgumentOutOfRangeException>(() => ledger.SetHappiness(101));
        ledger.AdjustLandValue(-101);
        Assert.Equal(0, ledger.Snapshot().CityPulse.LandValue);
    }

    [Fact]
    public void VersionedPersistenceRoundTripsAuthorityAndResetsDerivedMobility()
    {
        var source = Create(
            initialTreasury: 1_000,
            passiveIncomeRate: 12,
            population: 100,
            happiness: 70,
            landValue: 120,
            eastDistrictUnlockCost: 500);
        source.RegisterBuilding(new EconomyBuilding("saved-building")
        {
            Name = "Saved Plaza",
            Population = 20,
            Employees = 4,
            Position = new EconomyPoint(10, 20),
            AmenityRadius = 30,
            Services = new EconomyBuildingServices
            {
                Power = new EconomyBuildingService(10, 0, 75),
            },
        });
        source.CompleteMission("saved-mission", 50);
        source.RecordIncident(new EconomyIncident { Id = "saved-incident", HappinessModifier = -2 });
        source.SetZoneEffect(new EconomyZoneEffect("saved-zone", "COMMERCIAL", 1));
        source.UnlockEastDistrict();
        source.SetMobilityFeedback(new EconomyMobilityFeedback { Revision = 2, Congestion = 0.5 });
        EconomyLedgerState saved = source.Serialize();
        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        string json = JsonSerializer.Serialize(saved, jsonOptions);
        EconomyLedgerState decoded = JsonSerializer.Deserialize<EconomyLedgerState>(json, jsonOptions)!;

        var target = Create(eastDistrictUnlockCost: 500);
        EconomyLedgerSnapshot restored = target.Restore(decoded);
        Assert.Equal(source.Treasury, restored.Treasury);
        Assert.Equal(1, restored.NarrativeProgress);
        Assert.Equal(75, restored.Buildings.Single().Services.Power.Reach);
        Assert.Contains(restored.CompletedMissions, mission => mission.Id == "saved-mission");
        Assert.Contains(restored.Incidents, incident => incident.Id == "saved-incident");
        Assert.Contains(restored.Zones, zone => zone.Id == "saved-zone");
        Assert.True(target.IsDistrictUnlocked(EconomyDistrictIds.EastCyberMetropolis));
        Assert.Equal(0, restored.Mobility.Revision);
        Assert.Equal(0, restored.Mobility.Congestion);

        long revision = target.Revision;
        double treasury = target.Treasury;
        Assert.Throws<ArgumentOutOfRangeException>(() => target.Restore(saved with { Version = 99 }));
        Assert.Equal(revision, target.Revision);
        Assert.Equal(treasury, target.Treasury);
    }

    [Fact]
    public void RecoveryStatePersistsWithoutDuplicatingAssistance()
    {
        var source = Create(initialTreasury: 1);
        source.RegisterBuilding(new EconomyBuilding("upkeep", operatingCostRate: 1));
        source.Update(1);
        EconomyFiscalOverview insolvent = source.GetFiscalOverview();
        Assert.Equal("Insolvent", insolvent.Label);
        Assert.Equal("Capital is exhausted while recurring costs exceed revenue.", insolvent.Explanation);
        Assert.Contains("Claim emergency stabilization assistance.", insolvent.Actions);
        Assert.True(source.RequestEmergencyAssistance().Granted);
        Assert.Equal(3, source.GetFiscalOverview().Restrictions.Count);

        var target = Create();
        target.Restore(source.Serialize());
        Assert.Equal(FiscalStates.Recovery, target.Snapshot().FiscalStatus);
        Assert.Equal(1, target.Recovery.AssistanceClaims);
        Assert.Equal(100_000, target.Treasury);
        Assert.False(target.RequestEmergencyAssistance().Granted);
    }

    private static EconomyLedger Create(
        double initialTreasury = 0,
        double passiveIncomeRate = 0,
        double reputation = 0,
        int population = 0,
        double happiness = 50,
        double landValue = 100,
        EconomyBaseServices? services = null,
        double? eastDistrictUnlockCost = null) =>
        new(
            GameContentRegistry.LoadProduction().EconomyBalance,
            initialTreasury,
            passiveIncomeRate,
            reputation: reputation,
            population: population,
            happiness: happiness,
            landValue: landValue,
            services: services,
            eastDistrictUnlockCost: eastDistrictUnlockCost);

    private static EconomyBaseServices FullyServed() => new()
    {
        Power = new EconomyServiceBase(100, 100),
        Water = new EconomyServiceBase(100, 100),
        Fire = new EconomyServiceBase(100, 100),
    };
}

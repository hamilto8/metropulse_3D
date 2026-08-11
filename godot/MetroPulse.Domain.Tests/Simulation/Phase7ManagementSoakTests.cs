using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Services;
using MetroPulse.Domain.WorldEditing;
using Xunit;

namespace MetroPulse.Domain.Tests.Simulation;

public sealed class Phase7ManagementSoakTests
{
    [Fact]
    public void RepeatedWorldEditsAndIncidentRecoveryLeaveNoActiveRuntimeResidue()
    {
        const int cycles = 50;
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(content.EconomyBalance, 2_000_000, 8);
        var stores = new List<MemoryWorldEditParticipant>();
        IWorldEditParticipant[] participants = WorldEditParticipantIds.RequiredOrder.Select(id =>
        {
            if (id == WorldEditParticipantIds.Economy) return (IWorldEditParticipant)new EconomyWorldEditParticipant(economy);
            var store = new MemoryWorldEditParticipant(id);
            stores.Add(store);
            return store;
        }).ToArray();
        var editor = new WorldEditCoordinator(content, economy, participants);
        var outcomes = new MissionOutcomeService(economy, content);
        var services = new CityServiceModel(economy, outcomes);
        var response = new IncidentResponseService(outcomes, economy, cleanupCostPerSeverity: 0, repairCostPerSeverity: 0);

        for (int cycle = 0; cycle < cycles; cycle++)
        {
            double x = -125 + cycle % 5;
            WorldEditRecord placed = editor.Place("ROAD_STRAIGHT", Decision(x, -75)).Current!;
            editor.Move(placed.Id, Decision(x, -25));
            editor.Rotate(placed.Id, Decision(x, -25), Math.PI / 2);
            editor.Demolish(placed.Id);
            economy.Earn(12_500, "soak-neutralizer", placed.Id);

            string incidentId = $"soak-incident-{cycle:D3}";
            response.ReportIncident(new IncidentDefinition
            {
                Id = incidentId,
                Position = new OutcomePosition(205, 18),
            });
            response.ScheduleResponse(incidentId);
            response.PerformStreetWork($"work:{incidentId}:cleanup");
            response.PerformStreetWork($"work:{incidentId}:cleanup");
            response.PerformStreetWork($"work:{incidentId}:repair");
            response.PerformStreetWork($"work:{incidentId}:repair");

            if ((cycle + 1) % 10 == 0)
            {
                outcomes.Restore(outcomes.Serialize());
            }
            Assert.Empty(editor.Records);
            Assert.All(stores, store => Assert.Empty(store.Records));
            Assert.Null(economy.GetBuilding(placed.Id));
            Assert.Equal(0, services.Snapshot().ActiveIncidentCount);
            Assert.Equal(0, services.Snapshot().OpenWorkOrderCount);
        }

        Assert.Equal(cycles * 6, outcomes.Snapshot().Transactions.Count);
        Assert.Equal(2_000_000, economy.Treasury);
        services.Destroy();
    }

    private static PlacementDecision Decision(double x, double z) => new(
        true,
        Array.Empty<PlacementBlocker>(),
        null,
        PlacementIntelligence.CreatePreview(new PlacementSpec
        {
            Id = "ROAD_STRAIGHT",
            Name = "Road",
            Category = ConstructionCategories.Infrastructure,
            GeneratorType = "ROAD_SEGMENT",
            Footprint = new PlacementFootprint(30, 30),
            Cost = 25_000,
            IncomePerMinute = -80,
        }),
        new PlacementVector3(x, 0.4, z));
}

using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.WorldEditing;
using Xunit;

namespace MetroPulse.Domain.Tests.WorldEditing;

public sealed class WorldEditTransactionTests
{
    [Fact]
    public void PossiblyPartialThrowAndEarlierStepsCompensateInStrictLifoOrder()
    {
        var calls = new List<string>();
        WorldEditTransactionException error = Assert.Throws<WorldEditTransactionException>(() =>
            WorldEditTransaction.Run("fixture", transaction =>
            {
                transaction.Step("first", () => { calls.Add("apply:first"); return "one"; },
                    (_, _) => calls.Add("undo:first"));
                transaction.Step<int>("second", () =>
                {
                    calls.Add("apply:second-partial");
                    throw new InvalidOperationException("injected");
                }, (_, _) => calls.Add("undo:second"));
                return true;
            }));

        Assert.Equal(
            ["apply:first", "apply:second-partial", "undo:second", "undo:first"],
            calls);
        Assert.Empty(error.RollbackErrors);
    }

    [Fact]
    public void RejectionWithoutMutationDoesNotInvokeItsInverse()
    {
        var calls = new List<string>();
        Assert.Throws<WorldEditTransactionException>(() =>
            WorldEditTransaction.Run("fixture", transaction =>
            {
                transaction.Step("first", () => { calls.Add("apply:first"); return true; },
                    (_, _) => calls.Add("undo:first"));
                transaction.Step("reject", () => { calls.Add("reject"); return false; },
                    (_, _) => calls.Add("undo:reject"));
                return true;
            }));

        Assert.Equal(["apply:first", "reject", "undo:first"], calls);
    }

    [Fact]
    public void EveryPlacementParticipantFailureRestoresTreasuryAndAllPriorStores()
    {
        foreach (string failingId in WorldEditParticipantIds.RequiredOrder)
        {
            GameContentRegistry content = GameContentRegistry.LoadProduction();
            EconomyLedger economy = CreateEconomy(content);
            List<MemoryWorldEditParticipant> stores = WorldEditParticipantIds.RequiredOrder
                .Select(id => new MemoryWorldEditParticipant(
                    id,
                    (operation, _) => !(id == failingId && operation == "ATTACH")))
                .ToList();
            var coordinator = new WorldEditCoordinator(content, economy, stores);

            Assert.Throws<WorldEditTransactionException>(() =>
                coordinator.Place("ROAD_STRAIGHT", ValidDecision(-125, -75)));

            Assert.Equal(650_000, economy.Treasury);
            Assert.Empty(coordinator.Records);
            Assert.All(stores, store => Assert.Empty(store.Records));
        }
    }

    [Fact]
    public void PlaceMoveRotateAndDemolishKeepEveryParticipantAndEconomyConsistent()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger economy = CreateEconomy(content);
        var visual = new MemoryWorldEditParticipant(WorldEditParticipantIds.Visual);
        var collider = new MemoryWorldEditParticipant(WorldEditParticipantIds.Collider);
        var road = new MemoryWorldEditParticipant(WorldEditParticipantIds.RoadGraph);
        var economyParticipant = new EconomyWorldEditParticipant(economy);
        var occupancy = new MemoryWorldEditParticipant(WorldEditParticipantIds.Occupancy);
        var zoning = new MemoryWorldEditParticipant(WorldEditParticipantIds.Zoning);
        var service = new MemoryWorldEditParticipant(WorldEditParticipantIds.Service);
        var persistence = new MemoryWorldEditParticipant(WorldEditParticipantIds.Persistence);
        IWorldEditParticipant[] participants =
        [visual, collider, road, economyParticipant, occupancy, zoning, service, persistence];
        var coordinator = new WorldEditCoordinator(content, economy, participants);

        WorldEditReceipt placed = coordinator.Place("ROAD_STRAIGHT", ValidDecision(-125, -75));
        string id = placed.Current!.Id;
        Assert.Equal(-25_000, placed.TreasuryDelta);
        Assert.Equal(625_000, economy.Treasury);
        Assert.NotNull(economy.GetBuilding(id));
        Assert.All(new[] { visual, collider, road, occupancy, zoning, service, persistence },
            store => Assert.Equal(placed.Current, store.Records[id]));

        WorldEditReceipt moved = coordinator.Move(id, ValidDecision(-125, -25));
        Assert.Equal(new PlacementVector3(-125, 0.4, -25), moved.Current!.Position);
        Assert.Equal(-25, economy.GetBuilding(id)!.Position!.Z);

        WorldEditReceipt rotated = coordinator.Rotate(id, ValidDecision(-125, -25), Math.PI / 2);
        Assert.Equal(Math.PI / 2, rotated.Current!.RotationY);
        Assert.Equal(new PlacementFootprint(30, 30), rotated.Current.Footprint);

        WorldEditReceipt demolished = coordinator.Demolish(id);
        Assert.Equal(12_500, demolished.TreasuryDelta);
        Assert.Equal(637_500, economy.Treasury);
        Assert.Null(economy.GetBuilding(id));
        Assert.Empty(coordinator.Records);
        Assert.All(new[] { visual, collider, road, occupancy, zoning, service, persistence },
            store => Assert.Empty(store.Records));
    }

    [Fact]
    public void MoveFailureRestoresTheExactPreviousRecordEverywhere()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger economy = CreateEconomy(content);
        var rejectNewPersistence = false;
        List<IWorldEditParticipant> participants = WorldEditParticipantIds.RequiredOrder.Select(id =>
            id == WorldEditParticipantIds.Economy
                ? (IWorldEditParticipant)new EconomyWorldEditParticipant(economy)
                : new MemoryWorldEditParticipant(
                    id,
                    (operation, record) => !(rejectNewPersistence
                        && id == WorldEditParticipantIds.Persistence
                        && operation == "ATTACH"
                        && record.Position.Z == -25)))
            .ToList();
        var coordinator = new WorldEditCoordinator(content, economy, participants);
        WorldEditRecord original = coordinator.Place("ROAD_STRAIGHT", ValidDecision(-125, -75)).Current!;
        rejectNewPersistence = true;

        Assert.Throws<WorldEditTransactionException>(() =>
            coordinator.Move(original.Id, ValidDecision(-125, -25)));

        Assert.Equal(original, coordinator.Get(original.Id));
        Assert.Equal(original.EconomyRecord, economy.GetBuilding(original.Id));
        foreach (MemoryWorldEditParticipant store in participants.OfType<MemoryWorldEditParticipant>())
        {
            Assert.Equal(original, store.Records[original.Id]);
        }
    }

    [Fact]
    public void BrowserCompatibleWorldStateRestoresParticipantsAndReseedsStableIds()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger sourceEconomy = CreateEconomy(content);
        WorldEditCoordinator source = Coordinator(content, sourceEconomy, out _);
        WorldEditRecord savedRecord = source.Place("ROAD_STRAIGHT", ValidDecision(-125, -75)).Current!;
        IReadOnlyList<WorldEditBuildingState> savedWorld = source.Serialize();
        EconomyLedgerState savedEconomy = sourceEconomy.Serialize();

        EconomyLedger restoredEconomy = CreateEconomy(content);
        restoredEconomy.Restore(savedEconomy);
        WorldEditCoordinator restored = Coordinator(content, restoredEconomy, out List<MemoryWorldEditParticipant> stores);
        IReadOnlyList<WorldEditRecord> records = restored.Restore(savedWorld);

        Assert.Equal(savedRecord, Assert.Single(records));
        Assert.Equal(savedRecord.EconomyRecord, restoredEconomy.GetBuilding(savedRecord.Id));
        Assert.All(stores, store => Assert.Equal(savedRecord, store.Records[savedRecord.Id]));
        WorldEditRecord next = restored.Place("ROAD_STRAIGHT", ValidDecision(-125, -25)).Current!;
        Assert.Equal("USER_BUILDING_2", next.Id);
    }

    [Fact]
    public void RestoreFailureCompensatesRuntimeParticipantsWithoutRemovingStaticEconomy()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger sourceEconomy = CreateEconomy(content);
        WorldEditCoordinator source = Coordinator(content, sourceEconomy, out _);
        WorldEditRecord savedRecord = source.Place("ROAD_STRAIGHT", ValidDecision(-125, -75)).Current!;
        IReadOnlyList<WorldEditBuildingState> savedWorld = source.Serialize();

        EconomyLedger restoredEconomy = CreateEconomy(content);
        restoredEconomy.Restore(sourceEconomy.Serialize());
        var stores = new List<MemoryWorldEditParticipant>();
        IWorldEditParticipant[] participants = WorldEditParticipantIds.RequiredOrder.Select(id =>
        {
            if (id == WorldEditParticipantIds.Economy) return (IWorldEditParticipant)new EconomyWorldEditParticipant(restoredEconomy);
            var store = new MemoryWorldEditParticipant(
                id,
                (operation, _) => !(id == WorldEditParticipantIds.Service && operation == "ATTACH"));
            stores.Add(store);
            return store;
        }).ToArray();
        var restored = new WorldEditCoordinator(content, restoredEconomy, participants);

        Assert.Throws<WorldEditTransactionException>(() => restored.Restore(savedWorld));
        Assert.Empty(restored.Records);
        Assert.All(stores, store => Assert.Empty(store.Records));
        Assert.Equal(savedRecord.EconomyRecord, restoredEconomy.GetBuilding(savedRecord.Id));
    }

    private static WorldEditCoordinator Coordinator(
        GameContentRegistry content,
        EconomyLedger economy,
        out List<MemoryWorldEditParticipant> stores)
    {
        stores = [];
        var participants = new List<IWorldEditParticipant>();
        foreach (string id in WorldEditParticipantIds.RequiredOrder)
        {
            if (id == WorldEditParticipantIds.Economy)
            {
                participants.Add(new EconomyWorldEditParticipant(economy));
            }
            else
            {
                var store = new MemoryWorldEditParticipant(id);
                stores.Add(store);
                participants.Add(store);
            }
        }
        return new WorldEditCoordinator(content, economy, participants);
    }

    private static EconomyLedger CreateEconomy(GameContentRegistry content) => new(
        content.EconomyBalance,
        content.EconomyBalance.StartingTreasury,
        content.EconomyBalance.BaseRevenuePerSecond,
        population: 1_200,
        happiness: 70,
        landValue: 100,
        services: new EconomyBaseServices());

    private static PlacementDecision ValidDecision(double x, double z) => new(
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

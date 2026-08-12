using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionRuntimeStateTests
{
    [Fact]
    public void ActiveStateRequiresMatchingExecutionAndNoResultReceipt()
    {
        Harness harness = CreateActive();
        var state = new MissionRuntimeState
        {
            Lifecycle = harness.Lifecycle.Snapshot(),
            Execution = harness.Execution.Snapshot,
            ResultTransactionId = null,
        };

        Assert.True(MissionRuntimeState.Validate(state, harness.Registry));
        Assert.Throws<InvalidDataException>(() => MissionRuntimeState.Validate(
            state with { Execution = state.Execution! with { VehicleType = "SEDAN" } },
            harness.Registry));
        Assert.Throws<InvalidDataException>(() => MissionRuntimeState.Validate(
            state with { ResultTransactionId = "early" },
            harness.Registry));
    }

    [Fact]
    public void ResultStateRequiresOneMatchingCommittedReceipt()
    {
        Harness harness = CreateActive();
        _ = harness.Execution.Advance(1, new MissionVehicleSnapshot("taxi-save", "TAXI", 100, -80, 0));
        harness.Lifecycle.BeginCleanup();
        MissionOutcomeTransaction transaction = harness.Lifecycle.CreateOutcomeTransaction();
        MissionOutcomeReceipt receipt = new MissionOutcomeService().Apply(transaction);
        harness.Lifecycle.CommitCleanup(receipt);
        var state = new MissionRuntimeState
        {
            Lifecycle = harness.Lifecycle.Snapshot(),
            Execution = harness.Execution.Snapshot,
            ResultTransactionId = receipt.TransactionId,
        };

        Assert.True(MissionRuntimeState.Validate(state, harness.Registry));
        Assert.Throws<InvalidDataException>(() => MissionRuntimeState.Validate(
            state with { ResultTransactionId = "different" },
            harness.Registry));
    }

    [Fact]
    public void SaveBlockingLifecyclePhasesCannotMasqueradeAsRuntimeState()
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        var lifecycle = new MissionLifecycleController(registry.Definitions);
        lifecycle.Prepare("mission_executive");
        var state = new MissionRuntimeState
        {
            Lifecycle = lifecycle.Snapshot(),
            Execution = null,
            ResultTransactionId = null,
        };

        Assert.Throws<InvalidDataException>(() => MissionRuntimeState.Validate(state, registry));
    }

    private static Harness CreateActive()
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        var lifecycle = new MissionLifecycleController(registry.Definitions);
        var execution = new MissionExecutionModel(registry, lifecycle, rewardScale: 100);
        var taxi = new MissionVehicleSnapshot("taxi-save", "TAXI", 0, 30, 0);
        execution.BeginBriefing("mission_executive", taxi);
        _ = execution.Accept(taxi);
        return new Harness(registry, lifecycle, execution);
    }

    private sealed record Harness(
        MissionRegistry Registry,
        MissionLifecycleController Lifecycle,
        MissionExecutionModel Execution);
}

using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Core;
using Xunit;

namespace MetroPulse.Domain.Tests.Core;

public sealed class SimulationSchedulerTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void SchedulerExactlyMatchesPhaseZeroFixture()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("simulation-scheduler.json"));
        JsonElement data = fixture.RootElement.GetProperty("data");
        var taskOrder = new List<TaskCall>();
        var scheduler = new SimulationScheduler(
            fixedPhysicsStep: 0.1,
            cityStep: 1,
            maxFrameDelta: 1,
            maxPhysicsStepsPerFrame: 10,
            maxCityTicksPerFrame: 10,
            getCityTimeScale: _ => 5,
            initialClockPolicy: ClockPolicy.City);
        for (int index = 0; index < SimulationScheduleCatalog.StageOrder.Count; index++)
        {
            SimulationStage stage = SimulationScheduleCatalog.StageOrder[index];
            scheduler.RegisterTask(
                $"baseline:{stage.ToToken()}",
                stage,
                (delta, frame) => taskOrder.Add(new TaskCall(frame.Frame, stage.ToToken(), delta)),
                index * 10);
        }

        double[] deltas = [0.06, 0.07, 0.87, 0.25];
        var frames = deltas.Select(delta => new FixtureFrame(delta, scheduler.AdvanceFrame(delta))).ToArray();
        var policySnapshots = new Dictionary<string, SimulationSchedulerSnapshot>(StringComparer.Ordinal);
        foreach (ClockPolicy policy in Enum.GetValues<ClockPolicy>())
        {
            var subject = new SimulationScheduler(
                fixedPhysicsStep: 0.1,
                cityStep: 1,
                maxFrameDelta: 1,
                getCityTimeScale: _ => 15,
                initialClockPolicy: policy);
            policySnapshots.Add(policy.ToToken(), subject.AdvanceFrame(0.25));
        }

        AssertJsonEqual(data.GetProperty("frames"), frames);
        AssertJsonEqual(data.GetProperty("taskOrder"), taskOrder);
        AssertJsonEqual(data.GetProperty("policySnapshots"), policySnapshots);
        Assert.Equal(
            data.GetProperty("stageOrder").EnumerateArray().Select(value => value.GetString()),
            SimulationScheduleCatalog.StageOrder.Select(stage => stage.ToToken()));
        Assert.Equal(
            data.GetProperty("clocks").EnumerateObject().Select(entry => entry.Value.GetString()).Order(),
            SimulationScheduleCatalog.Clocks.Order());
    }

    [Fact]
    public void InputPolicyChangesGateTheSameFrame()
    {
        var pausing = new SimulationScheduler(
            fixedPhysicsStep: 0.1,
            cityStep: 1,
            maxFrameDelta: 1,
            initialClockPolicy: ClockPolicy.City);
        int gameplayUpdates = 0;
        pausing.RegisterTask("pause", SimulationStage.Input, (_, _) => pausing.SetClockPolicy(ClockPolicy.Paused));
        pausing.RegisterTask("gameplay", SimulationStage.Gameplay, (_, _) => gameplayUpdates++);

        SimulationSchedulerSnapshot paused = pausing.AdvanceFrame(0.25);
        Assert.Equal(0, gameplayUpdates);
        Assert.Equal(0, paused.Clocks[SimulationScheduleCatalog.GameplayClock].Elapsed);
        Assert.Equal(0.25, paused.Clocks[SimulationScheduleCatalog.PausedClock].Elapsed);

        var resuming = new SimulationScheduler(
            fixedPhysicsStep: 0.1,
            cityStep: 1,
            maxFrameDelta: 1,
            initialClockPolicy: ClockPolicy.Paused);
        resuming.RegisterTask("resume", SimulationStage.Input, (_, _) => resuming.SetClockPolicy(ClockPolicy.Street));
        SimulationSchedulerSnapshot resumed = resuming.AdvanceFrame(0.25);
        Assert.Equal(0.25, resumed.Clocks[SimulationScheduleCatalog.GameplayClock].Elapsed);
        Assert.Equal(0, resumed.Clocks[SimulationScheduleCatalog.PausedClock].Elapsed);
    }

    [Fact]
    public void RegistrationIsStableUniquePredicateGatedAndRemovable()
    {
        var scheduler = new SimulationScheduler(initialClockPolicy: ClockPolicy.Result);
        var calls = new List<string>();
        scheduler.RegisterTask("later", SimulationStage.Presentation, (_, _) => calls.Add("later"), order: 10);
        Func<bool> remove = scheduler.RegisterTask(
            "first",
            SimulationStage.Presentation,
            (_, _) => calls.Add("first"),
            order: -1,
            enabled: context => context.Frame > 1);

        Assert.Throws<InvalidOperationException>(() =>
            scheduler.RegisterTask("first", SimulationStage.Render, (_, _) => { }));
        scheduler.AdvanceFrame(0.1);
        scheduler.AdvanceFrame(0.1);
        Assert.Equal(["later", "first", "later"], calls);
        Assert.True(remove());
        Assert.False(remove());
    }

    [Fact]
    public void ConstructorAndClockPolicyRejectInvalidInputs()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new SimulationScheduler(fixedPhysicsStep: 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new SimulationScheduler(maxPhysicsStepsPerFrame: 0));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new SimulationScheduler().SetClockPolicy((ClockPolicy)999));

        var scheduler = new SimulationScheduler();
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            scheduler.RegisterTask("safe-after-failure", (SimulationStage)999, (_, _) => { }));
        scheduler.RegisterTask("safe-after-failure", SimulationStage.Input, (_, _) => { });
    }

    private static void AssertJsonEqual(JsonElement expected, object actual)
    {
        JsonNode expectedNode = JsonNode.Parse(expected.GetRawText())!;
        JsonNode actualNode = JsonSerializer.SerializeToNode(actual, JsonOptions)!;
        Assert.True(JsonNode.DeepEquals(expectedNode, actualNode),
            $"Expected {expectedNode.ToJsonString()} but received {actualNode.ToJsonString()}.");
    }

    private sealed record FixtureFrame(
        [property: System.Text.Json.Serialization.JsonPropertyName("delta")] double Delta,
        [property: System.Text.Json.Serialization.JsonPropertyName("snapshot")] SimulationSchedulerSnapshot Snapshot);

    private sealed record TaskCall(
        [property: System.Text.Json.Serialization.JsonPropertyName("frame")] long Frame,
        [property: System.Text.Json.Serialization.JsonPropertyName("stage")] string Stage,
        [property: System.Text.Json.Serialization.JsonPropertyName("delta")] double Delta);
}

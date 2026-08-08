using System.Text.Json;
using MetroPulse.Domain.Core;
using Xunit;

namespace MetroPulse.Domain.Tests.Core;

public sealed class GameStateCatalogTests
{
    [Fact]
    public void CatalogExactlyMatchesPhaseZeroFixture()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("game-state.json"));
        JsonElement data = fixture.RootElement.GetProperty("data");
        string[] expectedStates = data.GetProperty("states").EnumerateArray().Select(value => value.GetString()!).ToArray();

        Assert.Equal(expectedStates, Enum.GetValues<GameState>().Select(state => state.ToToken()));
        foreach (GameState state in Enum.GetValues<GameState>())
        {
            JsonElement policy = data.GetProperty("policies").GetProperty(state.ToToken());
            GameStatePolicy actual = GameStateCatalog.Policies[state];
            Assert.Equal(policy.GetProperty("mission").GetString(), actual.Mission.ToToken());
            Assert.Equal(policy.GetProperty("heat").GetString(), actual.Heat.ToToken());
            Assert.Equal(policy.GetProperty("control").GetString(), actual.Control.ToToken());
            Assert.Equal(policy.GetProperty("camera").GetString(), actual.Camera.ToToken());
            Assert.Equal(policy.GetProperty("clock").GetString(), actual.Clock.ToToken());

            string[] expectedTransitions = data.GetProperty("requestedTransitions")
                .GetProperty(state.ToToken())
                .EnumerateArray()
                .Select(value => value.GetString()!)
                .ToArray();
            Assert.Equal(expectedTransitions, GameStateCatalog.Transitions[state].Select(destination => destination.ToToken()));
        }
    }

    [Fact]
    public void RequestEvaluationExactlyMatchesPhaseZeroMatrix()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("game-state.json"));
        JsonElement matrix = fixture.RootElement.GetProperty("data").GetProperty("transitionMatrix");
        foreach (JsonElement expected in matrix.EnumerateArray())
        {
            GameState source = ParseState(expected.GetProperty("from").GetString()!);
            GameState destination = ParseState(expected.GetProperty("to").GetString()!);
            JsonElement expectedEvaluation = expected.GetProperty("evaluation");

            TransitionEvaluation actual = GameTransitionPolicy.EvaluateRequest(source, destination);
            Assert.Equal(expectedEvaluation.GetProperty("allowed").GetBoolean(), actual.Allowed);
            Assert.Equal(GetNullableString(expectedEvaluation.GetProperty("code")), actual.Code);
            string? expectedReason = expectedEvaluation.TryGetProperty("reason", out JsonElement reason)
                ? GetNullableString(reason)
                : null;
            Assert.Equal(expectedReason, actual.Reason);

            if (actual.Allowed)
            {
                AssertEffects(expected.GetProperty("effects"), GameStateCatalog.GetTransitionEffects(source, destination));
            }
        }
    }

    [Fact]
    public void DestinationContractsRejectInvalidOwnership()
    {
        TransitionEvaluation foot = GameTransitionPolicy.ValidateDestination(
            GameState.StreetOnFoot,
            new TransitionContext(ControlledEntityCount: 1, ControlledEntityKind: ControlKind.Vehicle));
        Assert.Equal(TransitionRejectionCodes.ControlledEntityRequired, foot.Code);

        TransitionEvaluation multiple = GameTransitionPolicy.ValidateDestination(
            GameState.StreetVehicle,
            new TransitionContext(ControlledEntityCount: 2, ControlledEntityKind: ControlKind.Multiple));
        Assert.Equal(TransitionRejectionCodes.MultipleControlledEntities, multiple.Code);

        TransitionEvaluation valid = GameTransitionPolicy.ValidateDestination(
            GameState.StreetVehicle,
            new TransitionContext(ControlledEntityCount: 1, ControlledEntityKind: ControlKind.Aircraft));
        Assert.True(valid.Allowed);

        Assert.True(GameTransitionPolicy.EvaluateRequest(
            GameState.Paused,
            GameState.Management,
            resumeState: GameState.Management).Allowed);
        Assert.Equal(
            TransitionRejectionCodes.InvalidResumeTarget,
            GameTransitionPolicy.EvaluateRequest(
                GameState.Paused,
                GameState.Builder,
                resumeState: GameState.Management).Code);
    }

    [Fact]
    public void SerializedGameStatesPreserveUppercaseTokensExactly()
    {
        foreach (GameState state in Enum.GetValues<GameState>())
        {
            string json = JsonSerializer.Serialize(state);
            Assert.Equal($"\"{state.ToToken()}\"", json);
            Assert.Equal(state, JsonSerializer.Deserialize<GameState>(json));
        }

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<GameState>("\"STREET\""));
    }

    private static GameState ParseState(string token) =>
        Enum.GetValues<GameState>().Single(state => state.ToToken() == token);

    private static string? GetNullableString(JsonElement value) =>
        value.ValueKind == JsonValueKind.Null ? null : value.GetString();

    private static void AssertEffects(JsonElement expected, TransitionEffects actual)
    {
        Assert.Equal(expected.GetProperty("mission").GetProperty("from").GetString(), actual.Mission.From.ToToken());
        Assert.Equal(expected.GetProperty("mission").GetProperty("to").GetString(), actual.Mission.To.ToToken());
        Assert.Equal(expected.GetProperty("heat").GetProperty("from").GetString(), actual.Heat.From.ToToken());
        Assert.Equal(expected.GetProperty("heat").GetProperty("to").GetString(), actual.Heat.To.ToToken());
        Assert.Equal(expected.GetProperty("controlledEntity").GetProperty("from").GetString(), actual.ControlledEntity.From.ToToken());
        Assert.Equal(expected.GetProperty("controlledEntity").GetProperty("to").GetString(), actual.ControlledEntity.To.ToToken());
        Assert.Equal(expected.GetProperty("camera").GetProperty("from").GetString(), actual.Camera.From.ToToken());
        Assert.Equal(expected.GetProperty("camera").GetProperty("to").GetString(), actual.Camera.To.ToToken());
        Assert.Equal(expected.GetProperty("simulationClock").GetProperty("from").GetString(), actual.SimulationClock.From.ToToken());
        Assert.Equal(expected.GetProperty("simulationClock").GetProperty("to").GetString(), actual.SimulationClock.To.ToToken());
    }
}

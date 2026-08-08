using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Core;

[JsonConverter(typeof(GameStateJsonConverter))]
public enum GameState
{
    Boot,
    Load,
    Management,
    Builder,
    Transition,
    StreetOnFoot,
    StreetVehicle,
    Result,
    Paused,
    Menu,
}

public enum MissionPolicy
{
    RequireNone,
    RequireResolved,
    Preserve,
    PreserveUntilResultCommit,
    Suspend,
}

public enum HeatPolicy
{
    PreserveFrozen,
    PreserveRunning,
}

public enum ControlPolicy
{
    RequireNone,
    Handoff,
    RequirePedestrian,
    RequireVehicle,
    Preserve,
    Suspend,
}

public enum CameraPolicy
{
    None,
    Loading,
    Management,
    Builder,
    Handoff,
    StreetOnFoot,
    StreetVehicle,
    Result,
    Preserve,
    Menu,
}

public enum ClockPolicy
{
    Stopped,
    City,
    Builder,
    Handoff,
    Street,
    Result,
    Paused,
    Menu,
}

public enum ControlKind
{
    None,
    Pedestrian,
    Vehicle,
    Aircraft,
    Multiple,
}

public static class StableTokens
{
    public static string ToToken(this GameState value) => value switch
    {
        GameState.StreetOnFoot => "STREET_ON_FOOT",
        GameState.StreetVehicle => "STREET_VEHICLE",
        _ => value.ToString().ToUpperInvariant(),
    };

    public static string ToToken(this MissionPolicy value) => value switch
    {
        MissionPolicy.RequireNone => "REQUIRE_NONE",
        MissionPolicy.RequireResolved => "REQUIRE_RESOLVED",
        MissionPolicy.PreserveUntilResultCommit => "PRESERVE_UNTIL_RESULT_COMMIT",
        _ => value.ToString().ToUpperInvariant(),
    };

    public static string ToToken(this HeatPolicy value) => value switch
    {
        HeatPolicy.PreserveFrozen => "PRESERVE_FROZEN",
        HeatPolicy.PreserveRunning => "PRESERVE_RUNNING",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string ToToken(this ControlPolicy value) => value switch
    {
        ControlPolicy.RequireNone => "REQUIRE_NONE",
        ControlPolicy.RequirePedestrian => "REQUIRE_PEDESTRIAN",
        ControlPolicy.RequireVehicle => "REQUIRE_VEHICLE",
        _ => value.ToString().ToUpperInvariant(),
    };

    public static string ToToken(this CameraPolicy value) => value switch
    {
        CameraPolicy.StreetOnFoot => "STREET_ON_FOOT",
        CameraPolicy.StreetVehicle => "STREET_VEHICLE",
        _ => value.ToString().ToUpperInvariant(),
    };

    public static string ToToken(this ClockPolicy value) => value.ToString().ToUpperInvariant();

    public static string ToToken(this ControlKind value) => value.ToString().ToUpperInvariant();

    public static bool TryParseGameState(string? token, out GameState state)
    {
        foreach (GameState candidate in Enum.GetValues<GameState>())
        {
            if (string.Equals(candidate.ToToken(), token, StringComparison.Ordinal))
            {
                state = candidate;
                return true;
            }
        }

        state = default;
        return false;
    }
}

public sealed class GameStateJsonConverter : JsonConverter<GameState>
{
    public override GameState Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        string? token = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
        if (!StableTokens.TryParseGameState(token, out GameState state))
        {
            throw new JsonException($"Unknown game-state token: {token ?? reader.TokenType.ToString()}");
        }

        return state;
    }

    public override void Write(Utf8JsonWriter writer, GameState value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToToken());
}

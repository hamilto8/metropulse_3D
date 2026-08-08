using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Missions;

public sealed record MissionDefinition
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("title")]
    public string? Title { get; init; }

    [JsonPropertyName("missionType")]
    public string? MissionType { get; init; }

    [JsonPropertyName("objectiveType")]
    public string? ObjectiveType { get; init; }

    [JsonPropertyName("chronologyChapter")]
    public double? ChronologyChapter { get; init; }

    [JsonPropertyName("vehicleType")]
    public string? VehicleType { get; init; }

    [JsonPropertyName("prerequisites")]
    public IReadOnlyList<MissionPrerequisite>? Prerequisites { get; init; }

    [JsonPropertyName("weatherPolicy")]
    public string? WeatherPolicy { get; init; }

    [JsonPropertyName("passengerName")]
    public string? PassengerName { get; init; }

    [JsonPropertyName("passengerRole")]
    public string? PassengerRole { get; init; }

    [JsonPropertyName("avatar")]
    public string? Avatar { get; init; }

    [JsonPropertyName("pickup")]
    public MissionLocation? Pickup { get; init; }

    [JsonPropertyName("dropoff")]
    public MissionLocation? Dropoff { get; init; }

    [JsonPropertyName("checkpoints")]
    public IReadOnlyList<MissionLocation>? Checkpoints { get; init; }

    [JsonPropertyName("rivals")]
    public IReadOnlyList<MissionRival>? Rivals { get; init; }

    [JsonPropertyName("sabotageAction")]
    public string? SabotageAction { get; init; }

    [JsonPropertyName("sabotageDuration")]
    public double? SabotageDuration { get; init; }

    [JsonPropertyName("baseReward")]
    public double BaseReward { get; init; } = double.NaN;

    [JsonPropertyName("rewardScale")]
    public double? RewardScale { get; init; }

    [JsonPropertyName("timeLimit")]
    public double TimeLimit { get; init; } = double.NaN;

    [JsonPropertyName("requiresMayhem")]
    public bool? RequiresMayhem { get; init; }

    [JsonPropertyName("retryPolicy")]
    public MissionRetryPolicy? RetryPolicy { get; init; }

    [JsonPropertyName("dialogueTree")]
    public IReadOnlyDictionary<string, DialogueNode>? DialogueTree { get; init; }
}

public sealed record MissionLocation
{
    [JsonPropertyName("x")]
    public double X { get; init; } = double.NaN;

    [JsonPropertyName("z")]
    public double Z { get; init; } = double.NaN;

    [JsonPropertyName("district")]
    public string? District { get; init; }

    [JsonPropertyName("districtId")]
    public string? DistrictId { get; init; }
}

public sealed record MissionRival
{
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("finishTime")]
    public double FinishTime { get; init; } = double.NaN;
}

public sealed record DialogueNode
{
    [JsonPropertyName("text")]
    public string? Text { get; init; }

    [JsonPropertyName("action")]
    public string? Action { get; init; }

    [JsonPropertyName("rushBonus")]
    public double? RushBonus { get; init; }

    [JsonPropertyName("timeLimitOverride")]
    public double? TimeLimitOverride { get; init; }

    [JsonPropertyName("choices")]
    public IReadOnlyList<DialogueChoice>? Choices { get; init; }
}

public sealed record DialogueChoice
{
    [JsonPropertyName("label")]
    public string? Label { get; init; }

    [JsonPropertyName("next")]
    public string? Next { get; init; }
}

[JsonConverter(typeof(MissionPrerequisiteConverter))]
public sealed record MissionPrerequisite
{
    [JsonPropertyName("type")]
    public string? Type { get; init; }

    [JsonPropertyName("missionId")]
    public string? MissionId { get; init; }

    [JsonPropertyName("status")]
    public string? Status { get; init; }

    [JsonPropertyName("requirement")]
    public JsonElement? Requirement { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }
}

public sealed class MissionPrerequisiteConverter : JsonConverter<MissionPrerequisite>
{
    public override MissionPrerequisite? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            return new MissionPrerequisite
            {
                Type = "MISSION_COMPLETED",
                MissionId = reader.GetString(),
            };
        }

        using JsonDocument document = JsonDocument.ParseValue(ref reader);
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("Mission prerequisites must be a stable mission ID or an object.");
        }

        return new MissionPrerequisite
        {
            Type = GetString(root, "type"),
            MissionId = GetString(root, "missionId"),
            Status = GetString(root, "status"),
            Requirement = root.TryGetProperty("requirement", out JsonElement requirement) ? requirement.Clone() : null,
            Reason = GetString(root, "reason"),
        };
    }

    public override void Write(Utf8JsonWriter writer, MissionPrerequisite value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteString("type", value.Type);
        if (value.MissionId is not null)
        {
            writer.WriteString("missionId", value.MissionId);
        }

        if (value.Status is not null)
        {
            writer.WriteString("status", value.Status);
        }

        if (value.Requirement.HasValue)
        {
            writer.WritePropertyName("requirement");
            value.Requirement.Value.WriteTo(writer);
        }

        if (value.Reason is not null)
        {
            writer.WriteString("reason", value.Reason);
        }

        writer.WriteEndObject();
    }

    private static string? GetString(JsonElement root, string propertyName) =>
        root.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

public sealed record MissionRetryPolicy
{
    [JsonPropertyName("strategy")]
    public string? Strategy { get; init; }

    [JsonPropertyName("maxAttempts")]
    public double MaxAttempts { get; init; } = double.NaN;
}

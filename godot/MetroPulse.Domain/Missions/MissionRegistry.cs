using System.Collections.Frozen;
using System.Reflection;
using System.Text.Json;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Missions;

public sealed class MissionRegistry
{
    private const string ProductionResourceName = "MetroPulse.Domain.Content.missions.json";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow,
    };

    private readonly FrozenDictionary<string, MissionDefinition> missions;

    private MissionRegistry(IReadOnlyList<MissionDefinition> definitions)
    {
        Definitions = Array.AsReadOnly(definitions.Select(Freeze).ToArray());
        missions = Definitions.ToFrozenDictionary(mission => mission.Id!, StringComparer.Ordinal);
    }

    public IReadOnlyList<MissionDefinition> Definitions { get; }

    public int Count => Definitions.Count;

    public MissionDefinition? Get(string id) => missions.GetValueOrDefault(id);

    public IReadOnlyList<MissionDefinition> GetMvpMissions(bool temporaryMayhemEnabled = false)
    {
        var scoped = new List<MissionDefinition>(ContentDefinitions.MvpMissionIds.Count);
        foreach (string missionId in ContentDefinitions.MvpMissionIds)
        {
            MissionDefinition mission = missions[missionId];
            if (mission.RequiresMayhem == true && !temporaryMayhemEnabled)
            {
                continue;
            }

            scoped.Add(mission);
        }

        return scoped.AsReadOnly();
    }

    public static MissionRegistry Load(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        IReadOnlyList<MissionDefinition>? definitions;
        try
        {
            definitions = JsonSerializer.Deserialize<IReadOnlyList<MissionDefinition>>(json, JsonOptions);
        }
        catch (JsonException error)
        {
            string field = string.IsNullOrWhiteSpace(error.Path) ? "<json>" : error.Path;
            throw new ContentValidationException(
                $"contains malformed JSON ({error.Message}).",
                "missions",
                field: field,
                code: "MALFORMED_JSON");
        }

        MissionValidator.Validate(definitions);
        ContentCatalogValidator.ValidateScope(definitions!);
        return new MissionRegistry(definitions!);
    }

    public static MissionRegistry LoadProduction()
    {
        Assembly assembly = typeof(MissionRegistry).Assembly;
        using Stream stream = assembly.GetManifestResourceStream(ProductionResourceName)
            ?? throw new InvalidOperationException($"Missing embedded mission content: {ProductionResourceName}");
        using var reader = new StreamReader(stream);
        return Load(reader.ReadToEnd());
    }

    private static MissionDefinition Freeze(MissionDefinition mission) => mission with
    {
        Prerequisites = Array.AsReadOnly((mission.Prerequisites ?? Array.Empty<MissionPrerequisite>()).ToArray()),
        Checkpoints = mission.Checkpoints is null ? null : Array.AsReadOnly(mission.Checkpoints.ToArray()),
        Rivals = mission.Rivals is null ? null : Array.AsReadOnly(mission.Rivals.ToArray()),
        DialogueTree = (mission.DialogueTree ?? new Dictionary<string, DialogueNode>())
            .ToFrozenDictionary(
                entry => entry.Key,
                entry => entry.Value with
                {
                    Choices = entry.Value.Choices is null
                        ? null
                        : Array.AsReadOnly(entry.Value.Choices.ToArray()),
                },
                StringComparer.Ordinal),
    };
}

namespace MetroPulse.Domain.Content;

using MetroPulse.Domain.Missions;

public static class ContentCatalogValidator
{
    private static readonly IReadOnlySet<string> ReleaseScopes =
        new HashSet<string>(["MVP", "POST_MVP", "COMPATIBILITY"], StringComparer.Ordinal);

    private static readonly IReadOnlySet<string> ZoneKinds =
        new HashSet<string>(["DEVELOPMENT", "SERVICE", "AUTHORED_WORLD"], StringComparer.Ordinal);

    public static void ValidateStaticDefinitions()
    {
        WorldBounds world = ContentDefinitions.WorldBounds;
        if (!double.IsFinite(world.MinX) || !double.IsFinite(world.MaxX)
            || !double.IsFinite(world.MinY) || !double.IsFinite(world.MaxY)
            || !double.IsFinite(world.MinZ) || !double.IsFinite(world.MaxZ)
            || world.MinX >= world.MaxX || world.MinY >= world.MaxY || world.MinZ >= world.MaxZ)
        {
            throw Error("must contain finite ordered axes.", null, null, source: "world-bounds");
        }

        var districtIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (DistrictDefinition district in ContentDefinitions.Districts)
        {
            ValidateUniqueId(district.Id, districtIds, "districts");
            ValidateLabel(district.Label, "districts", district.Id);
            ValidateEnum(district.ReleaseScope, ReleaseScopes, "districts", district.Id, "releaseScope");
            if (district.Bounds.MinX >= district.Bounds.MaxX || district.Bounds.MinZ >= district.Bounds.MaxZ
                || !world.Contains(district.Bounds.MinX, district.Bounds.MinZ)
                || !world.Contains(district.Bounds.MaxX, district.Bounds.MaxZ))
            {
                throw Error("must define ordered coordinates inside world bounds.", district.Id, "bounds", source: "districts");
            }
        }

        var zoneIds = new HashSet<string>(StringComparer.Ordinal);
        var zoneInputs = new HashSet<string>(StringComparer.Ordinal);
        foreach (ZoneDefinition zone in ContentDefinitions.Zones)
        {
            ValidateUniqueId(zone.Id, zoneIds, "zones");
            ValidateLabel(zone.Label, "zones", zone.Id);
            ValidateEnum(zone.Kind, ZoneKinds, "zones", zone.Id, "kind");
            ValidateEnum(zone.ReleaseScope, ReleaseScopes, "zones", zone.Id, "releaseScope");
            if (zone.Color is < 0 or > 0xffffff || !double.IsFinite(zone.Happiness) || !double.IsFinite(zone.LandValue))
            {
                throw Error("contains an invalid color or simulation scalar.", zone.Id, "color", source: "zones");
            }
            if (!zoneInputs.Add(zone.Id))
            {
                throw Error($"duplicates zone ID or alias {zone.Id}.", zone.Id, "id", "DUPLICATE_ID", "zones");
            }
            for (int index = 0; index < zone.Aliases.Count; index++)
            {
                string alias = zone.Aliases[index];
                if (!StableId.IsValid(alias) || !zoneInputs.Add(alias) || ContentDefinitions.Zones.Any(candidate => candidate.Id == alias))
                {
                    throw Error($"duplicates or invalidates zone ID or alias {alias}.", zone.Id, $"aliases[{index}]", "DUPLICATE_ID", "zones");
                }
            }
        }

        var factionIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (FactionDefinition faction in ContentDefinitions.Factions)
        {
            ValidateUniqueId(faction.Id, factionIds, "factions");
            ValidateLabel(faction.Label, "factions", faction.Id);
            if (!double.IsFinite(faction.MinReputation) || !double.IsFinite(faction.MaxReputation)
                || faction.MinReputation >= faction.MaxReputation)
            {
                throw Error("minReputation must be finite and below maxReputation.", faction.Id, "minReputation", source: "factions");
            }
        }

        ValidateProgression(ContentDefinitions.Progression);

        var vehicleIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (string vehicleId in ContentDefinitions.VehicleIds)
        {
            ValidateUniqueId(vehicleId, vehicleIds, "vehicle-content");
        }
    }

    public static void ValidateScope(IReadOnlyList<MissionDefinition> missions)
    {
        if (ContentDefinitions.MvpMissionIds.Count is < 8 or > 12)
        {
            throw Error("must contain between 8 and 12 authored mission IDs.", "scope", "missionIds");
        }

        if (ContentDefinitions.MvpActivityTemplates.Count is < 5 or > 7)
        {
            throw Error("must contain between 5 and 7 activity templates.", "scope", "activityTemplates");
        }

        var missionIds = missions.Select(mission => mission.Id!).ToHashSet(StringComparer.Ordinal);
        EnsureReferences(ContentDefinitions.MvpMissionIds, missionIds, "scope", "missionIds", "missions");
        EnsureReferences(ContentDefinitions.MvpWorldFootprint, ContentDefinitions.DistrictIds, "scope", "worldFootprint", "districts");
        EnsureReferences(ContentDefinitions.MvpActivityTemplates, MissionValidator.SupportedObjectives, "scope", "activityTemplates", "mission objectives");

        var zones = ContentDefinitions.Zones.ToDictionary(zone => zone.Id, StringComparer.Ordinal);
        foreach ((string zoneId, string expectedLabel) in ContentDefinitions.MvpZoneLabels)
        {
            if (!zones.TryGetValue(zoneId, out ZoneDefinition? zone))
            {
                throw Error($"references missing zones record {zoneId}.", "scope", $"zoneLabels.{zoneId}", "MISSING_REFERENCE");
            }

            if (!string.Equals(zone.Label, expectedLabel, StringComparison.Ordinal))
            {
                throw Error($"must match the canonical zone label {zone.Label}.", "scope", $"zoneLabels.{zoneId}");
            }
        }
    }

    public static void ValidateProgression(IReadOnlyList<ProgressionDefinition> progression)
    {
        if (progression.Count == 0)
        {
            throw Error("must be a non-empty array.", null, null, source: "progression");
        }

        var index = new Dictionary<string, ProgressionDefinition>(StringComparer.Ordinal);
        var ranks = new HashSet<int>();
        foreach (ProgressionDefinition record in progression)
        {
            if (!StableId.IsValid(record.Id))
            {
                throw Error("requires a stable non-empty ID.", record.Id, "id", source: "progression");
            }

            if (!index.TryAdd(record.Id, record))
            {
                throw Error($"duplicates stable ID {record.Id}.", record.Id, "id", "DUPLICATE_ID", "progression");
            }

            if (!ranks.Add(record.Rank))
            {
                throw Error($"duplicates progression rank {record.Rank}.", record.Id, "rank", "DUPLICATE_ID", "progression");
            }
        }

        foreach (ProgressionDefinition record in progression)
        {
            EnsureReferences(record.PrerequisiteIds, index.Keys.ToHashSet(StringComparer.Ordinal), record.Id, "prerequisiteIds", "progression", "progression");
        }

        var visited = new HashSet<string>(StringComparer.Ordinal);
        var active = new HashSet<string>(StringComparer.Ordinal);
        var ancestry = new List<string>();
        foreach (string id in index.Keys)
        {
            Visit(id);
        }

        void Visit(string id)
        {
            if (active.Contains(id))
            {
                int start = ancestry.IndexOf(id);
                string cycle = string.Join(" -> ", ancestry.Skip(start).Append(id));
                throw Error($"contains circular prerequisites ({cycle}).", id, "prerequisiteIds", "CIRCULAR_REFERENCE", "progression");
            }

            if (!visited.Add(id))
            {
                return;
            }

            active.Add(id);
            ancestry.Add(id);
            foreach (string prerequisiteId in index[id].PrerequisiteIds)
            {
                Visit(prerequisiteId);
            }

            ancestry.RemoveAt(ancestry.Count - 1);
            active.Remove(id);
        }
    }

    private static void EnsureReferences(
        IEnumerable<string> references,
        IReadOnlySet<string> knownIds,
        object? recordId,
        string field,
        string target,
        string source = "game-data")
    {
        int index = 0;
        foreach (string id in references)
        {
            if (!knownIds.Contains(id))
            {
                throw Error($"references missing {target} record {id}.", recordId, $"{field}[{index}]", "MISSING_REFERENCE", source);
            }

            index++;
        }
    }

    private static void ValidateUniqueId(
        string id,
        ISet<string> ids,
        string source)
    {
        if (!StableId.IsValid(id))
        {
            throw Error("requires a stable non-empty ID.", id, "id", source: source);
        }
        if (!ids.Add(id))
        {
            throw Error($"duplicates stable ID {id}.", id, "id", "DUPLICATE_ID", source);
        }
    }

    private static void ValidateLabel(string label, string source, string id)
    {
        if (string.IsNullOrWhiteSpace(label))
        {
            throw Error("must be a non-empty string.", id, "label", source: source);
        }
    }

    private static void ValidateEnum(
        string value,
        IReadOnlySet<string> allowed,
        string source,
        string id,
        string field)
    {
        if (!allowed.Contains(value))
        {
            throw Error($"uses invalid enum value {value}.", id, field, "INVALID_ENUM", source);
        }
    }

    private static ContentValidationException Error(
        string message,
        object? recordId,
        string? field,
        string code = "INVALID_GAME_DATA",
        string source = "game-data") =>
        new(message, source, recordId, field, code);
}

namespace MetroPulse.Domain.Content;

using MetroPulse.Domain.Missions;

public static class ContentCatalogValidator
{
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

    private static ContentValidationException Error(
        string message,
        object? recordId,
        string? field,
        string code = "INVALID_GAME_DATA",
        string source = "game-data") =>
        new(message, source, recordId, field, code);
}

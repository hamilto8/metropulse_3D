using System.Collections.Frozen;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Missions;

public static class MissionValidator
{
    private static readonly FrozenSet<string> Objectives =
        new[] { "TAXI", "COURIER", "RACE", "DELIVERY", "SABOTAGE", "SURVIVAL" }
            .ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> DialogueActions =
        new[] { "START_MISSION", "DECLINE" }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> WeatherPolicies =
        new[] { "STANDARD_ROAD", "EMERGENCY_RESPONSE", "DRY_COMPETITION", "SIGHTSEEING", "ALL_WEATHER" }
            .ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> PrerequisiteTypes =
        new[] { "MISSION_COMPLETED", "FOLLOW_UP_STATUS", "CITY_CONDITION" }
            .ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> FollowUpStatuses =
        new[] { "LOCKED", "AVAILABLE", "COMPLETED", "FAILED", "EXPIRED" }
            .ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> RetryStrategies =
        new[] { "RESTART", "LAST_CHECKPOINT", "NO_RETRY" }.ToFrozenSet(StringComparer.Ordinal);

    public static IReadOnlySet<string> SupportedObjectives => Objectives;

    public static void Validate(IReadOnlyList<MissionDefinition>? missions)
    {
        if (missions is null || missions.Count == 0)
        {
            throw Error("must be a non-empty array.");
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach ((MissionDefinition mission, int index) in missions.Select((value, index) => (value, index)))
        {
            string missionId = string.IsNullOrWhiteSpace(mission.Id) ? "<missing>" : mission.Id.Trim();
            if (missionId == "<missing>" || !ids.Add(missionId))
            {
                throw Error($"Mission id is missing or duplicated: {missionId}", missionId, "id", "DUPLICATE_ID");
            }

            RequireStableId(missionId, missionId, "id");
            RequireString(mission.Title, missionId, "title");
            RequireString(mission.PassengerName, missionId, "passengerName");
            RequireString(mission.PassengerRole, missionId, "passengerRole");
            string vehicleType = RequireStableId(mission.VehicleType, missionId, "vehicleType");
            RequireEnum(vehicleType, ContentDefinitions.VehicleIdSet, missionId, "vehicleType");
            ValidateLocation(mission.Pickup, missionId, "pickup");

            string objective = !string.IsNullOrWhiteSpace(mission.MissionType)
                ? mission.MissionType
                : !string.IsNullOrWhiteSpace(mission.ObjectiveType)
                    ? mission.ObjectiveType
                    : "DELIVERY";
            if (!Objectives.Contains(objective))
            {
                throw Error($"uses unsupported objective {objective}.", missionId, "missionType", "INVALID_ENUM");
            }

            if (objective != "SURVIVAL" || mission.Dropoff is not null)
            {
                ValidateLocation(mission.Dropoff, missionId, "dropoff");
            }

            if (objective == "RACE")
            {
                if (mission.Checkpoints is null || mission.Checkpoints.Count < 2)
                {
                    throw Error("requires at least two valid checkpoints.", missionId, "checkpoints");
                }

                for (int pointIndex = 0; pointIndex < mission.Checkpoints.Count; pointIndex++)
                {
                    ValidateLocation(mission.Checkpoints[pointIndex], missionId, $"checkpoints[{pointIndex}]");
                }

                if (mission.Rivals is null || mission.Rivals.Count == 0)
                {
                    throw Error("requires an authored rival roster.", missionId, "rivals");
                }

                for (int rivalIndex = 0; rivalIndex < mission.Rivals.Count; rivalIndex++)
                {
                    MissionRival rival = mission.Rivals[rivalIndex];
                    RequireString(rival.Name, missionId, $"rivals[{rivalIndex}].name");
                    RequireFinite(rival.FinishTime, missionId, $"rivals[{rivalIndex}].finishTime", 0.001);
                }
            }

            if (objective == "SABOTAGE"
                && (string.IsNullOrWhiteSpace(mission.SabotageAction) || mission.SabotageDuration is null or <= 0))
            {
                throw Error("requires a valid sabotage action and duration.", missionId, "sabotageAction");
            }

            RequireFinite(mission.TimeLimit, missionId, "timeLimit", 0.001);
            RequireFinite(mission.BaseReward, missionId, "baseReward", 0);
            if (mission.RewardScale.HasValue)
            {
                RequireFinite(mission.RewardScale.Value, missionId, "rewardScale", 0.001);
            }

            if (mission.ChronologyChapter.HasValue)
            {
                RequireFinite(mission.ChronologyChapter.Value, missionId, "chronologyChapter", 0);
            }

            if (mission.Prerequisites is null)
            {
                throw Error("must be an array.", missionId, "prerequisites");
            }

            RequireEnum(mission.WeatherPolicy, WeatherPolicies, missionId, "weatherPolicy");
            ValidateRetryPolicy(mission.RetryPolicy, missionId);
            ValidateDialogueTree(mission.DialogueTree, missionId);
        }

        ValidatePrerequisites(missions, ids);
    }

    private static void ValidateLocation(MissionLocation? location, string missionId, string field)
    {
        if (location is null)
        {
            throw Error("must be an object.", missionId, field);
        }

        RequireFinite(location.X, missionId, $"{field}.x", ContentDefinitions.WorldBounds.MinX, ContentDefinitions.WorldBounds.MaxX);
        RequireFinite(location.Z, missionId, $"{field}.z", ContentDefinitions.WorldBounds.MinZ, ContentDefinitions.WorldBounds.MaxZ);
        RequireString(location.District, missionId, $"{field}.district");
        string districtId = RequireStableId(location.DistrictId, missionId, $"{field}.districtId");
        if (!ContentDefinitions.DistrictIds.Contains(districtId))
        {
            throw Error($"references missing districts record {districtId}.", missionId, $"{field}.districtId", "MISSING_REFERENCE");
        }
    }

    private static void ValidateDialogueTree(IReadOnlyDictionary<string, DialogueNode>? tree, string missionId)
    {
        if (tree is null)
        {
            throw Error("must be an object.", missionId, "dialogueTree");
        }

        if (!tree.ContainsKey("start"))
        {
            throw Error("is missing dialogueTree.start.", missionId, "dialogueTree.start");
        }

        var edges = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach ((string nodeId, DialogueNode node) in tree)
        {
            RequireStableId(nodeId, missionId, $"dialogueTree.{nodeId}");
            RequireString(node.Text, missionId, $"dialogueTree.{nodeId}.text");
            if (node.Action is not null)
            {
                RequireEnum(node.Action, DialogueActions, missionId, $"dialogueTree.{nodeId}.action");
            }

            if (node.RushBonus.HasValue)
            {
                RequireFinite(node.RushBonus.Value, missionId, $"dialogueTree.{nodeId}.rushBonus", 0);
            }

            if (node.TimeLimitOverride.HasValue)
            {
                RequireFinite(node.TimeLimitOverride.Value, missionId, $"dialogueTree.{nodeId}.timeLimitOverride", 1);
            }

            var targets = new List<string>();
            IReadOnlyList<DialogueChoice> choices = node.Choices ?? Array.Empty<DialogueChoice>();
            for (int choiceIndex = 0; choiceIndex < choices.Count; choiceIndex++)
            {
                DialogueChoice choice = choices[choiceIndex];
                string prefix = $"dialogueTree.{nodeId}.choices[{choiceIndex}]";
                RequireString(choice.Label, missionId, $"{prefix}.label");
                string target = RequireStableId(choice.Next, missionId, $"{prefix}.next");
                if (!tree.ContainsKey(target))
                {
                    throw Error($"contains a broken dialogue choice to missing node {target}.", missionId, $"{prefix}.next", "MISSING_REFERENCE");
                }

                targets.Add(target);
            }

            edges[nodeId] = targets.AsReadOnly();
        }

        var reachable = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>();
        pending.Push("start");
        while (pending.TryPop(out string? nodeId))
        {
            if (!reachable.Add(nodeId))
            {
                continue;
            }

            foreach (string target in edges[nodeId])
            {
                pending.Push(target);
            }
        }

        foreach (string nodeId in tree.Keys)
        {
            if (!reachable.Contains(nodeId))
            {
                throw Error("is unreachable from dialogueTree.start.", missionId, $"dialogueTree.{nodeId}", "UNREACHABLE_RECORD");
            }
        }
    }

    private static void ValidateRetryPolicy(MissionRetryPolicy? policy, string missionId)
    {
        if (policy is null)
        {
            return;
        }

        RequireEnum(policy.Strategy, RetryStrategies, missionId, "retryPolicy.strategy");
        RequireFinite(policy.MaxAttempts, missionId, "retryPolicy.maxAttempts", 1);
        if (policy.MaxAttempts != Math.Truncate(policy.MaxAttempts))
        {
            throw Error("must be an integer.", missionId, "retryPolicy.maxAttempts");
        }
    }

    private static void ValidatePrerequisites(IReadOnlyList<MissionDefinition> missions, IReadOnlySet<string> ids)
    {
        var edges = missions.ToDictionary(mission => mission.Id!, _ => new List<string>(), StringComparer.Ordinal);
        foreach (MissionDefinition mission in missions)
        {
            for (int index = 0; index < mission.Prerequisites!.Count; index++)
            {
                MissionPrerequisite requirement = mission.Prerequisites[index];
                string field = $"prerequisites[{index}]";
                string type = RequireEnum(requirement.Type, PrerequisiteTypes, mission.Id!, $"{field}.type");
                if (type is "MISSION_COMPLETED" or "FOLLOW_UP_STATUS")
                {
                    string requiredMissionId = RequireStableId(requirement.MissionId, mission.Id!, $"{field}.missionId");
                    if (!ids.Contains(requiredMissionId))
                    {
                        throw Error($"references missing missions record {requiredMissionId}.", mission.Id!, $"{field}.missionId", "MISSING_REFERENCE");
                    }

                    edges[mission.Id!].Add(requiredMissionId);
                }

                if (type == "FOLLOW_UP_STATUS")
                {
                    RequireEnum(requirement.Status ?? "AVAILABLE", FollowUpStatuses, mission.Id!, $"{field}.status");
                }

                if (type == "CITY_CONDITION" && requirement.Requirement is null)
                {
                    throw Error("must be an object.", mission.Id!, $"{field}.requirement");
                }

                if (requirement.Reason is not null)
                {
                    RequireString(requirement.Reason, mission.Id!, $"{field}.reason");
                }
            }
        }

        var visiting = new HashSet<string>(StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        foreach (string missionId in edges.Keys)
        {
            Visit(missionId);
        }

        void Visit(string missionId)
        {
            if (!visiting.Add(missionId))
            {
                throw Error($"contains a circular mission prerequisite at {missionId}.", missionId, "prerequisites", "CIRCULAR_PREREQUISITE");
            }

            if (!visited.Contains(missionId))
            {
                foreach (string prerequisiteId in edges[missionId])
                {
                    Visit(prerequisiteId);
                }

                visited.Add(missionId);
            }

            visiting.Remove(missionId);
        }
    }

    private static string RequireString(string? value, string missionId, string field)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw Error("must be a non-empty string.", missionId, field);
        }

        return value.Trim();
    }

    private static string RequireStableId(string? value, string missionId, string field)
    {
        string normalized = RequireString(value, missionId, field);
        if (!StableId.IsValid(normalized))
        {
            throw Error("must be a stable ID containing only letters, numbers, underscores, or hyphens.", missionId, field);
        }

        return normalized;
    }

    private static string RequireEnum(string? value, IReadOnlySet<string> allowed, string missionId, string field)
    {
        if (value is null || !allowed.Contains(value))
        {
            throw Error($"uses invalid enum value {value}; expected one of {string.Join(", ", allowed)}.", missionId, field, "INVALID_ENUM");
        }

        return value;
    }

    private static double RequireFinite(double value, string missionId, string field, double minimum) =>
        RequireFinite(value, missionId, field, minimum, double.PositiveInfinity);

    private static double RequireFinite(double value, string missionId, string field, double minimum, double maximum)
    {
        if (!double.IsFinite(value) || value < minimum || value > maximum)
        {
            string range = double.IsFinite(minimum) || double.IsFinite(maximum)
                ? $" in the range {FormatNumber(minimum)}..{FormatNumber(maximum)}"
                : string.Empty;
            throw Error($"must be a finite number{range}.", missionId, field);
        }

        return value;
    }

    private static string FormatNumber(double value) => value switch
    {
        double.PositiveInfinity => "Infinity",
        double.NegativeInfinity => "-Infinity",
        _ => value.ToString("G", System.Globalization.CultureInfo.InvariantCulture),
    };

    private static ContentValidationException Error(
        string message,
        object? recordId = null,
        string? field = null,
        string code = "INVALID_GAME_DATA") =>
        new(message, "missions", recordId, field, code);
}

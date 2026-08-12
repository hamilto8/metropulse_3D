using System.Collections.Frozen;
using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Persistence;

/// <summary>Browser-compatible save envelope migration and whole-document validation authority.</summary>
public sealed class GameSaveDocumentValidator : IGameSaveDocumentValidator
{
    private static readonly string[] RequiredDomains =
    [
        "game",
        "economy",
        "world",
        "player",
        "timeWeather",
        "missions",
        "factions",
        "progression",
        "heat",
        "settings",
        "bindings",
        "alerts",
    ];

    private static readonly FrozenSet<string> StableGameStates = new[]
    {
        "MANAGEMENT",
        "BUILDER",
        "STREET_ON_FOOT",
        "STREET_VEHICLE",
        "RESULT",
        "PAUSED",
    }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> ControlledKinds = new[]
    {
        "VEHICLE",
        "PEDESTRIAN",
        "AIRCRAFT",
    }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenDictionary<string, string> ZoneAliases =
        ContentDefinitions.Zones
            .SelectMany(zone => zone.Aliases.Append(zone.Id).Select(alias => (alias, zone.Id)))
            .ToFrozenDictionary(pair => pair.alias, pair => pair.Id, StringComparer.Ordinal);

    private static readonly JsonSerializerOptions JsonOptions = new(SettingsValidator.JsonOptions)
    {
        WriteIndented = false,
    };

    private readonly GameContentRegistry content;
    private readonly FrozenDictionary<string, ZoneDefinition> zones;
    private readonly FrozenDictionary<string, FactionDefinition> factions;
    private readonly FrozenDictionary<string, ProgressionDefinition> progression;

    public GameSaveDocumentValidator(GameContentRegistry content)
    {
        this.content = content ?? throw new ArgumentNullException(nameof(content));
        zones = ContentDefinitions.Zones.ToFrozenDictionary(item => item.Id, StringComparer.Ordinal);
        factions = ContentDefinitions.Factions.ToFrozenDictionary(item => item.Id, StringComparer.Ordinal);
        progression = ContentDefinitions.Progression.ToFrozenDictionary(item => item.Id, StringComparer.Ordinal);
    }

    public string ValidateAndNormalize(string document) => Validate(document).Json;

    public ValidatedGameSaveDocument Validate(string document)
    {
        ArgumentNullException.ThrowIfNull(document);
        JsonObject root;
        try
        {
            root = JsonNode.Parse(document) as JsonObject
                ?? throw Error("must be an object.", "save");
        }
        catch (JsonException error)
        {
            throw Error("contains malformed JSON.", "save", innerException: error);
        }

        Migrate(root);
        ValidateEnvelope(root);
        string normalized = root.ToJsonString(JsonOptions);
        JsonObject metadata = RequireObject(root, "metadata", "save.metadata");
        JsonObject data = RequireObject(root, "data", "save.data");
        string[] reasons = RequireArray(metadata, "reasons", "save.metadata.reasons")
            .Select((node, index) => RequireString(node, $"save.metadata.reasons[{index}]"))
            .ToArray();
        return new ValidatedGameSaveDocument(
            normalized,
            RequireInteger(root["schemaVersion"], "save.schemaVersion"),
            RequireInteger(root["featureVersion"], "save.featureVersion"),
            RequireString(metadata["saveId"], "save.metadata.saveId"),
            RequireString(metadata["savedAt"], "save.metadata.savedAt"),
            RequireString(metadata["reason"], "save.metadata.reason"),
            Array.AsReadOnly(reasons),
            OptionalString(metadata["checkpoint"], "save.metadata.checkpoint"),
            data.ToJsonString(JsonOptions));
    }

    public ValidatedGameSaveDocument Create(
        JsonObject data,
        string saveId,
        DateTimeOffset savedAt,
        string reason,
        IEnumerable<string>? reasons = null,
        string? checkpoint = null)
    {
        ArgumentNullException.ThrowIfNull(data);
        string stableSaveId = RequireText(saveId, "save.metadata.saveId");
        string stableReason = RequireText(reason, "save.metadata.reason");
        string[] stableReasons = (reasons ?? [stableReason])
            .Select((value, index) => RequireText(value, $"save.metadata.reasons[{index}]"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (stableReasons.Length == 0) stableReasons = [stableReason];

        var root = new JsonObject
        {
            ["format"] = GameSaveConstants.Format,
            ["schemaVersion"] = GameSaveConstants.SchemaVersion,
            ["featureVersion"] = GameSaveConstants.FeatureVersion,
            ["metadata"] = new JsonObject
            {
                ["saveId"] = stableSaveId,
                ["savedAt"] = savedAt.ToUniversalTime().ToString("O"),
                ["reason"] = stableReason,
                ["reasons"] = new JsonArray(stableReasons.Select(value => JsonValue.Create(value)).ToArray()),
                ["checkpoint"] = checkpoint,
            },
            ["data"] = data.DeepClone(),
        };
        return Validate(root.ToJsonString(JsonOptions));
    }

    public GameSaveInspection Inspect(string? document, string slot)
    {
        if (string.IsNullOrWhiteSpace(slot)) throw new ArgumentException("A save slot ID is required.", nameof(slot));
        if (document is null) return new GameSaveInspection(slot, false, false, null, null, null);
        try
        {
            ValidatedGameSaveDocument validated = Validate(document);
            return new GameSaveInspection(slot, true, true, validated.SavedAt, null, validated);
        }
        catch (GameSaveValidationException error)
        {
            return new GameSaveInspection(slot, true, false, null, error.UserMessage, null);
        }
        catch (Exception error)
        {
            return new GameSaveInspection(slot, true, false, null, error.Message, null);
        }
    }

    private void Migrate(JsonObject root)
    {
        int schema = RequireInteger(root["schemaVersion"], "save.schemaVersion");
        if (schema < 0) throw Error("must be a non-negative integer.", "save.schemaVersion");
        if (schema > GameSaveConstants.SchemaVersion)
        {
            throw Error(
                $"schema {schema} is newer than supported schema {GameSaveConstants.SchemaVersion}.",
                "save.schemaVersion",
                "FUTURE_SAVE_VERSION");
        }

        while (schema < GameSaveConstants.SchemaVersion)
        {
            switch (schema)
            {
                case 0:
                    root["schemaVersion"] = 1;
                    RequireObject(root, "metadata", "save.metadata")["migratedFromSchema"] = 0;
                    schema = 1;
                    break;
                case 1:
                    root["schemaVersion"] = 2;
                    root["featureVersion"] = Math.Max(2, OptionalInteger(root["featureVersion"]) ?? 1);
                    JsonObject metadata = RequireObject(root, "metadata", "save.metadata");
                    JsonArray history = metadata["migrationHistory"] as JsonArray ?? [];
                    if (metadata["migrationHistory"] is not JsonArray) metadata["migrationHistory"] = history;
                    history.Add("P4.1_ZONE_VOCABULARY");
                    NormalizeZones(RequireObject(root, "data", "save.data"));
                    schema = 2;
                    break;
                default:
                    throw Error($"no migration exists for schema {schema}.", "save.schemaVersion", "MIGRATION_UNAVAILABLE");
            }
        }
    }

    private static void NormalizeZones(JsonObject data)
    {
        if (data["world"] is JsonObject world && world["zones"] is JsonArray worldZones)
        {
            foreach (JsonNode? node in worldZones)
            {
                if (node is JsonObject zone) NormalizeZoneField(zone, "zoneType");
            }
        }
        if (data["economy"] is JsonObject economy)
        {
            if (economy["buildings"] is JsonArray buildings)
            {
                foreach (JsonNode? node in buildings)
                {
                    if (node is JsonObject building) NormalizeZoneField(building, "kind");
                }
            }
            if (economy["zones"] is JsonArray economyZones)
            {
                foreach (JsonNode? node in economyZones)
                {
                    if (node is JsonObject zone) NormalizeZoneField(zone, "type");
                }
            }
        }
    }

    private static void NormalizeZoneField(JsonObject owner, string field)
    {
        if (owner[field] is JsonValue value
            && value.TryGetValue(out string? id)
            && id is not null
            && ZoneAliases.TryGetValue(id, out string? normalized))
        {
            owner[field] = normalized;
        }
    }

    private void ValidateEnvelope(JsonObject root)
    {
        if (RequireString(root["format"], "save.format") != GameSaveConstants.Format)
        {
            throw Error($"expected format {GameSaveConstants.Format}.", "save.format");
        }
        if (RequireInteger(root["schemaVersion"], "save.schemaVersion") != GameSaveConstants.SchemaVersion)
        {
            throw Error("was not migrated to the current schema.", "save.schemaVersion");
        }
        if (RequireInteger(root["featureVersion"], "save.featureVersion") < 1)
        {
            throw Error("must be a positive integer.", "save.featureVersion");
        }

        JsonObject metadata = RequireObject(root, "metadata", "save.metadata");
        RequireText(RequireString(metadata["saveId"], "save.metadata.saveId"), "save.metadata.saveId");
        string savedAt = RequireString(metadata["savedAt"], "save.metadata.savedAt");
        if (!DateTimeOffset.TryParse(savedAt, out _)) throw Error("must be an ISO date.", "save.metadata.savedAt");
        RequireText(RequireString(metadata["reason"], "save.metadata.reason"), "save.metadata.reason");
        JsonArray reasons = RequireArray(metadata, "reasons", "save.metadata.reasons");
        foreach ((JsonNode? reason, int index) in reasons.Select((value, index) => (value, index)))
        {
            _ = RequireString(reason, $"save.metadata.reasons[{index}]");
        }
        _ = OptionalString(metadata["checkpoint"], "save.metadata.checkpoint");

        JsonObject data = RequireObject(root, "data", "save.data");
        foreach (string domain in RequiredDomains) _ = RequireObject(data, domain, $"save.data.{domain}");
        ValidateDomains(data);
    }

    private void ValidateDomains(JsonObject data)
    {
        JsonObject game = Version(data, "game");
        string state = RequireString(game["state"], "save.data.game.state");
        if (!StableGameStates.Contains(state)) throw Error("is not a restorable state.", "save.data.game.state");
        _ = RequireBoolean(game["mayhemEnabled"], "save.data.game.mayhemEnabled");
        string? resumeState = OptionalString(game["resumeState"], "save.data.game.resumeState");
        if (state == "PAUSED" && (resumeState is null || !StableGameStates.Contains(resumeState) || resumeState == "PAUSED"))
        {
            throw Error("must identify a stable non-PAUSED resume state.", "save.data.game.resumeState");
        }

        Version(data, "economy");
        JsonObject world = Version(data, "world");
        ValidateWorld(world);
        JsonObject player = Version(data, "player");
        ValidatePlayer(player, state == "PAUSED" ? resumeState! : state);
        ValidateTimeWeather(Version(data, "timeWeather"));
        ValidateMissions(Version(data, "missions"));
        ValidateFactions(Version(data, "factions"));
        ValidateProgression(Version(data, "progression"));
        ValidateHeat(Version(data, "heat"));
        ValidateSettings(Version(data, "settings"), Version(data, "bindings"));
        ValidateAlerts(RequireObject(data, "alerts", "save.data.alerts"));
        ValidateOutcomeViews(data);
    }

    private void ValidateWorld(JsonObject world)
    {
        JsonArray buildings = RequireArray(world, "buildings", "save.data.world.buildings");
        var instanceIds = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < buildings.Count; index++)
        {
            string path = $"save.data.world.buildings[{index}]";
            JsonObject building = RequireObject(buildings[index], path);
            string specId = RequireString(building["specId"], $"{path}.specId");
            BuildingDefinition definition = content.GetBuilding(specId)
                ?? throw Error($"references unknown buildings content ID {specId}.", $"{path}.specId");
            string? economyId = OptionalString(building["economyId"], $"{path}.economyId");
            if (economyId is not null && !instanceIds.Add(RequireText(economyId, $"{path}.economyId")))
            {
                throw Error($"duplicates stable building instance ID {economyId}.", $"{path}.economyId");
            }
            JsonObject plot = RequireObject(building, "plot", $"{path}.plot");
            double x = InRange(plot["x"], $"{path}.plot.x", ContentDefinitions.WorldBounds.MinX, ContentDefinitions.WorldBounds.MaxX);
            double z = InRange(plot["z"], $"{path}.plot.z", ContentDefinitions.WorldBounds.MinZ, ContentDefinitions.WorldBounds.MaxZ);
            double width = OptionalFinite(plot["width"], $"{path}.plot.width") ?? definition.Footprint!.Width;
            double depth = OptionalFinite(plot["depth"], $"{path}.plot.depth") ?? definition.Footprint!.Depth;
            if (width <= 0 || width > 200 || depth <= 0 || depth > 200) throw Error("has an invalid footprint.", $"{path}.plot");
            double rotation = RequireFinite(building["rotationY"], $"{path}.rotationY");
            double cosine = Math.Abs(Math.Cos(rotation));
            double sine = Math.Abs(Math.Sin(rotation));
            double halfX = (width * cosine + depth * sine) * 0.5;
            double halfZ = (width * sine + depth * cosine) * 0.5;
            if (x - halfX < ContentDefinitions.WorldBounds.MinX || x + halfX > ContentDefinitions.WorldBounds.MaxX
                || z - halfZ < ContentDefinitions.WorldBounds.MinZ || z + halfZ > ContentDefinitions.WorldBounds.MaxZ)
            {
                throw Error("places its footprint outside supported world bounds.", $"{path}.plot");
            }
        }

        JsonArray zoneValues = RequireArray(world, "zones", "save.data.world.zones");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < zoneValues.Count; index++)
        {
            string path = $"save.data.world.zones[{index}]";
            JsonObject zone = RequireObject(zoneValues[index], path);
            string key = RequireText(RequireString(zone["key"], $"{path}.key"), $"{path}.key");
            if (!keys.Add(key)) throw Error($"duplicates stable zone key {key}.", $"{path}.key");
            string zoneType = RequireString(zone["zoneType"], $"{path}.zoneType");
            if (!zones.ContainsKey(zoneType)) throw Error($"references unknown zones content ID {zoneType}.", $"{path}.zoneType");
            _ = InRange(zone["x"], $"{path}.x", ContentDefinitions.WorldBounds.MinX, ContentDefinitions.WorldBounds.MaxX);
            _ = InRange(zone["z"], $"{path}.z", ContentDefinitions.WorldBounds.MinZ, ContentDefinitions.WorldBounds.MaxZ);
            _ = RequireFinite(zone["happinessModifier"], $"{path}.happinessModifier");
            _ = RequireFinite(zone["landValueModifier"], $"{path}.landValueModifier");
        }
    }

    private static void ValidatePlayer(JsonObject player, string effectiveState)
    {
        JsonNode? controlledNode = player["controlled"];
        if (controlledNode is null)
        {
            if (effectiveState is "STREET_ON_FOOT" or "STREET_VEHICLE" or "RESULT")
            {
                throw Error("street and result states require a controlled entity.", "save.data.player.controlled");
            }
            return;
        }
        JsonObject controlled = RequireObject(controlledNode, "save.data.player.controlled");
        string kind = RequireString(controlled["kind"], "save.data.player.controlled.kind");
        if (!ControlledKinds.Contains(kind)) throw Error("has an unsupported control kind.", "save.data.player.controlled.kind");
        _ = RequireText(RequireString(controlled["contentId"], "save.data.player.controlled.contentId"), "save.data.player.controlled.contentId");
        _ = RequireText(RequireString(controlled["typeId"], "save.data.player.controlled.typeId"), "save.data.player.controlled.typeId");
        double[] position = RequireVector(controlled["position"], "save.data.player.controlled.position");
        _ = RequireVector(controlled["rotation"], "save.data.player.controlled.rotation");
        _ = RequireFinite(controlled["speed"], "save.data.player.controlled.speed");
        if (position[0] < ContentDefinitions.WorldBounds.MinX || position[0] > ContentDefinitions.WorldBounds.MaxX
            || position[1] < ContentDefinitions.WorldBounds.MinY || position[1] > ContentDefinitions.WorldBounds.MaxY
            || position[2] < ContentDefinitions.WorldBounds.MinZ || position[2] > ContentDefinitions.WorldBounds.MaxZ)
        {
            throw Error("is outside the supported world bounds.", "save.data.player.controlled.position");
        }
    }

    private void ValidateTimeWeather(JsonObject value)
    {
        _ = InRange(value["time"], "save.data.timeWeather.time", 0, 24);
        _ = InRange(value["speed"], "save.data.timeWeather.speed", 0, 1_000);
        _ = RequireBoolean(value["playing"], "save.data.timeWeather.playing");
        string weather = RequireString(value["weather"], "save.data.timeWeather.weather");
        if (content.GetWeather(weather) is null) throw Error($"references unknown weather content ID {weather}.", "save.data.timeWeather.weather");
    }

    private void ValidateMissions(JsonObject missions)
    {
        JsonArray completed = RequireArray(missions, "completedMissionIds", "save.data.missions.completedMissionIds");
        ValidateUniqueMissionIds(completed, "save.data.missions.completedMissionIds");
        JsonArray runCounts = RequireArray(missions, "runCounts", "save.data.missions.runCounts");
        var runIds = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < runCounts.Count; index++)
        {
            string path = $"save.data.missions.runCounts[{index}]";
            if (runCounts[index] is not JsonArray entry || entry.Count != 2) throw Error("must be a [missionId, count] pair.", path);
            string id = KnownMission(entry[0], $"{path}[0]");
            if (!runIds.Add(id)) throw Error($"duplicates mission run count for {id}.", $"{path}[0]");
            if (RequireInteger(entry[1], $"{path}[1]") < 0) throw Error("must be a non-negative integer.", $"{path}[1]");
        }
        JsonArray dialogue = RequireArray(missions, "dialogueChoices", "save.data.missions.dialogueChoices");
        for (int index = 0; index < dialogue.Count; index++) ValidateDialogueChoice(dialogue[index], index);
        if (RequireInteger(missions["chronologyStep"], "save.data.missions.chronologyStep") < 0)
        {
            throw Error("must be a non-negative integer.", "save.data.missions.chronologyStep");
        }

        if (missions["contracts"] is JsonObject contracts)
        {
            try
            {
                MissionOutcomeStateDocument document = JsonSerializer.Deserialize<MissionOutcomeStateDocument>(contracts.ToJsonString(), JsonOptions)
                    ?? throw new InvalidDataException("Mission outcome state is empty.");
                MissionOutcomeService.ValidateState(document, content: content);
            }
            catch (Exception error)
            {
                throw Error(error.Message, "save.data.missions.contracts", innerException: error);
            }
        }
        if (missions["lifecycle"] is JsonObject lifecycle)
        {
            try
            {
                // The browser lifecycle validator intentionally treats an outcome receipt as
                // opaque save data. The richer C# receipt model has additional required fields,
                // so exclude that leaf while validating the shared lifecycle contract itself.
                JsonObject lifecycleContract = lifecycle.DeepClone().AsObject();
                if (lifecycleContract["run"] is JsonObject run) run.Remove("receipt");
                MissionLifecycleState state = JsonSerializer.Deserialize<MissionLifecycleState>(lifecycleContract.ToJsonString(), JsonOptions)
                    ?? throw new InvalidDataException("Mission lifecycle state is empty.");
                MissionLifecycleController.ValidateState(state, content.Missions.Definitions.Select(item => item.Id!).ToArray());
            }
            catch (Exception error)
            {
                throw Error(error.Message, "save.data.missions.lifecycle", innerException: error);
            }
        }
        if (missions["runtime"] is JsonObject runtime)
        {
            try
            {
                MissionRuntimeState state = JsonSerializer.Deserialize<MissionRuntimeState>(runtime.ToJsonString(), JsonOptions)
                    ?? throw new InvalidDataException("Mission runtime state is empty.");
                MissionRuntimeState.Validate(state, content.Missions);
            }
            catch (Exception error)
            {
                throw Error(error.Message, "save.data.missions.runtime", innerException: error);
            }
        }
        if (missions["active"] is JsonObject active)
        {
            string missionId = KnownMission(active["contentId"], "save.data.missions.active.contentId");
            if (RequireString(active["state"], "save.data.missions.active.state") != "IN_PROGRESS")
            {
                throw Error("must be IN_PROGRESS while an active mission is persisted.", "save.data.missions.active.state");
            }
            foreach (string field in new[] { "timeRemaining", "initialTimeLimit", "basePayout", "payout", "routeIndex", "raceElapsed", "sabotageProgress" })
            {
                if (RequireFinite(active[field], $"save.data.missions.active.{field}") < 0)
                {
                    throw Error("must be a non-negative finite number.", $"save.data.missions.active.{field}");
                }
            }
            _ = RequireBoolean(active["sabotageActive"], "save.data.missions.active.sabotageActive");
            _ = missionId;
        }
    }

    private void ValidateDialogueChoice(JsonNode? node, int index)
    {
        string path = $"save.data.missions.dialogueChoices[{index}]";
        JsonObject choice = RequireObject(node, path);
        string missionId = KnownMission(choice["missionId"], $"{path}.missionId");
        string nodeId = RequireString(choice["nodeId"], $"{path}.nodeId");
        string next = RequireString(choice["next"], $"{path}.next");
        string label = RequireString(choice["choice"], $"{path}.choice");
        MissionDefinition mission = content.Missions.Get(missionId)!;
        if (!mission.DialogueTree!.TryGetValue(nodeId, out DialogueNode? authored)
            || !mission.DialogueTree.ContainsKey(next)
            || !(authored.Choices ?? Array.Empty<DialogueChoice>()).Any(value => value.Label == label && value.Next == next))
        {
            throw Error("does not match an authored dialogue choice.", path);
        }
    }

    private void ValidateFactions(JsonObject value)
    {
        JsonObject values = RequireObject(value, "values", "save.data.factions.values");
        foreach ((string id, JsonNode? reputation) in values)
        {
            if (!factions.TryGetValue(id, out FactionDefinition? definition)) throw Error($"references unknown factions content ID {id}.", $"save.data.factions.values.{id}");
            _ = InRange(reputation, $"save.data.factions.values.{id}", definition.MinReputation, definition.MaxReputation);
        }
    }

    private void ValidateProgression(JsonObject value)
    {
        JsonObject values = RequireObject(value, "values", "save.data.progression.values");
        foreach ((string id, JsonNode? unlocked) in values)
        {
            if (!progression.ContainsKey(id)) throw Error($"references unknown progression content ID {id}.", $"save.data.progression.values.{id}");
            _ = RequireBoolean(unlocked, $"save.data.progression.values.{id}");
        }
    }

    private static void ValidateHeat(JsonObject value)
    {
        _ = RequireBoolean(value["wanted"], "save.data.heat.wanted");
        if (RequireFinite(value["escapeTimer"], "save.data.heat.escapeTimer") < 0)
        {
            throw Error("must be non-negative.", "save.data.heat.escapeTimer");
        }
        _ = OptionalString(value["activeIncidentId"], "save.data.heat.activeIncidentId");
    }

    private static void ValidateSettings(JsonObject settings, JsonObject bindings)
    {
        JsonObject values = RequireObject(settings, "values", "save.data.settings.values");
        JsonObject overrides = RequireObject(bindings, "overrides", "save.data.bindings.overrides");
        var candidate = new JsonObject
        {
            ["version"] = SettingsValidator.SchemaVersion,
            ["settings"] = values.DeepClone(),
            ["bindings"] = overrides.DeepClone(),
        };
        try
        {
            using JsonDocument document = JsonDocument.Parse(candidate.ToJsonString());
            _ = SettingsValidator.Validate(document.RootElement, allowMigration: false);
        }
        catch (Exception error)
        {
            throw Error(error.Message, "save.data.settings.values", innerException: error);
        }
        _ = RequireBoolean(settings["heatmap"], "save.data.settings.heatmap");
    }

    private static void ValidateAlerts(JsonObject alerts)
    {
        int version = RequireInteger(alerts["version"], "save.data.alerts.version");
        JsonArray items = RequireArray(alerts, "items", "save.data.alerts.items");
        if (version == 1)
        {
            for (int index = 0; index < items.Count; index++)
            {
                JsonObject item = RequireObject(items[index], $"save.data.alerts.items[{index}]");
                _ = RequireString(item["message"], $"save.data.alerts.items[{index}].message");
                _ = RequireString(item["type"], $"save.data.alerts.items[{index}].type");
            }
            return;
        }
        if (version != AlertService.StateVersion) throw Error("has an unsupported feature version.", "save.data.alerts.version");
        try
        {
            AlertStateDocument document = JsonSerializer.Deserialize<AlertStateDocument>(alerts.ToJsonString(), JsonOptions)
                ?? throw new InvalidDataException("Alert state is empty.");
            AlertService.ValidateState(document);
        }
        catch (Exception error)
        {
            throw Error(error.Message, "save.data.alerts", innerException: error);
        }
    }

    private static void ValidateOutcomeViews(JsonObject data)
    {
        if (data["missions"] is not JsonObject missions
            || missions["contracts"] is not JsonObject contracts
            || contracts["state"] is not JsonObject state)
        {
            return;
        }
        JsonNode? contractFactions = state["factions"];
        JsonNode? saveFactions = (data["factions"] as JsonObject)?["values"];
        JsonNode? contractProgression = state["progression"];
        JsonNode? saveProgression = (data["progression"] as JsonObject)?["values"];
        if (!JsonNode.DeepEquals(contractFactions, saveFactions))
        {
            throw Error("must match the authoritative mission outcome faction view.", "save.data.factions.values");
        }
        if (!JsonNode.DeepEquals(contractProgression, saveProgression))
        {
            throw Error("must match the authoritative mission outcome progression view.", "save.data.progression.values");
        }
    }

    private JsonObject Version(JsonObject data, string name)
    {
        JsonObject value = RequireObject(data, name, $"save.data.{name}");
        if (RequireInteger(value["version"], $"save.data.{name}.version") != 1)
        {
            throw Error("has an unsupported feature version.", $"save.data.{name}.version");
        }
        return value;
    }

    private void ValidateUniqueMissionIds(JsonArray values, string path)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < values.Count; index++)
        {
            string id = KnownMission(values[index], $"{path}[{index}]");
            if (!ids.Add(id)) throw Error($"duplicates stable content ID {id}.", $"{path}[{index}]");
        }
    }

    private string KnownMission(JsonNode? node, string path)
    {
        string id = RequireText(RequireString(node, path), path);
        if (content.Missions.Get(id) is null) throw Error($"references unknown missions content ID {id}.", path);
        return id;
    }

    private static JsonObject RequireObject(JsonObject owner, string property, string path) =>
        RequireObject(owner[property], path);

    private static JsonObject RequireObject(JsonNode? node, string path) =>
        node as JsonObject ?? throw Error("must be an object.", path);

    private static JsonArray RequireArray(JsonObject owner, string property, string path) =>
        owner[property] as JsonArray ?? throw Error("must be an array.", path);

    private static string RequireString(JsonNode? node, string path)
    {
        if (node is JsonValue value && value.TryGetValue(out string? result) && result is not null) return result;
        throw Error("must be a string.", path);
    }

    private static string? OptionalString(JsonNode? node, string path)
    {
        if (node is null) return null;
        return RequireString(node, path);
    }

    private static int RequireInteger(JsonNode? node, string path)
    {
        if (node is JsonValue value && value.TryGetValue(out int result)) return result;
        throw Error("must be an integer.", path);
    }

    private static int? OptionalInteger(JsonNode? node)
    {
        if (node is null) return null;
        return node is JsonValue value && value.TryGetValue(out int result) ? result : null;
    }

    private static bool RequireBoolean(JsonNode? node, string path)
    {
        if (node is JsonValue value && value.TryGetValue(out bool result)) return result;
        throw Error("must be boolean.", path);
    }

    private static double RequireFinite(JsonNode? node, string path)
    {
        if (node is JsonValue value && value.TryGetValue(out double result) && double.IsFinite(result)) return result;
        throw Error("must be finite.", path);
    }

    private static double? OptionalFinite(JsonNode? node, string path) =>
        node is null ? null : RequireFinite(node, path);

    private static double InRange(JsonNode? node, string path, double minimum, double maximum)
    {
        double value = RequireFinite(node, path);
        if (value < minimum || value > maximum) throw Error($"must be between {minimum} and {maximum}.", path);
        return value;
    }

    private static double[] RequireVector(JsonNode? node, string path)
    {
        if (node is not JsonArray values || values.Count != 3) throw Error("must be a 3D vector.", path);
        return values.Select((value, index) => RequireFinite(value, $"{path}[{index}]")).ToArray();
    }

    private static string RequireText(string? value, string path)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Error("must be a non-empty string.", path);
        return value.Trim();
    }

    private static GameSaveValidationException Error(
        string message,
        string path,
        string code = "INVALID_SAVE",
        Exception? innerException = null) =>
        new(message, path, code, innerException);
}

using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Persistence;
using Xunit;

namespace MetroPulse.Domain.Tests.Persistence;

public sealed class GameSavePersistenceTests
{
    private readonly GameSaveDocumentValidator validator = new(GameContentRegistry.LoadProduction());

    [Fact]
    public void FrozenCurrentEnvelopeValidatesWithoutLosingAnyDomain()
    {
        ValidatedGameSaveDocument document = validator.Validate(FixtureDocument("save-valid.json"));

        Assert.Equal(GameSaveConstants.SchemaVersion, document.SchemaVersion);
        Assert.Equal(GameSaveConstants.FeatureVersion, document.FeatureVersion);
        Assert.Equal("phase0-valid", document.SaveId);
        JsonObject data = JsonNode.Parse(document.DataJson)!.AsObject();
        Assert.Equal(
            ["alerts", "bindings", "economy", "factions", "game", "heat", "missions", "player", "progression", "settings", "timeWeather", "world"],
            data.Select(pair => pair.Key).Where(key => key != "mobility"));
        Assert.True(validator.Inspect(document.Json, GameSaveSlotIds.Current).Valid);
    }

    [Fact]
    public void SequentialMigrationsReachSchemaTwoAndRecordHistory()
    {
        ValidatedGameSaveDocument schemaZero = validator.Validate(FixtureDocument("save-schema-0.json"));
        JsonObject zero = JsonNode.Parse(schemaZero.Json)!.AsObject();
        Assert.Equal(2, zero["schemaVersion"]!.GetValue<int>());
        Assert.Equal(0, zero["metadata"]!["migratedFromSchema"]!.GetValue<int>());
        Assert.Equal("P4.1_ZONE_VOCABULARY", zero["metadata"]!["migrationHistory"]![0]!.GetValue<string>());

        ValidatedGameSaveDocument schemaOne = validator.Validate(FixtureDocument("save-schema-1.json"));
        JsonObject one = JsonNode.Parse(schemaOne.Json)!.AsObject();
        Assert.Equal(2, one["featureVersion"]!.GetValue<int>());
        Assert.Equal("P4.1_ZONE_VOCABULARY", one["metadata"]!["migrationHistory"]![0]!.GetValue<string>());
    }

    [Fact]
    public void SchemaOneMigrationCanonicalizesLegacyZoneVocabulary()
    {
        JsonObject candidate = FixtureNode("save-schema-1.json");
        JsonObject data = candidate["data"]!.AsObject();
        data["world"]!["zones"] = new JsonArray(new JsonObject
        {
            ["key"] = "1,1",
            ["x"] = 30,
            ["z"] = 30,
            ["zoneType"] = "INDUSTRIAL",
            ["happinessModifier"] = -7,
            ["landValueModifier"] = -3,
        });
        data["economy"]!["zones"] = new JsonArray(new JsonObject { ["type"] = "OFFICE" });

        JsonObject migrated = JsonNode.Parse(validator.Validate(candidate.ToJsonString()).Json)!.AsObject();
        Assert.Equal("OPERATIONS", migrated["data"]!["world"]!["zones"]![0]!["zoneType"]!.GetValue<string>());
        Assert.Equal("COMMERCIAL", migrated["data"]!["economy"]!["zones"]![0]!["type"]!.GetValue<string>());
    }

    [Fact]
    public void FutureAndCorruptFixturesFailWithActionableClassifications()
    {
        GameSaveValidationException future = Assert.Throws<GameSaveValidationException>(() =>
            validator.Validate(FixtureDocument("save-future.json")));
        Assert.Equal("FUTURE_SAVE_VERSION", future.Code);
        Assert.Contains("newer MetroPulse", future.UserMessage, StringComparison.Ordinal);

        GameSaveInspection corrupt = validator.Inspect(FixtureDocument("save-corrupt.json"), GameSaveSlotIds.Current);
        Assert.True(corrupt.Present);
        Assert.False(corrupt.Valid);
        Assert.Contains("save.data.economy", corrupt.Reason, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("save-controlled-entity.json")]
    [InlineData("save-mid-mission.json")]
    [InlineData("save-result.json")]
    [InlineData("save-recovery.json")]
    public void RepresentativeFrozenSaveScenariosValidate(string fixture)
    {
        Assert.Equal(GameSaveConstants.SchemaVersion, validator.Validate(FixtureDocument(fixture)).SchemaVersion);
    }

    [Fact]
    public void CrossDomainContentAndSettingsCorruptionFailsBeforePublication()
    {
        JsonObject unknownMission = FixtureNode("save-valid.json");
        unknownMission["data"]!["missions"]!["completedMissionIds"] = new JsonArray("mission_missing");
        Assert.Contains("unknown missions content ID", Assert.Throws<GameSaveValidationException>(() =>
            validator.Validate(unknownMission.ToJsonString())).Message, StringComparison.Ordinal);

        JsonObject invalidSettings = FixtureNode("save-valid.json");
        invalidSettings["data"]!["settings"]!["values"]!["textScale"] = 99;
        Assert.Contains("settings.values", Assert.Throws<GameSaveValidationException>(() =>
            validator.Validate(invalidSettings.ToJsonString())).Path, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateDeduplicatesReasonsAndRetainsStableCheckpointMetadata()
    {
        JsonObject data = FixtureNode("save-valid.json")["data"]!.AsObject();
        ValidatedGameSaveDocument document = validator.Create(
            data,
            "save-created",
            DateTimeOffset.Parse("2026-08-09T12:00:00Z"),
            AutosaveReasonIds.Checkpoint,
            [AutosaveReasonIds.WorldEdit, AutosaveReasonIds.Checkpoint, AutosaveReasonIds.WorldEdit],
            "mission_executive:dropoff");

        Assert.Equal([AutosaveReasonIds.WorldEdit, AutosaveReasonIds.Checkpoint], document.Reasons);
        Assert.Equal("mission_executive:dropoff", document.Checkpoint);
    }

    [Fact]
    public void DiscoveryOffersOnlyValidActionsAndPreparePreservesRecoverySemantics()
    {
        string valid = validator.Validate(FixtureDocument("save-valid.json")).Json;
        string recovery = validator.Validate(FixtureDocument("save-recovery.json")).Json;
        var repository = new MemoryRepository { Current = "{corrupt", Recovery = recovery };
        var discovery = new GameSaveDiscovery(repository, validator);

        GameSaveDiscoveryReport report = discovery.Discover();
        Assert.True(report.Actions[BootActionIds.NewGame]);
        Assert.False(report.Actions[BootActionIds.Continue]);
        Assert.True(report.Actions[BootActionIds.Recover]);
        PreparedBootSave prepared = discovery.Prepare(BootActionIds.Recover, report);
        Assert.True(prepared.Restore);
        Assert.Equal(recovery, repository.Current);

        repository.Current = valid;
        report = discovery.Discover();
        discovery.Prepare(BootActionIds.NewGame, report);
        Assert.Null(repository.Current);
        Assert.Equal(valid, repository.Recovery);
    }

    [Fact]
    public void SaveServiceCoalescesReasonsPublishesStatusAndHonorsMissionGate()
    {
        JsonObject data = FixtureNode("save-valid.json")["data"]!.AsObject();
        var repository = new MemoryRepository();
        bool allowed = true;
        var statuses = new List<GameSaveStatus>();
        using var service = new GameSaveService(
            repository,
            validator,
            () => data.DeepClone().AsObject(),
            () => new MissionSaveDecision(allowed, allowed ? null : "MISSION_COMMIT_IN_PROGRESS", allowed ? null : "Mission cleanup is committing."),
            () => DateTimeOffset.Parse("2026-08-09T12:00:00Z"),
            () => "service-save",
            debounceMilliseconds: 5_000);
        service.Subscribe(snapshot => statuses.Add(snapshot.Status));

        Assert.True(service.ScheduleSave(AutosaveReasonIds.Economy));
        Assert.True(service.ScheduleSave(AutosaveReasonIds.WorldEdit));
        Assert.False(service.Advance(TimeSpan.FromMilliseconds(4_999)));
        Assert.True(service.SaveCheckpoint("mission_executive:dropoff"));
        ValidatedGameSaveDocument saved = validator.Validate(repository.Current!);
        Assert.Equal(
            [AutosaveReasonIds.Checkpoint, AutosaveReasonIds.Economy, AutosaveReasonIds.WorldEdit],
            saved.Reasons);
        Assert.Contains(GameSaveStatus.Scheduled, statuses);
        Assert.Contains(GameSaveStatus.Saving, statuses);
        Assert.Equal(GameSaveStatus.Saved, service.Status.Status);

        allowed = false;
        Assert.False(service.ScheduleSave(AutosaveReasonIds.Mission));
        Assert.False(service.SaveNow());
        Assert.Equal("service-save", validator.Validate(repository.Current!).SaveId);
    }

    [Fact]
    public void SaveServiceFailureDoesNotMutateSlotsAndObserversCannotBreakSaving()
    {
        JsonObject data = FixtureNode("save-valid.json")["data"]!.AsObject();
        string prior = validator.Validate(FixtureDocument("save-valid.json")).Json;
        var repository = new MemoryRepository { Current = prior, FailWrites = true };
        using var service = new GameSaveService(repository, validator, () => data.DeepClone().AsObject());
        service.Subscribe(_ => throw new InvalidOperationException("observer failure"));

        Assert.False(service.SaveNow());
        Assert.Equal(prior, repository.Current);
        Assert.Equal(GameSaveStatus.Error, service.Status.Status);
        Assert.Contains("interrupted", service.Status.Error, StringComparison.Ordinal);
    }

    private static string FixtureDocument(string fixture) => FixtureNode(fixture).ToJsonString();

    private static JsonObject FixtureNode(string fixture) =>
        JsonNode.Parse(FixtureReader.Read(fixture))!["data"]!.DeepClone().AsObject();

    private sealed class MemoryRepository : IGameSaveRepository
    {
        public string? Current { get; set; }

        public string? Recovery { get; set; }

        public bool FailWrites { get; set; }

        public GameSaveSlots ReadSlots() => new(Current, Recovery);

        public string CommitCurrent(string document)
        {
            if (FailWrites) throw new IOException("interrupted transaction");
            if (Current is not null) Recovery = Current;
            Current = document;
            return document;
        }

        public string PutRecovery(string document)
        {
            Recovery = document;
            return document;
        }

        public string PromoteRecovery()
        {
            Current = Recovery ?? throw new InvalidOperationException("No recovery save is available.");
            return Current;
        }

        public bool ClearCurrent(bool preserveAsRecovery = true)
        {
            if (preserveAsRecovery && Current is not null) Recovery = Current;
            Current = null;
            return true;
        }
    }
}

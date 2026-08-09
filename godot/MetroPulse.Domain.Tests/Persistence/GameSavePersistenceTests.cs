using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Settings;
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

    [Fact]
    public void StaticRestoreAppliesAvailableSettingsAndRetainsAbsentOwnersAsImmutableDescriptors()
    {
        JsonObject save = FixtureNode("save-valid.json");
        save["data"]!["settings"]!["values"]!["textScale"] = 1.25;
        save["data"]!["bindings"]!["overrides"] = new JsonObject
        {
            [ControlContexts.Management] = new JsonObject { ["BUILD"] = new JsonArray("KeyG") },
        };
        var settings = new SettingsStore();
        settings.Load();
        var coordinator = new GameSaveRestoreCoordinator(
            validator,
            [new SettingsSaveRestoreParticipant(settings)]);

        GameSaveStaticRestoreReport report = coordinator.RestoreStatic(save.ToJsonString());

        Assert.Equal(1.25, settings.Get<double>("textScale"));
        Assert.Equal("KeyG", settings.GetBindings(ControlContexts.Management, "BUILD")[0]);
        Assert.Equal([GameSaveDomainIds.Settings, GameSaveDomainIds.Bindings], report.AppliedDomains);
        Assert.Contains(GameSaveDomainIds.Economy, report.DeferredStatic.DomainIds);
        Assert.Contains(GameSaveDomainIds.World, report.PendingRuntime.DomainIds);
        Assert.Contains(GameSaveDomainIds.Player, report.PendingRuntime.DomainIds);
        JsonObject runtime = JsonNode.Parse(report.PendingRuntime.DataJson)!.AsObject();
        Assert.True(runtime.ContainsKey(GameSaveDomainIds.Game));
        Assert.False(runtime.ContainsKey(GameSaveDomainIds.Settings));

        var adapter = new RecordingRuntimeRestoreAdapter();
        Assert.True(coordinator.RestoreRuntime(adapter));
        Assert.Equal("phase0-valid", adapter.Applied?.SaveId);
        Assert.Null(coordinator.PendingRuntime);
        Assert.False(coordinator.RestoreRuntime(adapter));
    }

    [Fact]
    public void StaticRestoreRollsBackAppliedParticipantsWhenACommitFails()
    {
        int first = 10;
        int second = 20;
        var coordinator = new GameSaveRestoreCoordinator(
            validator,
            [
                new DelegateRestoreParticipant(
                    GameSaveDomainIds.Economy,
                    apply: () => first = 11,
                    rollback: () => first = 10),
                new DelegateRestoreParticipant(
                    GameSaveDomainIds.TimeWeather,
                    apply: () => throw new IOException("static owner rejected restore"),
                    rollback: () => second = 20),
            ]);

        GameSaveRestoreException error = Assert.Throws<GameSaveRestoreException>(() =>
            coordinator.RestoreStatic(FixtureDocument("save-valid.json")));

        Assert.Equal(10, first);
        Assert.Equal(20, second);
        Assert.Empty(error.RollbackErrors);
        Assert.Null(coordinator.LastStaticRestore);
        Assert.Null(coordinator.PendingRuntime);
    }

    [Fact]
    public void FailedRuntimeRestoreRetainsTheDescriptorForRetry()
    {
        var coordinator = new GameSaveRestoreCoordinator(validator);
        GameSaveStaticRestoreReport report = coordinator.RestoreStatic(FixtureDocument("save-controlled-entity.json"));
        var failing = new RecordingRuntimeRestoreAdapter { Failure = new IOException("runtime owner unavailable") };

        Assert.Throws<IOException>(() => coordinator.RestoreRuntime(failing));
        Assert.Same(report.PendingRuntime, coordinator.PendingRuntime);
        Assert.Equal("phase0-controlled-entity", failing.Applied?.SaveId);
    }

    [Fact]
    public void ImportPreviewsMigratesBacksUpOriginalAndPublishesOnlyAfterConfirmation()
    {
        string source = FixtureDocument("save-schema-1.json");
        string prior = validator.Validate(FixtureDocument("save-valid.json")).Json;
        var repository = new MemoryRepository { Current = prior };
        var backups = new MemoryImportBackups();
        var imports = new GameSaveImportService(
            validator,
            repository,
            backups,
            () => DateTimeOffset.Parse("2026-08-09T14:30:00Z"));

        PreparedGameSaveImport prepared = imports.Prepare(source);

        Assert.Equal(1, prepared.Preview.SourceSchemaVersion);
        Assert.Equal(2, prepared.Preview.TargetSchemaVersion);
        Assert.Equal("MANAGEMENT", prepared.Preview.GameState);
        Assert.Equal(0, prepared.Preview.BuildingCount);
        Assert.Null(prepared.Preview.ControlledKind);
        Assert.False(imports.Confirm(prepared, confirmed: false).Imported);
        Assert.Equal(prior, repository.Current);
        Assert.Empty(backups.Entries);

        GameSaveImportResult result = imports.Confirm(prepared, confirmed: true);
        Assert.True(result.Imported);
        Assert.Equal("user://test-import-backups/phase0-valid.json", result.BackupPath);
        Assert.Equal(source, backups.Entries.Single().Original);
        Assert.Equal(2, validator.Validate(repository.Current!).SchemaVersion);
        Assert.Equal(prior, repository.Recovery);
    }

    [Fact]
    public void ImportPreviewDescribesMissionAndControlledEntityWithoutApplyingRuntimeState()
    {
        var repository = new MemoryRepository();
        var imports = new GameSaveImportService(validator, repository, new MemoryImportBackups());

        GameSaveImportPreview controlled = imports.Prepare(FixtureDocument("save-controlled-entity.json")).Preview;
        GameSaveImportPreview mission = imports.Prepare(FixtureDocument("save-mid-mission.json")).Preview;

        Assert.Equal("VEHICLE", controlled.ControlledKind);
        Assert.Equal("SEDAN", controlled.ControlledTypeId);
        Assert.Equal("mission_executive", mission.MissionId);
        Assert.Equal("ACTIVE", mission.MissionPhase);
        Assert.Null(repository.Current);
    }

    [Fact]
    public void InvalidOrInterruptedImportNeverMutatesCurrentOrRecovery()
    {
        string current = validator.Validate(FixtureDocument("save-valid.json")).Json;
        string recovery = validator.Validate(FixtureDocument("save-recovery.json")).Json;
        var repository = new MemoryRepository { Current = current, Recovery = recovery };
        var backups = new MemoryImportBackups();
        var imports = new GameSaveImportService(validator, repository, backups);

        Assert.Throws<GameSaveValidationException>(() => imports.Prepare(FixtureDocument("save-future.json")));
        Assert.Empty(backups.Entries);
        Assert.Equal(new GameSaveSlots(current, recovery), repository.ReadSlots());

        PreparedGameSaveImport prepared = imports.Prepare(FixtureDocument("save-schema-0.json"));
        repository.FailWrites = true;
        Assert.Throws<IOException>(() => imports.Confirm(prepared, confirmed: true));
        Assert.Equal(new GameSaveSlots(current, recovery), repository.ReadSlots());
        Assert.Single(backups.Entries);
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

    private sealed class RecordingRuntimeRestoreAdapter : IGameSaveRuntimeRestoreAdapter
    {
        public DeferredGameSaveDescriptor? Applied { get; private set; }

        public Exception? Failure { get; init; }

        public void Apply(DeferredGameSaveDescriptor descriptor)
        {
            Applied = descriptor;
            if (Failure is not null) throw Failure;
        }
    }

    private sealed class DelegateRestoreParticipant(
        string domainId,
        Action apply,
        Action rollback) : IGameSaveStaticRestoreParticipant
    {
        private readonly IReadOnlyList<string> domainIds = Array.AsReadOnly([domainId]);

        public IReadOnlyList<string> DomainIds => domainIds;

        public IPreparedGameSaveStaticRestore Prepare(JsonObject data) =>
            new DelegatePreparedRestore(domainIds, apply, rollback);
    }

    private sealed class DelegatePreparedRestore(
        IReadOnlyList<string> domainIds,
        Action apply,
        Action rollback) : IPreparedGameSaveStaticRestore
    {
        public IReadOnlyList<string> DomainIds => domainIds;

        public void Apply() => apply();

        public void Rollback() => rollback();
    }

    private sealed class MemoryImportBackups : IGameSaveImportBackupStore
    {
        public List<(string Path, string Original)> Entries { get; } = [];

        public string StoreOriginal(ReadOnlyMemory<byte> original, string saveId, DateTimeOffset importedAt)
        {
            string path = $"user://test-import-backups/{saveId}.json";
            Entries.Add((path, System.Text.Encoding.UTF8.GetString(original.Span)));
            return path;
        }
    }
}

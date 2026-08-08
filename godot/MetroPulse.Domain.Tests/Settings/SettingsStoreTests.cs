using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Settings;

public sealed class SettingsStoreTests
{
    [Fact]
    public void DefaultsAndCustomizationMatchFrozenPhaseZeroEvidenceExactly()
    {
        JsonElement fixture = ReadFixtureSettings();
        SettingsDocument defaults = SettingsValidator.CreateDefaultDocument();
        AssertJsonEqual(fixture.GetProperty("defaultDocument"), defaults);
        AssertJsonEqual(fixture.GetProperty("defaults"), defaults);

        var storage = new MemorySettingsStorage();
        var store = new SettingsStore(storage);
        store.Load();
        store.Set("cameraSensitivity.vehicle", 1.4);
        store.Set("textScale", 1.25);
        store.SetBinding(ControlContexts.Vehicle, "INTERACT", "KeyG");

        AssertJsonEqual(fixture.GetProperty("customized"), store.Snapshot());
        Assert.Equal(fixture.GetProperty("vehicleInteractLabel").GetString(), store.GetActionLabel(ControlContexts.Vehicle, "INTERACT"));
        ArgumentOutOfRangeException reserved = Assert.Throws<ArgumentOutOfRangeException>(
            () => store.SetBinding(ControlContexts.Vehicle, "INTERACT", "F5"));
        Assert.StartsWith(fixture.GetProperty("reservedBindingError").GetProperty("message").GetString()!, reserved.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void LoadMigratesBootSchemaAndPersistsCompleteVersionedDocument()
    {
        var storage = new MemorySettingsStorage(new Dictionary<string, string>
        {
            [SettingsValidator.StorageKey] = """{"version":1,"reducedMotion":"REDUCE","textScale":1.4}""",
        });
        var store = new SettingsStore(storage);

        SettingsLoadResult loaded = store.Load();

        Assert.Equal(SettingValues.ReduceMotion, loaded.Settings.Motion.ReducedMotion);
        Assert.Equal(1.4, loaded.Settings.TextScale);
        Assert.Equal(SettingsValidator.DefaultSettings.Audio, loaded.Settings.Audio);
        using JsonDocument persisted = JsonDocument.Parse(storage.GetItem(SettingsValidator.StorageKey)!);
        Assert.Equal(SettingsValidator.SchemaVersion, persisted.RootElement.GetProperty("version").GetInt32());
        Assert.True(store.Loaded);
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>)store.Snapshot().Bindings)
                .Add(ControlContexts.Vehicle, new Dictionary<string, IReadOnlyList<string>>()));
    }

    [Fact]
    public void ValidationRejectsPartialFutureAndOutOfRangeDocuments()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => SettingsValidator.Validate("""{"version":99}"""));
        ArgumentException partial = Assert.ThrowsAny<ArgumentException>(
            () => SettingsValidator.Validate("""{"version":2,"settings":{},"bindings":{}}"""));
        Assert.Contains("cameraSensitivity", partial.Message, StringComparison.Ordinal);
        var store = new SettingsStore(new MemorySettingsStorage());
        store.Load();
        ArgumentOutOfRangeException range = Assert.Throws<ArgumentOutOfRangeException>(() => store.Set("textScale", 4));
        Assert.Contains("between 0.8 and 1.5", range.Message, StringComparison.Ordinal);
        Assert.Throws<ArgumentException>(() => store.Set("unknown.option", true));

        var futureStorage = new MemorySettingsStorage(new Dictionary<string, string>
        {
            [SettingsValidator.StorageKey] = """{"version":99}""",
        });
        SettingsLoadResult fallback = new SettingsStore(futureStorage).Load();
        Assert.Single(fallback.Warnings);
        Assert.Equal(SettingsValidator.DefaultSettings, fallback.Settings);
        Assert.Equal("""{"version":99}""", futureStorage.GetItem(SettingsValidator.StorageKey));
    }

    [Fact]
    public void SettingUpdatesAreAtomicObservablePersistentAndReloadable()
    {
        var storage = new MemorySettingsStorage();
        var store = new SettingsStore(storage);
        store.Load();
        var events = new List<SettingsEvent>();
        Func<bool> unsubscribe = store.Subscribe(events.Add);

        store.Set("audio.master", 0.25);
        store.Set("cameraSensitivity.vehicle", 1.7);
        Assert.True(unsubscribe());
        Assert.False(unsubscribe());
        store.Set("difficulty", SettingValues.RelaxedDifficulty);

        Assert.Equal(2, events.Count);
        Assert.Equal("audio.master", events[0].Path);
        Assert.Equal(0.5, events[0].Previous!.Settings.Audio.Master);
        Assert.Equal(0.25, events[0].Current.Settings.Audio.Master);
        SettingsLoadResult reloaded = new SettingsStore(storage).Load();
        Assert.Equal(0.25, reloaded.Settings.Audio.Master);
        Assert.Equal(1.7, reloaded.Settings.CameraSensitivity.Vehicle);
        Assert.Equal(SettingValues.RelaxedDifficulty, reloaded.Settings.Difficulty);
    }

    [Fact]
    public void StorageAndListenerFailuresCannotPartiallyMutateLiveState()
    {
        var storage = new MemorySettingsStorage();
        var listenerErrors = new List<string>();
        var store = new SettingsStore(storage, onListenerError: error => listenerErrors.Add(error.Message));
        store.Load();
        int healthyListenerCalls = 0;
        store.Subscribe(_ => throw new InvalidOperationException("observer failed"));
        store.Subscribe(_ => healthyListenerCalls += 1);
        store.Set("textScale", 1.1);

        Assert.Equal(["observer failed"], listenerErrors);
        Assert.Equal(1, healthyListenerCalls);

        storage.SetFailure = new InvalidOperationException("quota exceeded");
        Assert.Throws<InvalidOperationException>(() => store.Set("textScale", 1.2));
        Assert.Equal(1.1, store.Get<double>("textScale"));
        Assert.Equal(1, healthyListenerCalls);
    }

    [Fact]
    public void BindingEditsRejectContextConflictsReservedInputsAndWrongDevices()
    {
        var store = new SettingsStore(new MemorySettingsStorage());
        store.Load();

        ArgumentOutOfRangeException conflict = Assert.Throws<ArgumentOutOfRangeException>(
            () => store.SetBinding(ControlContexts.Vehicle, "INTERACT", "KeyM"));
        Assert.Contains("conflicts between INTERACT and MODE", conflict.Message, StringComparison.Ordinal);
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            store.SetBinding(ControlContexts.Vehicle, "INTERACT", "F5"));
        ArgumentException device = Assert.Throws<ArgumentException>(() =>
            store.SetBinding(ControlContexts.Vehicle, "CAMERA", "KeyC"));
        Assert.Contains("mouse-button binding", device.Message, StringComparison.Ordinal);
        Assert.Equal("E", store.GetActionLabel(ControlContexts.Vehicle, "INTERACT"));
    }

    [Fact]
    public void BindingsUpdatePromptsAndResetByContextOrGlobally()
    {
        var storage = new MemorySettingsStorage();
        var store = new SettingsStore(storage);
        store.Load();

        store.SetBinding(ControlContexts.Vehicle, "INTERACT", "KeyG");
        store.SetBinding(ControlContexts.Pedestrian, "INTERACT", "KeyI");
        Assert.Equal("G", store.GetActionLabel(ControlContexts.Vehicle, "INTERACT"));
        Assert.Equal("I", store.GetActionLabel(ControlContexts.Pedestrian, "INTERACT"));
        store.ResetContext(ControlContexts.Vehicle);
        Assert.Equal("E", store.GetActionLabel(ControlContexts.Vehicle, "INTERACT"));
        Assert.Equal("I", store.GetActionLabel(ControlContexts.Pedestrian, "INTERACT"));
        store.ResetBindings();
        Assert.Equal("E", store.GetActionLabel(ControlContexts.Pedestrian, "INTERACT"));
        using JsonDocument persisted = JsonDocument.Parse(storage.GetItem(SettingsValidator.StorageKey)!);
        Assert.Empty(persisted.RootElement.GetProperty("bindings").EnumerateObject());
    }

    [Fact]
    public void DirectionalSlotsRemainStableAcrossValidationPersistenceAndReload()
    {
        var storage = new MemorySettingsStorage();
        var store = new SettingsStore(storage);
        store.Load();
        store.SetBinding(ControlContexts.Pedestrian, "MOVE", "KeyI", 0);

        Assert.Equal(
        [
            "KeyI",
            "KeyS",
            "KeyA",
            "KeyD",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
        ], store.GetBindings(ControlContexts.Pedestrian, "MOVE"));
        var reloaded = new SettingsStore(storage);
        reloaded.Load();
        Assert.Equal("KeyI", reloaded.GetBindings(ControlContexts.Pedestrian, "MOVE")[0]);
        Assert.Empty(reloaded.GetConflicts(ControlContexts.Pedestrian));
    }

    private static JsonElement ReadFixtureSettings()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("settings-bindings-alerts.json"));
        return fixture.RootElement.GetProperty("data").Clone();
    }

    private static void AssertJsonEqual(JsonElement expected, object actual)
    {
        JsonNode? expectedNode = JsonNode.Parse(expected.GetRawText());
        JsonNode? actualNode = JsonSerializer.SerializeToNode(actual, SettingsValidator.JsonOptions);
        Assert.True(JsonNode.DeepEquals(expectedNode, actualNode), $"Expected {expectedNode}; actual {actualNode}");
    }

    private sealed class MemorySettingsStorage : ISettingsStorage
    {
        private readonly Dictionary<string, string> values;

        public MemorySettingsStorage(IReadOnlyDictionary<string, string>? entries = null)
        {
            values = entries?.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal)
                ?? new Dictionary<string, string>(StringComparer.Ordinal);
        }

        public Exception? SetFailure { get; set; }

        public string? GetItem(string key) => values.GetValueOrDefault(key);

        public void SetItem(string key, string value)
        {
            if (SetFailure is not null) throw SetFailure;
            values[key] = value;
        }
    }
}

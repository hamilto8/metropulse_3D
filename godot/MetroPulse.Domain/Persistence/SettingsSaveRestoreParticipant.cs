using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Persistence;

public sealed class SettingsSaveRestoreParticipant : IGameSaveStaticRestoreParticipant
{
    private static readonly IReadOnlyList<string> OwnedDomains = Array.AsReadOnly(
        [GameSaveDomainIds.Settings, GameSaveDomainIds.Bindings]);

    private readonly SettingsStore store;

    public SettingsSaveRestoreParticipant(SettingsStore store)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
    }

    public IReadOnlyList<string> DomainIds => OwnedDomains;

    public IPreparedGameSaveStaticRestore Prepare(JsonObject data)
    {
        JsonObject settings = data[GameSaveDomainIds.Settings]?.AsObject()
            ?? throw new InvalidDataException("Save settings domain is unavailable.");
        JsonObject bindings = data[GameSaveDomainIds.Bindings]?.AsObject()
            ?? throw new InvalidDataException("Save bindings domain is unavailable.");
        var candidate = new JsonObject
        {
            ["version"] = SettingsValidator.SchemaVersion,
            ["settings"] = settings["values"]?.DeepClone(),
            ["bindings"] = bindings["overrides"]?.DeepClone(),
        };
        using JsonDocument parsed = JsonDocument.Parse(candidate.ToJsonString());
        SettingsDocument next = SettingsValidator.Validate(parsed.RootElement, allowMigration: false);
        SettingsDocument previous = store.Snapshot();
        return new Prepared(store, previous, next);
    }

    private sealed class Prepared(
        SettingsStore store,
        SettingsDocument previous,
        SettingsDocument next) : IPreparedGameSaveStaticRestore
    {
        public IReadOnlyList<string> DomainIds => OwnedDomains;

        public void Apply() => store.Replace(next.Settings, next.Bindings, source: "save-restore");

        public void Rollback() => store.Replace(previous.Settings, previous.Bindings, source: "save-restore-rollback");
    }
}

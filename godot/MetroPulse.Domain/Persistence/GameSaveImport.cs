using System.Text;
using System.Text.Json.Nodes;

namespace MetroPulse.Domain.Persistence;

public interface IGameSaveImportBackupStore
{
    string StoreOriginal(ReadOnlyMemory<byte> original, string saveId, DateTimeOffset importedAt);
}

public sealed record GameSaveImportPreview(
    string SaveId,
    string SavedAt,
    int SourceSchemaVersion,
    int TargetSchemaVersion,
    string GameState,
    int BuildingCount,
    int ZoneCount,
    string? MissionId,
    string? MissionPhase,
    string? ControlledKind,
    string? ControlledTypeId,
    int OriginalBytes);

public sealed class PreparedGameSaveImport
{
    internal PreparedGameSaveImport(
        byte[] original,
        ValidatedGameSaveDocument document,
        GameSaveImportPreview preview)
    {
        Original = original;
        Document = document;
        Preview = preview;
    }

    internal byte[] Original { get; }

    internal ValidatedGameSaveDocument Document { get; }

    public GameSaveImportPreview Preview { get; }
}

public sealed record GameSaveImportResult(
    bool Imported,
    GameSaveImportPreview Preview,
    string? BackupPath,
    ValidatedGameSaveDocument? Document);

/// <summary>Previews validated browser saves and publishes them only after explicit confirmation.</summary>
public sealed class GameSaveImportService
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    private readonly GameSaveDocumentValidator validator;
    private readonly IGameSaveRepository repository;
    private readonly IGameSaveImportBackupStore backups;
    private readonly Func<DateTimeOffset> now;

    public GameSaveImportService(
        GameSaveDocumentValidator validator,
        IGameSaveRepository repository,
        IGameSaveImportBackupStore backups,
        Func<DateTimeOffset>? now = null)
    {
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        this.repository = repository ?? throw new ArgumentNullException(nameof(repository));
        this.backups = backups ?? throw new ArgumentNullException(nameof(backups));
        this.now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public PreparedGameSaveImport Prepare(ReadOnlySpan<byte> original)
    {
        if (original.Length == 0) throw new InvalidDataException("The selected import file is empty.");
        byte[] retained = original.ToArray();
        string source;
        try
        {
            source = StrictUtf8.GetString(retained);
        }
        catch (DecoderFallbackException error)
        {
            throw new GameSaveValidationException("must contain valid UTF-8 JSON.", "import", innerException: error);
        }

        int sourceSchema = ReadSourceSchema(source);
        ValidatedGameSaveDocument document = validator.Validate(source);
        JsonObject data = JsonNode.Parse(document.DataJson)!.AsObject();
        JsonObject world = data[GameSaveDomainIds.World]!.AsObject();
        JsonObject missions = data[GameSaveDomainIds.Missions]!.AsObject();
        JsonObject? lifecycle = missions["lifecycle"] as JsonObject;
        JsonObject? active = missions["active"] as JsonObject;
        JsonObject? controlled = data[GameSaveDomainIds.Player]!["controlled"] as JsonObject;
        var preview = new GameSaveImportPreview(
            document.SaveId,
            document.SavedAt,
            sourceSchema,
            document.SchemaVersion,
            data[GameSaveDomainIds.Game]!["state"]!.GetValue<string>(),
            world["buildings"]!.AsArray().Count,
            world["zones"]!.AsArray().Count,
            Text(lifecycle?["selectedMissionId"]) ?? Text(active?["contentId"]),
            Text(lifecycle?["phase"]),
            Text(controlled?["kind"]),
            Text(controlled?["typeId"]),
            retained.Length);
        return new PreparedGameSaveImport(retained, document, preview);
    }

    public PreparedGameSaveImport Prepare(string original)
    {
        ArgumentNullException.ThrowIfNull(original);
        return Prepare(StrictUtf8.GetBytes(original));
    }

    public GameSaveImportResult Confirm(PreparedGameSaveImport prepared, bool confirmed)
    {
        ArgumentNullException.ThrowIfNull(prepared);
        if (!confirmed) return new GameSaveImportResult(false, prepared.Preview, null, null);

        string original = StrictUtf8.GetString(prepared.Original);
        ValidatedGameSaveDocument revalidated = validator.Validate(original);
        if (!string.Equals(revalidated.Json, prepared.Document.Json, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The prepared import no longer matches its validated document.");
        }

        string backupPath = backups.StoreOriginal(prepared.Original, revalidated.SaveId, now());
        string committed = repository.CommitCurrent(revalidated.Json);
        ValidatedGameSaveDocument published = validator.Validate(committed);
        return new GameSaveImportResult(true, prepared.Preview, backupPath, published);
    }

    private static int ReadSourceSchema(string source)
    {
        try
        {
            JsonObject root = JsonNode.Parse(source)?.AsObject()
                ?? throw new InvalidDataException("The selected import is not a JSON object.");
            return root["schemaVersion"]?.GetValue<int>()
                ?? throw new InvalidDataException("The selected import has no schemaVersion.");
        }
        catch (Exception error) when (error is not GameSaveValidationException)
        {
            throw new GameSaveValidationException("must declare an integer schemaVersion.", "import.schemaVersion", innerException: error);
        }
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out string? text) ? text : null;
}

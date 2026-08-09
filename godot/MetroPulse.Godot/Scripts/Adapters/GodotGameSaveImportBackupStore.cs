using System.Text.RegularExpressions;
using Godot;
using MetroPulse.Domain.Persistence;

namespace MetroPulse.Godot.Adapters;

public sealed partial class GodotGameSaveImportBackupStore : IGameSaveImportBackupStore
{
    public const string ProductionDirectory = "user://import-backups";

    private readonly string directoryPath;

    public GodotGameSaveImportBackupStore(string directoryPath = ProductionDirectory)
    {
        if (string.IsNullOrWhiteSpace(directoryPath)
            || !directoryPath.StartsWith("user://", StringComparison.Ordinal)
            || directoryPath.EndsWith("/", StringComparison.Ordinal))
        {
            throw new ArgumentException("The import-backup directory must be rooted under user://.", nameof(directoryPath));
        }
        this.directoryPath = directoryPath;
    }

    public string DirectoryPath => directoryPath;

    public string StoreOriginal(ReadOnlyMemory<byte> original, string saveId, DateTimeOffset importedAt)
    {
        if (original.IsEmpty) throw new InvalidDataException("An empty import cannot be backed up.");
        string stableId = SafeFilePart(saveId);
        string stamp = importedAt.ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ", System.Globalization.CultureInfo.InvariantCulture);
        string path = $"{directoryPath}/{stamp}-{stableId}.json";
        string absoluteDirectory = ProjectSettings.GlobalizePath(directoryPath);
        System.IO.Directory.CreateDirectory(absoluteDirectory);
        using global::Godot.FileAccess? writer = global::Godot.FileAccess.Open(path, global::Godot.FileAccess.ModeFlags.Write);
        if (writer is null)
        {
            Error openError = global::Godot.FileAccess.GetOpenError();
            throw new IOException($"Could not create import backup {path} (Godot error {openError}).");
        }
        writer.StoreBuffer(original.ToArray());
        writer.Flush();
        return path;
    }

    public void DeleteOwnedFiles()
    {
        string absoluteDirectory = ProjectSettings.GlobalizePath(directoryPath);
        if (!System.IO.Directory.Exists(absoluteDirectory)) return;
        foreach (string file in System.IO.Directory.EnumerateFiles(absoluteDirectory))
        {
            System.IO.File.Delete(file);
        }
        if (!System.IO.Directory.EnumerateFileSystemEntries(absoluteDirectory).Any())
        {
            System.IO.Directory.Delete(absoluteDirectory);
        }
    }

    private static string SafeFilePart(string value)
    {
        string normalized = Regex.Replace(value ?? string.Empty, "[^A-Za-z0-9_-]+", "-").Trim('-');
        return string.IsNullOrEmpty(normalized) ? "city" : normalized;
    }
}

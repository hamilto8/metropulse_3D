using Godot;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.Adapters;

public enum SettingsStorageFault
{
    None,
    BeforeTemporaryWrite,
    AfterTemporaryFlush,
    BeforePromote,
}

/// <summary>Atomic single-document settings storage rooted under Godot's user:// directory.</summary>
public sealed class GodotSettingsStorage : ISettingsStorage
{
    public const string ProductionPath = "user://settings-v2.json";

    private readonly string currentPath;
    private readonly string temporaryPath;

    public GodotSettingsStorage(
        string currentPath = ProductionPath,
        SettingsStorageFault injectedFault = SettingsStorageFault.None)
    {
        if (string.IsNullOrWhiteSpace(currentPath)
            || !currentPath.StartsWith("user://", StringComparison.Ordinal)
            || currentPath.EndsWith("/", StringComparison.Ordinal))
        {
            throw new ArgumentException("The settings path must be a file under user://.", nameof(currentPath));
        }

        this.currentPath = currentPath;
        temporaryPath = $"{currentPath}.tmp";
        InjectedFault = injectedFault;
    }

    public SettingsStorageFault InjectedFault { get; set; }

    public string CurrentPath => currentPath;

    public string TemporaryPath => temporaryPath;

    public string? GetItem(string key)
    {
        AssertKey(key);
        if (!global::Godot.FileAccess.FileExists(currentPath))
        {
            return null;
        }

        using global::Godot.FileAccess? reader = global::Godot.FileAccess.Open(
            currentPath,
            global::Godot.FileAccess.ModeFlags.Read);
        if (reader is null)
        {
            Error error = global::Godot.FileAccess.GetOpenError();
            throw new IOException($"The settings file could not be opened ({error}).");
        }

        return reader.GetAsText();
    }

    public void SetItem(string key, string value)
    {
        AssertKey(key);
        ArgumentNullException.ThrowIfNull(value);

        // Storage never promotes a document the domain validator cannot read.
        _ = SettingsValidator.Validate(value);
        string currentAbsolute = ProjectSettings.GlobalizePath(currentPath);
        string temporaryAbsolute = ProjectSettings.GlobalizePath(temporaryPath);
        string? directory = System.IO.Path.GetDirectoryName(currentAbsolute);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new IOException("The settings path has no writable parent directory.");
        }

        System.IO.Directory.CreateDirectory(directory);
        DeleteTemporary();

        try
        {
            ThrowIfInjected(SettingsStorageFault.BeforeTemporaryWrite);
            using (global::Godot.FileAccess? writer = global::Godot.FileAccess.Open(
                temporaryPath,
                global::Godot.FileAccess.ModeFlags.Write))
            {
                if (writer is null)
                {
                    Error error = global::Godot.FileAccess.GetOpenError();
                    throw new IOException($"The temporary settings file could not be opened ({error}).");
                }

                writer.StoreString(value);
                writer.Flush();
            }

            ThrowIfInjected(SettingsStorageFault.AfterTemporaryFlush);
            using (global::Godot.FileAccess? verifier = global::Godot.FileAccess.Open(
                temporaryPath,
                global::Godot.FileAccess.ModeFlags.Read))
            {
                if (verifier is null)
                {
                    Error error = global::Godot.FileAccess.GetOpenError();
                    throw new IOException($"The temporary settings file could not be verified ({error}).");
                }

                _ = SettingsValidator.Validate(verifier.GetAsText());
            }

            ThrowIfInjected(SettingsStorageFault.BeforePromote);
            System.IO.File.Move(temporaryAbsolute, currentAbsolute, overwrite: true);
        }
        catch
        {
            DeleteTemporary();
            throw;
        }
    }

    public void DeleteOwnedFiles()
    {
        DeleteIfPresent(ProjectSettings.GlobalizePath(currentPath));
        DeleteTemporary();
    }

    private static void AssertKey(string key)
    {
        if (!string.Equals(key, SettingsValidator.StorageKey, StringComparison.Ordinal))
        {
            throw new ArgumentException($"Unsupported settings storage key: {key}.", nameof(key));
        }
    }

    private void DeleteTemporary() => DeleteIfPresent(ProjectSettings.GlobalizePath(temporaryPath));

    private static void DeleteIfPresent(string absolutePath)
    {
        if (System.IO.File.Exists(absolutePath))
        {
            System.IO.File.Delete(absolutePath);
        }
    }

    private void ThrowIfInjected(SettingsStorageFault stage)
    {
        if (InjectedFault == stage)
        {
            throw new IOException($"Injected settings write interruption at {stage}.");
        }
    }
}

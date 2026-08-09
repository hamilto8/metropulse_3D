using Godot;
using MetroPulse.Domain.Persistence;

namespace MetroPulse.Godot.Adapters;

public enum GameSaveRepositoryFault
{
    None,
    BeforeTemporaryWrite,
    AfterTemporaryFlush,
    AfterTemporaryValidation,
    BeforeRecoveryRotation,
    AfterRecoveryRotation,
    BeforeCurrentPromote,
}

/// <summary>Crash-repairable current/recovery save storage rooted under Godot's user:// directory.</summary>
public sealed class GodotGameSaveRepository : IGameSaveRepository
{
    public const string ProductionDirectory = "user://saves";

    private readonly object gate = new();
    private readonly IGameSaveDocumentValidator validator;
    private readonly string directoryPath;
    private readonly string currentPath;
    private readonly string recoveryPath;
    private readonly string temporaryPath;
    private readonly string recoveryTemporaryPath;

    public GodotGameSaveRepository(
        IGameSaveDocumentValidator validator,
        string directoryPath = ProductionDirectory,
        GameSaveRepositoryFault injectedFault = GameSaveRepositoryFault.None,
        bool simulateProcessInterruption = false)
    {
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        if (string.IsNullOrWhiteSpace(directoryPath)
            || !directoryPath.StartsWith("user://", StringComparison.Ordinal)
            || directoryPath.EndsWith("/", StringComparison.Ordinal))
        {
            throw new ArgumentException("The save directory must be rooted under user://.", nameof(directoryPath));
        }

        this.directoryPath = directoryPath;
        currentPath = $"{directoryPath}/current.json";
        recoveryPath = $"{directoryPath}/recovery.json";
        temporaryPath = $"{directoryPath}/transaction.tmp";
        recoveryTemporaryPath = $"{directoryPath}/recovery.tmp";
        InjectedFault = injectedFault;
        SimulateProcessInterruption = simulateProcessInterruption;
    }

    public GameSaveRepositoryFault InjectedFault { get; set; }

    public bool SimulateProcessInterruption { get; set; }

    public string DirectoryPath => directoryPath;

    public string CurrentPath => currentPath;

    public string RecoveryPath => recoveryPath;

    public string TemporaryPath => temporaryPath;

    public string RecoveryTemporaryPath => recoveryTemporaryPath;

    public GameSaveSlots ReadSlots()
    {
        lock (gate)
        {
            RepairInterruptedTransaction();
            return new GameSaveSlots(ReadRaw(currentPath), ReadRaw(recoveryPath));
        }
    }

    public string CommitCurrent(string document)
    {
        lock (gate)
        {
            RepairInterruptedTransaction();
            string normalized = Validate(document);
            string? previousCurrent = ReadRaw(currentPath);
            string? previousRecovery = ReadRaw(recoveryPath);

            try
            {
                WriteValidatedTemporary(normalized);
                ThrowIfInjected(GameSaveRepositoryFault.BeforeRecoveryRotation);
                if (TryValidate(previousCurrent, out string validCurrent))
                {
                    WriteRaw(temporaryPath, validCurrent);
                    MoveReplace(temporaryPath, recoveryPath);
                    WriteValidatedTemporary(normalized);
                }
                ThrowIfInjected(GameSaveRepositoryFault.AfterRecoveryRotation);
                ThrowIfInjected(GameSaveRepositoryFault.BeforeCurrentPromote);
                MoveReplace(temporaryPath, currentPath);
                return normalized;
            }
            catch
            {
                if (!SimulateProcessInterruption)
                {
                    RestoreExact(previousCurrent, previousRecovery);
                    DeleteTemporary();
                }
                throw;
            }
        }
    }

    public string PutRecovery(string document)
    {
        lock (gate)
        {
            RepairInterruptedTransaction();
            string normalized = Validate(document);
            try
            {
                WriteValidatedTemporary(recoveryTemporaryPath, normalized);
                MoveReplace(recoveryTemporaryPath, recoveryPath);
                return normalized;
            }
            catch
            {
                if (!SimulateProcessInterruption) DeleteRecoveryTemporary();
                throw;
            }
        }
    }

    public string PromoteRecovery()
    {
        lock (gate)
        {
            RepairInterruptedTransaction();
            string recovery = ReadRaw(recoveryPath)
                ?? throw new InvalidOperationException("No recovery save is available.");
            string normalized = Validate(recovery);
            WriteValidatedTemporary(normalized);
            MoveReplace(temporaryPath, currentPath);
            return normalized;
        }
    }

    public bool ClearCurrent(bool preserveAsRecovery = true)
    {
        lock (gate)
        {
            RepairInterruptedTransaction();
            string? current = ReadRaw(currentPath);
            if (preserveAsRecovery && TryValidate(current, out string normalized))
            {
                WriteValidatedTemporary(normalized);
                MoveReplace(temporaryPath, recoveryPath);
            }
            DeleteIfPresent(Absolute(currentPath));
            DeleteTemporary();
            return true;
        }
    }

    public void DeleteOwnedFiles()
    {
        lock (gate)
        {
            DeleteIfPresent(Absolute(currentPath));
            DeleteIfPresent(Absolute(recoveryPath));
            DeleteTemporary();
            DeleteRecoveryTemporary();
            string absoluteDirectory = Absolute(directoryPath);
            if (System.IO.Directory.Exists(absoluteDirectory)
                && !System.IO.Directory.EnumerateFileSystemEntries(absoluteDirectory).Any())
            {
                System.IO.Directory.Delete(absoluteDirectory);
            }
        }
    }

    private void RepairInterruptedTransaction()
    {
        DeleteRecoveryTemporary();
        string? temporary = ReadRaw(temporaryPath);
        if (temporary is null) return;

        string? current = ReadRaw(currentPath);
        if (current is not null)
        {
            string? recoveryBesideCurrent = ReadRaw(recoveryPath);
            if (TryValidate(temporary, out string temporaryBesideCurrent)
                && TryValidate(current, out string normalizedCurrent)
                && TryValidate(recoveryBesideCurrent, out string recoveryBesideCurrentNormalized)
                && string.Equals(normalizedCurrent, recoveryBesideCurrentNormalized, StringComparison.Ordinal))
            {
                WriteRaw(temporaryPath, temporaryBesideCurrent);
                MoveReplace(temporaryPath, currentPath);
                return;
            }
            DeleteTemporary();
            return;
        }

        if (TryValidate(temporary, out string orphanedTemporary))
        {
            WriteRaw(temporaryPath, orphanedTemporary);
            MoveReplace(temporaryPath, currentPath);
            return;
        }

        DeleteTemporary();
        string? fallbackRecovery = ReadRaw(recoveryPath);
        if (TryValidate(fallbackRecovery, out string fallbackRecoveryNormalized))
        {
            WriteRaw(temporaryPath, fallbackRecoveryNormalized);
            MoveReplace(temporaryPath, currentPath);
        }
    }

    private void WriteValidatedTemporary(string normalized) =>
        WriteValidatedTemporary(temporaryPath, normalized);

    private void WriteValidatedTemporary(string path, string normalized)
    {
        DeleteIfPresent(Absolute(path));
        ThrowIfInjected(GameSaveRepositoryFault.BeforeTemporaryWrite);
        WriteRaw(path, normalized);
        ThrowIfInjected(GameSaveRepositoryFault.AfterTemporaryFlush);
        string reread = ReadRaw(path)
            ?? throw new IOException("The temporary save disappeared before validation.");
        _ = Validate(reread);
        ThrowIfInjected(GameSaveRepositoryFault.AfterTemporaryValidation);
    }

    private string Validate(string document)
    {
        ArgumentNullException.ThrowIfNull(document);
        string normalized = validator.ValidateAndNormalize(document);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new InvalidDataException("The save validator returned an empty document.");
        }
        return normalized;
    }

    private bool TryValidate(string? document, out string normalized)
    {
        if (document is null)
        {
            normalized = string.Empty;
            return false;
        }
        try
        {
            normalized = Validate(document);
            return true;
        }
        catch
        {
            normalized = string.Empty;
            return false;
        }
    }

    private void RestoreExact(string? current, string? recovery)
    {
        RestorePath(currentPath, current);
        RestorePath(recoveryPath, recovery);
    }

    private void RestorePath(string path, string? value)
    {
        if (value is null)
        {
            DeleteIfPresent(Absolute(path));
            return;
        }
        WriteRaw(temporaryPath, value);
        MoveReplace(temporaryPath, path);
    }

    private static string? ReadRaw(string path)
    {
        if (!global::Godot.FileAccess.FileExists(path)) return null;
        using global::Godot.FileAccess? reader = global::Godot.FileAccess.Open(
            path,
            global::Godot.FileAccess.ModeFlags.Read);
        if (reader is null)
        {
            Error error = global::Godot.FileAccess.GetOpenError();
            throw new IOException($"The save file {path} could not be opened ({error}).");
        }
        return reader.GetAsText();
    }

    private static void WriteRaw(string path, string value)
    {
        string? directory = System.IO.Path.GetDirectoryName(Absolute(path));
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new IOException($"The save path {path} has no writable parent directory.");
        }
        System.IO.Directory.CreateDirectory(directory);
        using global::Godot.FileAccess? writer = global::Godot.FileAccess.Open(
            path,
            global::Godot.FileAccess.ModeFlags.Write);
        if (writer is null)
        {
            Error error = global::Godot.FileAccess.GetOpenError();
            throw new IOException($"The save file {path} could not be opened for writing ({error}).");
        }
        writer.StoreString(value);
        writer.Flush();
    }

    private static void MoveReplace(string source, string destination) =>
        System.IO.File.Move(Absolute(source), Absolute(destination), overwrite: true);

    private void DeleteTemporary() => DeleteIfPresent(Absolute(temporaryPath));

    private void DeleteRecoveryTemporary() => DeleteIfPresent(Absolute(recoveryTemporaryPath));

    private static void DeleteIfPresent(string absolutePath)
    {
        if (System.IO.File.Exists(absolutePath)) System.IO.File.Delete(absolutePath);
    }

    private static string Absolute(string path) => ProjectSettings.GlobalizePath(path);

    private void ThrowIfInjected(GameSaveRepositoryFault stage)
    {
        if (InjectedFault == stage)
        {
            throw new IOException($"Injected game-save interruption at {stage}.");
        }
    }
}

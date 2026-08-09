using System.Text.Json.Nodes;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Persistence;

/// <summary>Owns save snapshot creation, reason coalescing, debounce, checkpoints, and status publication.</summary>
public sealed class GameSaveService : IDisposable
{
    public const int DefaultDebounceMilliseconds = 5_000;

    private readonly object gate = new();
    private readonly IGameSaveRepository repository;
    private readonly GameSaveDocumentValidator validator;
    private readonly Func<JsonObject> capture;
    private readonly Func<MissionSaveDecision>? canSave;
    private readonly Func<DateTimeOffset> now;
    private readonly Func<string> idFactory;
    private readonly List<Action<GameSaveStatusSnapshot>> listeners = [];
    private readonly HashSet<string> pendingReasons = new(StringComparer.Ordinal);
    private string? pendingCheckpoint;
    private string? scheduledPrimaryReason;
    private double? remainingDebounceMilliseconds;
    private bool saving;
    private bool restoring;
    private bool disposed;
    private string? lastSavedAt;
    private Exception? lastError;
    private GameSaveStatus status = GameSaveStatus.Idle;

    public GameSaveService(
        IGameSaveRepository repository,
        GameSaveDocumentValidator validator,
        Func<JsonObject> capture,
        Func<MissionSaveDecision>? canSave = null,
        Func<DateTimeOffset>? now = null,
        Func<string>? idFactory = null,
        int debounceMilliseconds = DefaultDebounceMilliseconds)
    {
        this.repository = repository ?? throw new ArgumentNullException(nameof(repository));
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        this.capture = capture ?? throw new ArgumentNullException(nameof(capture));
        this.canSave = canSave;
        this.now = now ?? (() => DateTimeOffset.UtcNow);
        this.idFactory = idFactory ?? (() => Guid.NewGuid().ToString());
        if (debounceMilliseconds < 0) throw new ArgumentOutOfRangeException(nameof(debounceMilliseconds));
        DebounceMilliseconds = debounceMilliseconds;
    }

    public int DebounceMilliseconds { get; }

    public GameSaveStatusSnapshot Status
    {
        get
        {
            lock (gate) return Snapshot();
        }
    }

    public Func<bool> Subscribe(Action<GameSaveStatusSnapshot> listener, bool emitCurrent = false)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ArgumentNullException.ThrowIfNull(listener);
        lock (gate)
        {
            listeners.Add(listener);
            if (emitCurrent) NotifyOne(listener, Snapshot());
        }
        bool subscribed = true;
        return () =>
        {
            lock (gate)
            {
                if (!subscribed) return false;
                subscribed = false;
                return listeners.Remove(listener);
            }
        };
    }

    public bool ScheduleSave(string reason = AutosaveReasonIds.WorldEdit, string? checkpoint = null)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        string stableReason = RequireText(reason, nameof(reason));
        MissionSaveDecision? decision = canSave?.Invoke();
        if (restoring || decision?.Allowed == false) return false;
        lock (gate)
        {
            pendingReasons.Add(stableReason);
            scheduledPrimaryReason = stableReason;
            if (checkpoint is not null) pendingCheckpoint = RequireText(checkpoint, nameof(checkpoint));
            SetStatus(GameSaveStatus.Scheduled);
            remainingDebounceMilliseconds = DebounceMilliseconds;
            return true;
        }
    }

    public bool Advance(TimeSpan elapsed)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (elapsed < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(elapsed));
        bool flush;
        lock (gate)
        {
            if (remainingDebounceMilliseconds is null) return false;
            remainingDebounceMilliseconds = Math.Max(0, remainingDebounceMilliseconds.Value - elapsed.TotalMilliseconds);
            flush = remainingDebounceMilliseconds == 0;
        }
        return flush && FlushScheduled();
    }

    public bool SaveCheckpoint(string checkpointId) =>
        SaveNow(AutosaveReasonIds.Checkpoint, RequireText(checkpointId, nameof(checkpointId)));

    public bool FlushScheduled()
    {
        string? reason;
        lock (gate)
        {
            if (pendingReasons.Count == 0) return false;
            reason = scheduledPrimaryReason ?? AutosaveReasonIds.WorldEdit;
        }
        return SaveNow(reason);
    }

    public bool SaveNow(string reason = AutosaveReasonIds.Manual, string? checkpoint = null)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        string stableReason = RequireText(reason, nameof(reason));
        MissionSaveDecision? decision = canSave?.Invoke();
        if (restoring || decision?.Allowed == false)
        {
            lock (gate)
            {
                lastError = decision?.Allowed == false
                    ? new InvalidOperationException(decision.Reason ?? "Saving is temporarily unavailable.")
                    : null;
            }
            return false;
        }

        lock (gate)
        {
            if (saving)
            {
                pendingReasons.Add(stableReason);
                if (checkpoint is not null) pendingCheckpoint = RequireText(checkpoint, nameof(checkpoint));
                return false;
            }
            saving = true;
            remainingDebounceMilliseconds = null;
            pendingReasons.Add(stableReason);
            if (checkpoint is not null) pendingCheckpoint = RequireText(checkpoint, nameof(checkpoint));
            SetStatus(GameSaveStatus.Saving);
        }

        try
        {
            string[] reasons;
            string? finalCheckpoint;
            lock (gate)
            {
                reasons = pendingReasons.Order(StringComparer.Ordinal).ToArray();
                finalCheckpoint = pendingCheckpoint;
                pendingReasons.Clear();
                pendingCheckpoint = null;
                scheduledPrimaryReason = null;
            }
            string primaryReason = reasons.Contains(AutosaveReasonIds.Manual, StringComparer.Ordinal)
                ? AutosaveReasonIds.Manual
                : stableReason;
            ValidatedGameSaveDocument document = validator.Create(
                capture(),
                idFactory(),
                now(),
                primaryReason,
                reasons,
                finalCheckpoint);
            repository.CommitCurrent(document.Json);
            lock (gate)
            {
                lastSavedAt = document.SavedAt;
                lastError = null;
                SetStatus(GameSaveStatus.Saved);
            }
            return true;
        }
        catch (Exception error)
        {
            lock (gate)
            {
                lastError = error;
                SetStatus(GameSaveStatus.Error);
            }
            return false;
        }
        finally
        {
            lock (gate)
            {
                saving = false;
                if (pendingReasons.Count > 0)
                {
                    SetStatus(GameSaveStatus.Scheduled);
                    remainingDebounceMilliseconds = 0;
                }
            }
        }
    }

    public void SetRestoring(bool value)
    {
        lock (gate)
        {
            restoring = value;
            SetStatus(value ? GameSaveStatus.Loading : GameSaveStatus.Idle);
        }
    }

    public bool Clear(bool preserveRecovery = true)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        try
        {
            repository.ClearCurrent(preserveRecovery);
            lock (gate)
            {
                lastSavedAt = null;
                lastError = null;
                SetStatus(GameSaveStatus.Idle);
            }
            return true;
        }
        catch (Exception error)
        {
            lock (gate)
            {
                lastError = error;
                SetStatus(GameSaveStatus.Error);
            }
            return false;
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lock (gate)
        {
            listeners.Clear();
            pendingReasons.Clear();
        }
    }

    private void SetStatus(GameSaveStatus value)
    {
        status = value;
        GameSaveStatusSnapshot snapshot = Snapshot();
        foreach (Action<GameSaveStatusSnapshot> listener in listeners.ToArray()) NotifyOne(listener, snapshot);
    }

    private GameSaveStatusSnapshot Snapshot() => new(
        status,
        true,
        saving || pendingReasons.Count > 0,
        restoring,
        lastSavedAt,
        lastError is GameSaveValidationException validation ? validation.UserMessage : lastError?.Message);

    private static void NotifyOne(Action<GameSaveStatusSnapshot> listener, GameSaveStatusSnapshot snapshot)
    {
        try
        {
            listener(snapshot);
        }
        catch
        {
            // Status observers cannot break persistence.
        }
    }

    private static string RequireText(string? value, string parameter)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("A non-empty value is required.", parameter);
        return value.Trim();
    }
}

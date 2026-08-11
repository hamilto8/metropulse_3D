namespace MetroPulse.Domain.WorldEditing;

public enum WorldEditTransactionState
{
    Active,
    Committed,
    RolledBack,
}

public sealed record WorldEditRollbackError(string Step, Exception Error);

public sealed class WorldEditTransactionException : Exception
{
    public WorldEditTransactionException(
        string message,
        Exception? innerException = null,
        IReadOnlyList<WorldEditRollbackError>? rollbackErrors = null)
        : base(message, innerException)
    {
        RollbackErrors = rollbackErrors ?? Array.Empty<WorldEditRollbackError>();
    }

    public IReadOnlyList<WorldEditRollbackError> RollbackErrors { get; }
}

/// <summary>
/// Synchronous cross-authority transaction. Compensation is registered before apply,
/// and every applied or possibly partially-applied step rolls back in strict LIFO order.
/// </summary>
public sealed class WorldEditTransaction
{
    private sealed record Entry(string Label, Action<object?, Exception?> Compensate)
    {
        public object? Value { get; set; }
    }

    private readonly List<Entry> compensations = [];

    public WorldEditTransaction(string label)
    {
        if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("A transaction label is required.", nameof(label));
        Label = label.Trim();
    }

    public string Label { get; }

    public WorldEditTransactionState State { get; private set; } = WorldEditTransactionState.Active;

    public T Step<T>(string label, Func<T> apply, Action<T, Exception?>? compensate = null)
    {
        EnsureActive();
        if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("A step label is required.", nameof(label));
        ArgumentNullException.ThrowIfNull(apply);
        var entry = new Entry(label.Trim(), (value, cause) => compensate?.Invoke((T)value!, cause));
        entry.Value = default(T);
        compensations.Add(entry);
        T value = apply();
        if (value is bool accepted && !accepted)
        {
            compensations.RemoveAt(compensations.Count - 1);
            throw new WorldEditTransactionException($"{label} rejected the {Label} transaction.");
        }
        entry.Value = value;
        return value;
    }

    public void Commit()
    {
        EnsureActive();
        compensations.Clear();
        State = WorldEditTransactionState.Committed;
    }

    public IReadOnlyList<WorldEditRollbackError> Rollback(Exception? cause = null)
    {
        if (State != WorldEditTransactionState.Active) return Array.Empty<WorldEditRollbackError>();
        var errors = new List<WorldEditRollbackError>();
        for (int index = compensations.Count - 1; index >= 0; index--)
        {
            Entry entry = compensations[index];
            try
            {
                entry.Compensate(entry.Value, cause);
            }
            catch (Exception error)
            {
                errors.Add(new WorldEditRollbackError(entry.Label, error));
            }
        }
        compensations.Clear();
        State = WorldEditTransactionState.RolledBack;
        return errors.AsReadOnly();
    }

    public static T Run<T>(string label, Func<WorldEditTransaction, T> executor)
    {
        ArgumentNullException.ThrowIfNull(executor);
        var transaction = new WorldEditTransaction(label);
        try
        {
            T value = executor(transaction);
            transaction.Commit();
            return value;
        }
        catch (Exception error)
        {
            IReadOnlyList<WorldEditRollbackError> rollbackErrors = transaction.Rollback(error);
            if (error is WorldEditTransactionException transactionError && rollbackErrors.Count == 0)
            {
                throw transactionError;
            }
            throw new WorldEditTransactionException(
                $"{label} failed and was rolled back.",
                error,
                rollbackErrors);
        }
    }

    private void EnsureActive()
    {
        if (State != WorldEditTransactionState.Active)
        {
            throw new InvalidOperationException($"{Label} transaction is {State.ToString().ToLowerInvariant()}.");
        }
    }
}

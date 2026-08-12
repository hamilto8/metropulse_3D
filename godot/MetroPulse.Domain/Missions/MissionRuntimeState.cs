namespace MetroPulse.Domain.Missions;

/// <summary>Save-safe mission ownership retained across active checkpoints and RESULT.</summary>
public sealed record MissionRuntimeState
{
    public int Version { get; init; } = 1;

    public required MissionLifecycleState Lifecycle { get; init; }

    public required MissionExecutionState? Execution { get; init; }

    public required string? ResultTransactionId { get; init; }

    public static bool Validate(MissionRuntimeState value, MissionRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(registry);
        if (value.Version != 1)
        {
            throw new InvalidDataException($"Unsupported mission runtime state version: {value.Version}");
        }
        MissionLifecycleController.ValidateState(
            value.Lifecycle,
            registry.Definitions.Select(mission => mission.Id!).ToArray());
        bool active = value.Lifecycle.Phase is MissionPhases.Active or MissionPhases.Checkpoint;
        bool result = value.Lifecycle.Phase == MissionPhases.Result;
        bool idle = value.Lifecycle.Phase == MissionPhases.Idle;
        if (!active && !result && !idle)
        {
            throw new InvalidDataException($"Mission phase {value.Lifecycle.Phase} cannot be persisted safely.");
        }
        if (idle)
        {
            if (value.Execution is not null || value.ResultTransactionId is not null)
                throw new InvalidDataException("Idle mission runtime state cannot retain execution or a result transaction.");
            return true;
        }
        if (value.Execution is null)
            throw new InvalidDataException("Occupied mission runtime state requires execution state.");
        MissionExecutionModel.ValidateState(value.Execution, registry, value.Lifecycle);
        if (active && value.ResultTransactionId is not null)
            throw new InvalidDataException("Active mission runtime state cannot retain a result transaction.");
        if (result)
        {
            string transactionId = value.Lifecycle.Run?.TransactionId
                ?? throw new InvalidDataException("RESULT mission state has no transaction ID.");
            if (value.Lifecycle.Run?.Receipt?.TransactionId != transactionId
                || value.ResultTransactionId != transactionId)
            {
                throw new InvalidDataException("RESULT mission lifecycle, receipt, and runtime transaction IDs must match.");
            }
        }
        return true;
    }
}

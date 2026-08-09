using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Boot;

public enum BootStageStatus
{
    Pending,
    Running,
    Complete,
    Failed,
}

public static class BootStageIds
{
    public const string CapabilityChecks = "capability-checks";
    public const string SettingsBootstrap = "settings-bootstrap";
    public const string ContentValidation = "content-validation";
    public const string SaveDiscovery = "save-discovery";
    public const string ActionSelection = "action-selection";
    public const string SessionConstruction = "session-construction";
    public const string SaveApplication = "save-application";
    public const string FinalReadiness = "final-readiness";
    public const string InteractiveRelease = "interactive-release";
}

public sealed record BootProgress(
    string StageId,
    string Label,
    BootStageStatus Status,
    int Completed,
    int Total,
    double Progress,
    BootStageException? Error = null);

public sealed record BootStageDefinition(
    string Id,
    string Label,
    Func<IReadOnlyDictionary<string, object?>, CancellationToken, ValueTask<object?>> Run);

public sealed class BootStageException : Exception
{
    public BootStageException(
        string stageId,
        string stageLabel,
        string code,
        string userMessage,
        IEnumerable<string>? actions = null,
        Exception? innerException = null)
        : base($"Boot stage \"{stageLabel}\" failed: {innerException?.Message ?? userMessage}", innerException)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(stageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(stageLabel);
        ArgumentException.ThrowIfNullOrWhiteSpace(code);
        ArgumentException.ThrowIfNullOrWhiteSpace(userMessage);

        StageId = stageId;
        StageLabel = stageLabel;
        Code = code;
        UserMessage = userMessage;
        Actions = Array.AsReadOnly((actions ?? []).Where(action => !string.IsNullOrWhiteSpace(action)).ToArray());
    }

    public string StageId { get; }

    public string StageLabel { get; }

    public string Code { get; }

    public string UserMessage { get; }

    public IReadOnlyList<string> Actions { get; }
}

public sealed class BootPipeline
{
    private readonly ReadOnlyCollection<BootStageDefinition> stages;
    private readonly Action<BootProgress>? onProgress;
    private int running;

    public BootPipeline(
        IEnumerable<BootStageDefinition> stages,
        Action<BootProgress>? onProgress = null)
    {
        ArgumentNullException.ThrowIfNull(stages);

        BootStageDefinition[] stageArray = stages.ToArray();
        if (stageArray.Length == 0)
        {
            throw new ArgumentException("BootPipeline requires at least one stage.", nameof(stages));
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        for (int index = 0; index < stageArray.Length; index++)
        {
            BootStageDefinition? stage = stageArray[index];
            if (stage is null)
            {
                throw new ArgumentException($"Boot stage {index + 1} must not be null.", nameof(stages));
            }

            if (string.IsNullOrWhiteSpace(stage.Id) || !ids.Add(stage.Id))
            {
                throw new ArgumentException($"Boot stage ID is missing or duplicated: {stage.Id ?? "<missing>"}.", nameof(stages));
            }

            if (string.IsNullOrWhiteSpace(stage.Label))
            {
                throw new ArgumentException($"Boot stage {stage.Id} requires a label.", nameof(stages));
            }

            ArgumentNullException.ThrowIfNull(stage.Run);
        }

        this.stages = Array.AsReadOnly(stageArray);
        this.onProgress = onProgress;
    }

    public IReadOnlyList<BootStageDefinition> Stages => stages;

    public bool IsRunning => Volatile.Read(ref running) != 0;

    public async ValueTask<IReadOnlyDictionary<string, object?>> RunAsync(
        CancellationToken cancellationToken = default)
    {
        if (Interlocked.CompareExchange(ref running, 1, 0) != 0)
        {
            throw new InvalidOperationException("BootPipeline is already running.");
        }

        var results = new Dictionary<string, object?>(StringComparer.Ordinal);
        try
        {
            for (int index = 0; index < stages.Count; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                BootStageDefinition stage = stages[index];
                Report(stage, index, BootStageStatus.Running);

                try
                {
                    IReadOnlyDictionary<string, object?> priorResults = Snapshot(results);
                    results[stage.Id] = await stage.Run(priorResults, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception error)
                {
                    BootStageException wrapped = error is BootStageException stageError
                        && string.Equals(stageError.StageId, stage.Id, StringComparison.Ordinal)
                            ? stageError
                            : new BootStageException(
                                stage.Id,
                                stage.Label,
                                "BOOT_STAGE_FAILED",
                                error.Message,
                                innerException: error);
                    Report(stage, index, BootStageStatus.Failed, wrapped);
                    throw wrapped;
                }

                Report(stage, index, BootStageStatus.Complete);
            }

            return Snapshot(results);
        }
        finally
        {
            Volatile.Write(ref running, 0);
        }
    }

    private static IReadOnlyDictionary<string, object?> Snapshot(
        IReadOnlyDictionary<string, object?> results) =>
        new ReadOnlyDictionary<string, object?>(
            new Dictionary<string, object?>(results, StringComparer.Ordinal));

    private void Report(
        BootStageDefinition stage,
        int index,
        BootStageStatus status,
        BootStageException? error = null)
    {
        int completed = status == BootStageStatus.Complete ? index + 1 : index;
        onProgress?.Invoke(new BootProgress(
            stage.Id,
            stage.Label,
            status,
            completed,
            stages.Count,
            (double)completed / stages.Count,
            error));
    }
}

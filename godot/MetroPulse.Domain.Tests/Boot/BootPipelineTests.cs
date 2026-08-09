using MetroPulse.Domain.Boot;
using Xunit;

namespace MetroPulse.Domain.Tests.Boot;

public sealed class BootPipelineTests
{
    [Fact]
    public async Task RunAsync_RunsStagesOnceInOrderWithReadOnlyPriorResults()
    {
        var calls = new List<string>();
        var progress = new List<BootProgress>();
        var pipeline = new BootPipeline(
        [
            new("first", "First stage", (results, _) =>
            {
                calls.Add($"first:{results.Count}");
                Assert.Throws<NotSupportedException>(() =>
                    ((IDictionary<string, object?>)results).Add("unsafe", 1));
                return ValueTask.FromResult<object?>(10);
            }),
            new("second", "Second stage", (results, _) =>
            {
                calls.Add($"second:{results["first"]}");
                return ValueTask.FromResult<object?>((int)results["first"]! + 5);
            }),
        ],
        progress.Add);

        IReadOnlyDictionary<string, object?> result = await pipeline.RunAsync();

        Assert.Equal(["first:0", "second:10"], calls);
        Assert.Equal(15, result["second"]);
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, object?>)result).Add("unsafe", 1));
        Assert.Equal(
            [BootStageStatus.Running, BootStageStatus.Complete, BootStageStatus.Running, BootStageStatus.Complete],
            progress.Select(item => item.Status));
        Assert.Equal(1, progress[^1].Progress);
        Assert.False(pipeline.IsRunning);
    }

    [Fact]
    public async Task RunAsync_FailsClosedAtResponsibleStageAndAllowsRetry()
    {
        bool fail = true;
        int unsafeCalls = 0;
        var progress = new List<BootProgress>();
        var pipeline = new BootPipeline(
        [
            new("data", "Validate data", (_, _) => fail
                ? ValueTask.FromException<object?>(new InvalidOperationException("duplicate mission id"))
                : ValueTask.FromResult<object?>("valid")),
            new("runtime", "Start runtime", (_, _) =>
            {
                unsafeCalls++;
                return ValueTask.FromResult<object?>(null);
            }),
        ],
        progress.Add);

        BootStageException error = await Assert.ThrowsAsync<BootStageException>(async () =>
            await pipeline.RunAsync());

        Assert.Equal("data", error.StageId);
        Assert.Equal("BOOT_STAGE_FAILED", error.Code);
        Assert.Contains("duplicate mission id", error.Message, StringComparison.Ordinal);
        Assert.Equal(0, unsafeCalls);
        Assert.Equal(BootStageStatus.Failed, progress[^1].Status);
        Assert.False(pipeline.IsRunning);

        fail = false;
        await pipeline.RunAsync();
        Assert.Equal(1, unsafeCalls);
    }

    [Fact]
    public async Task RunAsync_RejectsConcurrentRun()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var pipeline = new BootPipeline(
        [
            new("waiting", "Waiting", async (_, _) =>
            {
                await gate.Task;
                return null;
            }),
        ]);

        ValueTask<IReadOnlyDictionary<string, object?>> firstRun = pipeline.RunAsync();
        await Assert.ThrowsAsync<InvalidOperationException>(async () => await pipeline.RunAsync());
        gate.SetResult();
        await firstRun;
    }

    [Fact]
    public void Constructor_RejectsMissingAndDuplicateStages()
    {
        Assert.Throws<ArgumentException>(() => new BootPipeline([]));
        Assert.Throws<ArgumentException>(() => new BootPipeline(
        [
            new("same", "First", (_, _) => ValueTask.FromResult<object?>(null)),
            new("same", "Second", (_, _) => ValueTask.FromResult<object?>(null)),
        ]));
    }

    [Fact]
    public void CapabilityReport_FailsActionablyAndPublishesReadOnlyChecks()
    {
        var report = new DesktopCapabilityReport(
        [
            new(DesktopCapabilityIds.GraphicsBackend, true, "Vulkan is active."),
            new(DesktopCapabilityIds.UserData, false, "The write probe failed.", "Choose a writable profile directory, then retry."),
        ]);

        Assert.False(report.Compatible);
        Assert.Single(report.Failures);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<DesktopCapabilityResult>)report.Checks).Add(
                new DesktopCapabilityResult("unsafe", true, "unsafe")));

        BootStageException error = Assert.Throws<BootStageException>(() =>
            report.AssertCompatible(BootStageIds.CapabilityChecks, "Check desktop capabilities"));
        Assert.Equal("INCOMPATIBLE_DESKTOP", error.Code);
        Assert.Equal(BootStageIds.CapabilityChecks, error.StageId);
        Assert.Equal(["Choose a writable profile directory, then retry."], error.Actions);
    }
}

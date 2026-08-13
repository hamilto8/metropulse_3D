using System.Reflection;
using System.Text.Json;
using Godot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.App;

namespace MetroPulse.Godot.Diagnostics;

/// <summary>Explicit, bounded, privacy-safe native performance capture.</summary>
public partial class PerformanceCaptureRunner : Node
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly List<DiagnosticPerformance> samples = [];
    private CompositionRoot compositionRoot = null!;
    private DiagnosticsOverlay diagnostics = null!;
    private RuntimeConfiguration configuration = null!;
    private ulong startedUsec;
    private ulong captureStartedUsec;
    private ulong nextSampleUsec;
    private int[] gcStart = [];
    private long allocatedBytesStart;
    private DiagnosticPerformance? resourceBaseline;

    public void Begin(
        CompositionRoot root,
        DiagnosticsOverlay overlay,
        RuntimeConfiguration runtimeConfiguration)
    {
        compositionRoot = root ?? throw new ArgumentNullException(nameof(root));
        diagnostics = overlay ?? throw new ArgumentNullException(nameof(overlay));
        configuration = runtimeConfiguration ?? throw new ArgumentNullException(nameof(runtimeConfiguration));
        if (configuration.PerformanceCapturePath is null)
        {
            throw new ArgumentException("Performance capture requires an output path.", nameof(runtimeConfiguration));
        }

        RenderingServer.ViewportSetMeasureRenderTime(GetViewport().GetViewportRid(), true);
        diagnostics.BeginPerformanceCapture();
        startedUsec = Time.GetTicksUsec();
        gcStart = [GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2)];
        allocatedBytesStart = GC.GetTotalAllocatedBytes(precise: false);
        SetProcess(true);
    }

    public override void _Process(double delta)
    {
        _ = delta;
        ulong now = Time.GetTicksUsec();
        double elapsed = Seconds(now - startedUsec);
        if (elapsed < configuration.PerformanceWarmupSeconds) return;

        if (captureStartedUsec == 0)
        {
            captureStartedUsec = now;
            nextSampleUsec = now;
            resourceBaseline = diagnostics.CurrentPerformance;
        }

        if (now >= nextSampleUsec)
        {
            samples.Add(diagnostics.CurrentPerformance);
            nextSampleUsec = now + 100_000;
        }

        if (Seconds(now - captureStartedUsec) >= configuration.PerformanceDurationSeconds)
        {
            Finish(now);
        }
    }

    private void Finish(ulong finishedUsec)
    {
        SetProcess(false);
        DiagnosticSnapshot finalSnapshot = diagnostics.CurrentSnapshot;
        DiagnosticPerformance final = finalSnapshot.Performance;
        DiagnosticPerformance baseline = resourceBaseline ?? final;
        var report = new
        {
            schemaVersion = 1,
            capturedAtUtc = DateTimeOffset.UtcNow.ToString("O"),
            sourceRevision = System.Environment.GetEnvironmentVariable("METROPULSE_SOURCE_REVISION") ?? "unavailable",
            applicationVersion = typeof(PerformanceCaptureRunner).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion ?? "unknown",
            engine = new
            {
                version = Engine.GetVersionInfo()["string"].AsString(),
                physicsEngine = ProjectSettings.GetSetting("physics/3d/physics_engine", "unknown").AsString(),
                physicsTicksPerSecond = Engine.PhysicsTicksPerSecond,
                nominalPhysicsStepMilliseconds = 1000d / Engine.PhysicsTicksPerSecond,
                nominalInputSamplingWorstCaseMilliseconds = 1000d / Engine.PhysicsTicksPerSecond,
                interpolation = ProjectSettings.GetSetting("physics/common/physics_interpolation", false).AsBool(),
                renderer = RenderingServer.GetCurrentRenderingDriverName(),
            },
            host = new
            {
                operatingSystem = OS.GetName(),
                distribution = OS.GetDistributionName(),
                version = OS.GetVersion(),
                architecture = Engine.GetArchitectureName(),
                processor = OS.GetProcessorName(),
                processorCount = OS.GetProcessorCount(),
                model = OS.GetModelName(),
                videoAdapter = RenderingServer.GetVideoAdapterName(),
                videoVendor = RenderingServer.GetVideoAdapterVendor(),
                videoApi = RenderingServer.GetVideoAdapterApiVersion(),
                viewport = new { width = GetViewport().GetVisibleRect().Size.X, height = GetViewport().GetVisibleRect().Size.Y },
            },
            scenario = new
            {
                bootAction = configuration.BootAction,
                quality = compositionRoot.CurrentSession?.Environment?.QualityProfile ?? "HIGH",
                featureFlags = configuration.Features.Snapshot(),
                warmupSeconds = configuration.PerformanceWarmupSeconds,
                requestedDurationSeconds = configuration.PerformanceDurationSeconds,
                measuredDurationSeconds = Seconds(finishedUsec - captureStartedUsec),
                samples = samples.Count,
            },
            load = new
            {
                bootToInteractiveMilliseconds = compositionRoot.BootToInteractiveMilliseconds,
            },
            timingMilliseconds = new
            {
                frame = Summary(sample => sample.FrameMilliseconds),
                process = Summary(sample => sample.ProcessMilliseconds),
                physics = Summary(sample => sample.PhysicsMilliseconds),
                navigation = Summary(sample => sample.NavigationMilliseconds),
                renderCpu = Summary(sample => sample.RenderCpuMilliseconds),
                renderGpu = Summary(sample => sample.RenderGpuMilliseconds),
            },
            throughput = new
            {
                fps = Summary(sample => sample.Fps),
                drawCalls = Summary(sample => sample.DrawCalls),
                primitives = Summary(sample => sample.Primitives),
                renderedObjects = Summary(sample => sample.RenderedObjects),
            },
            resources = new
            {
                sceneNodes = finalSnapshot.Counts.SceneNodes,
                worldNodes = finalSnapshot.Counts.WorldNodes,
                physicsBodies = finalSnapshot.Counts.PhysicsBodies,
                godotObjects = final.GodotObjectCount,
                resources = final.ResourceCount,
                nodes = final.NodeCount,
                orphanNodes = final.OrphanNodeCount,
                videoMemoryBytes = final.VideoMemoryBytes,
                staticMemoryBytes = final.StaticMemoryBytes,
                managedMemoryBytes = final.ManagedMemoryBytes,
                managedAllocatedBytes = Math.Max(0, final.TotalAllocatedBytes - allocatedBytesStart),
                physicsActiveObjects = final.PhysicsActiveObjects,
                physicsCollisionPairs = final.PhysicsCollisionPairs,
                physicsIslands = final.PhysicsIslandCount,
                activeAudioVoices = final.ActiveAudioVoices,
                gcCollections = new
                {
                    generation0 = final.Gen0Collections - gcStart[0],
                    generation1 = final.Gen1Collections - gcStart[1],
                    generation2 = final.Gen2Collections - gcStart[2],
                },
            },
            resourceGrowth = new
            {
                staticMemoryBytes = SignedDelta(final.StaticMemoryBytes, baseline.StaticMemoryBytes),
                managedMemoryBytes = final.ManagedMemoryBytes - baseline.ManagedMemoryBytes,
                videoMemoryBytes = SignedDelta(final.VideoMemoryBytes, baseline.VideoMemoryBytes),
                godotObjects = SignedDelta(final.GodotObjectCount, baseline.GodotObjectCount),
                resources = SignedDelta(final.ResourceCount, baseline.ResourceCount),
                nodes = SignedDelta(final.NodeCount, baseline.NodeCount),
                orphanNodes = SignedDelta(final.OrphanNodeCount, baseline.OrphanNodeCount),
            },
            gates = new
            {
                recommendedAverageFps = samples.Count > 0 && samples.Average(sample => sample.Fps) >= 60,
                minimumAverageFps = samples.Count > 0 && samples.Average(sample => sample.Fps) >= 30,
                routineFrameTime = samples.Count > 0
                    && PerformanceStatistics.Summarize(samples.Select(sample => sample.FrameMilliseconds)).P99 <= 33,
                initialLoad = compositionRoot.BootToInteractiveMilliseconds < 10_000,
            },
            availability = new
            {
                gpuTiming = samples.Any(sample => sample.RenderGpuMilliseconds > 0),
            },
        };

        string outputPath = configuration.PerformanceCapturePath!;
        string? directory = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        string temporaryPath = $"{outputPath}.tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(report, SerializerOptions));
        File.Move(temporaryPath, outputPath, overwrite: true);
        GD.Print($"phase11.performance-capture.passed path={outputPath} samples={samples.Count}");
        GetTree().Quit(0);
    }

    private PerformanceSeriesSummary Summary(Func<DiagnosticPerformance, double> selector) =>
        PerformanceStatistics.Summarize(samples.Select(selector));

    private static double Seconds(ulong microseconds) => microseconds / 1_000_000.0;

    private static long SignedDelta(ulong current, ulong baseline) => current >= baseline
        ? checked((long)(current - baseline))
        : -checked((long)(baseline - current));
}

using System.Collections.ObjectModel;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Core;

public enum SimulationStage
{
    Input,
    FixedPhysics,
    Gameplay,
    City,
    Presentation,
    Camera,
    Render,
}

public static class SimulationScheduleCatalog
{
    public const string RenderClock = "RENDER";
    public const string GameplayClock = "GAMEPLAY_REAL_TIME";
    public const string PhysicsClock = "PHYSICS_FIXED";
    public const string CityClock = "CITY_LOGICAL";
    public const string UiClock = "UI";
    public const string PausedClock = "PAUSED";

    public static readonly IReadOnlyList<string> Clocks = Array.AsReadOnly([
        RenderClock,
        GameplayClock,
        PhysicsClock,
        CityClock,
        UiClock,
        PausedClock,
    ]);

    public static readonly IReadOnlyList<SimulationStage> StageOrder = Array.AsReadOnly([
        SimulationStage.Input,
        SimulationStage.FixedPhysics,
        SimulationStage.Gameplay,
        SimulationStage.City,
        SimulationStage.Presentation,
        SimulationStage.Camera,
        SimulationStage.Render,
    ]);

    public static string ToToken(this SimulationStage stage) => stage switch
    {
        SimulationStage.FixedPhysics => "FIXED_PHYSICS",
        _ => stage.ToString().ToUpperInvariant(),
    };

    public static string GetClock(SimulationStage stage) => stage switch
    {
        SimulationStage.Input or SimulationStage.Presentation => UiClock,
        SimulationStage.FixedPhysics => PhysicsClock,
        SimulationStage.Gameplay => GameplayClock,
        SimulationStage.City => CityClock,
        SimulationStage.Camera or SimulationStage.Render => RenderClock,
        _ => throw new ArgumentOutOfRangeException(nameof(stage), stage, null),
    };
}

public sealed record SimulationClockSnapshot
{
    [JsonPropertyName("delta")]
    public required double Delta { get; init; }

    [JsonPropertyName("elapsed")]
    public required double Elapsed { get; init; }

    [JsonPropertyName("ticks")]
    public required long Ticks { get; init; }
}

public sealed record SimulationFrameStats
{
    [JsonPropertyName("physicsSteps")]
    public required int PhysicsSteps { get; init; }

    [JsonPropertyName("cityTicks")]
    public required int CityTicks { get; init; }

    [JsonPropertyName("cityTimeScale")]
    public required double CityTimeScale { get; init; }
}

public sealed record SimulationSchedulerSnapshot
{
    [JsonPropertyName("frame")]
    public required long Frame { get; init; }

    [JsonPropertyName("clockPolicy")]
    public required string ClockPolicy { get; init; }

    [JsonPropertyName("paused")]
    public required bool Paused { get; init; }

    [JsonPropertyName("gameplayActive")]
    public required bool GameplayActive { get; init; }

    [JsonPropertyName("cityActive")]
    public required bool CityActive { get; init; }

    [JsonPropertyName("fixedPhysicsStep")]
    public required double FixedPhysicsStep { get; init; }

    [JsonPropertyName("cityStep")]
    public required double CityStep { get; init; }

    [JsonPropertyName("physicsRemainder")]
    public required double PhysicsRemainder { get; init; }

    [JsonPropertyName("cityRemainder")]
    public required double CityRemainder { get; init; }

    [JsonPropertyName("lastFrame")]
    public required SimulationFrameStats LastFrame { get; init; }

    [JsonPropertyName("clocks")]
    public required IReadOnlyDictionary<string, SimulationClockSnapshot> Clocks { get; init; }
}

public sealed class SimulationFrameContext
{
    private readonly Func<IReadOnlyDictionary<string, SimulationClockSnapshot>> clocksProvider;

    internal SimulationFrameContext(Func<IReadOnlyDictionary<string, SimulationClockSnapshot>> clocksProvider) =>
        this.clocksProvider = clocksProvider;

    public long Frame { get; internal set; }

    public ClockPolicy ClockPolicy { get; internal set; }

    public double RenderDelta { get; internal set; }

    public double BoundedDelta { get; internal set; }

    public double GameplayDelta { get; internal set; }

    public double CityTimeScale { get; internal set; }

    public double PhysicsAlpha { get; internal set; }

    public SimulationStage Stage { get; internal set; }

    public string Clock { get; internal set; } = SimulationScheduleCatalog.UiClock;

    public double Delta { get; internal set; }

    public IReadOnlyDictionary<string, SimulationClockSnapshot> Clocks => clocksProvider();
}

public sealed class SimulationScheduler
{
    private const double Epsilon = 1e-9;
    private static readonly HashSet<ClockPolicy> ActiveGameplayPolicies =
        [ClockPolicy.City, ClockPolicy.Builder, ClockPolicy.Street];
    private static readonly HashSet<ClockPolicy> ActiveCityPolicies =
        [ClockPolicy.City, ClockPolicy.Builder, ClockPolicy.Street];
    private static readonly HashSet<ClockPolicy> MultipliedCityPolicies =
        [ClockPolicy.City, ClockPolicy.Builder];

    private readonly Dictionary<SimulationStage, List<ScheduledTask>> tasks =
        SimulationScheduleCatalog.StageOrder.ToDictionary(stage => stage, _ => new List<ScheduledTask>());
    private readonly HashSet<string> taskIds = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MutableClock> clocks =
        SimulationScheduleCatalog.Clocks.ToDictionary(name => name, _ => new MutableClock(), StringComparer.Ordinal);
    private readonly Func<ClockScaleContext, double> getCityTimeScale;
    private long registrationSerial;
    private double? lastTimestampMs;
    private double physicsAccumulator;
    private double cityAccumulator;

    public SimulationScheduler(
        double fixedPhysicsStep = 1d / 120d,
        double cityStep = 1,
        double maxFrameDelta = 0.1,
        int maxPhysicsStepsPerFrame = 10,
        int maxCityTicksPerFrame = 30,
        Func<ClockScaleContext, double>? getCityTimeScale = null,
        ClockPolicy initialClockPolicy = ClockPolicy.Stopped)
    {
        FixedPhysicsStep = RequirePositive(fixedPhysicsStep, nameof(fixedPhysicsStep));
        CityStep = RequirePositive(cityStep, nameof(cityStep));
        MaxFrameDelta = RequirePositive(maxFrameDelta, nameof(maxFrameDelta));
        if (maxPhysicsStepsPerFrame < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxPhysicsStepsPerFrame));
        }
        if (maxCityTicksPerFrame < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxCityTicksPerFrame));
        }
        MaxPhysicsStepsPerFrame = maxPhysicsStepsPerFrame;
        MaxCityTicksPerFrame = maxCityTicksPerFrame;
        this.getCityTimeScale = getCityTimeScale ?? (_ => 1);
        SetClockPolicy(initialClockPolicy);
    }

    public double FixedPhysicsStep { get; }

    public double CityStep { get; }

    public double MaxFrameDelta { get; }

    public int MaxPhysicsStepsPerFrame { get; }

    public int MaxCityTicksPerFrame { get; }

    public long Frame { get; private set; }

    public ClockPolicy ClockPolicy { get; private set; }

    public bool Paused => ClockPolicy == ClockPolicy.Paused;

    public bool GameplayActive => ActiveGameplayPolicies.Contains(ClockPolicy);

    public bool CityActive => ActiveCityPolicies.Contains(ClockPolicy);

    public SimulationFrameStats LastFrame { get; private set; } =
        new() { PhysicsSteps = 0, CityTicks = 0, CityTimeScale = 0 };

    public ClockPolicy SetClockPolicy(ClockPolicy clockPolicy)
    {
        if (!Enum.IsDefined(clockPolicy))
        {
            throw new ArgumentOutOfRangeException(nameof(clockPolicy));
        }
        ClockPolicy = clockPolicy;
        return ClockPolicy;
    }

    public Func<bool> RegisterTask(
        string id,
        SimulationStage stage,
        Action<double, SimulationFrameContext> update,
        double order = 0,
        Func<SimulationFrameContext, bool>? enabled = null)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Task ID is required.", nameof(id));
        if (taskIds.Contains(id)) throw new InvalidOperationException($"Simulation task already registered: {id}");
        if (!Enum.IsDefined(stage)) throw new ArgumentOutOfRangeException(nameof(stage));
        ArgumentNullException.ThrowIfNull(update);
        if (!double.IsFinite(order)) throw new ArgumentOutOfRangeException(nameof(order));

        var task = new ScheduledTask(id, update, order, enabled, registrationSerial++);
        List<ScheduledTask> stageTasks = tasks[stage];
        taskIds.Add(id);
        stageTasks.Add(task);
        stageTasks.Sort((left, right) =>
        {
            int comparison = left.Order.CompareTo(right.Order);
            return comparison != 0 ? comparison : left.Serial.CompareTo(right.Serial);
        });

        bool registered = true;
        return () =>
        {
            if (!registered) return false;
            registered = false;
            taskIds.Remove(id);
            return stageTasks.Remove(task);
        };
    }

    public double GetCityTimeScaleForPolicy()
    {
        if (!CityActive) return 0;
        double requested = getCityTimeScale(new ClockScaleContext(ClockPolicy, Frame));
        double safeScale = double.IsFinite(requested) ? Math.Max(0, requested) : 0;
        return MultipliedCityPolicies.Contains(ClockPolicy) ? safeScale : safeScale > 0 ? 1 : 0;
    }

    public SimulationFrameStats RunFrame(double timestampMs)
    {
        if (!double.IsFinite(timestampMs)) return Advance(0);
        if (!lastTimestampMs.HasValue)
        {
            lastTimestampMs = timestampMs;
            return Advance(0);
        }
        double deltaSeconds = Math.Max(0, (timestampMs - lastTimestampMs.Value) / 1000);
        lastTimestampMs = timestampMs;
        return Advance(deltaSeconds);
    }

    public void ResetFrameClock(double? timestampMs = null) =>
        lastTimestampMs = timestampMs.HasValue && double.IsFinite(timestampMs.Value) ? timestampMs : null;

    public SimulationSchedulerSnapshot AdvanceFrame(double realDeltaSeconds)
    {
        Advance(realDeltaSeconds);
        return Snapshot();
    }

    public SimulationSchedulerSnapshot Snapshot() => new()
    {
        Frame = Frame,
        ClockPolicy = ClockPolicy.ToToken(),
        Paused = Paused,
        GameplayActive = GameplayActive,
        CityActive = CityActive,
        FixedPhysicsStep = FixedPhysicsStep,
        CityStep = CityStep,
        PhysicsRemainder = physicsAccumulator,
        CityRemainder = cityAccumulator,
        LastFrame = LastFrame,
        Clocks = new ReadOnlyDictionary<string, SimulationClockSnapshot>(SnapshotClocks()),
    };

    private SimulationFrameStats Advance(double realDeltaSeconds)
    {
        double renderDelta = double.IsFinite(realDeltaSeconds) ? Math.Max(0, realDeltaSeconds) : 0;
        double boundedDelta = Math.Min(renderDelta, MaxFrameDelta);
        Frame++;
        AdvanceClock(SimulationScheduleCatalog.RenderClock, renderDelta);
        AdvanceClock(SimulationScheduleCatalog.UiClock, boundedDelta);

        var context = new SimulationFrameContext(() =>
            new ReadOnlyDictionary<string, SimulationClockSnapshot>(SnapshotClocks()))
        {
            Frame = Frame,
            ClockPolicy = ClockPolicy,
            RenderDelta = renderDelta,
            BoundedDelta = boundedDelta,
        };
        RunStage(SimulationStage.Input, boundedDelta, context);

        double gameplayDelta = GameplayActive ? boundedDelta : 0;
        double cityTimeScale = GetCityTimeScaleForPolicy();
        context.ClockPolicy = ClockPolicy;
        context.GameplayDelta = gameplayDelta;
        context.CityTimeScale = cityTimeScale;
        AdvanceClock(SimulationScheduleCatalog.GameplayClock, gameplayDelta);
        AdvanceClock(SimulationScheduleCatalog.PausedClock, Paused ? renderDelta : 0);
        clocks[SimulationScheduleCatalog.PhysicsClock].Delta = 0;
        clocks[SimulationScheduleCatalog.CityClock].Delta = 0;

        int physicsSteps = 0;
        if (gameplayDelta > 0)
        {
            physicsAccumulator += gameplayDelta;
            while (physicsAccumulator + Epsilon >= FixedPhysicsStep && physicsSteps < MaxPhysicsStepsPerFrame)
            {
                AdvanceClock(SimulationScheduleCatalog.PhysicsClock, FixedPhysicsStep);
                RunStage(SimulationStage.FixedPhysics, FixedPhysicsStep, context);
                physicsAccumulator -= FixedPhysicsStep;
                if (Math.Abs(physicsAccumulator) < Epsilon) physicsAccumulator = 0;
                physicsSteps++;
            }
        }
        context.PhysicsAlpha = Math.Min(1, physicsAccumulator / FixedPhysicsStep);

        if (gameplayDelta > 0) RunStage(SimulationStage.Gameplay, gameplayDelta, context);

        int cityTicks = 0;
        double cityDelta = gameplayDelta * cityTimeScale;
        if (cityDelta > 0)
        {
            cityAccumulator += cityDelta;
            while (cityAccumulator + Epsilon >= CityStep && cityTicks < MaxCityTicksPerFrame)
            {
                AdvanceClock(SimulationScheduleCatalog.CityClock, CityStep);
                RunStage(SimulationStage.City, CityStep, context);
                cityAccumulator -= CityStep;
                if (Math.Abs(cityAccumulator) < Epsilon) cityAccumulator = 0;
                cityTicks++;
            }
        }

        RunStage(SimulationStage.Presentation, boundedDelta, context);
        RunStage(SimulationStage.Camera, boundedDelta, context);
        RunStage(SimulationStage.Render, renderDelta, context);
        LastFrame = new SimulationFrameStats
        {
            PhysicsSteps = physicsSteps,
            CityTicks = cityTicks,
            CityTimeScale = cityTimeScale,
        };
        return LastFrame;
    }

    private void AdvanceClock(string name, double delta)
    {
        MutableClock clock = clocks[name];
        clock.Delta = delta;
        if (delta <= 0) return;
        clock.Elapsed += delta;
        clock.Ticks++;
    }

    private void RunStage(SimulationStage stage, double delta, SimulationFrameContext context)
    {
        context.Stage = stage;
        context.Clock = SimulationScheduleCatalog.GetClock(stage);
        context.Delta = delta;
        foreach (ScheduledTask task in tasks[stage].ToArray())
        {
            if (task.Enabled is not null && !task.Enabled(context)) continue;
            task.Update(delta, context);
        }
    }

    private Dictionary<string, SimulationClockSnapshot> SnapshotClocks() => clocks.ToDictionary(
        entry => entry.Key,
        entry => new SimulationClockSnapshot
        {
            Delta = entry.Value.Delta,
            Elapsed = entry.Value.Elapsed,
            Ticks = entry.Value.Ticks,
        },
        StringComparer.Ordinal);

    private static double RequirePositive(double value, string name) =>
        double.IsFinite(value) && value > 0 ? value : throw new ArgumentOutOfRangeException(name);

    private sealed class MutableClock
    {
        public double Delta { get; set; }
        public double Elapsed { get; set; }
        public long Ticks { get; set; }
    }

    private sealed record ScheduledTask(
        string Id,
        Action<double, SimulationFrameContext> Update,
        double Order,
        Func<SimulationFrameContext, bool>? Enabled,
        long Serial);
}

public sealed record ClockScaleContext(ClockPolicy ClockPolicy, long Frame);

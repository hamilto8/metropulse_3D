using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Pedestrians;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Enforcement;

/// <summary>Session adapter for player-owned Heat and bounded police response.</summary>
public partial class EnforcementRuntime : Node
{
    public const string PlayerResponseTargetId = "player";
    private PlayerControlRuntime? playerControl;
    private LivingTrafficRuntime? traffic;
    private LivingPedestrianRuntime? pedestrians;
    private GodotSessionRuntimeHost? runtime;
    private MvpWorldGenerator? world;
    private bool recoveryQueued;

    public bool Initialized { get; private set; }

    public HeatEnforcementState State { get; private set; } = HeatEnforcementState.Clear;

    public int CrimeReportCount { get; private set; }

    public int IncidentCreateCount { get; private set; }

    public int ArrestCount { get; private set; }

    public int EscapeCount { get; private set; }

    public string LastOutcome { get; private set; } = EnforcementOutcomes.None;

    public EnforcementResponseSnapshot? Response { get; private set; }

    public void Initialize(
        PlayerControlRuntime controlOwner,
        LivingTrafficRuntime trafficOwner,
        LivingPedestrianRuntime pedestrianOwner,
        GodotSessionRuntimeHost runtimeOwner,
        MvpWorldGenerator worldOwner)
    {
        if (Initialized) throw new InvalidOperationException("Enforcement is already initialized.");
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        pedestrians = pedestrianOwner ?? throw new ArgumentNullException(nameof(pedestrianOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        playerControl.VehicleHijacked += OnVehicleHijacked;
        pedestrians.PlayerVehiclePedestrianHit += OnPlayerVehiclePedestrianHit;
        ProcessPhysicsPriority = -760;
        SetPhysicsProcess(true);
        Initialized = true;
    }

    public HeatReportResult ReportCrime(
        Vector3 position,
        string reason,
        int severity,
        bool witnessed = true,
        double security = 0.65,
        string? sourceId = null)
    {
        EnsureInitialized();
        HeatReportResult result = HeatEnforcementModel.Report(
            State,
            new CrimeReport(reason, new TrafficPoint(position.X, position.Z), severity, witnessed, security, sourceId));
        State = result.State;
        CrimeReportCount += 1;
        if (result.IncidentCreated) IncidentCreateCount += 1;
        Response = traffic!.Simulation.DispatchOrUpdateEnforcement(
            PlayerResponseTargetId,
            new TrafficPoint(position.X, position.Z),
            result.RequestedResponders);
        return result;
    }

    public bool ClearResponse(string outcome = EnforcementOutcomes.None)
    {
        EnsureInitialized();
        if (!State.Wanted && Response is null) return false;
        long sequence = State.CrimeSequence;
        State = HeatEnforcementState.Clear with { CrimeSequence = sequence };
        _ = traffic!.Simulation.ClearEnforcement(PlayerResponseTargetId);
        Response = null;
        LastOutcome = outcome;
        return true;
    }

    public EnforcementAdvanceResult AdvanceObservation(EnforcementObservation observation, double delta)
    {
        EnsureInitialized();
        EnforcementAdvanceResult result = HeatEnforcementModel.Advance(State, observation, delta);
        State = result.State;
        LastOutcome = result.Outcome;
        if (result.Outcome == EnforcementOutcomes.None) return result;
        _ = traffic!.Simulation.ClearEnforcement(PlayerResponseTargetId);
        Response = null;
        if (result.Outcome == EnforcementOutcomes.Escaped) EscapeCount += 1;
        if (result.Outcome == EnforcementOutcomes.Arrested)
        {
            ArrestCount += 1;
            QueueSafeRecovery();
        }
        return result;
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized || !State.Wanted || runtime is null || playerControl is null) return;
        if (GameStateCatalog.Policies[runtime.StateMachine.State].Heat != HeatPolicy.PreserveRunning) return;
        if (playerControl.ControlledCameraTarget is not { } target) return;
        var capture = target.CaptureCameraTarget();
        var position = new TrafficPoint(capture.Position.X, capture.Position.Z);
        int requested = Math.Clamp(State.WantedTier, 1, 4);
        Response = traffic!.Simulation.DispatchOrUpdateEnforcement(
            PlayerResponseTargetId, position, requested);
        bool safe = world!.Surface.IsWithinWorldBounds(position.X, position.Z)
            && !world.Surface.IsWater(position.X, position.Z, 0.5);
        bool visible = Response.NearestDistance <= HeatEnforcementModel.DefaultConfig.EscapeDistance;
        _ = AdvanceObservation(
            new EnforcementObservation(
                PlayerResponseTargetId,
                position,
                playerControl.ControlledKind == ControlKind.Vehicle,
                Response.NearestDistance,
                visible,
                safe),
            delta);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        if (playerControl is not null) playerControl.VehicleHijacked -= OnVehicleHijacked;
        if (pedestrians is not null) pedestrians.PlayerVehiclePedestrianHit -= OnPlayerVehiclePedestrianHit;
        _ = traffic?.Simulation.ClearEnforcement(PlayerResponseTargetId);
        playerControl = null;
        traffic = null;
        pedestrians = null;
        runtime = null;
        world = null;
        Response = null;
        recoveryQueued = false;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void OnVehicleHijacked(PlayerVehicleController vehicle) => ReportCrime(
        vehicle.GlobalPosition,
        "Vehicle hijack reported",
        severity: 2,
        witnessed: true,
        security: 0.7,
        sourceId: vehicle.StableId);

    private void OnPlayerVehiclePedestrianHit(
        TrafficAgentSnapshot vehicle,
        PedestrianAgentSnapshot pedestrian) => ReportCrime(
            new Vector3((float)pedestrian.Position.X, (float)pedestrian.Position.Y, (float)pedestrian.Position.Z),
            "Hit-and-run reported",
            severity: 3,
            witnessed: true,
            security: 0.75,
            sourceId: vehicle.Id);

    private void QueueSafeRecovery()
    {
        if (recoveryQueued) return;
        recoveryQueued = true;
        Callable.From(CompleteSafeRecovery).CallDeferred();
    }

    private void CompleteSafeRecovery()
    {
        recoveryQueued = false;
        if (!Initialized || runtime is null || playerControl is null || world is null) return;
        if (runtime.StateMachine.State is GameState.StreetOnFoot or GameState.StreetVehicle)
        {
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("enforcement:arrest", Name));
        }
        runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("enforcement:safe-recovery", Name));
        double height = world.Surface.GetTerrainHeight(-75, -75);
        playerControl.Pedestrian?.SpawnAt(new Vector3(-75, (float)height, -75));
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Enforcement runtime is not initialized.");
    }
}

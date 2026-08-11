using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Vehicles;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Player;

public sealed record PlayerControlSnapshot(
    bool PedestrianExists,
    PlayerPedestrianSnapshot? PedestrianState,
    PlayerPedestrianSnapshot? SuspendedPedestrianState,
    ControlKind ControlledKind,
    string? ControlledVehicleId,
    string? PendingVehicleId,
    Vector3? PendingExitPose,
    Vector3? PendingEjectionDirection,
    double? PendingEjectionSpeed,
    IReadOnlyDictionary<string, PlayerVehicleSnapshot> VehicleStates,
    long AuthorityGeneration);

public sealed record VehicleEntryRequestResult(
    bool Allowed,
    bool ReadyForTransition,
    bool HijackInProgress,
    double RemainingDuration,
    string? Code = null);

public sealed record VehicleExitRequestResult(bool Allowed, Vector3? ExitPose = null, string? Code = null);

/// <summary>Single session authority for player-owned bodies and transactional handoff.</summary>
public partial class PlayerControlRuntime : Node, IPlayerControlTransitionBridge
{
    private readonly Dictionary<string, PlayerVehicleController> vehicles = new(StringComparer.Ordinal);
    private RuntimeInputHost? input;
    private MvpWorldGenerator? world;
    private GameContentRegistry? content;
    private Node3D? agentRoot;
    private Node3D? cameraOrigin;
    private PlayerPedestrianController? pedestrian;
    private PlayerVehicleController? controlledVehicle;
    private PlayerVehicleController? pendingVehicle;
    private PlayerPedestrianSnapshot? suspendedPedestrianState;
    private Vector3? pendingExitPose;
    private Vector3? pendingEjectionDirection;
    private double? pendingEjectionSpeed;
    private (PlayerVehicleController Vehicle, VehicleHijackProgress Progress)? hijack;

    public bool Initialized { get; private set; }

    public ControlKind ControlledKind { get; private set; }

    public int HandoffCount { get; private set; }

    public int RestoreCount { get; private set; }

    public long AuthorityGeneration { get; private set; }

    public PlayerPedestrianController? Pedestrian => pedestrian;

    public PlayerVehicleController? ControlledVehicle => controlledVehicle;

    public IReadOnlyCollection<PlayerVehicleController> Vehicles => Array.AsReadOnly(vehicles.Values.ToArray());

    public VehicleHijackProgress? HijackProgress => hijack?.Progress;

    public PlayerVehicleController? HijackTarget => hijack?.Vehicle;

    public event Action<PlayerVehicleController>? RiderEjectionPrepared;

    public event Action<PlayerVehicleController>? VehicleHijacked;

    public IGameplayCameraTarget? ControlledCameraTarget => ControlledKind switch
    {
        ControlKind.Pedestrian => pedestrian,
        ControlKind.Vehicle => controlledVehicle,
        _ => null,
    };

    public void Initialize(
        RuntimeInputHost inputHost,
        MvpWorldGenerator worldOwner,
        GameContentRegistry contentRegistry,
        Node3D agentOwner,
        Node3D cameraControlOrigin)
    {
        if (Initialized) throw new InvalidOperationException("Player control runtime is already initialized.");
        input = inputHost ?? throw new ArgumentNullException(nameof(inputHost));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        content = contentRegistry ?? throw new ArgumentNullException(nameof(contentRegistry));
        agentRoot = agentOwner ?? throw new ArgumentNullException(nameof(agentOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));
        Initialized = true;
    }

    public PlayerVehicleController SpawnVehicle(
        string stableId,
        string typeId,
        Vector3 position,
        bool authorized,
        bool occupied,
        float yaw = 0)
    {
        EnsureInitialized();
        if (string.IsNullOrWhiteSpace(stableId) || vehicles.ContainsKey(stableId))
        {
            throw new ArgumentException("Vehicle stable IDs must be non-empty and unique.", nameof(stableId));
        }
        VehicleProfileRecord profile = content!.GetVehicleProfile(typeId)
            ?? throw new ArgumentException($"Unknown vehicle profile {typeId}.", nameof(typeId));
        var vehicle = new PlayerVehicleController { Name = $"Vehicle_{stableId}" };
        agentRoot!.AddChild(vehicle);
        vehicle.Initialize(stableId, typeId, profile, input!, world!, cameraOrigin!, authorized, occupied);
        vehicle.ImpactReported += OnVehicleImpactReported;
        vehicle.SpawnAt(position, yaw);
        vehicles.Add(stableId, vehicle);
        return vehicle;
    }

    public bool RemoveVehicle(string stableId)
    {
        EnsureInitialized();
        if (!vehicles.TryGetValue(stableId, out PlayerVehicleController? vehicle)
            || ReferenceEquals(vehicle, controlledVehicle)
            || ReferenceEquals(vehicle, pendingVehicle)
            || ReferenceEquals(vehicle, hijack?.Vehicle)) return false;
        vehicles.Remove(stableId);
        vehicle.ImpactReported -= OnVehicleImpactReported;
        vehicle.Free();
        return true;
    }

    public VehicleEntryRequestResult BeginVehicleEntry(PlayerVehicleController vehicle)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(vehicle);
        if (ControlledKind != ControlKind.Pedestrian || pedestrian is null || !vehicles.ContainsKey(vehicle.StableId))
        {
            return new VehicleEntryRequestResult(false, false, false, 0, "PEDESTRIAN_CONTROL_REQUIRED");
        }
        double distance = pedestrian.GlobalPosition.DistanceTo(vehicle.GlobalPosition);
        VehicleEntryDecision decision = VehiclePossessionModel.EvaluateEntry(
            distance,
            vehicle.Gameplay.Occupied,
            vehicle.Gameplay.Authorized,
            vehicle.GroundedWheelCount > 0);
        if (!decision.Allowed)
        {
            return new VehicleEntryRequestResult(false, false, false, 0, decision.Code);
        }
        if (decision.RequiresHijack)
        {
            hijack = (vehicle, new VehicleHijackProgress(0, false, false));
            return new VehicleEntryRequestResult(true, false, true, decision.RequiredDuration);
        }
        pendingVehicle = vehicle;
        return new VehicleEntryRequestResult(true, true, false, 0);
    }

    public VehicleEntryRequestResult AdvanceHijack(double delta, bool remainsEligible)
    {
        EnsureInitialized();
        if (hijack is not { } active)
        {
            return new VehicleEntryRequestResult(false, false, false, 0, "HIJACK_NOT_ACTIVE");
        }
        VehicleHijackProgress progress = VehiclePossessionModel.AdvanceHijack(active.Progress, delta, remainsEligible);
        hijack = (active.Vehicle, progress);
        if (progress.Canceled)
        {
            hijack = null;
            return new VehicleEntryRequestResult(false, false, false, 0, progress.Code);
        }
        if (progress.Completed)
        {
            active.Vehicle.MarkHijacked();
            pendingVehicle = active.Vehicle;
            hijack = null;
            VehicleHijacked?.Invoke(active.Vehicle);
            return new VehicleEntryRequestResult(true, true, false, 0);
        }
        return new VehicleEntryRequestResult(
            true,
            false,
            true,
            Math.Max(0, VehiclePossessionModel.DefaultConfig.HijackDuration - progress.Elapsed));
    }

    public bool IsHijackEligible()
    {
        if (hijack is not { } active || ControlledKind != ControlKind.Pedestrian || pedestrian is null) return false;
        return pedestrian.GlobalPosition.DistanceTo(active.Vehicle.GlobalPosition)
                <= VehiclePossessionModel.DefaultConfig.MaximumEntryDistance
            && active.Vehicle.GroundedWheelCount > 0;
    }

    public void ApplyWeatherGrip(string? weatherMode)
    {
        EnsureInitialized();
        double grip = content!.GetWeather(weatherMode ?? string.Empty)?.GripMultiplier
            ?? content.GetWeather(content.DefaultWeatherMode)?.GripMultiplier
            ?? 1;
        foreach (PlayerVehicleController vehicle in vehicles.Values) vehicle.SetGripMultiplier(grip);
    }

    public VehicleExitRequestResult RequestVehicleExit()
    {
        EnsureInitialized();
        if (ControlledKind != ControlKind.Vehicle || controlledVehicle is null)
        {
            return new VehicleExitRequestResult(false, Code: "VEHICLE_CONTROL_REQUIRED");
        }
        bool poseSafe = controlledVehicle.TryGetExitPose(out Vector3 pose);
        double speed = new Vector2(controlledVehicle.LinearVelocity.X, controlledVehicle.LinearVelocity.Z).Length();
        VehicleExitDecision decision = VehiclePossessionModel.EvaluateExit(
            speed,
            controlledVehicle.Rotation.Z,
            controlledVehicle.GroundedWheelCount > 0,
            poseSafe);
        if (!decision.Allowed) return new VehicleExitRequestResult(false, Code: decision.Code);
        pendingExitPose = pose;
        return new VehicleExitRequestResult(true, pose);
    }

    public TransitionContext SnapshotContext() => new(
        ControlledEntityCount: ControlledKind == ControlKind.None ? 0 : 1,
        ControlledEntityKind: ControlledKind);

    public object CaptureSourceState() => new PlayerControlSnapshot(
        pedestrian is not null,
        pedestrian?.CaptureState(),
        suspendedPedestrianState,
        ControlledKind,
        controlledVehicle?.StableId,
        pendingVehicle?.StableId,
        pendingExitPose,
        pendingEjectionDirection,
        pendingEjectionSpeed,
        vehicles.ToDictionary(pair => pair.Key, pair => pair.Value.CaptureState(), StringComparer.Ordinal),
        AuthorityGeneration);

    public TransitionPhaseResult Handoff(TransitionRuntimeContext context)
    {
        EnsureInitialized();
        ControlPolicy policy = GameStateCatalog.Policies[context.To].Control;
        switch (policy)
        {
            case ControlPolicy.RequirePedestrian:
                return HandoffToPedestrian();
            case ControlPolicy.RequireVehicle:
                return HandoffToVehicle();
            case ControlPolicy.RequireNone:
                pedestrian?.SetControlled(false);
                if (controlledVehicle is not null)
                {
                    controlledVehicle.SetSimulationSuspended(false);
                    if (controlledVehicle.SetControlled(false)) AuthorityGeneration++;
                    controlledVehicle = null;
                }
                ControlledKind = ControlKind.None;
                break;
            case ControlPolicy.Suspend:
                controlledVehicle?.SetSimulationSuspended(true);
                break;
            case ControlPolicy.Preserve:
                break;
            default:
                return new TransitionPhaseResult(false, "CONTROL_POLICY_UNSUPPORTED", $"Control policy {policy} is not implemented.");
        }
        HandoffCount++;
        return new TransitionPhaseResult();
    }

    public void RestoreSourceState(object? sourceState)
    {
        EnsureInitialized();
        if (sourceState is not PlayerControlSnapshot snapshot)
        {
            throw new InvalidOperationException("Player control source snapshot is unavailable.");
        }
        if (!snapshot.PedestrianExists)
        {
            if (pedestrian is not null)
            {
                pedestrian.Free();
                pedestrian = null;
            }
        }
        else
        {
            PlayerPedestrianController avatar = EnsurePedestrian();
            avatar.RestoreState(snapshot.PedestrianState
                ?? throw new InvalidOperationException("Pedestrian source state is unavailable."));
        }
        foreach ((string id, PlayerVehicleSnapshot state) in snapshot.VehicleStates)
        {
            if (vehicles.TryGetValue(id, out PlayerVehicleController? vehicle)) vehicle.RestoreState(state);
        }
        suspendedPedestrianState = snapshot.SuspendedPedestrianState;
        ControlledKind = snapshot.ControlledKind;
        controlledVehicle = ResolveVehicle(snapshot.ControlledVehicleId);
        pendingVehicle = ResolveVehicle(snapshot.PendingVehicleId);
        pendingExitPose = snapshot.PendingExitPose;
        pendingEjectionDirection = snapshot.PendingEjectionDirection;
        pendingEjectionSpeed = snapshot.PendingEjectionSpeed;
        AuthorityGeneration = snapshot.AuthorityGeneration;
        RestoreCount++;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        if (pedestrian is not null && GodotObject.IsInstanceValid(pedestrian))
        {
            pedestrian.Free();
            pedestrian = null;
        }
        foreach (PlayerVehicleController vehicle in vehicles.Values)
        {
            vehicle.ImpactReported -= OnVehicleImpactReported;
            if (GodotObject.IsInstanceValid(vehicle)) vehicle.Free();
        }
        vehicles.Clear();
        controlledVehicle = null;
        pendingVehicle = null;
        suspendedPedestrianState = null;
        pendingExitPose = null;
        pendingEjectionDirection = null;
        pendingEjectionSpeed = null;
        hijack = null;
        ControlledKind = ControlKind.None;
        input = null;
        world = null;
        content = null;
        agentRoot = null;
        cameraOrigin = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private TransitionPhaseResult HandoffToPedestrian()
    {
        PlayerPedestrianController avatar = EnsurePedestrian();
        if (ControlledKind == ControlKind.Vehicle)
        {
            if (controlledVehicle is null || pendingExitPose is not Vector3 exitPose)
            {
                return new TransitionPhaseResult(false, "VEHICLE_EXIT_NOT_PREPARED", "A safe vehicle exit pose must be accepted before returning on foot.");
            }
            if (controlledVehicle.SetControlled(false)) AuthorityGeneration++;
            controlledVehicle.SetSimulationSuspended(false);
            controlledVehicle = null;
            if (suspendedPedestrianState is not null) avatar.RestoreState(suspendedPedestrianState);
            avatar.SpawnAt(exitPose, suspendedPedestrianState?.Heading ?? 0);
            if (pendingEjectionDirection is Vector3 direction && pendingEjectionSpeed is double speed)
            {
                avatar.ApplyVehicleImpact(direction, speed);
            }
            suspendedPedestrianState = null;
            pendingExitPose = null;
            pendingEjectionDirection = null;
            pendingEjectionSpeed = null;
        }
        avatar.SetControlled(true);
        ControlledKind = ControlKind.Pedestrian;
        HandoffCount++;
        return new TransitionPhaseResult();
    }

    private TransitionPhaseResult HandoffToVehicle()
    {
        if (controlledVehicle is not null && ControlledKind == ControlKind.Vehicle)
        {
            controlledVehicle.SetSimulationSuspended(false);
            HandoffCount++;
            return new TransitionPhaseResult();
        }
        if (pendingVehicle is null)
        {
            return new TransitionPhaseResult(false, "VEHICLE_ENTRY_NOT_PREPARED", "A validated vehicle entry must be prepared before vehicle control transfer.");
        }
        PlayerPedestrianController avatar = EnsurePedestrian();
        suspendedPedestrianState = avatar.CaptureState();
        avatar.SetControlled(false);
        controlledVehicle = pendingVehicle;
        pendingVehicle = null;
        controlledVehicle.SetSimulationSuspended(false);
        if (controlledVehicle.SetControlled(true)) AuthorityGeneration++;
        ControlledKind = ControlKind.Vehicle;
        HandoffCount++;
        return new TransitionPhaseResult();
    }

    private PlayerPedestrianController EnsurePedestrian()
    {
        if (pedestrian is not null && GodotObject.IsInstanceValid(pedestrian)) return pedestrian;
        pedestrian = new PlayerPedestrianController { Name = "PlayerPedestrian" };
        agentRoot!.AddChild(pedestrian);
        pedestrian.Initialize(input!, world!, cameraOrigin!);
        pedestrian.SpawnAt(new Vector3(0, 0, 0));
        return pedestrian;
    }

    private PlayerVehicleController? ResolveVehicle(string? id) =>
        id is not null && vehicles.TryGetValue(id, out PlayerVehicleController? vehicle) ? vehicle : null;

    private void OnVehicleImpactReported(
        PlayerVehicleController vehicle,
        VehicleImpactDecision decision,
        Vector3 direction)
    {
        if (!decision.EjectRider || ControlledKind != ControlKind.Vehicle
            || !ReferenceEquals(vehicle, controlledVehicle)
            || !vehicle.TryGetRecoveryExitPose(out Vector3 pose)) return;
        pendingExitPose = pose;
        pendingEjectionDirection = direction;
        pendingEjectionSpeed = vehicle.LastImpactSpeed;
        RiderEjectionPrepared?.Invoke(vehicle);
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Player control runtime is not initialized.");
    }
}

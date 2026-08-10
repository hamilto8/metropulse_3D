using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Player;

public sealed record PlayerControlSnapshot(
    bool PedestrianExists,
    PlayerPedestrianSnapshot? PedestrianState,
    ControlKind ControlledKind);

/// <summary>Single session authority for player-owned bodies and transactional handoff.</summary>
public partial class PlayerControlRuntime : Node, IPlayerControlTransitionBridge
{
    private RuntimeInputHost? input;
    private MvpWorldGenerator? world;
    private Node3D? agentRoot;
    private Node3D? cameraOrigin;
    private PlayerPedestrianController? pedestrian;

    public bool Initialized { get; private set; }

    public ControlKind ControlledKind { get; private set; }

    public int HandoffCount { get; private set; }

    public int RestoreCount { get; private set; }

    public PlayerPedestrianController? Pedestrian => pedestrian;

    public IGameplayCameraTarget? ControlledCameraTarget => ControlledKind == ControlKind.Pedestrian
        ? pedestrian
        : null;

    public void Initialize(
        RuntimeInputHost inputHost,
        MvpWorldGenerator worldOwner,
        Node3D agentOwner,
        Node3D cameraControlOrigin)
    {
        if (Initialized) throw new InvalidOperationException("Player control runtime is already initialized.");
        input = inputHost ?? throw new ArgumentNullException(nameof(inputHost));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        agentRoot = agentOwner ?? throw new ArgumentNullException(nameof(agentOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));
        Initialized = true;
    }

    public TransitionContext SnapshotContext() => new(
        ControlledEntityCount: ControlledKind == ControlKind.None ? 0 : 1,
        ControlledEntityKind: ControlledKind);

    public object CaptureSourceState() => new PlayerControlSnapshot(
        pedestrian is not null,
        pedestrian?.CaptureState(),
        ControlledKind);

    public TransitionPhaseResult Handoff(TransitionRuntimeContext context)
    {
        EnsureInitialized();
        ControlPolicy policy = GameStateCatalog.Policies[context.To].Control;
        switch (policy)
        {
            case ControlPolicy.RequirePedestrian:
                PlayerPedestrianController avatar = EnsurePedestrian();
                avatar.SetControlled(true);
                ControlledKind = ControlKind.Pedestrian;
                break;
            case ControlPolicy.RequireNone:
                pedestrian?.SetControlled(false);
                ControlledKind = ControlKind.None;
                break;
            case ControlPolicy.Suspend:
            case ControlPolicy.Preserve:
                break;
            case ControlPolicy.RequireVehicle:
                return new TransitionPhaseResult(false, "VEHICLE_RUNTIME_UNAVAILABLE", "Vehicle control is not available until the next Phase 5 slice.");
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
        ControlledKind = snapshot.ControlledKind;
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
        ControlledKind = ControlKind.None;
        input = null;
        world = null;
        agentRoot = null;
        cameraOrigin = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private PlayerPedestrianController EnsurePedestrian()
    {
        if (pedestrian is not null && GodotObject.IsInstanceValid(pedestrian)) return pedestrian;
        pedestrian = new PlayerPedestrianController { Name = "PlayerPedestrian" };
        agentRoot!.AddChild(pedestrian);
        pedestrian.Initialize(input!, world!, cameraOrigin!);
        pedestrian.SpawnAt(new Vector3(0, 0, 0));
        return pedestrian;
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Player control runtime is not initialized.");
    }
}

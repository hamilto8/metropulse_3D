using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Vehicles;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Vehicles;

namespace MetroPulse.Godot.Player;

/// <summary>Publishes vehicle possession and exit through the shared deterministic priority service.</summary>
public partial class PlayerVehicleInteractionPublisher : Node
{
    public const int InteractionPhysicsPriority = -800;
    private PlayerControlRuntime? playerControl;
    private GodotSessionRuntimeHost? runtime;
    private RuntimeInputHost? input;
    private Func<bool>? unregisterProvider;

    public bool Initialized { get; private set; }

    public InteractionService Service { get; private set; } = null!;

    public void Initialize(
        PlayerControlRuntime controlOwner,
        GodotSessionRuntimeHost runtimeOwner,
        RuntimeInputHost inputOwner)
    {
        if (Initialized) throw new InvalidOperationException("Vehicle interaction publisher is already initialized.");
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        Service = new InteractionService(() => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["gameState"] = runtime.StateMachine.State.ToToken(),
            ["controlledKind"] = playerControl.ControlledKind.ToString(),
        });
        unregisterProvider = Service.RegisterProvider("player-vehicle", PublishCandidates);
        ProcessPhysicsPriority = InteractionPhysicsPriority;
        SetPhysicsProcess(true);
        Initialized = true;
    }

    public InteractionSnapshot Refresh() => Service.Refresh();

    public InteractionResolution ResolvePrimary() => Service.ResolvePrimary();

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized || input is null || playerControl is null || runtime is null) return;
        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        if (!snapshot.Suspended && snapshot.JustPressed.Contains("INTERACT"))
        {
            _ = Service.ResolvePrimary();
        }
        if (runtime.StateMachine.State == GameState.StreetOnFoot && playerControl.HijackProgress?.Completed == false)
        {
            VehicleEntryRequestResult progress = playerControl.AdvanceHijack(delta, playerControl.IsHijackEligible());
            if (progress.ReadyForTransition)
            {
                runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("interaction:hijack", Name));
            }
        }
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unregisterProvider?.Invoke();
        unregisterProvider = null;
        Service.Clear();
        SetPhysicsProcess(false);
        playerControl = null;
        runtime = null;
        input = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private IEnumerable<InteractionCandidateInput> PublishCandidates(IReadOnlyDictionary<string, object?> context)
    {
        _ = context;
        if (playerControl is null || runtime is null) return Array.Empty<InteractionCandidateInput>();
        if (playerControl.ControlledKind == ControlKind.Vehicle && playerControl.ControlledVehicle is { } controlled)
        {
            bool poseSafe = controlled.TryGetExitPose(out _);
            VehicleExitDecision exit = VehiclePossessionModel.EvaluateExit(
                new Vector2(controlled.LinearVelocity.X, controlled.LinearVelocity.Z).Length(),
                controlled.Rotation.Z,
                controlled.GroundedWheelCount > 0,
                poseSafe);
            return
            [
                new InteractionCandidateInput
                {
                    Id = $"vehicle-exit:{controlled.StableId}",
                    Kind = "VEHICLE_EXIT",
                    Priority = InteractionPriorities.ControlledEntityExit,
                    Prompt = $"Exit {controlled.TypeId}",
                    AccessibilityLabel = $"Exit controlled {controlled.TypeId} vehicle",
                    Distance = 0,
                    Eligibility = new InteractionEligibility(exit.Allowed, exit.Code),
                    FailureReason = exit.Code,
                    Metadata = Metadata(controlled, "Returns this vehicle to AI control."),
                    Action = _ => ExitControlledVehicle(),
                },
            ];
        }
        if (playerControl.ControlledKind != ControlKind.Pedestrian || playerControl.Pedestrian is not { } pedestrian)
        {
            return Array.Empty<InteractionCandidateInput>();
        }
        return playerControl.Vehicles.Select(vehicle =>
        {
            double distance = pedestrian.GlobalPosition.DistanceTo(vehicle.GlobalPosition);
            VehicleEntryDecision entry = VehiclePossessionModel.EvaluateEntry(
                distance,
                vehicle.Gameplay.Occupied,
                vehicle.Gameplay.Authorized,
                vehicle.GroundedWheelCount > 0);
            bool hijack = vehicle.Gameplay.Occupied && !vehicle.Gameplay.Authorized;
            return new InteractionCandidateInput
            {
                Id = $"vehicle-{(hijack ? "hijack" : "enter")}:{vehicle.StableId}",
                Kind = hijack ? "VEHICLE_HIJACK" : "VEHICLE_ENTER",
                Priority = InteractionPriorities.VehicleHijack,
                Prompt = $"{(hijack ? "Hijack" : "Enter")} {vehicle.TypeId}",
                AccessibilityLabel = $"{(hijack ? "Hijack occupied" : "Enter")} {vehicle.TypeId} vehicle",
                Distance = distance,
                Eligibility = new InteractionEligibility(entry.Allowed, entry.Code),
                FailureReason = entry.Code,
                Metadata = Metadata(
                    vehicle,
                    hijack
                        ? $"Requires a {entry.RequiredDuration:F2} second approach before authority changes."
                        : "Transfers pedestrian, camera, and input authority to this vehicle."),
                Action = _ => EnterVehicle(vehicle),
            };
        }).ToArray();
    }

    private object EnterVehicle(PlayerVehicleController vehicle)
    {
        VehicleEntryRequestResult entry = playerControl!.BeginVehicleEntry(vehicle);
        if (entry.ReadyForTransition)
        {
            runtime!.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("interaction:enter", Name));
        }
        return entry;
    }

    private object ExitControlledVehicle()
    {
        VehicleExitRequestResult exit = playerControl!.RequestVehicleExit();
        if (exit.Allowed)
        {
            runtime!.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("interaction:exit", Name));
        }
        return exit;
    }

    private static IReadOnlyDictionary<string, object?> Metadata(
        PlayerVehicleController vehicle,
        string consequence) => new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["stableId"] = vehicle.StableId,
            ["typeId"] = vehicle.TypeId,
            ["consequence"] = consequence,
        };
}

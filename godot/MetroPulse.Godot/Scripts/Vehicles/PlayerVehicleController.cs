using Godot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Vehicles;

public sealed record PlayerVehicleSnapshot(
    Transform3D Transform,
    Vector3 LinearVelocity,
    Vector3 AngularVelocity,
    bool Controlled,
    bool SimulationSuspended,
    bool Authorized,
    bool Occupied,
    bool AiActive,
    long AuthorityGeneration,
    int AiHandoffs,
    double GripMultiplier);

/// <summary>Production profile-driven custom raycast chassis selected by ADR 0001.</summary>
public partial class PlayerVehicleController : RigidBody3D, IGameplayCameraTarget
{
    public const int VehiclePhysicsPriority = -850;
    private readonly List<VehicleWheelComponent> wheels = [];
    private RuntimeInputHost? input;
    private MvpWorldGenerator? world;
    private Node3D? cameraOrigin;
    private VehicleProfile? profile;
    private VehiclePhysicsLayout? layout;
    private VehiclePrototypeControl control = new(0, 0, 0);
    private Vector3 suspendedLinearVelocity;
    private Vector3 suspendedAngularVelocity;
    private double gripMultiplier = 1;
    private int groundedWheelCount;

    public bool Initialized { get; private set; }

    public string StableId { get; private set; } = string.Empty;

    public string TypeId { get; private set; } = string.Empty;

    public bool Controlled => Gameplay.PlayerControlled;

    public bool SimulationSuspended { get; private set; }

    public int GroundedWheelCount => groundedWheelCount;

    public int WheelCount => wheels.Count;

    public double GripMultiplier => gripMultiplier;

    public VehicleVisualComponent Visual { get; private set; } = null!;

    public VehicleLightsComponent Lights { get; private set; } = null!;

    public VehicleOccupantComponent Occupant { get; private set; } = null!;

    public VehicleAudioComponent Audio { get; private set; } = null!;

    public VehicleGameplayStateComponent Gameplay { get; private set; } = null!;

    public VehicleProfile Profile => profile ?? throw new InvalidOperationException("Vehicle profile is unavailable.");

    public void Initialize(
        string stableId,
        string typeId,
        VehicleProfileRecord record,
        RuntimeInputHost inputHost,
        MvpWorldGenerator worldOwner,
        Node3D cameraControlOrigin,
        bool authorized,
        bool occupied)
    {
        if (Initialized) throw new InvalidOperationException("Vehicle controller is already initialized.");
        if (string.IsNullOrWhiteSpace(stableId)) throw new ArgumentException("A stable vehicle ID is required.", nameof(stableId));
        if (string.IsNullOrWhiteSpace(typeId)) throw new ArgumentException("A vehicle type ID is required.", nameof(typeId));
        ArgumentNullException.ThrowIfNull(record);
        StableId = stableId;
        TypeId = typeId;
        profile = record.Profile ?? throw new ArgumentException("Vehicle profile is unavailable.", nameof(record));
        layout = record.PhysicsLayout ?? throw new ArgumentException("Vehicle physics layout is unavailable.", nameof(record));
        input = inputHost ?? throw new ArgumentNullException(nameof(inputHost));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));
        PlayerVehicleDynamics dynamics = profile.PlayerDynamics
            ?? throw new ArgumentException("Vehicle dynamics are unavailable.", nameof(record));

        Mass = (float)profile.Mass;
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Traffic;
        CollisionMask = (uint)CollisionMasks.Traffic;
        ContinuousCd = true;
        CanSleep = false;
        AngularDamp = (float)dynamics.AngularDamping;
        AxisLockAngularX = dynamics.AngularFactor?.X == 0;
        AxisLockAngularY = dynamics.AngularFactor?.Y == 0;
        AxisLockAngularZ = dynamics.AngularFactor?.Z == 0;
        CenterOfMassMode = CenterOfMassModeEnum.Custom;
        CenterOfMass = new Vector3(0, (float)-Math.Max(0.12, profile.Height * 0.18), 0);
        ProcessPhysicsPriority = VehiclePhysicsPriority;

        AddChild(new CollisionShape3D
        {
            Name = "ChassisCollision",
            Position = new Vector3(0, (float)layout.ChassisShapeOffsetY, 0),
            Shape = new BoxShape3D { Size = new Vector3((float)profile.Width, (float)profile.Height, (float)profile.Length) },
        });
        Visual = new VehicleVisualComponent { Name = "VisualBody" };
        AddChild(Visual);
        Visual.Initialize(typeId, profile, layout);
        BuildWheels(dynamics);
        Lights = new VehicleLightsComponent { Name = "Lights" };
        AddChild(Lights);
        Lights.Initialize(typeId, profile);
        Occupant = new VehicleOccupantComponent { Name = "Occupant" };
        AddChild(Occupant);
        Occupant.Initialize(typeId, profile);
        Audio = new VehicleAudioComponent { Name = "Audio" };
        AddChild(Audio);
        Audio.Initialize();
        Gameplay = new VehicleGameplayStateComponent { Name = "GameplayState" };
        AddChild(Gameplay);
        Gameplay.Initialize(authorized, occupied);
        SetPhysicsProcess(true);
        Initialized = true;
    }

    public void SpawnAt(Vector3 desiredPosition, float yaw = 0)
    {
        EnsureInitialized();
        double surface = world!.Surface.GetTerrainHeight(desiredPosition.X, desiredPosition.Z);
        GlobalPosition = new Vector3(desiredPosition.X, (float)(surface + layout!.SettledRideHeight + 0.25), desiredPosition.Z);
        Rotation = new Vector3(0, float.IsFinite(yaw) ? yaw : 0, 0);
        LinearVelocity = Vector3.Zero;
        AngularVelocity = Vector3.Zero;
        ResetPhysicsInterpolation();
    }

    public bool SetControlled(bool controlled)
    {
        EnsureInitialized();
        bool changed = Gameplay.SetPlayerControlled(controlled);
        if (!controlled) control = new VehiclePrototypeControl(0, 0, 0, gripMultiplier);
        return changed;
    }

    public void MarkHijacked() => Gameplay.MarkHijacked();

    public void SetGripMultiplier(double value)
    {
        gripMultiplier = Math.Clamp(double.IsFinite(value) ? value : 1, 0.1, 1.5);
        control = control with { GripMultiplier = gripMultiplier };
    }

    public void ApplyControl(VehiclePrototypeControl next)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(next);
        control = next with
        {
            Throttle = Math.Clamp(double.IsFinite(next.Throttle) ? next.Throttle : 0, -1, 1),
            Brake = Math.Clamp(double.IsFinite(next.Brake) ? next.Brake : 0, 0, 1),
            Steering = Math.Clamp(double.IsFinite(next.Steering) ? next.Steering : 0, -1, 1),
            GripMultiplier = gripMultiplier,
        };
    }

    public void SetSimulationSuspended(bool suspended)
    {
        EnsureInitialized();
        if (SimulationSuspended == suspended) return;
        SimulationSuspended = suspended;
        if (suspended)
        {
            suspendedLinearVelocity = LinearVelocity;
            suspendedAngularVelocity = AngularVelocity;
            Freeze = true;
        }
        else
        {
            Freeze = false;
            LinearVelocity = suspendedLinearVelocity;
            AngularVelocity = suspendedAngularVelocity;
        }
    }

    public PlayerVehicleSnapshot CaptureState() => new(
        GlobalTransform,
        LinearVelocity,
        AngularVelocity,
        Controlled,
        SimulationSuspended,
        Gameplay.Authorized,
        Gameplay.Occupied,
        Gameplay.AiActive,
        Gameplay.AuthorityGeneration,
        Gameplay.AiHandoffCount,
        gripMultiplier);

    public void RestoreState(PlayerVehicleSnapshot snapshot)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(snapshot);
        Freeze = false;
        GlobalTransform = snapshot.Transform;
        LinearVelocity = snapshot.LinearVelocity;
        AngularVelocity = snapshot.AngularVelocity;
        gripMultiplier = snapshot.GripMultiplier;
        Gameplay.Restore(
            snapshot.Authorized,
            snapshot.Occupied,
            snapshot.Controlled,
            snapshot.AiActive,
            snapshot.AuthorityGeneration,
            snapshot.AiHandoffs);
        SimulationSuspended = false;
        if (snapshot.SimulationSuspended) SetSimulationSuspended(true);
        ResetPhysicsInterpolation();
    }

    public GameplayCameraTargetSnapshot CaptureCameraTarget()
    {
        Vector3 forward = -GlobalBasis.Z;
        return new GameplayCameraTargetSnapshot(
            StableId,
            CameraTargetTypes.Vehicle,
            GlobalPosition,
            Math.Atan2(forward.X, forward.Z),
            new Vector2(LinearVelocity.X, LinearVelocity.Z).Length(),
            HasPhysicsVehicle: true,
            UserControlled: Controlled);
    }

    public bool TryGetExitPose(out Vector3 pose)
    {
        EnsureInitialized();
        Vector3 candidate = GlobalPosition + (GlobalBasis.X.Normalized() * (float)(Profile.Width * 0.5 + 1));
        double terrain = world!.Surface.GetTerrainHeight(candidate.X, candidate.Z);
        candidate.Y = (float)terrain + 0.95f;
        bool safe = world.Surface.IsWithinWorldBounds(candidate.X, candidate.Z)
            && !world.Surface.IsWater(candidate.X, terrain, candidate.Z);
        pose = candidate;
        return safe;
    }

    public override void _PhysicsProcess(double delta)
    {
        _ = delta;
        if (!Initialized || SimulationSuspended) return;
        if (Controlled && input is not null)
        {
            RuntimeInputSnapshot snapshot = input.LatestSnapshot;
            if (!snapshot.Suspended && snapshot.Context == ControlContexts.Vehicle)
            {
                control = ReadControl(snapshot) with { GripMultiplier = gripMultiplier };
            }
        }
        ApplyVehicleForces();
    }

    public override void _ExitTree()
    {
        SetPhysicsProcess(false);
        input = null;
        world = null;
        cameraOrigin = null;
        Initialized = false;
    }

    private void BuildWheels(PlayerVehicleDynamics dynamics)
    {
        float track = (float)(Profile.Width * dynamics.WheelTrackFactor);
        double[] axles = Profile.WheelCount >= 6
            ? [-Profile.Length * 0.36, Profile.Length * 0.05, Profile.Length * 0.36]
            : [-Profile.Length * 0.32, Profile.Length * 0.32];
        int index = 0;
        foreach (double axle in axles)
        {
            bool front = index == 0;
            foreach (bool left in new[] { true, false })
            {
                bool driven = dynamics.DrivenAxle == "all" || (!front && dynamics.DrivenAxle == "rear");
                var wheel = new VehicleWheelComponent { Name = $"Wheel{wheels.Count + 1}" };
                AddChild(wheel);
                wheel.Initialize(
                    new Vector3(left ? -track : track, (float)layout!.WheelConnectionY, (float)axle),
                    front,
                    driven,
                    Profile.WheelRadius,
                    Profile.SuspensionRestLength);
                wheels.Add(wheel);
            }
            index++;
        }
    }

    private VehiclePrototypeControl ReadControl(RuntimeInputSnapshot snapshot)
    {
        double left = Slot(snapshot, "DRIVE", 0) + Slot(snapshot, "DRIVE", 2);
        double right = Slot(snapshot, "DRIVE", 1) + Slot(snapshot, "DRIVE", 3);
        double steering = Math.Clamp(right - left + snapshot.LeftStick.X, -1, 1);
        double throttle = Math.Max(snapshot.Actions.GetValueOrDefault("THROTTLE"), snapshot.RightTrigger);
        double brakeInput = Math.Max(snapshot.Actions.GetValueOrDefault("BRAKE"), snapshot.LeftTrigger);
        double signedSpeed = LinearVelocity.Dot(-GlobalBasis.Z);
        double brake = brakeInput;
        if (brakeInput > RuntimeInputState.PressedThreshold && signedSpeed < 0.5)
        {
            throttle = -brakeInput;
            brake = 0;
        }
        if (snapshot.Actions.GetValueOrDefault("HANDBRAKE") > RuntimeInputState.PressedThreshold) brake = 1;
        return new VehiclePrototypeControl(throttle, brake, steering, gripMultiplier);
    }

    private void ApplyVehicleForces()
    {
        VehicleDriveProfile drive = Profile.Drive!;
        PlayerVehicleDynamics dynamics = Profile.PlayerDynamics!;
        groundedWheelCount = 0;
        Vector3 up = GlobalBasis.Y.Normalized();
        Vector3 chassisForward = -GlobalBasis.Z.Normalized();
        double signedSpeed = LinearVelocity.Dot(chassisForward);
        double requestedForce = control.Throttle >= 0
            ? control.Throttle * drive.ForwardEngineForce
            : control.Throttle * drive.ReverseEngineForce;
        if ((signedSpeed >= drive.MaxForwardSpeed && requestedForce > 0)
            || (signedSpeed <= -drive.MaxReverseSpeed && requestedForce < 0)) requestedForce = 0;

        foreach (VehicleWheelComponent wheel in wheels)
        {
            wheel.Probe.ForceRaycastUpdate();
            if (!wheel.Probe.IsColliding()) continue;
            groundedWheelCount++;
            Vector3 worldOffset = wheel.GlobalPosition - GlobalPosition;
            double contactDistance = wheel.GlobalPosition.DistanceTo(wheel.Probe.GetCollisionPoint());
            double suspensionLength = Math.Max(0, contactDistance - Profile.WheelRadius);
            double compression = Math.Max(0, Profile.SuspensionRestLength - suspensionLength);
            Vector3 pointVelocity = LinearVelocity + AngularVelocity.Cross(worldOffset);
            double spring = compression * Profile.SuspensionStiffness * Profile.Mass / wheels.Count;
            double damper = -pointVelocity.Dot(up) * Profile.Mass * 0.18 / wheels.Count;
            double suspensionForce = Math.Clamp(spring + damper, 0, Profile.MaxSuspensionForce);
            ApplyForce(up * (float)suspensionForce, worldOffset);

            Vector3 wheelForward = wheel.Front
                ? chassisForward.Rotated(up, (float)(control.Steering * drive.MaxSteering))
                : chassisForward;
            Vector3 wheelRight = wheelForward.Cross(up).Normalized();
            if (wheel.Driven) ApplyForce(wheelForward * (float)(requestedForce / Math.Max(1, wheels.Count)), worldOffset);
            double lateralSpeed = pointVelocity.Dot(wheelRight);
            double lateralForce = Math.Clamp(
                -lateralSpeed * Profile.Mass * dynamics.LateralGripFactor * control.GripMultiplier / wheels.Count,
                -Profile.Mass * 18,
                Profile.Mass * 18);
            ApplyForce(wheelRight * (float)lateralForce, worldOffset);
            if (control.Brake > 0.001 && pointVelocity.LengthSquared() > 0.0001f)
            {
                Vector3 planar = pointVelocity - (up * pointVelocity.Dot(up));
                if (!planar.IsZeroApprox())
                {
                    ApplyForce(-planar.Normalized() * (float)(control.Brake * drive.MaxBrakeForce * 5 / wheels.Count), worldOffset);
                }
            }
        }

        double speed = new Vector2(LinearVelocity.X, LinearVelocity.Z).Length();
        ApplyCentralForce(-up * (float)(speed * dynamics.DownforceFactor));
        if (TypeId == "MOTORBIKE" && Math.Abs(dynamics.VisualLeanFactor) > 0)
        {
            Visual.Rotation = new Vector3(0, 0, (float)(-control.Steering * dynamics.VisualLeanFactor));
        }
    }

    private static double Slot(RuntimeInputSnapshot snapshot, string action, int index) =>
        snapshot.Actions.GetValueOrDefault(RuntimeInputActionIds.Slot(action, index));

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Vehicle controller is not initialized.");
    }
}

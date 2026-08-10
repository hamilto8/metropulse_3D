using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.Vehicles;

namespace MetroPulse.Godot.Vehicles;

/// <summary>Phase 5 comparison branch using Godot's intentionally limited built-in vehicle solver.</summary>
public partial class BuiltInSedanPhysicsPrototype : VehicleBody3D, IVehiclePhysicsPrototype
{
    private readonly List<VehicleWheel3D> wheels = [];
    private VehicleProfile? profile;
    private VehiclePrototypeControl control = new(0, 0, 0);
    private ulong physicsMicroseconds;
    private ulong physicsSamples;

    public VehiclePhysicsBranch Branch => VehiclePhysicsBranch.BuiltInVehicleBody;

    public Vector3 VehicleVelocity => LinearVelocity;

    public int GroundedWheelCount => wheels.Count(wheel => wheel.IsInContact());

    public double AveragePhysicsMicroseconds => physicsSamples == 0 ? 0 : physicsMicroseconds / (double)physicsSamples;

    public int WheelCount => wheels.Count;

    public void Initialize(VehicleProfileRecord record)
    {
        if (profile is not null) throw new InvalidOperationException("Built-in sedan prototype is already initialized.");
        ArgumentNullException.ThrowIfNull(record);
        profile = record.Profile ?? throw new ArgumentException("The sedan profile is unavailable.", nameof(record));
        VehiclePhysicsLayout layout = record.PhysicsLayout
            ?? throw new ArgumentException("The sedan physics layout is unavailable.", nameof(record));
        VehicleDriveProfile drive = profile.Drive
            ?? throw new ArgumentException("The sedan drive profile is unavailable.", nameof(record));
        PlayerVehicleDynamics dynamics = profile.PlayerDynamics
            ?? throw new ArgumentException("The sedan dynamics profile is unavailable.", nameof(record));

        Mass = (float)profile.Mass;
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Traffic;
        CollisionMask = (uint)CollisionMasks.Traffic;
        ContinuousCd = true;
        CanSleep = false;
        AngularDamp = (float)dynamics.AngularDamping;

        AddChild(new CollisionShape3D
        {
            Name = "ChassisCollision",
            Position = new Vector3(0, (float)layout.ChassisShapeOffsetY, 0),
            Shape = new BoxShape3D
            {
                Size = new Vector3((float)profile.Width, (float)profile.Height, (float)profile.Length),
            },
        });
        AddChild(new MeshInstance3D
        {
            Name = "VisualBody",
            Position = new Vector3(0, (float)layout.ChassisShapeOffsetY, 0),
            Mesh = new BoxMesh
            {
                Size = new Vector3((float)profile.Width, (float)profile.Height, (float)profile.Length),
            },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = Color.FromHtml("f59e0b"), Roughness = 0.62f },
        });

        float track = (float)(profile.Width * dynamics.WheelTrackFactor);
        float axle = (float)(profile.Length * 0.32);
        for (int index = 0; index < 4; index += 1)
        {
            bool front = index < 2;
            bool left = index % 2 == 0;
            var wheel = new VehicleWheel3D
            {
                Name = $"Wheel{index + 1}",
                Position = new Vector3(left ? -track : track, (float)layout.WheelConnectionY, front ? -axle : axle),
                WheelRadius = (float)profile.WheelRadius,
                WheelRestLength = (float)profile.SuspensionRestLength,
                WheelFrictionSlip = (float)dynamics.LateralGripFactor,
                SuspensionStiffness = (float)profile.SuspensionStiffness,
                SuspensionMaxForce = (float)profile.MaxSuspensionForce,
                SuspensionTravel = (float)(profile.SuspensionRestLength * 0.55),
                DampingCompression = 0.82f,
                DampingRelaxation = 0.88f,
                WheelRollInfluence = (float)dynamics.RollInfluence,
                UseAsSteering = front,
                UseAsTraction = dynamics.DrivenAxle == "all" || (!front && dynamics.DrivenAxle == "rear"),
            };
            AddChild(wheel);
            wheels.Add(wheel);
        }
        EngineForce = 0;
        Brake = 0;
        Steering = 0;
        SetPhysicsProcess(true);
        _ = drive;
    }

    public void ApplyControl(VehiclePrototypeControl next)
    {
        ArgumentNullException.ThrowIfNull(next);
        control = next with
        {
            Throttle = Math.Clamp(double.IsFinite(next.Throttle) ? next.Throttle : 0, -1, 1),
            Brake = Math.Clamp(double.IsFinite(next.Brake) ? next.Brake : 0, 0, 1),
            Steering = Math.Clamp(double.IsFinite(next.Steering) ? next.Steering : 0, -1, 1),
            GripMultiplier = Math.Clamp(double.IsFinite(next.GripMultiplier) ? next.GripMultiplier : 1, 0.1, 1.5),
        };
    }

    public override void _PhysicsProcess(double delta)
    {
        _ = delta;
        if (profile?.Drive is not VehicleDriveProfile drive || profile.PlayerDynamics is not PlayerVehicleDynamics dynamics) return;
        ulong started = Time.GetTicksUsec();
        double speed = LinearVelocity.Dot(-GlobalBasis.Z);
        double requestedForce = control.Throttle >= 0
            ? control.Throttle * drive.ForwardEngineForce
            : control.Throttle * drive.ReverseEngineForce;
        if ((speed >= drive.MaxForwardSpeed && requestedForce > 0)
            || (speed <= -drive.MaxReverseSpeed && requestedForce < 0))
        {
            requestedForce = 0;
        }
        EngineForce = (float)requestedForce;
        Brake = (float)(control.Brake * drive.MaxBrakeForce);
        Steering = (float)(control.Steering * drive.MaxSteering);
        foreach (VehicleWheel3D wheel in wheels)
        {
            wheel.WheelFrictionSlip = (float)(dynamics.LateralGripFactor * control.GripMultiplier);
        }
        physicsMicroseconds += Time.GetTicksUsec() - started;
        physicsSamples++;
    }

    public double CapturePlanarHeading()
    {
        Vector3 forward = -GlobalBasis.Z;
        return Math.Abs(Math.Atan2(forward.X, -forward.Z));
    }
}

using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.Vehicles;

namespace MetroPulse.Godot.Vehicles;

/// <summary>Phase 5 comparison branch with explicit raycast suspension and tire forces.</summary>
public partial class CustomSedanPhysicsPrototype : RigidBody3D, IVehiclePhysicsPrototype
{
    private sealed record WheelProbe(RayCast3D Ray, bool Front, Vector3 LocalOffset);

    private readonly List<WheelProbe> wheels = [];
    private VehicleProfile? profile;
    private VehiclePrototypeControl control = new(0, 0, 0);
    private ulong physicsMicroseconds;
    private ulong physicsSamples;
    private int groundedWheelCount;

    public VehiclePhysicsBranch Branch => VehiclePhysicsBranch.CustomRaycastRigidBody;

    public Vector3 VehicleVelocity => LinearVelocity;

    public int GroundedWheelCount => groundedWheelCount;

    public double AveragePhysicsMicroseconds => physicsSamples == 0 ? 0 : physicsMicroseconds / (double)physicsSamples;

    public int RaycastCount => wheels.Count;

    public void Initialize(VehicleProfileRecord record)
    {
        if (profile is not null) throw new InvalidOperationException("Custom sedan prototype is already initialized.");
        ArgumentNullException.ThrowIfNull(record);
        profile = record.Profile ?? throw new ArgumentException("The sedan profile is unavailable.", nameof(record));
        VehiclePhysicsLayout layout = record.PhysicsLayout
            ?? throw new ArgumentException("The sedan physics layout is unavailable.", nameof(record));
        PlayerVehicleDynamics dynamics = profile.PlayerDynamics
            ?? throw new ArgumentException("The sedan dynamics profile is unavailable.", nameof(record));

        Mass = (float)profile.Mass;
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Traffic;
        CollisionMask = (uint)CollisionMasks.Traffic;
        ContinuousCd = true;
        CanSleep = false;
        AngularDamp = (float)dynamics.AngularDamping;
        CenterOfMassMode = CenterOfMassModeEnum.Custom;
        CenterOfMass = new Vector3(0, -0.25f, 0);

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
            MaterialOverride = new StandardMaterial3D { AlbedoColor = Color.FromHtml("22c55e"), Roughness = 0.62f },
        });

        float track = (float)(profile.Width * dynamics.WheelTrackFactor);
        float axle = (float)(profile.Length * 0.32);
        float castLength = (float)(profile.SuspensionRestLength + profile.WheelRadius + 0.2);
        for (int index = 0; index < 4; index += 1)
        {
            bool front = index < 2;
            bool left = index % 2 == 0;
            Vector3 offset = new(left ? -track : track, (float)layout.WheelConnectionY, front ? -axle : axle);
            var ray = new RayCast3D
            {
                Name = $"SuspensionRay{index + 1}",
                Position = offset,
                TargetPosition = Vector3.Down * castLength,
                CollisionMask = (uint)(MetroPulse.Domain.Simulation.CollisionLayer.Surface
                    | MetroPulse.Domain.Simulation.CollisionLayer.StaticObstacle),
                Enabled = true,
                ExcludeParent = true,
            };
            AddChild(ray);
            wheels.Add(new WheelProbe(ray, front, offset));
        }
        SetPhysicsProcess(true);
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
        groundedWheelCount = 0;
        Vector3 up = GlobalBasis.Y.Normalized();
        Vector3 chassisForward = -GlobalBasis.Z.Normalized();
        Vector3 chassisRight = GlobalBasis.X.Normalized();
        double signedSpeed = LinearVelocity.Dot(chassisForward);
        double requestedForce = control.Throttle >= 0
            ? control.Throttle * drive.ForwardEngineForce
            : control.Throttle * drive.ReverseEngineForce;
        if ((signedSpeed >= drive.MaxForwardSpeed && requestedForce > 0)
            || (signedSpeed <= -drive.MaxReverseSpeed && requestedForce < 0))
        {
            requestedForce = 0;
        }

        foreach (WheelProbe wheel in wheels)
        {
            wheel.Ray.ForceRaycastUpdate();
            if (!wheel.Ray.IsColliding()) continue;
            groundedWheelCount++;
            Vector3 worldOffset = wheel.Ray.GlobalPosition - GlobalPosition;
            double contactDistance = wheel.Ray.GlobalPosition.DistanceTo(wheel.Ray.GetCollisionPoint());
            double suspensionLength = Math.Max(0, contactDistance - profile.WheelRadius);
            double compression = Math.Max(0, profile.SuspensionRestLength - suspensionLength);
            Vector3 pointVelocity = LinearVelocity + AngularVelocity.Cross(worldOffset);
            double spring = compression * profile.SuspensionStiffness * profile.Mass / wheels.Count;
            double damper = -pointVelocity.Dot(up) * profile.Mass * 0.18 / wheels.Count;
            double suspensionForce = Math.Clamp(spring + damper, 0, profile.MaxSuspensionForce);
            ApplyForce(up * (float)suspensionForce, worldOffset);

            Vector3 wheelForward = wheel.Front
                ? chassisForward.Rotated(up, (float)(control.Steering * drive.MaxSteering))
                : chassisForward;
            Vector3 wheelRight = wheelForward.Cross(up).Normalized();
            bool driven = dynamics.DrivenAxle == "all" || (!wheel.Front && dynamics.DrivenAxle == "rear");
            if (driven)
            {
                ApplyForce(wheelForward * (float)(requestedForce / Math.Max(1, wheels.Count)), worldOffset);
            }
            double lateralSpeed = pointVelocity.Dot(wheelRight);
            double lateralForce = Math.Clamp(
                -lateralSpeed * profile.Mass * dynamics.LateralGripFactor * control.GripMultiplier / wheels.Count,
                -profile.Mass * 18,
                profile.Mass * 18);
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

        double planarSpeed = new Vector2(LinearVelocity.X, LinearVelocity.Z).Length();
        ApplyCentralForce(-up * (float)(planarSpeed * dynamics.DownforceFactor));
        physicsMicroseconds += Time.GetTicksUsec() - started;
        physicsSamples++;
    }

    public double CapturePlanarHeading()
    {
        Vector3 forward = -GlobalBasis.Z;
        return Math.Abs(Math.Atan2(forward.X, -forward.Z));
    }
}

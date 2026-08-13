using Godot;
using MetroPulse.Domain.Aircraft;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Aircraft;

public sealed record AircraftActorSnapshot(
    AircraftFlightState State,
    bool Controlled,
    bool SimulationSuspended,
    double CrashRecoveryRemaining,
    int CrashCount,
    int ResetCount,
    int TakeoffCount,
    int LandingCount);

/// <summary>Feature-gated Northwind Sparrow renderer and deterministic flight adapter.</summary>
public partial class AircraftActor : Node3D, IGameplayCameraTarget
{
    public const string StableAircraftId = "northwind-sparrow";
    public const double BoardingRadius = 5.5;
    private const double RecoverySeconds = 2.2;
    private static readonly AirfieldBounds Airspace = new(-245, 860, -455, 455);

    private MvpWorldGenerator world = null!;
    private RuntimeInputHost input = null!;
    private SessionAudioRuntime audio = null!;
    private PlayerInterface playerInterface = null!;
    private AircraftLandingSurfaceModel landing = null!;
    private AudioStreamPlayer3D propeller = null!;
    private AircraftFlightState state = AircraftFlightModel.CreateState();
    private double crashRecoveryRemaining;

    public bool Initialized { get; private set; }
    public bool Controlled { get; private set; }
    public bool SimulationSuspended { get; private set; }
    public AircraftFlightState State => state;
    public AircraftLandingAssessment? LandingAssessment { get; private set; }
    public int CrashCount { get; private set; }
    public int ResetCount { get; private set; }
    public int TakeoffCount { get; private set; }
    public int LandingCount { get; private set; }
    public int PilotPopulation => Controlled ? 1 : 0;

    public void Initialize(
        MvpWorldGenerator worldOwner,
        GameContentRegistry content,
        RuntimeInputHost inputOwner,
        SessionAudioRuntime audioOwner,
        PlayerInterface interfaceOwner)
    {
        if (Initialized) throw new InvalidOperationException("The aircraft actor is already initialized.");
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        audio = audioOwner ?? throw new ArgumentNullException(nameof(audioOwner));
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        landing = new AircraftLandingSurfaceModel(
            content?.CountrysideGrid ?? throw new ArgumentNullException(nameof(content)));
        AddToGroup("aircraft");
        BuildVisual();
        propeller = new AudioStreamPlayer3D
        {
            Name = "PropellerAudio",
            Stream = ProceduralAudioStreamCache.Get("aircraft-propeller"),
            Bus = AudioBusIds.Vehicle,
            MaxDistance = 560,
            UnitSize = 26,
        };
        AddChild(propeller);
        ResetToRunway(announce: false, count: false);
        Initialized = true;
    }

    public bool CanBoard(Vector3 pedestrianPosition) => Initialized
        && !state.Crashed
        && state.Grounded
        && state.Speed <= 2
        && pedestrianPosition.DistanceTo(GlobalPosition) <= BoardingRadius;

    public bool SetControlled(bool controlled)
    {
        if (Controlled == controlled) return false;
        Controlled = controlled;
        if (controlled)
        {
            propeller.Play();
            audio.PublishCaption("[propeller engine running]");
        }
        else
        {
            state = state with { Throttle = 0 };
            propeller.Stop();
        }
        return true;
    }

    public void SetSimulationSuspended(bool suspended)
    {
        SimulationSuspended = suspended;
        propeller.StreamPaused = suspended;
    }

    public void Advance(double rawDelta)
    {
        if (!Initialized || SimulationSuspended) return;
        double delta = Math.Clamp(double.IsFinite(rawDelta) ? rawDelta : 0, 0, 0.1);
        if (crashRecoveryRemaining > 0)
        {
            crashRecoveryRemaining = Math.Max(0, crashRecoveryRemaining - delta);
            if (crashRecoveryRemaining == 0) ResetToRunway();
            return;
        }

        AircraftFlightState previous = state;
        AircraftVector3 position = state.Position!;
        LandingAssessment = landing.Assess(
            new AircraftPlanarPoint(position.X, position.Z),
            state.Heading,
            new AircraftLandingWorld
            {
                GetTerrainHeight = world.Surface.GetTerrainHeight,
                IsInWater = point => world.Surface.IsWater(point.X, point.Y, point.Z),
                IsBridgeDeck = (x, z) => world.Surface.GetBridgeDeckHeight(x, z) is not null,
            });
        AircraftControls controls = Controlled ? ReadControls(input.LatestSnapshot) : new AircraftControls();
        state = AircraftFlightModel.Step(
            state,
            controls,
            delta,
            new AircraftEnvironment
            {
                GroundHeight = LandingAssessment.GroundHeight,
                InWater = LandingAssessment.Reason == LandingFailureReasons.Water,
                CanLand = LandingAssessment.Allowed,
                LandingSurface = LandingAssessment.Type,
            });
        EnforceAirspace();
        SyncTransform();
        UpdateAudio();

        if (previous.Grounded && !state.Grounded) TakeoffCount++;
        if (!previous.Grounded && state.Grounded && !state.Crashed)
        {
            LandingCount++;
            playerInterface.Announce($"Safe touchdown on {LandingAssessment.Label.ToLowerInvariant()}.");
        }
        if (state.Crashed)
        {
            TriggerCrash(LandingAssessment.Reason == LandingFailureReasons.Water
                ? "ditched in water"
                : LandingAssessment.Allowed ? "made a hard landing" : $"attempted an unsafe landing on {LandingAssessment.Label.ToLowerInvariant()}");
            return;
        }
        WorldColliderMetadata? obstacle = FindObstacle();
        if (obstacle is not null) TriggerCrash($"collided with {obstacle.Kind}");
    }

    public bool TryGetExitPose(out Vector3 pose)
    {
        Vector3 right = new((float)Math.Cos(state.Heading), 0, (float)-Math.Sin(state.Heading));
        pose = GlobalPosition - right * 7.2f + new Vector3(0, 0, -1.5f);
        pose.Y = (float)world.Surface.GetTerrainHeight(pose.X, pose.Z) + 0.95f;
        return state.Grounded && !state.Crashed && state.Speed <= 3
            && !world.Surface.IsWater(pose.X, pose.Y, pose.Z);
    }

    public void ResetToRunway(bool announce = true, bool count = true)
    {
        AircraftSpawnPoint spawn = AircraftLandingSurfaceModel.DefaultAirfieldLayout.AircraftStart;
        state = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(spawn.X, spawn.Y, spawn.Z),
            Heading = spawn.Heading,
            Grounded = true,
            Mode = AircraftModes.Parked,
        });
        crashRecoveryRemaining = 0;
        LandingAssessment = null;
        if (count) ResetCount++;
        SyncTransform();
        ResetPhysicsInterpolation();
        if (announce && Initialized) playerInterface.Announce("Aircraft returned to runway 36.");
    }

    public AircraftActorSnapshot CaptureState() => new(
        state,
        Controlled,
        SimulationSuspended,
        crashRecoveryRemaining,
        CrashCount,
        ResetCount,
        TakeoffCount,
        LandingCount);

    public void RestoreState(AircraftActorSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        state = AircraftFlightModel.CreateState(snapshot.State);
        Controlled = snapshot.Controlled;
        SimulationSuspended = snapshot.SimulationSuspended;
        crashRecoveryRemaining = Math.Max(0, snapshot.CrashRecoveryRemaining);
        CrashCount = snapshot.CrashCount;
        ResetCount = snapshot.ResetCount;
        TakeoffCount = snapshot.TakeoffCount;
        LandingCount = snapshot.LandingCount;
        SyncTransform();
        ResetPhysicsInterpolation();
        if (Controlled && !propeller.Playing) propeller.Play();
        if (!Controlled && propeller.Playing) propeller.Stop();
        propeller.StreamPaused = SimulationSuspended;
    }

    public GameplayCameraTargetSnapshot CaptureCameraTarget() => new(
        StableAircraftId,
        CameraTargetTypes.Aircraft,
        GlobalPosition,
        state.Heading,
        state.Speed,
        HasPhysicsVehicle: false,
        UserControlled: Controlled);

    public void Shutdown()
    {
        if (!Initialized) return;
        propeller.Stop();
        Controlled = false;
        SimulationSuspended = false;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void TriggerCrash(string reason)
    {
        if (crashRecoveryRemaining > 0) return;
        state = state with
        {
            Crashed = true,
            Mode = AircraftModes.Crashed,
            Speed = 0,
            VerticalSpeed = 0,
        };
        crashRecoveryRemaining = RecoverySeconds;
        CrashCount++;
        audio.PlaySpatial("explosion", GlobalPosition);
        playerInterface.Announce($"Aircraft {reason}. Emergency runway recovery engaged.", true);
        UpdateAudio();
    }

    private void EnforceAirspace()
    {
        AircraftVector3 position = state.Position!;
        double x = Math.Clamp(position.X, Airspace.MinX, Airspace.MaxX);
        double z = Math.Clamp(position.Z, Airspace.MinZ, Airspace.MaxZ);
        double heading = state.Heading;
        bool reflected = false;
        if (x != position.X)
        {
            heading = (Math.Tau - heading) % Math.Tau;
            reflected = true;
        }
        if (z != position.Z)
        {
            heading = (Math.PI - heading + Math.Tau) % Math.Tau;
            reflected = true;
        }
        if (reflected) state = state with { Position = position with { X = x, Z = z }, Heading = heading, Roll = 0 };
    }

    private WorldColliderMetadata? FindObstacle()
    {
        Vector3 position = GlobalPosition;
        foreach (WorldColliderMetadata collider in world.Colliders.Snapshot)
        {
            if (collider.Layer != CollisionLayer.StaticObstacle) continue;
            Vector3 half = collider.Size * 0.5f + Vector3.One * 1.4f;
            Vector3 offset = position - collider.Position;
            if (Math.Abs(offset.X) <= half.X && Math.Abs(offset.Y) <= half.Y && Math.Abs(offset.Z) <= half.Z)
                return collider;
        }
        return null;
    }

    private void SyncTransform()
    {
        AircraftVector3 position = state.Position!;
        Position = new Vector3((float)position.X, (float)position.Y, (float)position.Z);
        Rotation = new Vector3((float)-state.Pitch, (float)(state.Heading + Math.PI), (float)-state.Roll);
    }

    private void UpdateAudio()
    {
        AircraftAudioProfile profile = AircraftAudioModel.GetProfile(state);
        propeller.PitchScale = (float)Math.Clamp(profile.RpmRatio * 1.35, 0.25, 1.45);
        propeller.VolumeDb = (float)Math.Clamp(20 * Math.Log10(Math.Max(0.001, profile.EngineGain + profile.PropellerGain)), -80, 0);
    }

    private static AircraftControls ReadControls(RuntimeInputSnapshot snapshot) => new()
    {
        Roll = Slot(snapshot, "AIR_ROLL", 1) - Slot(snapshot, "AIR_ROLL", 0),
        Pitch = Slot(snapshot, "AIR_PITCH", 0) - Slot(snapshot, "AIR_PITCH", 1),
        ThrottleUp = Slot(snapshot, "AIR_THROTTLE", 0),
        ThrottleDown = Slot(snapshot, "AIR_THROTTLE", 1),
        Brake = snapshot.Actions.GetValueOrDefault("AIR_BRAKE"),
    };

    private static double Slot(RuntimeInputSnapshot snapshot, string action, int index) =>
        snapshot.Actions.GetValueOrDefault(RuntimeInputActionIds.Slot(action, index));

    private void BuildVisual()
    {
        StandardMaterial3D body = Material(new Color("d9e4ef"), metallic: 0.35f);
        StandardMaterial3D wing = Material(new Color("2b6f9f"), metallic: 0.25f);
        StandardMaterial3D dark = Material(new Color("172435"), metallic: 0.5f);
        AddPart("Fuselage", new CylinderMesh { TopRadius = 0.48f, BottomRadius = 0.62f, Height = 6.8f, RadialSegments = 12 }, body, new Vector3(0, 0.25f, 0), new Vector3(Mathf.Pi / 2, 0, 0));
        AddPart("MainWing", new BoxMesh { Size = new Vector3(10.2f, 0.18f, 1.35f) }, wing, new Vector3(0, 0.25f, 0.15f));
        AddPart("TailWing", new BoxMesh { Size = new Vector3(4.2f, 0.12f, 0.65f) }, wing, new Vector3(0, 0.5f, 2.75f));
        AddPart("TailFin", new BoxMesh { Size = new Vector3(0.14f, 1.45f, 1.1f) }, wing, new Vector3(0, 1.05f, 2.55f));
        AddPart("Cockpit", new SphereMesh { Radius = 0.68f, Height = 1.05f, RadialSegments = 12, Rings = 6 }, dark, new Vector3(0, 0.78f, -0.7f));
        AddPart("Propeller", new BoxMesh { Size = new Vector3(0.15f, 3.6f, 0.12f) }, dark, new Vector3(0, 0.25f, -3.48f));
    }

    private void AddPart(string name, Mesh mesh, Material material, Vector3 position, Vector3? rotation = null)
    {
        var part = new MeshInstance3D { Name = name, Mesh = mesh, MaterialOverride = material, Position = position };
        if (rotation is Vector3 value) part.Rotation = value;
        AddChild(part);
    }

    private static StandardMaterial3D Material(Color color, float metallic = 0) => new()
    {
        AlbedoColor = color,
        Metallic = metallic,
        Roughness = 0.55f,
    };
}

using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Rocket;
using MetroPulse.Domain.Simulation;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Effects;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Rocket;

public partial class RocketLaunchRuntime : Node
{
    private const string GroupName = "rocket_launch";
    private static readonly string[] ColliderIds =
        ["rocket-launch-pad", "rocket-launch-gantry", "rocket-mission-control"];
    private readonly List<VaporState> vapors = [];
    private MvpWorldGenerator world = null!;
    private GameplayCameraRig camera = null!;
    private SessionEffectRuntime effects = null!;
    private SessionAudioRuntime audio = null!;
    private PlayerInterface playerInterface = null!;
    private RocketLaunchModel model = null!;
    private Node3D facility = null!;
    private Node3D rocket = null!;
    private MeshInstance3D flame = null!;
    private Func<bool>? unregisterTick;
    private double elapsed;

    public bool Initialized { get; private set; }

    public bool Launched => model?.Launched == true;

    public int FacilityNodeCount => facility?.GetChildCount(includeInternal: true) ?? 0;

    public int VaporCount => vapors.Count;

    public RocketLaunchSnapshot Snapshot => model.Snapshot();

    public RocketLaunchControl Control { get; private set; } = null!;

    public void Initialize(
        MvpWorldGenerator worldOwner,
        GodotSessionRuntimeHost runtime,
        GameplayCameraRig cameraOwner,
        SessionEffectRuntime effectOwner,
        SessionAudioRuntime audioOwner,
        PlayerInterface interfaceOwner,
        Node3D worldRoot)
    {
        if (Initialized) throw new InvalidOperationException("Rocket launch is already initialized.");
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        ArgumentNullException.ThrowIfNull(runtime);
        camera = cameraOwner ?? throw new ArgumentNullException(nameof(cameraOwner));
        effects = effectOwner ?? throw new ArgumentNullException(nameof(effectOwner));
        audio = audioOwner ?? throw new ArgumentNullException(nameof(audioOwner));
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        ArgumentNullException.ThrowIfNull(worldRoot);
        model = new RocketLaunchModel();
        BuildFacility(worldRoot);
        Control = new RocketLaunchControl();
        playerInterface.Chrome.AddChild(Control);
        Control.Initialize(this);
        unregisterTick = runtime.Scheduler.RegisterTask(
            "rocket.launch",
            SimulationStage.Gameplay,
            (delta, _) => Advance(delta));
        Initialized = true;
        ApplyPresentation(0);
    }

    public bool LaunchNow()
    {
        EnsureInitialized();
        if (!model.LaunchNow()) return false;
        audio.PlaySpatial("explosion", facility.GlobalPosition);
        playerInterface.Announce("Rocket liftoff. Launch vehicle ascending.", assertive: true);
        ApplyPresentation(0);
        return true;
    }

    public RocketLaunchSnapshot Reset()
    {
        EnsureInitialized();
        RocketLaunchSnapshot result = model.Reset();
        elapsed = 0;
        foreach (VaporState vapor in vapors)
        {
            vapor.Age = vapor.InitialAge;
            vapor.Visual.Visible = false;
        }
        flame.Visible = false;
        ApplyPresentation(0);
        playerInterface.Announce("Rocket reset to launch pad. Countdown restored to five minutes.");
        return result;
    }

    public bool ViewLaunch()
    {
        EnsureInitialized();
        bool applied = camera.ApplyPresetImmediate("rocket");
        if (applied) _ = camera.ApplyRocketTracking(model.Altitude);
        return applied;
    }

    public void AdvanceForTest(double deltaSeconds) => Advance(deltaSeconds);

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unregisterTick?.Invoke();
        unregisterTick = null;
        foreach (string id in ColliderIds) _ = world.Colliders.Unregister(id);
        Control.Shutdown();
        if (GodotObject.IsInstanceValid(Control)) Control.QueueFree();
        if (GodotObject.IsInstanceValid(facility)) facility.QueueFree();
        vapors.Clear();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Advance(double deltaSeconds)
    {
        if (!Initialized || !double.IsFinite(deltaSeconds) || deltaSeconds < 0) return;
        elapsed += deltaSeconds;
        model.Advance(deltaSeconds);
        ApplyPresentation(deltaSeconds);
    }

    private void ApplyPresentation(double deltaSeconds)
    {
        rocket.Position = new Vector3(0, (float)model.Altitude, 0);
        double flashScale = effects.CurrentPolicy.FlashScale;
        float pulse = (float)((model.Launched ? 2.2 : 1) + Math.Sin(elapsed * 20) * 0.15 * flashScale);
        flame.Scale = new Vector3(pulse, pulse * (model.Launched ? 2.8f : 1.2f), pulse);
        flame.Visible = flashScale > 0;
        double nozzleY = model.Altitude - 3.5;
        foreach (VaporState vapor in vapors)
        {
            vapor.Age += deltaSeconds * (model.Launched ? 2 : 1);
            double progress = vapor.Age / vapor.Lifetime;
            if (progress >= 1)
            {
                vapor.Age = 0;
                vapor.Visual.Position = new Vector3(vapor.OffsetX, (float)nozzleY, vapor.OffsetZ);
                vapor.Visual.Scale = Vector3.One;
                progress = 0;
            }
            vapor.Visual.Visible = !effects.CurrentPolicy.SpawnComets ? false : true;
            vapor.Visual.Position += new Vector3(
                (float)(Math.Sin(vapor.Age * 3 + vapor.OffsetX) * 2 * deltaSeconds),
                (float)(-vapor.Speed * deltaSeconds),
                (float)(Math.Cos(vapor.Age * 3 + vapor.OffsetZ) * 2 * deltaSeconds));
            float scale = (float)(1 + progress * 4.5);
            vapor.Visual.Scale = Vector3.One * scale;
            if (vapor.Visual.MaterialOverride is StandardMaterial3D material)
            {
                Color color = material.AlbedoColor;
                color.A = (float)(progress < 0.2 ? progress / 0.2 * 0.45 : (1 - progress) * 0.45);
                material.AlbedoColor = color;
            }
        }
        if (model.Launched) _ = camera.ApplyRocketTracking(model.Altitude);
        Control?.ApplyState();
    }

    private void BuildFacility(Node3D worldRoot)
    {
        float terrain = (float)world.Surface.GetTerrainHeight(700, -280);
        facility = new Node3D
        {
            Name = "RocketLaunchFacility",
            Position = new Vector3(700, terrain, -280),
        };
        facility.AddToGroup(GroupName);
        worldRoot.AddChild(facility);

        AddMesh(facility, "LaunchPad", new CylinderMesh { TopRadius = 18, BottomRadius = 18, Height = 1.5f },
            new Vector3(0, 0.75f, 0), new Color("2b2d42"));
        AddCollider("rocket-launch-pad", "rocket-pad", new Vector3(0, 0.75f, 0), new Vector3(36, 1.5f, 36), CollisionLayer.Surface);
        AddMesh(facility, "Gantry", new BoxMesh { Size = new Vector3(6, 55, 6) },
            new Vector3(-10, 27.5f, 0), new Color("d90429"), metallic: 0.8f);
        AddCollider("rocket-launch-gantry", "rocket-gantry", new Vector3(-10, 27.5f, 0), new Vector3(6, 55, 6), CollisionLayer.StaticObstacle);
        AddMesh(facility, "MissionControl", new BoxMesh { Size = new Vector3(18, 10, 12) },
            new Vector3(35, 5.3f, 35), new Color("e0e1dd"), metallic: 0.2f);
        AddCollider("rocket-mission-control", "mission-control", new Vector3(35, 5.3f, 35), new Vector3(18, 10, 12), CollisionLayer.StaticObstacle);

        rocket = new Node3D { Name = "Rocket", Position = new Vector3(0, 1.5f, 0) };
        facility.AddChild(rocket);
        AddMesh(rocket, "Stage1", new CylinderMesh { TopRadius = 3.2f, BottomRadius = 3.2f, Height = 25 },
            new Vector3(0, 12.5f, 0), new Color("edf2f4"), metallic: 0.2f);
        AddMesh(rocket, "Stage2", new CylinderMesh { TopRadius = 2.8f, BottomRadius = 2.8f, Height = 15 },
            new Vector3(0, 32.5f, 0), new Color("edf2f4"), metallic: 0.2f);
        AddMesh(rocket, "Nose", new PrismMesh { Size = new Vector3(5.6f, 8, 5.6f) },
            new Vector3(0, 44, 0), new Color("ef233c"));
        flame = AddMesh(rocket, "Flame", new CylinderMesh { TopRadius = 0.2f, BottomRadius = 2.2f, Height = 8 },
            new Vector3(0, -5, 0), new Color("ff3a00"), emission: 3);
        flame.Visible = false;

        for (int index = 0; index < 20; index++)
        {
            float offsetX = ((index % 5) - 2) * 0.3f;
            float offsetZ = ((index / 5) - 1.5f) * 0.3f;
            MeshInstance3D visual = AddMesh(facility, $"Vapor{index:00}",
                new SphereMesh { Radius = 2, Height = 4, RadialSegments = 8, Rings = 4 },
                new Vector3(offsetX, 18.5f, offsetZ), new Color(0.94f, 0.95f, 0.97f, 0), transparent: true);
            visual.Visible = false;
            vapors.Add(new VaporState(visual, index * 0.09, 1.5 + (index % 6) * 0.25, 8 + (index % 7), offsetX, offsetZ));
        }
    }

    private void AddCollider(string id, string kind, Vector3 localPosition, Vector3 size, CollisionLayer layer)
    {
        var body = new StaticBody3D
        {
            Name = $"{id}-collision",
            Position = localPosition,
            CollisionLayer = (uint)layer,
            CollisionMask = (uint)(layer == CollisionLayer.Surface ? CollisionMasks.Surface : CollisionMasks.StaticObstacle),
        };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
        facility.AddChild(body);
        world.Colliders.Register(new WorldColliderMetadata(
            id,
            "RocketLaunch",
            kind,
            layer,
            layer == CollisionLayer.Surface ? CollisionMasks.Surface : CollisionMasks.StaticObstacle,
            facility.GlobalPosition + localPosition,
            size,
            0,
            body));
    }

    private static MeshInstance3D AddMesh(
        Node3D owner,
        string name,
        Mesh mesh,
        Vector3 position,
        Color color,
        float metallic = 0,
        float emission = 0,
        bool transparent = false)
    {
        var material = new StandardMaterial3D
        {
            AlbedoColor = color,
            Roughness = 0.4f,
            Metallic = metallic,
            Transparency = transparent ? BaseMaterial3D.TransparencyEnum.Alpha : BaseMaterial3D.TransparencyEnum.Disabled,
            EmissionEnabled = emission > 0,
            Emission = color,
            EmissionEnergyMultiplier = emission,
        };
        var visual = new MeshInstance3D
        {
            Name = name,
            Mesh = mesh,
            Position = position,
            MaterialOverride = material,
        };
        owner.AddChild(visual);
        return visual;
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Rocket launch is not initialized.");
    }

    private sealed class VaporState(
        MeshInstance3D visual,
        double age,
        double lifetime,
        double speed,
        float offsetX,
        float offsetZ)
    {
        public MeshInstance3D Visual { get; } = visual;
        public double InitialAge { get; } = age;
        public double Age { get; set; } = age;
        public double Lifetime { get; } = lifetime;
        public double Speed { get; } = speed;
        public float OffsetX { get; } = offsetX;
        public float OffsetZ { get; } = offsetZ;
    }
}

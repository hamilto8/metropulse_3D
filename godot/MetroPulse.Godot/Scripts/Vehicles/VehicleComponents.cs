using Godot;
using MetroPulse.Domain.Content;

namespace MetroPulse.Godot.Vehicles;

public partial class VehicleVisualComponent : Node3D
{
    public MeshInstance3D Body { get; private set; } = null!;

    public void Initialize(string typeId, VehicleProfile profile, VehiclePhysicsLayout layout)
    {
        Body = new MeshInstance3D
        {
            Name = "BodyMesh",
            Position = new Vector3(0, (float)layout.ChassisShapeOffsetY, 0),
            Mesh = new BoxMesh { Size = new Vector3((float)profile.Width, (float)profile.Height, (float)profile.Length) },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = VehicleColor(typeId),
                Metallic = typeId == "SPORTS" ? 0.28f : 0.08f,
                Roughness = typeId == "MOTORBIKE" ? 0.48f : 0.64f,
            },
        };
        AddChild(Body);
    }

    private static Color VehicleColor(string typeId) => typeId switch
    {
        "SPORTS" => Color.FromHtml("ef4444"),
        "BUS" => Color.FromHtml("fbbf24"),
        "TRUCK" => Color.FromHtml("64748b"),
        "POLICE" => Color.FromHtml("e2e8f0"),
        "MOTORBIKE" => Color.FromHtml("8b5cf6"),
        _ => Color.FromHtml("38bdf8"),
    };
}

public partial class VehicleWheelComponent : Node3D
{
    public bool Front { get; private set; }

    public bool Driven { get; private set; }

    public RayCast3D Probe { get; private set; } = null!;

    public MeshInstance3D Visual { get; private set; } = null!;

    public void Initialize(
        Vector3 localPosition,
        bool front,
        bool driven,
        double radius,
        double suspensionLength)
    {
        Position = localPosition;
        Front = front;
        Driven = driven;
        Probe = new RayCast3D
        {
            Name = "GroundProbe",
            TargetPosition = Vector3.Down * (float)(suspensionLength + radius + 0.2),
            CollisionMask = (uint)(MetroPulse.Domain.Simulation.CollisionLayer.Surface
                | MetroPulse.Domain.Simulation.CollisionLayer.StaticObstacle),
            Enabled = true,
            ExcludeParent = true,
        };
        AddChild(Probe);
        Visual = new MeshInstance3D
        {
            Name = "WheelMesh",
            Position = Vector3.Down * (float)suspensionLength,
            Rotation = new Vector3(0, 0, Mathf.Pi / 2),
            Mesh = new CylinderMesh
            {
                TopRadius = (float)radius,
                BottomRadius = (float)radius,
                Height = (float)Math.Max(0.16, radius * 0.42),
                RadialSegments = 12,
            },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = Color.FromHtml("111827"), Roughness = 0.92f },
        };
        AddChild(Visual);
    }
}

public partial class VehicleLightsComponent : Node3D
{
    public int LightCount { get; private set; }

    public bool EmergencyCapable { get; private set; }

    public void Initialize(string typeId, VehicleProfile profile)
    {
        float halfWidth = (float)(profile.Width * 0.34);
        float frontZ = (float)(-profile.Length * 0.5 - 0.02);
        float rearZ = (float)(profile.Length * 0.5 + 0.02);
        foreach ((Vector3 position, Color color) in new[]
        {
            (new Vector3(-halfWidth, 0.25f, frontZ), Colors.White),
            (new Vector3(halfWidth, 0.25f, frontZ), Colors.White),
            (new Vector3(-halfWidth, 0.2f, rearZ), Color.FromHtml("ef4444")),
            (new Vector3(halfWidth, 0.2f, rearZ), Color.FromHtml("ef4444")),
        })
        {
            AddChild(new OmniLight3D
            {
                Position = position,
                LightColor = color,
                OmniRange = 3,
                LightEnergy = 0.45f,
                ShadowEnabled = false,
            });
            LightCount++;
        }
        EmergencyCapable = typeId is "POLICE" or "AMBULANCE";
    }
}

public partial class VehicleOccupantComponent : Node3D
{
    public MeshInstance3D OccupantVisual { get; private set; } = null!;

    public bool RiderLayout { get; private set; }

    public void Initialize(string typeId, VehicleProfile profile)
    {
        RiderLayout = typeId == "MOTORBIKE";
        OccupantVisual = new MeshInstance3D
        {
            Name = RiderLayout ? "Rider" : "Driver",
            Position = new Vector3(0, (float)(profile.Height * (RiderLayout ? 0.9 : 0.45)), 0),
            Mesh = new CapsuleMesh
            {
                Radius = RiderLayout ? 0.18f : 0.22f,
                Height = RiderLayout ? 0.85f : 0.7f,
            },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = Color.FromHtml("fde68a"), Roughness = 0.8f },
        };
        AddChild(OccupantVisual);
    }
}

public partial class VehicleAudioComponent : Node3D
{
    public AudioStreamPlayer3D Engine { get; private set; } = null!;

    public AudioStreamPlayer3D Impact { get; private set; } = null!;

    public void Initialize()
    {
        Engine = new AudioStreamPlayer3D { Name = "Engine", MaxDistance = 80 };
        Impact = new AudioStreamPlayer3D { Name = "Impact", MaxDistance = 60 };
        AddChild(Engine);
        AddChild(Impact);
    }
}

public partial class VehicleGameplayStateComponent : Node
{
    public bool Authorized { get; private set; }

    public bool Occupied { get; private set; }

    public bool PlayerControlled { get; private set; }

    public bool AiActive { get; private set; }

    public long AuthorityGeneration { get; private set; }

    public int AiHandoffCount { get; private set; }

    public void Initialize(bool authorized, bool occupied)
    {
        Authorized = authorized;
        Occupied = occupied;
        AiActive = occupied;
    }

    public bool SetPlayerControlled(bool controlled)
    {
        if (PlayerControlled == controlled) return false;
        PlayerControlled = controlled;
        Occupied = true;
        AiActive = !controlled;
        AuthorityGeneration++;
        if (!controlled) AiHandoffCount++;
        return true;
    }

    public void MarkHijacked()
    {
        Authorized = true;
        Occupied = true;
    }

    public void Restore(bool authorized, bool occupied, bool playerControlled, bool aiActive, long generation, int aiHandoffs)
    {
        Authorized = authorized;
        Occupied = occupied;
        PlayerControlled = playerControlled;
        AiActive = aiActive;
        AuthorityGeneration = generation;
        AiHandoffCount = aiHandoffs;
    }
}

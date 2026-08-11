using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Traffic;

public static class TrafficRenderDetailTiers
{
    public const string High = "HIGH";
    public const string Medium = "MEDIUM";
    public const string Low = "LOW";
}

/// <summary>Lightweight traffic presentation/collision root; domain state remains authoritative.</summary>
public partial class TrafficVehicleActor : AnimatableBody3D
{
    private CollisionShape3D collision = null!;
    private MeshInstance3D highDetail = null!;
    private MeshInstance3D lowDetail = null!;
    private AudioStreamPlayer3D horn = null!;
    private MvpWorldGenerator? world;
    private int publishedHornCount;

    public string StableId { get; private set; } = string.Empty;

    public string TypeId { get; private set; } = string.Empty;

    public bool Parked { get; private set; }

    public string RenderDetailTier { get; private set; } = TrafficRenderDetailTiers.Low;

    public bool CollisionActive => !collision.Disabled;

    public void Initialize(TrafficAgentSnapshot snapshot, VehicleProfileRecord record, MvpWorldGenerator worldOwner)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(record);
        VehicleProfile profile = record.Profile ?? throw new ArgumentException("Traffic vehicle profile is unavailable.", nameof(record));
        StableId = snapshot.Id;
        TypeId = snapshot.TypeId;
        Parked = snapshot.Parked;
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Traffic;
        CollisionMask = (uint)(MetroPulse.Domain.Simulation.CollisionLayer.Player
            | MetroPulse.Domain.Simulation.CollisionLayer.Traffic
            | MetroPulse.Domain.Simulation.CollisionLayer.Pedestrian
            | MetroPulse.Domain.Simulation.CollisionLayer.StaticObstacle);
        SyncToPhysics = false;

        collision = new CollisionShape3D
        {
            Name = "Collision",
            Position = new Vector3(0, (float)(profile.Height * 0.5), 0),
            Shape = new BoxShape3D { Size = new Vector3((float)profile.Width, (float)profile.Height, (float)profile.Length) },
        };
        AddChild(collision);
        highDetail = CreateBody("HighDetail", profile, TrafficColor(snapshot.TypeId), 1);
        lowDetail = CreateBody("LowDetailProxy", profile, TrafficColor(snapshot.TypeId).Darkened(0.18f), 0.82f);
        AddChild(highDetail);
        AddChild(lowDetail);
        horn = new AudioStreamPlayer3D { Name = "Horn", MaxDistance = 70 };
        AddChild(horn);
        Apply(snapshot, Vector3.Zero);
    }

    public void Apply(TrafficAgentSnapshot snapshot, Vector3 renderFocus)
    {
        if (world is null) throw new InvalidOperationException("Traffic actor is not initialized.");
        double height = world.Surface.GetTerrainHeight(snapshot.Position.X, snapshot.Position.Z);
        GlobalPosition = new Vector3((float)snapshot.Position.X, (float)height, (float)snapshot.Position.Z);
        Rotation = new Vector3(0, (float)snapshot.Heading, 0);
        ResetPhysicsInterpolation();

        float distance = new Vector2(GlobalPosition.X - renderFocus.X, GlobalPosition.Z - renderFocus.Z).Length();
        RenderDetailTier = distance <= 160
            ? TrafficRenderDetailTiers.High
            : distance <= 400
                ? TrafficRenderDetailTiers.Medium
                : TrafficRenderDetailTiers.Low;
        highDetail.Visible = RenderDetailTier is TrafficRenderDetailTiers.High or TrafficRenderDetailTiers.Medium;
        lowDetail.Visible = RenderDetailTier == TrafficRenderDetailTiers.Low;
        highDetail.CastShadow = RenderDetailTier == TrafficRenderDetailTiers.High
            ? GeometryInstance3D.ShadowCastingSetting.On
            : GeometryInstance3D.ShadowCastingSetting.Off;
        bool collisionEnabled = snapshot.DetailTier == TrafficAgentDetailTiers.Near && !snapshot.PlayerControlled;
        collision.SetDeferred(CollisionShape3D.PropertyName.Disabled, !collisionEnabled);
        Visible = !snapshot.PlayerControlled;

        Color color = snapshot.DamageState switch
        {
            TrafficDamageStates.OnFire => Color.FromHtml("f97316"),
            TrafficDamageStates.Disabled => Color.FromHtml("1f2937"),
            TrafficDamageStates.Damaged => TrafficColor(snapshot.TypeId).Darkened(0.35f),
            _ => TrafficColor(snapshot.TypeId),
        };
        if (highDetail.MaterialOverride is StandardMaterial3D highMaterial) highMaterial.AlbedoColor = color;
        if (lowDetail.MaterialOverride is StandardMaterial3D lowMaterial) lowMaterial.AlbedoColor = color.Darkened(0.18f);
        if (snapshot.HornCount > publishedHornCount)
        {
            publishedHornCount = snapshot.HornCount;
            horn.Play();
        }
    }

    public void SetPromoted(bool promoted)
    {
        Visible = !promoted;
        collision.SetDeferred(CollisionShape3D.PropertyName.Disabled, promoted);
    }

    public override void _ExitTree()
    {
        world = null;
    }

    private static MeshInstance3D CreateBody(string name, VehicleProfile profile, Color color, double scale)
    {
        return new MeshInstance3D
        {
            Name = name,
            Position = new Vector3(0, (float)(profile.Height * scale * 0.5), 0),
            Mesh = new BoxMesh
            {
                Size = new Vector3((float)(profile.Width * scale), (float)(profile.Height * scale), (float)(profile.Length * scale)),
            },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = color,
                Metallic = 0.08f,
                Roughness = 0.7f,
            },
        };
    }

    private static Color TrafficColor(string typeId) => typeId switch
    {
        "SPORTS" => Color.FromHtml("ef4444"),
        "BUS" => Color.FromHtml("fbbf24"),
        "TRUCK" => Color.FromHtml("64748b"),
        "POLICE" => Color.FromHtml("e2e8f0"),
        "MOTORBIKE" => Color.FromHtml("8b5cf6"),
        _ => Color.FromHtml("38bdf8"),
    };
}

using Godot;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Presentation;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Pedestrians;

public static class PedestrianRenderDetailTiers
{
    public const string High = "HIGH";
    public const string Medium = "MEDIUM";
    public const string Low = "LOW";
}

/// <summary>Lightweight body and independent render/collision LOD for one domain citizen.</summary>
public partial class PedestrianActor : AnimatableBody3D
{
    private CollisionShape3D collision = null!;
    private Node3D highDetail = null!;
    private MeshInstance3D lowDetail = null!;
    private MvpWorldGenerator? world;
    private QualityProfilePolicy quality = QualityProfilePolicy.Resolve(QualityProfileIds.High);

    public string StableId { get; private set; } = string.Empty;

    public string Archetype { get; private set; } = string.Empty;

    public string RenderDetailTier { get; private set; } = PedestrianRenderDetailTiers.Low;

    public bool CollisionActive => !collision.Disabled;

    public void Initialize(
        PedestrianAgentSnapshot snapshot,
        MvpWorldGenerator worldOwner,
        QualityProfilePolicy? qualityProfile = null)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        quality = qualityProfile ?? QualityProfilePolicy.Resolve(QualityProfileIds.High);
        StableId = snapshot.Id;
        Archetype = snapshot.Descriptor.Archetype;
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Pedestrian;
        CollisionMask = (uint)MetroPulse.Domain.Simulation.CollisionMasks.Pedestrian;
        SyncToPhysics = false;

        collision = new CollisionShape3D
        {
            Name = "Collision",
            Position = new Vector3(0, 0.9f, 0),
            Shape = new CapsuleShape3D { Radius = 0.38f, Height = 1.8f },
        };
        AddChild(collision);
        Color clothing = Color.FromHtml(snapshot.Descriptor.Color.ToString("x6"));
        highDetail = CreateHighDetail(snapshot, clothing);
        AddChild(highDetail);
        lowDetail = new MeshInstance3D
        {
            Name = "LowDetailProxy",
            Position = new Vector3(0, 0.85f, 0),
            Mesh = new CapsuleMesh { Radius = 0.3f, Height = 1.35f },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = clothing.Darkened(0.12f), Roughness = 0.9f },
        };
        AddChild(lowDetail);
        Apply(snapshot, Vector3.Zero);
    }

    public void Apply(PedestrianAgentSnapshot snapshot, Vector3 renderFocus)
    {
        if (world is null) throw new InvalidOperationException("Pedestrian actor is not initialized.");
        double terrain = world.Surface.GetTerrainHeight(snapshot.Position.X, snapshot.Position.Z);
        float elevation = snapshot.KnockedDown
            ? (float)Math.Max(terrain + 0.15, snapshot.Position.Y)
            : (float)(terrain + Math.Max(0, snapshot.Position.Y));
        GlobalPosition = new Vector3((float)snapshot.Position.X, elevation, (float)snapshot.Position.Z);
        Rotation = snapshot.KnockedDown
            ? new Vector3(0, (float)snapshot.Heading, Mathf.Pi / 2)
            : new Vector3(0, (float)snapshot.Heading, 0);

        float distance = new Vector2(GlobalPosition.X - renderFocus.X, GlobalPosition.Z - renderFocus.Z).Length();
        RenderDetailTier = distance <= quality.PedestrianHighDetailDistance
            ? PedestrianRenderDetailTiers.High
            : distance <= quality.PedestrianProxyDistance
                ? PedestrianRenderDetailTiers.Medium
                : PedestrianRenderDetailTiers.Low;
        highDetail.Visible = RenderDetailTier is PedestrianRenderDetailTiers.High or PedestrianRenderDetailTiers.Medium;
        lowDetail.Visible = RenderDetailTier == PedestrianRenderDetailTiers.Low;
        foreach (MeshInstance3D mesh in highDetail.GetChildren().OfType<MeshInstance3D>())
        {
            mesh.CastShadow = quality.PedestrianShadows && RenderDetailTier == PedestrianRenderDetailTiers.High
                ? GeometryInstance3D.ShadowCastingSetting.On
                : GeometryInstance3D.ShadowCastingSetting.Off;
        }
        bool collisionEnabled = snapshot.DetailTier == PedestrianDetailTiers.Near && !snapshot.KnockedDown;
        collision.SetDeferred(CollisionShape3D.PropertyName.Disabled, !collisionEnabled);
    }

    public override void _ExitTree() => world = null;

    private static Node3D CreateHighDetail(PedestrianAgentSnapshot snapshot, Color clothing)
    {
        var root = new Node3D { Name = "HighDetail" };
        double scale = snapshot.Descriptor.Appearance.HeightScale;
        root.Scale = new Vector3(1, (float)scale, 1);
        root.AddChild(new MeshInstance3D
        {
            Name = "Body",
            Position = new Vector3(0, 1.05f, 0),
            Mesh = new CapsuleMesh { Radius = 0.32f, Height = 1.05f },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = clothing, Roughness = 0.85f },
        });
        root.AddChild(new MeshInstance3D
        {
            Name = "Head",
            Position = new Vector3(0, 1.72f, 0),
            Mesh = new SphereMesh { Radius = 0.23f, Height = 0.46f },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = Color.FromHtml(snapshot.Descriptor.Appearance.SkinTone.ToString("x6")),
                Roughness = 0.9f,
            },
        });
        return root;
    }
}

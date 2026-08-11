using Godot;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.Traffic;
using MetroPulse.Domain.World;
using MetroPulse.Domain.WorldEditing;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Construction;

internal abstract class GodotNodeWorldEditParticipant<TNode> : IWorldEditParticipant
    where TNode : Node3D
{
    private readonly Dictionary<string, TNode> active = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TNode> detached = new(StringComparer.Ordinal);
    protected readonly Node3D Owner;

    protected GodotNodeWorldEditParticipant(string id, Node3D owner)
    {
        Id = id;
        Owner = owner ?? throw new ArgumentNullException(nameof(owner));
    }

    public string Id { get; }

    public int Count => active.Count;

    public bool Attach(WorldEditRecord record)
    {
        if (active.ContainsKey(record.Id)) return false;
        TNode node;
        if (detached.Remove(record.Id, out TNode? recovered)) node = recovered;
        else node = CreateNode(record);
        ConfigureNode(node, record);
        Owner.AddChild(node);
        active.Add(record.Id, node);
        OnAttached(node, record);
        return true;
    }

    public bool Detach(WorldEditRecord record)
    {
        if (!active.Remove(record.Id, out TNode? node)) return false;
        OnDetaching(node, record);
        Owner.RemoveChild(node);
        detached[record.Id] = node;
        return true;
    }

    public void FinalizeDetach(WorldEditRecord record)
    {
        if (detached.Remove(record.Id, out TNode? node)) node.QueueFree();
    }

    public void Shutdown()
    {
        foreach (TNode node in active.Values.Concat(detached.Values).Distinct())
        {
            if (node.GetParent() is Node parent) parent.RemoveChild(node);
            node.QueueFree();
        }
        active.Clear();
        detached.Clear();
    }

    protected abstract TNode CreateNode(WorldEditRecord record);

    protected abstract void ConfigureNode(TNode node, WorldEditRecord record);

    protected virtual void OnAttached(TNode node, WorldEditRecord record) { }

    protected virtual void OnDetaching(TNode node, WorldEditRecord record) { }
}

internal sealed class GodotVisualWorldEditParticipant : GodotNodeWorldEditParticipant<Node3D>
{
    public GodotVisualWorldEditParticipant(Node3D owner) : base(WorldEditParticipantIds.Visual, owner) { }

    protected override Node3D CreateNode(WorldEditRecord record)
    {
        Node3D root = new() { Name = record.Id };
        root.AddChild(new MeshInstance3D { Name = "Visual" });
        return root;
    }

    protected override void ConfigureNode(Node3D node, WorldEditRecord record)
    {
        float height = (float)Math.Max(record.Height, record.GeneratorType == "ROAD_SEGMENT" ? 0.35 : 1);
        node.Name = record.Id;
        node.Position = new Vector3((float)record.Position.X, (float)record.Position.Y + height / 2, (float)record.Position.Z);
        node.Rotation = new Vector3(0, (float)record.RotationY, 0);
        node.SetMeta("stable_id", record.Id);
        node.SetMeta("spec_id", record.SpecId);
        node.SetMeta("world_kind", record.GeneratorType == "ROAD_SEGMENT" ? "ROAD" : "BUILDING");
        MeshInstance3D mesh = node.GetNode<MeshInstance3D>("Visual");
        mesh.Mesh = new BoxMesh
        {
            Size = new Vector3((float)record.Footprint.Width, height, (float)record.Footprint.Depth),
        };
        mesh.MaterialOverride = new StandardMaterial3D
        {
            AlbedoColor = CategoryColor(record.Category),
            Roughness = record.GeneratorType == "ROAD_SEGMENT" ? 0.86f : 0.58f,
            Metallic = record.GeneratorType == "ROAD_SEGMENT" ? 0.08f : 0.3f,
        };
    }

    private static Color CategoryColor(string category) => category switch
    {
        "RESIDENTIAL" => new Color("63d7ff"),
        "COMMERCIAL" => new Color("ff4fd8"),
        "OPERATIONS" => new Color("ff9f43"),
        "FACILITIES" => new Color("55ef8b"),
        _ => new Color("67727e"),
    };
}

internal sealed class GodotColliderWorldEditParticipant : GodotNodeWorldEditParticipant<StaticBody3D>
{
    private readonly WorldCollisionRegistry registry;

    public GodotColliderWorldEditParticipant(Node3D owner, WorldCollisionRegistry registry)
        : base(WorldEditParticipantIds.Collider, owner) =>
        this.registry = registry ?? throw new ArgumentNullException(nameof(registry));

    protected override StaticBody3D CreateNode(WorldEditRecord record)
    {
        StaticBody3D body = new() { Name = $"{record.Id}-Collision" };
        body.AddChild(new CollisionShape3D { Name = "Shape" });
        return body;
    }

    protected override void ConfigureNode(StaticBody3D node, WorldEditRecord record)
    {
        float height = (float)Math.Max(record.Height, record.GeneratorType == "ROAD_SEGMENT" ? 0.35 : 1);
        node.Name = $"{record.Id}-Collision";
        node.Position = new Vector3((float)record.Position.X, (float)record.Position.Y + height / 2, (float)record.Position.Z);
        node.Rotation = new Vector3(0, (float)record.RotationY, 0);
        node.CollisionLayer = (uint)CollisionLayer.StaticObstacle;
        node.CollisionMask = (uint)CollisionMasks.StaticObstacle;
        node.GetNode<CollisionShape3D>("Shape").Shape = new BoxShape3D
        {
            Size = new Vector3((float)record.Footprint.Width, height, (float)record.Footprint.Depth),
        };
    }

    protected override void OnAttached(StaticBody3D node, WorldEditRecord record)
    {
        float height = (float)Math.Max(record.Height, record.GeneratorType == "ROAD_SEGMENT" ? 0.35 : 1);
        registry.Register(new WorldColliderMetadata(
            record.Id,
            "USER_WORLD",
            record.GeneratorType == "ROAD_SEGMENT" ? "ROAD" : "BUILDING",
            CollisionLayer.StaticObstacle,
            CollisionMasks.StaticObstacle,
            node.GlobalPosition,
            new Vector3((float)record.Footprint.Width, height, (float)record.Footprint.Depth),
            record.RotationY,
            node));
    }

    protected override void OnDetaching(StaticBody3D node, WorldEditRecord record)
    {
        if (!registry.Unregister(record.Id))
        {
            throw new InvalidOperationException($"Collider {record.Id} was not registered.");
        }
    }
}

internal sealed class OccupancyWorldEditParticipant : IWorldEditParticipant
{
    private readonly Dictionary<string, WorldEditRecord> records = new(StringComparer.Ordinal);

    public string Id => WorldEditParticipantIds.Occupancy;

    public IReadOnlyCollection<WorldEditRecord> Records => records.Values;

    public IReadOnlyList<PlacementWorldOccupant> Snapshot() => records.Values
        .OrderBy(record => record.Id, StringComparer.Ordinal)
        .Select(record => new PlacementWorldOccupant(
            record.Id,
            record.Name,
            record.GeneratorType == "ROAD_SEGMENT" ? "ROAD" : "BUILDING",
            PlacementGeometry.CreateRect(
                record.Position.X,
                record.Position.Z,
                record.Footprint.Width,
                record.Footprint.Depth,
                record.RotationY,
                PlacementGeometry.DefaultClearance),
            ConnectedRoad: record.GeneratorType == "ROAD_SEGMENT"))
        .ToArray();

    public bool Attach(WorldEditRecord record) => records.TryAdd(record.Id, record);

    public bool Detach(WorldEditRecord record) => records.Remove(record.Id);
}

internal sealed class TrafficRoadWorldEditParticipant : IWorldEditParticipant
{
    private readonly TrafficRoadGraph graph;
    private readonly WorldSurfaceModel surface;
    private readonly Node3D owner;
    private readonly Action topologyChanged;
    private readonly Dictionary<string, WorldEditRecord> records = new(StringComparer.Ordinal);
    private readonly Dictionary<string, UserRoadRegistration> registrations = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MeshInstance3D> directives = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MeshInstance3D> detachedDirectives = new(StringComparer.Ordinal);

    public TrafficRoadWorldEditParticipant(
        TrafficRoadGraph graph,
        WorldSurfaceModel surface,
        Node3D owner,
        Action topologyChanged)
    {
        this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
        this.surface = surface ?? throw new ArgumentNullException(nameof(surface));
        this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
        this.topologyChanged = topologyChanged ?? throw new ArgumentNullException(nameof(topologyChanged));
    }

    public string Id => WorldEditParticipantIds.RoadGraph;

    public IReadOnlyDictionary<string, WorldEditRecord> Records => records;

    public RoadNetworkSnapshot NetworkSnapshot => graph.GetRoadNetworkSnapshot();

    public int RoadCount => registrations.Count;

    public bool Attach(WorldEditRecord record)
    {
        if (!records.TryAdd(record.Id, record)) return false;
        if (record.GeneratorType != "ROAD_SEGMENT") return true;
        bool bridge = record.SpecId == "BRIDGE_DECK";
        UserRoadRegistration? registration = null;
        bool deckAdded = false;
        MeshInstance3D? directive = null;
        try
        {
            registration = graph.RegisterUserRoad(new UserRoadSegmentDefinition(
                record.Id,
                new TrafficPoint(record.Position.X, record.Position.Z),
                record.Footprint.Width,
                record.Footprint.Depth,
                record.RotationY,
                record.SpecId == "ROAD_INTERSECTION",
                bridge));
            registrations.Add(record.Id, registration);
            if (bridge)
            {
                deckAdded = surface.RegisterDeck(ToSurfaceDeck(record));
                if (!deckAdded) throw new InvalidOperationException($"Bridge deck {record.Id} is already registered.");
            }
            if (!detachedDirectives.Remove(record.Id, out directive)) directive = CreateDirective(record, registration.Connected);
            ConfigureDirective(directive, record, registration.Connected);
            owner.AddChild(directive);
            directives.Add(record.Id, directive);
            topologyChanged();
            return true;
        }
        catch
        {
            if (directive?.GetParent() is Node parent) parent.RemoveChild(directive);
            if (directive is not null) detachedDirectives[record.Id] = directive;
            if (deckAdded) _ = surface.UnregisterDeck(record.Id);
            if (registration is not null)
            {
                _ = graph.UnregisterUserRoad(record.Id);
                registrations.Remove(record.Id);
            }
            records.Remove(record.Id);
            throw;
        }
    }

    public bool Detach(WorldEditRecord record)
    {
        if (!records.ContainsKey(record.Id)) return false;
        if (record.GeneratorType != "ROAD_SEGMENT") return records.Remove(record.Id);
        UserRoadRegistration registration = registrations[record.Id];
        bool bridge = record.SpecId == "BRIDGE_DECK";
        if (bridge && !surface.UnregisterDeck(record.Id))
        {
            throw new InvalidOperationException($"Bridge deck {record.Id} was not registered.");
        }
        if (!graph.UnregisterUserRoad(record.Id))
        {
            if (bridge) _ = surface.RegisterDeck(ToSurfaceDeck(record));
            throw new InvalidOperationException($"Traffic road {record.Id} was not registered.");
        }
        registrations.Remove(record.Id);
        if (directives.Remove(record.Id, out MeshInstance3D? directive))
        {
            owner.RemoveChild(directive);
            detachedDirectives[record.Id] = directive;
        }
        records.Remove(record.Id);
        try
        {
            topologyChanged();
        }
        catch
        {
            // Derived mobility refresh cannot invalidate a completed topology mutation.
        }
        _ = registration;
        return true;
    }

    public void FinalizeDetach(WorldEditRecord record)
    {
        if (detachedDirectives.Remove(record.Id, out MeshInstance3D? directive)) directive.QueueFree();
    }

    public void Shutdown()
    {
        foreach (WorldEditRecord record in records.Values.Where(item => item.GeneratorType == "ROAD_SEGMENT").ToArray())
        {
            if (record.SpecId == "BRIDGE_DECK") _ = surface.UnregisterDeck(record.Id);
            _ = graph.UnregisterUserRoad(record.Id);
        }
        foreach (MeshInstance3D directive in directives.Values.Concat(detachedDirectives.Values).Distinct())
        {
            if (directive.GetParent() is Node parent) parent.RemoveChild(directive);
            directive.QueueFree();
        }
        records.Clear();
        registrations.Clear();
        directives.Clear();
        detachedDirectives.Clear();
    }

    private static SurfaceDeck ToSurfaceDeck(WorldEditRecord record) => new(
        record.Id,
        record.Position.X - record.Footprint.Width / 2,
        record.Position.X + record.Footprint.Width / 2,
        record.Position.Z - record.Footprint.Depth / 2,
        record.Position.Z + record.Footprint.Depth / 2,
        record.Position.Y + record.Height);

    private static MeshInstance3D CreateDirective(WorldEditRecord record, bool connected) => new()
    {
        Name = $"{record.Id}-TrafficDirective",
        Mesh = new CylinderMesh
        {
            Height = 0.08f,
            TopRadius = 12.5f,
            BottomRadius = 12.5f,
            RadialSegments = 32,
        },
        CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
    };

    private static void ConfigureDirective(MeshInstance3D directive, WorldEditRecord record, bool connected)
    {
        directive.Position = new Vector3(
            (float)record.Position.X,
            (float)(record.Position.Y + record.Height + 0.05),
            (float)record.Position.Z);
        Color color = record.SpecId == "BRIDGE_DECK"
            ? new Color(0.1f, 0.9f, 1, 0.24f)
            : connected
                ? new Color(0.15f, 1, 0.45f, 0.2f)
                : new Color(1, 0.58f, 0.1f, 0.28f);
        directive.MaterialOverride = new StandardMaterial3D
        {
            AlbedoColor = color,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        };
    }
}

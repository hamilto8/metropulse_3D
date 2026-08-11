using Godot;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Simulation;
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

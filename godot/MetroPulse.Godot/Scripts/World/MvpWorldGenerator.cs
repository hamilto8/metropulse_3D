using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.World;

namespace MetroPulse.Godot.World;

public sealed record MayhemWorldObjectState(
    string StableId,
    Node3D Owner,
    WorldColliderMetadata Collider,
    uint CollisionLayer,
    uint CollisionMask);

public partial class MvpWorldGenerator : Node3D
{
    private readonly Dictionary<string, Node3D> chunks = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Node3D> runtimeObjects = new(StringComparer.Ordinal);
    private readonly HashSet<string> mayhemSuspended = new(StringComparer.Ordinal);

    public bool IsBuilt { get; private set; }

    public WorldResourceCache Resources { get; } = new();

    public WorldCollisionRegistry Colliders { get; } = new();

    public WorldSurfaceModel Surface { get; private set; } = new();

    public MvpWorldLayout? Layout { get; private set; }

    public int MultiMeshGroupCount { get; private set; }

    public WorldDebugTraversalCapsule? DebugTraversalCapsule { get; private set; }

    public IReadOnlyList<WorldObjectDefinition> MayhemTargets => Layout?.Objects
        .Where(item => item.ChunkId == "InitialSkyline" && item.Kind == "building")
        .OrderBy(item => item.Id, StringComparer.Ordinal)
        .ToArray() ?? Array.Empty<WorldObjectDefinition>();

    public void Initialize(GameContentRegistry content)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (IsBuilt)
        {
            throw new InvalidOperationException("The authored MVP world is already built.");
        }
        Layout = MvpWorldLayout.CreateProduction(content);
        Surface = new WorldSurfaceModel();
        foreach (string chunkId in Layout.ChunkIds)
        {
            Node3D chunk = new() { Name = chunkId };
            AddChild(chunk);
            chunks.Add(chunkId, chunk);
        }
        foreach (WorldObjectDefinition definition in Layout.Objects)
        {
            AddObject(definition, Layout.Materials[definition.MaterialId]);
        }
        foreach (WorldInstanceGroupDefinition group in Layout.InstanceGroups)
        {
            AddInstances(group, Layout.Materials[group.MaterialId]);
        }
        foreach (WorldSegmentGroupDefinition group in Layout.SegmentGroups)
        {
            AddSegments(group, Layout.Materials[group.MaterialId]);
        }
        if (OS.IsDebugBuild())
        {
            DebugTraversalCapsule = new WorldDebugTraversalCapsule();
            DebugTraversalCapsule.Initialize();
            AddChild(DebugTraversalCapsule);
        }
        IsBuilt = true;
    }

    public void ShutdownWorld()
    {
        if (!IsBuilt)
        {
            return;
        }
        foreach (Node child in GetChildren())
        {
            RemoveChild(child);
            child.QueueFree();
        }
        chunks.Clear();
        runtimeObjects.Clear();
        mayhemSuspended.Clear();
        Colliders.Clear();
        Resources.Clear();
        Layout = null;
        MultiMeshGroupCount = 0;
        DebugTraversalCapsule = null;
        IsBuilt = false;
    }

    public override void _ExitTree()
    {
        ShutdownWorld();
    }

    private void AddObject(WorldObjectDefinition definition, WorldMaterialDefinition material)
    {
        Node3D owner = new()
        {
            Name = definition.Id,
            Position = ToVector(definition.Position),
            Rotation = new Vector3(0, (float)definition.RotationY, 0),
        };
        owner.SetMeta("stable_id", definition.Id);
        owner.SetMeta("world_kind", definition.Kind);
        owner.SetMeta("world_chunk", definition.ChunkId);
        chunks[definition.ChunkId].AddChild(owner);
        runtimeObjects.Add(definition.Id, owner);

        if (definition.Rendered)
        {
            MeshInstance3D mesh = new()
            {
                Name = "Visual",
                Mesh = Resources.GetMesh(definition.Primitive, definition.Size),
                MaterialOverride = Resources.GetMaterial(material),
                CastShadow = definition.CastShadow
                    ? GeometryInstance3D.ShadowCastingSetting.On
                    : GeometryInstance3D.ShadowCastingSetting.Off,
            };
            owner.AddChild(mesh);
        }

        if (definition.Role == WorldObjectRole.Decoration)
        {
            return;
        }
        StaticBody3D body = new()
        {
            Name = "Collision",
            CollisionLayer = (uint)definition.Layer,
            CollisionMask = (uint)definition.Mask,
        };
        CollisionShape3D shape = new()
        {
            Name = "Shape",
            Shape = Resources.GetShape(definition.Primitive, definition.Size),
        };
        body.AddChild(shape);
        owner.AddChild(body);
        Colliders.Register(new(
            definition.Id,
            definition.ChunkId,
            definition.Kind,
            definition.Layer,
            definition.Mask,
            owner.GlobalPosition,
            ToVector(definition.Size),
            definition.RotationY,
            body));
    }

    public MayhemWorldObjectState? SuspendMayhemTarget(string stableId)
    {
        if (!runtimeObjects.TryGetValue(stableId, out Node3D? owner)
            || mayhemSuspended.Contains(stableId)
            || !Colliders.TryGet(stableId, out WorldColliderMetadata? collider)
            || collider is null)
        {
            return null;
        }
        var state = new MayhemWorldObjectState(
            stableId,
            owner,
            collider,
            collider.Body.CollisionLayer,
            collider.Body.CollisionMask);
        owner.Visible = false;
        collider.Body.CollisionLayer = 0;
        collider.Body.CollisionMask = 0;
        if (!Colliders.Unregister(stableId))
        {
            owner.Visible = true;
            collider.Body.CollisionLayer = state.CollisionLayer;
            collider.Body.CollisionMask = state.CollisionMask;
            return null;
        }
        mayhemSuspended.Add(stableId);
        return state;
    }

    public bool RestoreMayhemTarget(MayhemWorldObjectState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (!mayhemSuspended.Remove(state.StableId)) return false;
        state.Owner.Visible = true;
        state.Collider.Body.CollisionLayer = state.CollisionLayer;
        state.Collider.Body.CollisionMask = state.CollisionMask;
        Colliders.Register(state.Collider);
        return true;
    }

    private void AddInstances(WorldInstanceGroupDefinition group, WorldMaterialDefinition material)
    {
        foreach (IGrouping<(int X, int Z), WorldInstanceTransform> cell in group.Instances.GroupBy(item => (
            (int)Math.Floor(item.Position.X / group.CellSize),
            (int)Math.Floor(item.Position.Z / group.CellSize))))
        {
            WorldInstanceTransform[] instances = cell.ToArray();
            MultiMesh multiMesh = new()
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
                Mesh = Resources.GetMesh(group.Primitive, group.MeshSize),
                InstanceCount = instances.Length,
            };
            for (int index = 0; index < instances.Length; index++)
            {
                WorldInstanceTransform instance = instances[index];
                Basis basis = new Basis(Vector3.Up, (float)instance.RotationY).Scaled(ToVector(instance.Scale));
                multiMesh.SetInstanceTransform(index, new Transform3D(basis, ToVector(instance.Position)));
            }
            MultiMeshInstance3D node = new()
            {
                Name = $"{group.Id}-cell-{cell.Key.X}-{cell.Key.Z}",
                Multimesh = multiMesh,
                MaterialOverride = Resources.GetMaterial(material),
                CastShadow = group.CastShadow
                    ? GeometryInstance3D.ShadowCastingSetting.On
                    : GeometryInstance3D.ShadowCastingSetting.Off,
            };
            chunks[group.ChunkId].AddChild(node);
            MultiMeshGroupCount++;
        }
    }

    private void AddSegments(WorldSegmentGroupDefinition group, WorldMaterialDefinition material)
    {
        foreach (IGrouping<(int X, int Z), WorldSegmentDefinition> cell in group.Segments.GroupBy(item => (
            (int)Math.Floor(item.Start.X / group.CellSize),
            (int)Math.Floor(item.Start.Z / group.CellSize))))
        {
            WorldSegmentDefinition[] segments = cell.ToArray();
            MultiMesh multiMesh = new()
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
                Mesh = Resources.GetMesh(WorldPrimitiveKind.Cylinder, new WorldVector3(1, 1, 1)),
                InstanceCount = segments.Length,
            };
            for (int index = 0; index < segments.Length; index++)
            {
                Vector3 start = ToVector(segments[index].Start);
                Vector3 end = ToVector(segments[index].End);
                Vector3 delta = end - start;
                Basis basis = new(new Quaternion(Vector3.Up, delta.Normalized()));
                basis = basis.Scaled(new Vector3((float)group.Diameter, delta.Length(), (float)group.Diameter));
                multiMesh.SetInstanceTransform(index, new Transform3D(basis, (start + end) * 0.5f));
            }
            MultiMeshInstance3D node = new()
            {
                Name = $"{group.Id}-cell-{cell.Key.X}-{cell.Key.Z}",
                Multimesh = multiMesh,
                MaterialOverride = Resources.GetMaterial(material),
                CastShadow = group.CastShadow
                    ? GeometryInstance3D.ShadowCastingSetting.On
                    : GeometryInstance3D.ShadowCastingSetting.Off,
            };
            chunks[group.ChunkId].AddChild(node);
            MultiMeshGroupCount++;
        }
    }

    private static Vector3 ToVector(WorldVector3 value) => new((float)value.X, (float)value.Y, (float)value.Z);
}

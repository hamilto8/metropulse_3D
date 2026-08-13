using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.World;
using MetroPulse.Godot.Construction;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Countryside;

public partial class CountrysideExpansionRuntime : Node, IFeatureSceneryOwner
{
    private const string GroupName = "countryside_expansion";
    private readonly Dictionary<string, SceneryOwner> scenery = new(StringComparer.Ordinal);
    private readonly List<string> colliderIds = [];
    private MvpWorldGenerator world = null!;
    private CityEditorRuntime editor = null!;
    private Node3D package = null!;

    public bool Initialized { get; private set; }

    public CountrysideExpansionPlan Plan { get; private set; } = null!;

    public int HouseCount => scenery.Values.Count(item => item.Kind == CountrysideSceneryKinds.House);

    public int TreeCount => scenery.Values.Count(item => item.Kind == CountrysideSceneryKinds.Tree);

    public int RoadVisualCount { get; private set; }

    public int BridgeCount { get; private set; }

    public int OwnedColliderCount => colliderIds.Count;

    public void Initialize(
        GameContentRegistry content,
        MvpWorldGenerator worldOwner,
        CityEditorRuntime editorOwner,
        Node3D worldRoot)
    {
        if (Initialized) throw new InvalidOperationException("Countryside expansion is already initialized.");
        ArgumentNullException.ThrowIfNull(content);
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        editor = editorOwner ?? throw new ArgumentNullException(nameof(editorOwner));
        ArgumentNullException.ThrowIfNull(worldRoot);
        Plan = CountrysideExpansionModel.Create(content);
        package = new Node3D { Name = "CountrysideExpansion" };
        package.AddToGroup(GroupName);
        worldRoot.AddChild(package);
        BuildTerrain(content.CountrysideGrid);
        BuildRoads(content.CountrysideGrid);
        BuildRiverAndBridges();
        foreach (CountrysideSceneryPlacement house in Plan.Houses) AddHouse(house);
        foreach (CountrysideSceneryPlacement tree in Plan.Trees) AddTree(tree);
        editor.AttachFeatureSceneryOwner(this);
        Initialized = true;
    }

    public int RemoveOverlapping(PlacementRect footprint)
    {
        if (!Initialized || footprint is not { IsFinite: true }) return 0;
        string[] conflicts = scenery.Values
            .Where(item => PlacementGeometry.Overlaps(footprint, item.Occupancy))
            .Select(item => item.Id)
            .ToArray();
        foreach (string id in conflicts) RemoveScenery(id);
        return conflicts.Length;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        editor.DetachFeatureSceneryOwner(this);
        foreach (string id in colliderIds) _ = world.Colliders.Unregister(id);
        colliderIds.Clear();
        scenery.Clear();
        if (GodotObject.IsInstanceValid(package)) package.QueueFree();
        RoadVisualCount = 0;
        BridgeCount = 0;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildTerrain(CountrysideGridDefinition grid)
    {
        PlanarExtentDefinition bounds = grid.Bounds!;
        const double cell = 20;
        var surface = new SurfaceTool();
        surface.Begin(Mesh.PrimitiveType.Triangles);
        for (double x = bounds.MinX; x < bounds.MaxX; x += cell)
        {
            for (double z = bounds.MinZ; z < bounds.MaxZ; z += cell)
            {
                float x1 = (float)x;
                float x2 = (float)Math.Min(bounds.MaxX, x + cell);
                float z1 = (float)z;
                float z2 = (float)Math.Min(bounds.MaxZ, z + cell);
                Vector3 a = TerrainPoint(x1, z1);
                Vector3 b = TerrainPoint(x2, z1);
                Vector3 c = TerrainPoint(x2, z2);
                Vector3 d = TerrainPoint(x1, z2);
                AddTriangle(surface, a, c, b);
                AddTriangle(surface, a, d, c);
            }
        }
        surface.GenerateNormals();
        ArrayMesh mesh = surface.Commit();
        var terrain = new MeshInstance3D
        {
            Name = "RollingTerrain",
            Mesh = mesh,
            MaterialOverride = Material(new Color("3b7a57"), roughness: 0.95f),
        };
        package.AddChild(terrain);
        var body = new StaticBody3D
        {
            Name = "CountrysideTerrainCollision",
            CollisionLayer = (uint)CollisionLayer.Surface,
            CollisionMask = (uint)CollisionMasks.Surface,
        };
        Shape3D terrainShape = mesh.CreateTrimeshShape();
        if (terrainShape is ConcavePolygonShape3D concave) concave.BackfaceCollision = true;
        body.AddChild(new CollisionShape3D { Shape = terrainShape });
        package.AddChild(body);
        RegisterCollider(
            "countryside-terrain",
            "rolling-terrain",
            CollisionLayer.Surface,
            CollisionMasks.Surface,
            new Vector3(610, 0, 0),
            new Vector3(380, 12, 700),
            body);
    }

    private void BuildRoads(CountrysideGridDefinition grid)
    {
        foreach (double z in grid.HorizontalRoadCenters!)
        {
            AddRoadRibbon($"CountryRoadZ{z:0}", new Vector3(420, 0, (float)z), new Vector3(800, 0, (float)z), grid.RoadWidth);
        }
        foreach (double x in grid.VerticalRoadCenters!)
        {
            AddRoadRibbon($"CountryRoadX{x:0}", new Vector3((float)x, 0, -100), new Vector3((float)x, 0, 100), grid.RoadWidth);
        }
        VerticalRoadDefinition access = grid.RocketAccessRoad!;
        AddRoadRibbon("RocketAccessRoad", new Vector3((float)access.CenterX, 0, (float)access.MinZ), new Vector3((float)access.CenterX, 0, (float)access.MaxZ), access.Width);
        HorizontalRoadDefinition spur = grid.MissionControlSpur!;
        AddRoadRibbon("MissionControlSpur", new Vector3((float)spur.MinX, 0, (float)spur.CenterZ), new Vector3((float)spur.MaxX, 0, (float)spur.CenterZ), spur.Width);
    }

    private void BuildRiverAndBridges()
    {
        AddBox(package, "CountrysideRiver", new Vector3(400, -1.2f, 0), new Vector3(40, 0.08f, 800), new Color("24568c"), roughness: 0.2f);
        AddObstacle("countryside-riverbank-west", "riverbank", new Vector3(378.5f, -2, 0), new Vector3(3, 4.2f, 800), new Color("5f6368"));
        AddObstacle("countryside-riverbank-east", "riverbank", new Vector3(421.5f, -2, 0), new Vector3(3, 4.2f, 800), new Color("5f6368"));
        double[] centers = [-100, -50, 0, 50, 100];
        for (int index = 0; index < centers.Length; index++)
        {
            float z = (float)centers[index];
            string prefix = $"countryside-bridge-{index}";
            AddSurface($"{prefix}-deck", "bridge-deck", new Vector3(400, 0, z), new Vector3(40, 0.35f, 16), new Color("3d312a"));
            AddObstacle($"{prefix}-north-rail", "bridge-barrier", new Vector3(400, 1.25f, z - 7.5f), new Vector3(40, 2.5f, 0.5f), new Color("d69e2e"));
            AddObstacle($"{prefix}-south-rail", "bridge-barrier", new Vector3(400, 1.25f, z + 7.5f), new Vector3(40, 2.5f, 0.5f), new Color("d69e2e"));
            BridgeCount++;
        }
    }

    private void AddHouse(CountrysideSceneryPlacement placement)
    {
        float y = (float)world.Surface.GetTerrainHeight(placement.X, placement.Z);
        var owner = new Node3D
        {
            Name = placement.Id,
            Position = new Vector3((float)placement.X, y, (float)placement.Z),
            Rotation = new Vector3(0, (float)placement.RotationY, 0),
        };
        package.AddChild(owner);
        AddBox(owner, "Walls", new Vector3(0, 3, 0), new Vector3(10, 6, 8), HouseColor(placement.Id));
        var roof = AddBox(owner, "Roof", new Vector3(0, 7.1f, 0), new Vector3(11.6f, 2.8f, 8.8f), new Color("5c3d2e"));
        roof.Rotation = new Vector3(0, 0, Mathf.Pi / 4);
        AddBox(owner, "Chimney", new Vector3(-2.8f, 8.5f, -1.5f), new Vector3(1.2f, 4, 1.2f), new Color("6d4c41"));
        AddSceneryCollider(placement, owner, new Vector3(0, 3, 0), new Vector3(10, 6, 8), "suburban-house");
    }

    private void AddTree(CountrysideSceneryPlacement placement)
    {
        float y = (float)world.Surface.GetTerrainHeight(placement.X, placement.Z);
        var owner = new Node3D
        {
            Name = placement.Id,
            Position = new Vector3((float)placement.X, y - 0.2f, (float)placement.Z),
        };
        package.AddChild(owner);
        AddCylinder(owner, "Trunk", new Vector3(0, 1.5f, 0), 0.5f, 3, new Color("4a3525"));
        AddSphere(owner, "LeavesLower", new Vector3(0, 3.5f, 0), 2.5f, new Color("1e824c"));
        AddSphere(owner, "LeavesUpper", new Vector3(0, 5.2f, 0), 1.8f, new Color("277d4b"));
        AddSceneryCollider(placement, owner, new Vector3(0, 2.5f, 0), new Vector3(1.2f, 5, 1.2f), "tree-trunk");
    }

    private void AddSceneryCollider(
        CountrysideSceneryPlacement placement,
        Node3D owner,
        Vector3 localPosition,
        Vector3 size,
        string kind)
    {
        var body = new StaticBody3D
        {
            Name = "Collision",
            Position = localPosition,
            CollisionLayer = (uint)CollisionLayer.StaticObstacle,
            CollisionMask = (uint)CollisionMasks.StaticObstacle,
        };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
        owner.AddChild(body);
        RegisterCollider(
            placement.Id,
            kind,
            CollisionLayer.StaticObstacle,
            CollisionMasks.StaticObstacle,
            owner.GlobalPosition + localPosition,
            size,
            body,
            placement.RotationY);
        scenery.Add(placement.Id, new SceneryOwner(placement.Id, placement.Kind, placement.Occupancy, owner));
    }

    private void RemoveScenery(string id)
    {
        if (!scenery.Remove(id, out SceneryOwner? owned)) return;
        _ = world.Colliders.Unregister(id);
        colliderIds.Remove(id);
        if (GodotObject.IsInstanceValid(owned.Owner)) owned.Owner.QueueFree();
    }

    private void AddRoadRibbon(string name, Vector3 start, Vector3 end, double width)
    {
        Vector3 delta = end - start;
        int segments = Math.Max(1, (int)Math.Ceiling(delta.Length() / 10));
        for (int index = 0; index < segments; index++)
        {
            float t0 = index / (float)segments;
            float t1 = (index + 1) / (float)segments;
            Vector3 a = start.Lerp(end, t0);
            Vector3 b = start.Lerp(end, t1);
            a.Y = (float)world.Surface.GetTerrainHeight(a.X, a.Z) + 0.05f;
            b.Y = (float)world.Surface.GetTerrainHeight(b.X, b.Z) + 0.05f;
            Vector3 center = (a + b) * 0.5f;
            Vector3 size = Math.Abs(delta.X) >= Math.Abs(delta.Z)
                ? new Vector3(new Vector2(a.X, a.Y).DistanceTo(new Vector2(b.X, b.Y)), 0.12f, (float)width)
                : new Vector3((float)width, 0.12f, new Vector2(a.Z, a.Y).DistanceTo(new Vector2(b.Z, b.Y)));
            MeshInstance3D road = AddBox(package, $"{name}-{index:00}", center, size, new Color("25282d"), roughness: 0.9f);
            if (Math.Abs(delta.X) >= Math.Abs(delta.Z)) road.Rotation = new Vector3(0, 0, MathF.Atan2(b.Y - a.Y, b.X - a.X));
            else road.Rotation = new Vector3(-MathF.Atan2(b.Y - a.Y, b.Z - a.Z), 0, 0);
            RoadVisualCount++;
        }
    }

    private void AddSurface(string id, string kind, Vector3 position, Vector3 size, Color color)
    {
        AddBox(package, $"{id}-visual", position, size, color);
        var body = Body(id, position, size, CollisionLayer.Surface, CollisionMasks.Surface);
        RegisterCollider(id, kind, CollisionLayer.Surface, CollisionMasks.Surface, position, size, body);
    }

    private void AddObstacle(string id, string kind, Vector3 position, Vector3 size, Color color)
    {
        AddBox(package, $"{id}-visual", position, size, color);
        var body = Body(id, position, size, CollisionLayer.StaticObstacle, CollisionMasks.StaticObstacle);
        RegisterCollider(id, kind, CollisionLayer.StaticObstacle, CollisionMasks.StaticObstacle, position, size, body);
    }

    private StaticBody3D Body(string id, Vector3 position, Vector3 size, CollisionLayer layer, CollisionLayer mask)
    {
        var body = new StaticBody3D
        {
            Name = $"{id}-collision",
            Position = position,
            CollisionLayer = (uint)layer,
            CollisionMask = (uint)mask,
        };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
        package.AddChild(body);
        return body;
    }

    private void RegisterCollider(
        string id,
        string kind,
        CollisionLayer layer,
        CollisionLayer mask,
        Vector3 position,
        Vector3 size,
        StaticBody3D body,
        double rotationY = 0)
    {
        body.SetMeta("stable_id", id);
        world.Colliders.Register(new WorldColliderMetadata(
            id,
            "CountrysideExpansion",
            kind,
            layer,
            mask,
            position,
            size,
            rotationY,
            body));
        colliderIds.Add(id);
    }

    private Vector3 TerrainPoint(float x, float z) => new(x, (float)world.Surface.GetTerrainHeight(x, z), z);

    private static void AddTriangle(SurfaceTool surface, Vector3 first, Vector3 second, Vector3 third)
    {
        surface.AddVertex(first);
        surface.AddVertex(second);
        surface.AddVertex(third);
    }

    private static MeshInstance3D AddBox(
        Node3D owner,
        string name,
        Vector3 position,
        Vector3 size,
        Color color,
        float roughness = 0.7f)
    {
        var visual = new MeshInstance3D
        {
            Name = name,
            Position = position,
            Mesh = new BoxMesh { Size = size },
            MaterialOverride = Material(color, roughness),
        };
        owner.AddChild(visual);
        return visual;
    }

    private static void AddCylinder(Node3D owner, string name, Vector3 position, float radius, float height, Color color)
    {
        var visual = new MeshInstance3D
        {
            Name = name,
            Position = position,
            Mesh = new CylinderMesh { TopRadius = radius * 0.8f, BottomRadius = radius, Height = height, RadialSegments = 8 },
            MaterialOverride = Material(color),
        };
        owner.AddChild(visual);
    }

    private static void AddSphere(Node3D owner, string name, Vector3 position, float radius, Color color)
    {
        var visual = new MeshInstance3D
        {
            Name = name,
            Position = position,
            Mesh = new SphereMesh { Radius = radius, Height = radius * 2, RadialSegments = 8, Rings = 4 },
            MaterialOverride = Material(color),
        };
        owner.AddChild(visual);
    }

    private static StandardMaterial3D Material(Color color, float roughness = 0.7f) => new()
    {
        AlbedoColor = color,
        Roughness = roughness,
    };

    private static Color HouseColor(string id)
    {
        Color[] colors = [new("dfd3c3"), new("a3b899"), new("b8b5ff"), new("fce38a"), new("e23e57"), new("3f72af"), new("95e1d3")];
        int hash = id.Aggregate(17, (value, character) => unchecked(value * 31 + character));
        return colors[(hash & int.MaxValue) % colors.Length];
    }

    private sealed record SceneryOwner(string Id, string Kind, PlacementRect Occupancy, Node3D Owner);
}

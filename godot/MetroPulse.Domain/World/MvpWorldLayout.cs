using MetroPulse.Domain.Content;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Domain.World;

public enum WorldPrimitiveKind
{
    Box,
    Cylinder,
    Sphere,
}

public enum WorldObjectRole
{
    Decoration,
    Surface,
    StaticObstacle,
}

public sealed record WorldVector3(double X, double Y, double Z)
{
    public static readonly WorldVector3 One = new(1, 1, 1);
}

public sealed record WorldMaterialDefinition(
    string Id,
    int Color,
    double Roughness = 0.7,
    double Metallic = 0,
    int? EmissionColor = null,
    double EmissionEnergy = 0,
    double Opacity = 1);

public sealed record WorldObjectDefinition(
    string Id,
    string ChunkId,
    string Kind,
    WorldPrimitiveKind Primitive,
    WorldVector3 Position,
    WorldVector3 Size,
    string MaterialId,
    WorldObjectRole Role = WorldObjectRole.Decoration,
    double RotationY = 0,
    bool Rendered = true,
    bool CastShadow = true)
{
    public CollisionLayer Layer => Role switch
    {
        WorldObjectRole.Surface => CollisionLayer.Surface,
        WorldObjectRole.StaticObstacle => CollisionLayer.StaticObstacle,
        _ => CollisionLayer.None,
    };

    public CollisionLayer Mask => Role switch
    {
        WorldObjectRole.Surface => CollisionMasks.Surface,
        WorldObjectRole.StaticObstacle => CollisionMasks.StaticObstacle,
        _ => CollisionLayer.None,
    };
}

public sealed record WorldInstanceTransform(
    string Id,
    WorldVector3 Position,
    WorldVector3 Scale,
    double RotationY = 0);

public sealed record WorldInstanceGroupDefinition(
    string Id,
    string ChunkId,
    WorldPrimitiveKind Primitive,
    WorldVector3 MeshSize,
    string MaterialId,
    double CellSize,
    IReadOnlyList<WorldInstanceTransform> Instances,
    bool CastShadow = false);

public sealed record WorldSegmentDefinition(string Id, WorldVector3 Start, WorldVector3 End);

public sealed record WorldSegmentGroupDefinition(
    string Id,
    string ChunkId,
    string MaterialId,
    double Diameter,
    double CellSize,
    IReadOnlyList<WorldSegmentDefinition> Segments,
    bool CastShadow = true);

public sealed record MvpWorldLayout(
    IReadOnlyList<string> ChunkIds,
    IReadOnlyDictionary<string, WorldMaterialDefinition> Materials,
    IReadOnlyList<WorldObjectDefinition> Objects,
    IReadOnlyList<WorldInstanceGroupDefinition> InstanceGroups,
    IReadOnlyList<WorldSegmentGroupDefinition> SegmentGroups)
{
    private static readonly string[] ProductionChunkIds =
    [
        "WestCore",
        "RiverCorridor",
        "PrimaryBridge",
        "CentralPark",
        "BuildingPlots",
        "StreetFurniture",
        "InitialSkyline",
    ];

    private static readonly string[] BusinessTypes =
    [
        "NEOTECH",
        "CYBERCAFE",
        "APEX_BANK",
        "STARLIGHT_HOTEL",
        "BOBA_HAVEN",
        "GALAXY_CINEMA",
        "MART_247",
        "METRO_TOWER",
        "ORBITAL_SYSTEMS",
        "QUANTUM_DYNAMIC",
        "VALKYRIE_MOTORS",
        "SYNTH_LABS",
        "NEXUS_PLAZA",
        "CHRONO_BANK",
        "AETHER_TOWER",
        "SOLARIS_HOTEL",
        "CYBER_DYNAMICS",
        "HYPERION_SPA",
        "TITAN_INDUSTRIES",
        "OMNI_CORP",
        "VORTEX_ENERGY",
        "SILICON_SPIRE",
        "ZENITH_TOWER",
    ];

    private static readonly double[] BuildingHeights =
    [75, 25, 85, 65, 20, 35, 18, 95, 105, 88, 70, 80, 56, 92, 115, 78, 62, 42, 72, 58, 68, 102, 82];

    private static readonly int[] BuildingColors =
    [
        0x3b4d68,
        0x5a3e73,
        0x475569,
        0x6b4c7a,
        0x7a4358,
        0x4f3f6e,
        0x3d5a4d,
        0x485265,
        0x3b526c,
        0x4f4a6e,
        0x3a5372,
        0x375a63,
        0x42536b,
        0x555047,
        0x494d5a,
        0x6e4854,
        0x41556b,
        0x604a66,
        0x4d5361,
        0x475064,
        0x4a5868,
        0x3f536d,
        0x50536d,
    ];

    public static MvpWorldLayout CreateProduction(GameContentRegistry content)
    {
        ArgumentNullException.ThrowIfNull(content);
        List<WorldObjectDefinition> objects = [];
        List<WorldInstanceGroupDefinition> instanceGroups = [];
        List<WorldSegmentGroupDefinition> segmentGroups = [];
        Dictionary<string, WorldMaterialDefinition> materials = CreateMaterials();

        AddGroundAndRoads(objects, instanceGroups);
        AddRiver(objects);
        AddBridge(content, objects, segmentGroups);
        AddPark(objects, instanceGroups);
        AddSkyline(objects, instanceGroups, materials);
        AddStreetFurniture(content, objects, instanceGroups);
        AddCafeFurniture(objects);

        return new MvpWorldLayout(
            Array.AsReadOnly(ProductionChunkIds),
            new System.Collections.ObjectModel.ReadOnlyDictionary<string, WorldMaterialDefinition>(materials),
            objects.AsReadOnly(),
            instanceGroups.AsReadOnly(),
            segmentGroups.AsReadOnly());
    }

    private static Dictionary<string, WorldMaterialDefinition> CreateMaterials() => new(StringComparer.Ordinal)
    {
        ["ground"] = new("ground", 0x1e2534, 0.85, 0.1),
        ["basin"] = new("basin", 0x05070f, 1),
        ["water"] = new("water", 0x047aa8, 0.18, 0.35, 0x00bcd4, 0.35, 0.88),
        ["retaining"] = new("retaining", 0x3a4052, 0.8),
        ["road"] = new("road", 0x2c3344, 0.78, 0.18),
        ["road-line"] = new("road-line", 0xffcc00, 0.55),
        ["crosswalk"] = new("crosswalk", 0xeeeeee, 0.45),
        ["sidewalk"] = new("sidewalk", 0x647488, 0.65, 0.12),
        ["park"] = new("park", 0x1b4d2e, 0.9, 0.05),
        ["park-path"] = new("park-path", 0x8c857b, 0.9),
        ["fountain"] = new("fountain", 0x334455, 0.4),
        ["fountain-water"] = new("fountain-water", 0x00aaff, 0.1, 0.8, 0x00aaff, 0.35, 0.85),
        ["tree-trunk"] = new("tree-trunk", 0x4a3525, 0.9),
        ["tree-leaves"] = new("tree-leaves", 0x1e824c, 0.8),
        ["lamp"] = new("lamp", 0x333333, 0.2, 0.8),
        ["lamp-bulb"] = new("lamp-bulb", 0xffd58a, 0.25, 0, 0xffc46b, 0.1),
        ["cafe-metal"] = new("cafe-metal", 0x263449, 0.45, 0.65),
        ["cafe-wood"] = new("cafe-wood", 0x8b5a2b, 0.75),
        ["cafe-accent"] = new("cafe-accent", 0x06b6d4, 0.4, 0, 0x062b36, 0.3),
        ["bridge-deck"] = new("bridge-deck", 0x222633, 0.8),
        ["bridge-sidewalk"] = new("bridge-sidewalk", 0x3b455a, 0.75),
        ["bridge-edge"] = new("bridge-edge", 0x6e1f2d, 0.45, 0.45),
        ["bridge-tower"] = new("bridge-tower", 0xc9334d, 0.35, 0.5),
        ["bridge-cable"] = new("bridge-cable", 0xc7d5df, 0.28, 0.82),
        ["bridge-hanger"] = new("bridge-hanger", 0x899ca9, 0.35, 0.72),
        ["bridge-anchor"] = new("bridge-anchor", 0x586274, 0.78),
        ["window"] = new("window", 0x82abc5, 0.15, 0.45, 0xffd58a, 0.14),
    };

    private static void AddGroundAndRoads(
        ICollection<WorldObjectDefinition> objects,
        ICollection<WorldInstanceGroupDefinition> instanceGroups)
    {
        objects.Add(Box("ground-west", "WestCore", "ground", -32.5, -0.1, 0, 335, 0.2, 800, "ground", WorldObjectRole.Surface));
        objects.Add(Box("ground-primary-corridor", "WestCore", "ground", 282.5, -0.1, 0, 195, 0.2, 800, "ground", WorldObjectRole.Surface));
        objects.Add(Box("river-basin", "RiverCorridor", "river-basin", 160, -4.1, 0, 50, 0.2, 800, "basin", WorldObjectRole.Surface));

        double[] roadsX = [-100, -50, 0, 50, 100, 210, 260, 310];
        double[] roadsZ = [-100, -50, 0, 50, 100];
        foreach (double z in roadsZ)
        {
            objects.Add(Box($"road-west-z-{z}", "WestCore", "road", -17.5, 0.005, z, 265, 0.01, 14, "road", WorldObjectRole.Surface));
            objects.Add(Box($"road-east-z-{z}", "WestCore", "road", 292.5, 0.005, z, 175, 0.01, 14, "road", WorldObjectRole.Surface));
            objects.Add(Box($"road-line-west-z-{z}", "WestCore", "road-line", -17.5, 0.016, z, 265, 0.012, 0.4, "road-line"));
            objects.Add(Box($"road-line-east-z-{z}", "WestCore", "road-line", 292.5, 0.016, z, 175, 0.012, 0.4, "road-line"));
        }
        foreach (double x in roadsX)
        {
            objects.Add(Box($"road-x-{x}", "WestCore", "road", x, 0.005, 0, 14, 0.01, 200, "road", WorldObjectRole.Surface));
            objects.Add(Box($"road-line-x-{x}", "WestCore", "road-line", x, 0.016, 0, 0.4, 0.012, 200, "road-line"));
        }

        List<WorldInstanceTransform> crosswalks = [];
        foreach (double x in roadsX)
        {
            foreach (double z in roadsZ)
            {
                foreach ((double offsetX, double offsetZ, double rotation) in new (double, double, double)[]
                {
                    (0, 8.5, 0), (0, -8.5, 0), (8.5, 0, Math.PI / 2), (-8.5, 0, Math.PI / 2),
                })
                {
                    for (int stripe = -4; stripe <= 4; stripe += 2)
                    {
                        double stripeX = x + (rotation == 0 ? stripe : offsetX);
                        double stripeZ = z + (rotation == 0 ? offsetZ : stripe);
                        crosswalks.Add(new($"crosswalk-{crosswalks.Count}", new(stripeX, 0.031, stripeZ), WorldVector3.One, rotation));
                    }
                }
            }
        }
        instanceGroups.Add(new("crosswalks", "WestCore", WorldPrimitiveKind.Box, new(1.2, 0.012, 3), "crosswalk", 100, crosswalks.AsReadOnly()));

        double[] blockX = [-75, -25, 25, 75, 235, 285];
        double[] blockZ = [-75, -25, 25, 75];
        foreach (double x in blockX)
        {
            foreach (double z in blockZ)
            {
                objects.Add(Box($"plot-surface-{x}-{z}", "BuildingPlots", "plot-surface", x, 0.2, z, 44, 0.4, 44, "sidewalk", WorldObjectRole.Surface));
            }
        }
    }

    private static void AddRiver(ICollection<WorldObjectDefinition> objects)
    {
        objects.Add(Box("river-water", "RiverCorridor", "water", 160, -1.2, 0, 50, 0.08, 800, "water"));
        objects.Add(Box("retaining-wall-west", "RiverCorridor", "retaining-wall", 133.5, -2, 0, 3, 4.2, 800, "retaining", WorldObjectRole.StaticObstacle));
        objects.Add(Box("retaining-wall-east", "RiverCorridor", "retaining-wall", 186.5, -2, 0, 3, 4.2, 800, "retaining", WorldObjectRole.StaticObstacle));
    }

    private static void AddBridge(
        GameContentRegistry content,
        ICollection<WorldObjectDefinition> objects,
        ICollection<WorldSegmentGroupDefinition> segmentGroups)
    {
        SuspensionBridgeLayout layout = content.SuspensionBridgeLayout;
        double length = layout.DeckEndX - layout.DeckStartX;
        objects.Add(Box("grand-suspension-deck", "PrimaryBridge", "bridge-deck", layout.CenterX, -0.45, 0, length, 1, layout.DeckWidth, "bridge-deck", WorldObjectRole.Surface));
        objects.Add(Box("grand-suspension-center-line", "PrimaryBridge", "road-line", layout.CenterX, 0.06, 0, length, 0.04, 0.4, "road-line"));
        foreach (double z in new double[] { -7.5, 7.5 })
        {
            string side = z < 0 ? "north" : "south";
            objects.Add(Box($"grand-suspension-sidewalk-{side}", "PrimaryBridge", "bridge-sidewalk", layout.CenterX, 0.15, z, length, 0.4, 3, "bridge-sidewalk", WorldObjectRole.Surface));
            objects.Add(Box($"grand-suspension-edge-{side}", "PrimaryBridge", "bridge-edge", layout.CenterX, 0.35, z < 0 ? -8.8 : 8.8, length, 1.1, 0.65, "bridge-edge"));
            objects.Add(Box($"grand-suspension-barrier-{side}", "PrimaryBridge", "bridge-barrier", layout.CenterX, 1.1, z < 0 ? -8.7 : 8.7, length, 2.2, 0.6, "bridge-edge", WorldObjectRole.StaticObstacle, rendered: false));
        }
        foreach (double x in new double[] { layout.WestTowerX, layout.EastTowerX })
        {
            foreach (double z in new double[] { -layout.CableZ, layout.CableZ })
            {
                objects.Add(Box($"tower-leg-{x}-{z}", "PrimaryBridge", "bridge-tower", x, 32, z, 2.5, 64, 2.5, "bridge-tower", WorldObjectRole.StaticObstacle));
            }
            foreach (double y in new double[] { 22, 43.5, 61.2 })
            {
                objects.Add(Box($"tower-beam-{x}-{y}", "PrimaryBridge", "bridge-tower-beam", x, y, 0, 3, 2.4, 19, "bridge-tower", WorldObjectRole.StaticObstacle));
            }
        }
        foreach (double x in new double[] { layout.DeckStartX, layout.DeckEndX })
        {
            foreach (double z in new double[] { -layout.CableZ, layout.CableZ })
            {
                objects.Add(Box($"bridge-anchor-{x}-{z}", "PrimaryBridge", "bridge-anchor", x, 1.2, z, 4, 3.4, 3.4, "bridge-anchor", WorldObjectRole.StaticObstacle));
            }
        }

        List<WorldSegmentDefinition> cables = [];
        List<WorldSegmentDefinition> hangers = [];
        foreach (double z in new double[] { -layout.CableZ, layout.CableZ })
        {
            for (double x = layout.DeckStartX; x < layout.DeckEndX; x += 1)
            {
                cables.Add(new(
                    $"cable-{z}-{x}",
                    new(x, CableHeight(x, layout), z),
                    new(x + 1, CableHeight(x + 1, layout), z)));
            }
            for (double x = layout.DeckStartX + layout.HangerSpacing; x < layout.DeckEndX; x += layout.HangerSpacing)
            {
                if (Math.Abs(x - layout.WestTowerX) < 2.6 || Math.Abs(x - layout.EastTowerX) < 2.6)
                {
                    continue;
                }
                hangers.Add(new($"hanger-{z}-{x}", new(x, layout.HangerDeckY, z), new(x, CableHeight(x, layout), z)));
            }
        }
        segmentGroups.Add(new("main-cables", "PrimaryBridge", "bridge-cable", 0.68, 50, cables.AsReadOnly()));
        segmentGroups.Add(new("vertical-hangers", "PrimaryBridge", "bridge-hanger", 0.22, 50, hangers.AsReadOnly()));
    }

    private static void AddPark(
        ICollection<WorldObjectDefinition> objects,
        ICollection<WorldInstanceGroupDefinition> instanceGroups)
    {
        objects.Add(Box("central-park-grass", "CentralPark", "park", -75, 0.45, -75, 32, 0.5, 32, "park", WorldObjectRole.Surface));
        objects.Add(Box("central-park-path-ne", "CentralPark", "park-path", -75, 0.715, -75, 41.6, 0.03, 3, "park-path", rotationY: Math.PI / 4));
        objects.Add(Box("central-park-path-nw", "CentralPark", "park-path", -75, 0.715, -75, 41.6, 0.03, 3, "park-path", rotationY: -Math.PI / 4));
        objects.Add(Cylinder("central-park-fountain-pool", "CentralPark", "fountain", -75, 0.8, -75, 12, 0.8, "fountain", WorldObjectRole.StaticObstacle));
        objects.Add(Cylinder("central-park-fountain-water", "CentralPark", "fountain-water", -75, 1.21, -75, 10.8, 0.06, "fountain-water"));
        objects.Add(Cylinder("central-park-fountain-spout", "CentralPark", "fountain", -75, 2, -75, 3, 3, "fountain", WorldObjectRole.StaticObstacle));

        (double x, double z)[] trees =
        [(-85, -85), (-65, -85), (-85, -65), (-65, -65), (-90, -75), (-60, -75), (-75, -90), (-75, -60)];
        List<WorldInstanceTransform> leaves = [];
        foreach ((double x, double z) in trees)
        {
            string id = $"central-park-tree-{x}-{z}";
            objects.Add(Cylinder(id, "CentralPark", "tree-trunk", x, 2.2, z, 1.2, 3, "tree-trunk", WorldObjectRole.StaticObstacle));
            leaves.Add(new($"{id}-lower", new(x, 4.2, z), new(2.5, 2.5, 2.5)));
            leaves.Add(new($"{id}-upper", new(x, 5.9, z), new(1.8, 1.8, 1.8)));
        }
        instanceGroups.Add(new("central-park-tree-canopies", "CentralPark", WorldPrimitiveKind.Sphere, new(2, 2, 2), "tree-leaves", 50, leaves.AsReadOnly(), true));
    }

    private static void AddSkyline(
        ICollection<WorldObjectDefinition> objects,
        ICollection<WorldInstanceGroupDefinition> instanceGroups,
        IDictionary<string, WorldMaterialDefinition> materials)
    {
        double[] blockX = [-75, -25, 25, 75, 235, 285];
        double[] blockZ = [-75, -25, 25, 75];
        List<WorldInstanceTransform> windows = [];
        int index = 0;
        foreach (double x in blockX)
        {
            foreach (double z in blockZ)
            {
                if (x == -75 && z == -75)
                {
                    continue;
                }
                string type = BusinessTypes[index];
                double height = BuildingHeights[index];
                string materialId = $"building-{index}";
                materials[materialId] = new(materialId, BuildingColors[index], 0.35, 0.35);
                objects.Add(Box($"building-{type.ToLowerInvariant()}", "InitialSkyline", "building", x, height / 2 + 0.4, z, 28, height, 28, materialId, WorldObjectRole.StaticObstacle));
                int rows = (int)Math.Floor(height / 4);
                for (int row = 1; row < rows; row++)
                {
                    for (int column = 0; column < 6; column++)
                    {
                        double windowX = x - 11 + (column * 4);
                        windows.Add(new($"window-{index}-front-{row}-{column}", new(windowX, (row * 4) + 0.4, z + 14.1), WorldVector3.One));
                        windows.Add(new($"window-{index}-back-{row}-{column}", new(windowX, (row * 4) + 0.4, z - 14.1), WorldVector3.One, Math.PI));
                    }
                }
                index++;
            }
        }
        instanceGroups.Add(new("skyline-windows", "InitialSkyline", WorldPrimitiveKind.Box, new(2.4, 2.4, 0.05), "window", 100, windows.AsReadOnly()));
    }

    private static void AddStreetFurniture(
        GameContentRegistry content,
        ICollection<WorldObjectDefinition> objects,
        ICollection<WorldInstanceGroupDefinition> instanceGroups)
    {
        List<WorldInstanceTransform> poles = [];
        List<WorldInstanceTransform> bulbs = [];
        for (int index = 0; index < content.StreetLampPlacements.Count; index++)
        {
            StreetLampPlacement lamp = content.StreetLampPlacements[index];
            string id = $"street-lamp-{index:D3}";
            objects.Add(Cylinder(id, "StreetFurniture", "street-lamp", lamp.X, 4.4, lamp.Z, 0.5, 8, "lamp", WorldObjectRole.StaticObstacle, rendered: false));
            poles.Add(new($"{id}-pole", new(lamp.X, 4.4, lamp.Z), WorldVector3.One, lamp.Rotation));
            bulbs.Add(new($"{id}-bulb", new(lamp.X + (Math.Sin(lamp.Rotation) * 2), 7.9, lamp.Z + (Math.Cos(lamp.Rotation) * 2)), WorldVector3.One));
        }
        instanceGroups.Add(new("street-lamp-poles", "StreetFurniture", WorldPrimitiveKind.Cylinder, new(0.5, 8, 0.5), "lamp", 100, poles.AsReadOnly(), true));
        instanceGroups.Add(new("street-lamp-bulbs", "StreetFurniture", WorldPrimitiveKind.Sphere, new(0.8, 0.8, 0.8), "lamp-bulb", 100, bulbs.AsReadOnly()));
    }

    private static void AddCafeFurniture(ICollection<WorldObjectDefinition> objects)
    {
        (double x, double z, double rotation)[] seats =
        [
            (13, 41, Math.PI / 2),
            (13, 37, Math.PI / 2),
            (41, 13, Math.PI),
            (37, 13, Math.PI),
            (63, -41, -Math.PI / 2),
            (63, -37, -Math.PI / 2),
        ];
        for (int index = 0; index < seats.Length; index++)
        {
            (double x, double z, double rotation) = seats[index];
            double tableX = x + (Math.Cos(rotation) * 1.15);
            double tableZ = z - (Math.Sin(rotation) * 1.15);
            objects.Add(Box($"cafe-chair-{index}", "StreetFurniture", "cafe-chair", x, 1.05, z, 0.82, 1.3, 0.82, "cafe-accent", WorldObjectRole.StaticObstacle, rotation));
            objects.Add(Cylinder($"cafe-table-{index}", "StreetFurniture", "cafe-table", tableX, 0.95, tableZ, 1.5, 1.1, "cafe-wood", WorldObjectRole.StaticObstacle));
        }
    }

    public static double CableHeight(double x, SuspensionBridgeLayout layout)
    {
        double safeX = Math.Clamp(double.IsFinite(x) ? x : layout.CenterX, layout.DeckStartX, layout.DeckEndX);
        if (safeX <= layout.WestTowerX)
        {
            double t = (safeX - layout.DeckStartX) / (layout.WestTowerX - layout.DeckStartX);
            return Lerp(layout.AnchorCableY, layout.TowerCableY, t) - (layout.SideSpanSag * 4 * t * (1 - t));
        }
        if (safeX >= layout.EastTowerX)
        {
            double t = (safeX - layout.EastTowerX) / (layout.DeckEndX - layout.EastTowerX);
            return Lerp(layout.TowerCableY, layout.AnchorCableY, t) - (layout.SideSpanSag * 4 * t * (1 - t));
        }
        double centerT = (safeX - layout.WestTowerX) / (layout.EastTowerX - layout.WestTowerX);
        double centered = (centerT * 2) - 1;
        return layout.CenterCableY + ((layout.TowerCableY - layout.CenterCableY) * centered * centered);
    }

    private static WorldObjectDefinition Box(
        string id,
        string chunk,
        string kind,
        double x,
        double y,
        double z,
        double width,
        double height,
        double depth,
        string material,
        WorldObjectRole role = WorldObjectRole.Decoration,
        double rotationY = 0,
        bool rendered = true) =>
        new(id, chunk, kind, WorldPrimitiveKind.Box, new(x, y, z), new(width, height, depth), material, role, rotationY, rendered);

    private static WorldObjectDefinition Cylinder(
        string id,
        string chunk,
        string kind,
        double x,
        double y,
        double z,
        double diameter,
        double height,
        string material,
        WorldObjectRole role = WorldObjectRole.Decoration,
        double rotationY = 0,
        bool rendered = true) =>
        new(id, chunk, kind, WorldPrimitiveKind.Cylinder, new(x, y, z), new(diameter, height, diameter), material, role, rotationY, rendered);

    private static double Lerp(double from, double to, double amount) => from + ((to - from) * amount);
}

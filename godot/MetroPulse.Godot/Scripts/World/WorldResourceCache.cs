using Godot;
using MetroPulse.Domain.World;

namespace MetroPulse.Godot.World;

public sealed class WorldResourceCache
{
    private readonly Dictionary<string, Mesh> meshes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, StandardMaterial3D> materials = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Shape3D> shapes = new(StringComparer.Ordinal);

    public int MeshCount => meshes.Count;

    public int MaterialCount => materials.Count;

    public int ShapeCount => shapes.Count;

    public Mesh GetMesh(WorldPrimitiveKind kind, WorldVector3 size)
    {
        string key = $"{kind}:{size.X:R}:{size.Y:R}:{size.Z:R}";
        if (meshes.TryGetValue(key, out Mesh? cached))
        {
            return cached;
        }
        Mesh mesh = kind switch
        {
            WorldPrimitiveKind.Box => new BoxMesh { Size = ToVector(size) },
            WorldPrimitiveKind.Cylinder => new CylinderMesh
            {
                TopRadius = (float)(size.X * 0.5),
                BottomRadius = (float)(size.X * 0.5),
                Height = (float)size.Y,
                RadialSegments = 8,
            },
            WorldPrimitiveKind.Sphere => new SphereMesh
            {
                Radius = (float)(size.X * 0.5),
                Height = (float)size.Y,
                RadialSegments = 12,
                Rings = 6,
            },
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        meshes.Add(key, mesh);
        return mesh;
    }

    public StandardMaterial3D GetMaterial(WorldMaterialDefinition definition)
    {
        if (materials.TryGetValue(definition.Id, out StandardMaterial3D? cached))
        {
            return cached;
        }
        StandardMaterial3D material = new()
        {
            AlbedoColor = ColorFromRgb(definition.Color, definition.Opacity),
            Roughness = (float)definition.Roughness,
            Metallic = (float)definition.Metallic,
            Transparency = definition.Opacity < 1
                ? BaseMaterial3D.TransparencyEnum.Alpha
                : BaseMaterial3D.TransparencyEnum.Disabled,
        };
        if (definition.EmissionColor is int emission)
        {
            material.EmissionEnabled = true;
            material.Emission = ColorFromRgb(emission);
            material.EmissionEnergyMultiplier = (float)definition.EmissionEnergy;
        }
        materials.Add(definition.Id, material);
        return material;
    }

    public Shape3D GetShape(WorldPrimitiveKind kind, WorldVector3 size)
    {
        string key = $"{kind}:{size.X:R}:{size.Y:R}:{size.Z:R}";
        if (shapes.TryGetValue(key, out Shape3D? cached))
        {
            return cached;
        }
        Shape3D shape = kind switch
        {
            WorldPrimitiveKind.Box => new BoxShape3D { Size = ToVector(size) },
            WorldPrimitiveKind.Cylinder => new CylinderShape3D { Radius = (float)(size.X * 0.5), Height = (float)size.Y },
            WorldPrimitiveKind.Sphere => new SphereShape3D { Radius = (float)(size.X * 0.5) },
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        shapes.Add(key, shape);
        return shape;
    }

    public void Clear()
    {
        meshes.Clear();
        materials.Clear();
        shapes.Clear();
    }

    private static Vector3 ToVector(WorldVector3 value) => new((float)value.X, (float)value.Y, (float)value.Z);

    private static Color ColorFromRgb(int rgb, double alpha = 1) => new(
        ((rgb >> 16) & 0xff) / 255f,
        ((rgb >> 8) & 0xff) / 255f,
        (rgb & 0xff) / 255f,
        (float)alpha);
}

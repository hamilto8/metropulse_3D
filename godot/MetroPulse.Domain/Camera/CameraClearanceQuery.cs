namespace MetroPulse.Domain.Camera;

public static class CameraClearanceReasons
{
    public const string InvalidPosition = "INVALID_POSITION";
    public const string Terrain = "TERRAIN";
    public const string Water = "WATER";
    public const string Obstacle = "OBSTACLE";
}

public sealed record CameraClearanceDefaults(
    double Radius = 0.8,
    double TerrainClearance = 0.7,
    double SearchStep = 2.5,
    double MaximumSearchRadius = 30,
    int SamplesPerRing = 16);

public sealed record CameraObstacle(
    string Id,
    CameraVector3 Position,
    CameraVector3 Size,
    string Kind = "obstacle",
    string? EntityId = null);

public sealed record CameraClearanceOptions
{
    public double? Radius { get; init; }

    public double? TerrainClearance { get; init; }

    public double? SearchStep { get; init; }

    public double? MaximumSearchRadius { get; init; }

    public int? SamplesPerRing { get; init; }

    public CameraVector3? PreferredDirection { get; init; }

    public IReadOnlySet<string> IgnoredIds { get; init; } = new HashSet<string>(StringComparer.Ordinal);
}

public sealed record CameraClearanceInspection(
    bool Clear,
    string? Reason,
    CameraObstacle? Obstacle = null,
    double? MinimumY = null);

/// <summary>Deterministic collision-free camera-origin query over immutable world snapshots.</summary>
public sealed class CameraClearanceQuery
{
    private readonly Func<double, double, double> getTerrainHeight;
    private readonly Func<CameraVector3, bool> isWater;
    private readonly Func<IReadOnlyList<CameraObstacle>> getObstacles;
    private readonly CameraClearanceDefaults defaults;

    public CameraClearanceQuery(
        Func<double, double, double>? getTerrainHeight = null,
        Func<CameraVector3, bool>? isWater = null,
        Func<IReadOnlyList<CameraObstacle>>? getObstacles = null,
        CameraClearanceDefaults? defaults = null)
    {
        this.getTerrainHeight = getTerrainHeight ?? ((_, _) => 0);
        this.isWater = isWater ?? (_ => false);
        this.getObstacles = getObstacles ?? (() => Array.Empty<CameraObstacle>());
        this.defaults = defaults ?? new CameraClearanceDefaults();
    }

    public CameraClearanceInspection Inspect(
        CameraVector3 position,
        CameraClearanceOptions? options = null)
    {
        if (position is null || !position.IsFinite)
        {
            return new CameraClearanceInspection(false, CameraClearanceReasons.InvalidPosition);
        }
        options ??= new CameraClearanceOptions();
        double radius = NonNegative(options.Radius, defaults.Radius);
        double terrainClearance = Math.Max(radius, NonNegative(options.TerrainClearance, defaults.TerrainClearance));
        double terrainHeight = getTerrainHeight(position.X, position.Z);
        double surfaceHeight = double.IsFinite(terrainHeight) ? terrainHeight : 0;
        if (position.Y < surfaceHeight + terrainClearance)
        {
            return new CameraClearanceInspection(
                false,
                CameraClearanceReasons.Terrain,
                MinimumY: surfaceHeight + terrainClearance);
        }
        if (isWater(position)) return new CameraClearanceInspection(false, CameraClearanceReasons.Water);

        IReadOnlySet<string> ignored = options.IgnoredIds ?? new HashSet<string>(StringComparer.Ordinal);
        foreach (CameraObstacle candidate in getObstacles() ?? Array.Empty<CameraObstacle>())
        {
            if (candidate is null || ignored.Contains(candidate.Id)
                || (candidate.EntityId is not null && ignored.Contains(candidate.EntityId)))
            {
                continue;
            }
            if (NormalizeObstacle(candidate) is CameraObstacle obstacle
                && SphereIntersectsBox(position, radius, obstacle))
            {
                return new CameraClearanceInspection(false, CameraClearanceReasons.Obstacle, candidate);
            }
        }
        return new CameraClearanceInspection(true, null);
    }

    public CameraVector3 Resolve(
        CameraVector3 desiredPosition,
        CameraClearanceOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(desiredPosition);
        if (!desiredPosition.IsFinite)
        {
            throw new ArgumentException("desiredPosition must contain finite x, y, and z", nameof(desiredPosition));
        }
        options ??= new CameraClearanceOptions();
        CameraVector3 resolved = LiftAboveTerrain(desiredPosition, options);
        if (Inspect(resolved, options).Clear) return resolved;

        double step = Math.Max(0.25, Positive(options.SearchStep, defaults.SearchStep, 0.25));
        double maximumRadius = Math.Max(step, Positive(options.MaximumSearchRadius, defaults.MaximumSearchRadius, step));
        int samples = Math.Max(8, options.SamplesPerRing ?? defaults.SamplesPerRing);
        CameraVector3? preferred = options.PreferredDirection;
        double startAngle = preferred is not null && preferred.IsFinite
            ? Math.Atan2(preferred.Z, preferred.X)
            : 0;

        for (double distance = step; distance <= maximumRadius; distance += step)
        {
            for (int index = 0; index < samples; index += 1)
            {
                double angle = startAngle + ((double)index / samples) * Math.PI * 2;
                resolved = new CameraVector3(
                    desiredPosition.X + Math.Cos(angle) * distance,
                    desiredPosition.Y,
                    desiredPosition.Z + Math.Sin(angle) * distance);
                resolved = LiftAboveTerrain(resolved, options);
                if (Inspect(resolved, options).Clear) return resolved;
            }
        }
        throw new InvalidOperationException(
            $"No safe camera position exists within {maximumRadius} world units.");
    }

    private CameraVector3 LiftAboveTerrain(CameraVector3 position, CameraClearanceOptions options)
    {
        double radius = NonNegative(options.Radius, defaults.Radius);
        double clearance = Math.Max(radius, NonNegative(options.TerrainClearance, defaults.TerrainClearance));
        double terrainHeight = getTerrainHeight(position.X, position.Z);
        double surface = double.IsFinite(terrainHeight) ? terrainHeight : 0;
        return position with { Y = Math.Max(position.Y, surface + clearance) };
    }

    private static CameraObstacle? NormalizeObstacle(CameraObstacle obstacle)
    {
        if (!obstacle.Position.IsFinite || !obstacle.Size.IsFinite
            || obstacle.Size.X <= 0 || obstacle.Size.Y <= 0 || obstacle.Size.Z <= 0)
        {
            return null;
        }
        return obstacle;
    }

    private static bool SphereIntersectsBox(CameraVector3 position, double radius, CameraObstacle obstacle)
    {
        double dx = Math.Max(Math.Abs(position.X - obstacle.Position.X) - obstacle.Size.X * 0.5, 0);
        double dy = Math.Max(Math.Abs(position.Y - obstacle.Position.Y) - obstacle.Size.Y * 0.5, 0);
        double dz = Math.Max(Math.Abs(position.Z - obstacle.Position.Z) - obstacle.Size.Z * 0.5, 0);
        return dx * dx + dy * dy + dz * dz < radius * radius;
    }

    private static double NonNegative(double? value, double fallback)
    {
        double selected = value is not null && double.IsFinite(value.Value) ? value.Value : fallback;
        return Math.Max(0, selected);
    }

    private static double Positive(double? value, double fallback, double minimum)
    {
        double selected = value is not null && double.IsFinite(value.Value) && value.Value != 0
            ? value.Value
            : fallback;
        return Math.Max(minimum, selected);
    }
}

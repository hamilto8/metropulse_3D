using System.Collections.Frozen;
using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Aircraft;

public static class LandingSurfaceTypes
{
    public const string Runway = "RUNWAY";
    public const string Road = "ROAD";
    public const string Countryside = "COUNTRYSIDE";
    public const string Unsuitable = "UNSUITABLE";
}

public static class LandingFailureReasons
{
    public const string InvalidPosition = "invalid-position";
    public const string Water = "water";
    public const string UnsupportedSurface = "unsupported-surface";
    public const string TerrainTooSteep = "terrain-too-steep";
}

public sealed record AircraftPlanarPoint(double X, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Z);
}

public sealed record AirfieldBounds(double MinX, double MaxX, double MinZ, double MaxZ);

public sealed record AircraftSpawnPoint(double X, double Y, double Z, double Heading);

public sealed record AirfieldLayout(
    double CenterX,
    double CenterZ,
    double RunwayWidth,
    double RunwayLength,
    double RunwayHeading,
    AircraftSpawnPoint AircraftStart,
    AirfieldBounds Bounds);

public sealed record PlacedLandingRoad
{
    public AircraftPlanarPoint? Position { get; init; }
    public double Width { get; init; } = 30;
    public double Depth { get; init; } = 30;
    public double RotationY { get; init; }
    public string? RoadType { get; init; }
    public bool Active { get; init; } = true;
}

public sealed record AircraftLandingWorld
{
    public Func<double, double, double>? GetTerrainHeight { get; init; }
    public Func<AircraftVector3, bool>? IsInWater { get; init; }
    public Func<double, double, bool>? IsBridgeDeck { get; init; }
    public IReadOnlyList<PlacedLandingRoad> PlacedRoads { get; init; } = Array.Empty<PlacedLandingRoad>();
}

public sealed record AircraftLandingAssessment(
    bool Allowed,
    string Type,
    string Label,
    string? Reason,
    double GroundHeight,
    double MaximumGrade);

/// <summary>Pure runway, road, countryside, footprint, water, and terrain-grade authority.</summary>
public sealed class AircraftLandingSurfaceModel
{
    public const double MaximumLandingGrade = 0.22;

    public static readonly AirfieldLayout DefaultAirfieldLayout = new(
        -105,
        -260,
        28,
        210,
        Math.PI,
        new AircraftSpawnPoint(-105, 1.15, -190, Math.PI),
        new AirfieldBounds(-196, -18, -382, -138));

    private static readonly IReadOnlyList<double> CityRoadX = Array.AsReadOnly<double>(
        [-100, -50, 0, 50, 100, 210, 260, 310]);

    private static readonly IReadOnlyList<double> CityRoadZ = Array.AsReadOnly<double>(
        [-100, -50, 0, 50, 100]);

    private static readonly IReadOnlyList<(double Minimum, double Maximum)> CityHorizontalSegments =
        Array.AsReadOnly<(double Minimum, double Maximum)>([(-150, 115), (205, 380)]);

    private static readonly IReadOnlyList<AircraftPlanarPoint> AircraftFootprint =
        Array.AsReadOnly<AircraftPlanarPoint>(
        [
            new(0, 0),
            new(-1.65, 0.45),
            new(1.65, 0.45),
            new(0, -3.05),
            new(0, 3.7),
            new(-4.75, 0.35),
            new(4.75, 0.35),
        ]);

    private static readonly FrozenDictionary<string, string> Labels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [LandingSurfaceTypes.Runway] = "AIRFIELD RUNWAY",
            [LandingSurfaceTypes.Road] = "ROAD",
            [LandingSurfaceTypes.Countryside] = "COUNTRYSIDE",
            [LandingSurfaceTypes.Unsuitable] = "UNSUITABLE TERRAIN",
        }.ToFrozenDictionary(StringComparer.Ordinal);

    private readonly CountrysideGridDefinition grid;

    public AircraftLandingSurfaceModel(CountrysideGridDefinition grid)
    {
        ArgumentNullException.ThrowIfNull(grid);
        this.grid = grid;
    }

    public static AircraftLandingSurfaceModel LoadProduction() =>
        new(GameContentRegistry.LoadProduction().CountrysideGrid);

    public static bool IsAirfieldLayoutValid(AirfieldLayout? layout = null)
    {
        layout ??= DefaultAirfieldLayout;
        if (!double.IsFinite(layout.CenterX)
            || !double.IsFinite(layout.CenterZ)
            || !double.IsFinite(layout.RunwayWidth)
            || !double.IsFinite(layout.RunwayLength)
            || layout.RunwayWidth <= 0
            || layout.RunwayLength <= 0)
        {
            return false;
        }
        double halfWidth = layout.RunwayWidth / 2;
        double halfLength = layout.RunwayLength / 2;
        return layout.CenterX - halfWidth >= layout.Bounds.MinX
            && layout.CenterX + halfWidth <= layout.Bounds.MaxX
            && layout.CenterZ - halfLength >= layout.Bounds.MinZ
            && layout.CenterZ + halfLength <= layout.Bounds.MaxZ
            && layout.AircraftStart.Z >= layout.CenterZ - halfLength
            && layout.AircraftStart.Z <= layout.CenterZ + halfLength;
    }

    public string Classify(
        AircraftPlanarPoint? position,
        AircraftLandingWorld? world = null,
        AirfieldLayout? layout = null)
    {
        if (position is not { IsFinite: true }) return LandingSurfaceTypes.Unsuitable;
        layout ??= DefaultAirfieldLayout;
        double x = position.X;
        double z = position.Z;
        if (IsOnRunway(x, z, layout)) return LandingSurfaceTypes.Runway;
        if (world?.IsBridgeDeck?.Invoke(x, z) == true) return LandingSurfaceTypes.Unsuitable;
        if (IsOnAuthoredRoad(x, z) || IsOnPlacedRoad(x, z, world?.PlacedRoads))
        {
            return LandingSurfaceTypes.Road;
        }
        PlanarExtentDefinition? bounds = grid.Bounds;
        if (bounds is not null
            && InRange(x, bounds.MinX, bounds.MaxX)
            && InRange(z, bounds.MinZ, bounds.MaxZ))
        {
            return LandingSurfaceTypes.Countryside;
        }
        return LandingSurfaceTypes.Unsuitable;
    }

    public static IReadOnlyList<AircraftPlanarPoint> GetFootprintSamples(
        AircraftPlanarPoint? position,
        double heading = 0)
    {
        if (position is not { IsFinite: true }) return Array.Empty<AircraftPlanarPoint>();
        double safeHeading = double.IsFinite(heading) ? heading : 0;
        double cosine = Math.Cos(safeHeading);
        double sine = Math.Sin(safeHeading);
        return new ReadOnlyCollection<AircraftPlanarPoint>(AircraftFootprint
            .Select(local => new AircraftPlanarPoint(
                position.X + local.X * cosine + local.Z * sine,
                position.Z - local.X * sine + local.Z * cosine))
            .ToList());
    }

    public AircraftLandingAssessment Assess(
        AircraftPlanarPoint? position,
        double heading = 0,
        AircraftLandingWorld? world = null,
        AirfieldLayout? layout = null,
        double maximumGrade = MaximumLandingGrade)
    {
        string type = Classify(position, world, layout);
        string label = Labels[type];
        IReadOnlyList<AircraftPlanarPoint> samples = GetFootprintSamples(position, heading);
        if (samples.Count == 0)
        {
            return new AircraftLandingAssessment(
                false,
                type,
                label,
                LandingFailureReasons.InvalidPosition,
                0,
                double.PositiveInfinity);
        }

        world ??= new AircraftLandingWorld();
        double[] heights = samples
            .Select(sample => FiniteOrZero(world.GetTerrainHeight?.Invoke(sample.X, sample.Z)))
            .ToArray();
        double centerHeight = heights[0];
        bool wet = samples.Select((sample, index) => new AircraftVector3(
                sample.X,
                heights[index] + AircraftFlightModel.DefaultConfig.GearHeight,
                sample.Z))
            .Any(point => world.IsInWater?.Invoke(point) == true);
        double maximumDetectedGrade = 0;
        for (int index = 1; index < samples.Count; index += 1)
        {
            double deltaX = samples[index].X - samples[0].X;
            double deltaZ = samples[index].Z - samples[0].Z;
            double distance = Math.Sqrt(deltaX * deltaX + deltaZ * deltaZ);
            double grade = distance > 0 ? Math.Abs(heights[index] - centerHeight) / distance : 0;
            maximumDetectedGrade = Math.Max(maximumDetectedGrade, grade);
        }

        double safeMaximumGrade = double.IsFinite(maximumGrade) && maximumGrade >= 0
            ? maximumGrade
            : MaximumLandingGrade;
        string? reason = null;
        if (wet) reason = LandingFailureReasons.Water;
        else if (type == LandingSurfaceTypes.Unsuitable) reason = LandingFailureReasons.UnsupportedSurface;
        else if (maximumDetectedGrade > safeMaximumGrade) reason = LandingFailureReasons.TerrainTooSteep;

        return new AircraftLandingAssessment(
            reason is null,
            type,
            label,
            reason,
            wet ? Math.Max(0, centerHeight) : centerHeight,
            maximumDetectedGrade);
    }

    private bool IsOnAuthoredRoad(double x, double z)
    {
        double roadHalfWidth = FiniteOrFallback(grid.RoadWidth, 14) * 0.5;
        bool onCityHorizontal = CityRoadZ.Any(roadZ => Near(z, roadZ, roadHalfWidth))
            && CityHorizontalSegments.Any(segment => InRange(x, segment.Minimum, segment.Maximum));
        bool onCityVertical = CityRoadX.Any(roadX => Near(x, roadX, roadHalfWidth))
            && InRange(z, -100, 100);
        bool onCountryHorizontal = (grid.HorizontalRoadCenters ?? Array.Empty<double>())
            .Any(roadZ => Near(z, roadZ, roadHalfWidth))
            && grid.Bounds is { } bounds
            && InRange(x, bounds.MinX, bounds.MaxX);
        bool onCountryVertical = (grid.VerticalRoadCenters ?? Array.Empty<double>())
            .Any(roadX => Near(x, roadX, roadHalfWidth))
            && InRange(z, grid.VerticalRoadMinZ, grid.VerticalRoadMaxZ);

        VerticalRoadDefinition? access = grid.RocketAccessRoad;
        bool onRocketAccess = access is not null
            && Near(x, access.CenterX, access.Width * 0.5)
            && InRange(z, access.MinZ, access.MaxZ);
        HorizontalRoadDefinition? spur = grid.MissionControlSpur;
        bool onMissionSpur = spur is not null
            && InRange(x, spur.MinX, spur.MaxX)
            && Near(z, spur.CenterZ, spur.Width * 0.5);
        return onCityHorizontal || onCityVertical || onCountryHorizontal
            || onCountryVertical || onRocketAccess || onMissionSpur;
    }

    private static bool IsOnPlacedRoad(
        double x,
        double z,
        IReadOnlyList<PlacedLandingRoad>? roads)
    {
        if (roads is null) return false;
        foreach (PlacedLandingRoad road in roads)
        {
            if (!road.Active
                || road.Position is not { IsFinite: true } position
                || string.IsNullOrEmpty(road.RoadType)
                || road.RoadType == "BRIDGE")
            {
                continue;
            }
            double rotation = double.IsFinite(road.RotationY) ? road.RotationY : 0;
            double deltaX = x - position.X;
            double deltaZ = z - position.Z;
            double cosine = Math.Cos(rotation);
            double sine = Math.Sin(rotation);
            double localX = deltaX * cosine - deltaZ * sine;
            double localZ = deltaX * sine + deltaZ * cosine;
            double halfWidth = PositiveOrDefault(road.Width, 30) * 0.5;
            double halfDepth = PositiveOrDefault(road.Depth, 30) * 0.5;
            if (Math.Abs(localX) <= halfWidth && Math.Abs(localZ) <= halfDepth) return true;
        }
        return false;
    }

    private static bool IsOnRunway(double x, double z, AirfieldLayout layout) =>
        Near(x, layout.CenterX, layout.RunwayWidth * 0.5)
        && Near(z, layout.CenterZ, layout.RunwayLength * 0.5);

    private static bool InRange(double value, double minimum, double maximum) =>
        value >= minimum && value <= maximum;

    private static bool Near(double value, double center, double radius) =>
        Math.Abs(value - center) <= radius;

    private static double PositiveOrDefault(double value, double fallback) =>
        double.IsFinite(value) && value > 0 ? value : fallback;

    private static double FiniteOrZero(double? value) =>
        value is { } number && double.IsFinite(number) ? number : 0;

    private static double FiniteOrFallback(double value, double fallback) =>
        double.IsFinite(value) ? value : fallback;
}

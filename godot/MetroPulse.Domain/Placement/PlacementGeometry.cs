using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Placement;

public sealed record PlacementVector3(double X, double Y, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
}

public sealed record PlacementFootprint(double Width, double Depth);

public sealed record PlacementRect(double MinX, double MaxX, double MinZ, double MaxZ)
{
    public bool IsFinite => double.IsFinite(MinX)
        && double.IsFinite(MaxX)
        && double.IsFinite(MinZ)
        && double.IsFinite(MaxZ);

    public double Width => MaxX - MinX;

    public double Depth => MaxZ - MinZ;

    public bool Contains(double x, double z) => IsFinite
        && double.IsFinite(x)
        && double.IsFinite(z)
        && x >= MinX
        && x <= MaxX
        && z >= MinZ
        && z <= MaxZ;
}

public sealed record PlacementTerrainHeights(
    double NorthWest,
    double NorthEast,
    double SouthWest,
    double SouthEast);

/// <summary>Pure footprint, overlap, access-distance, water-sample, and slope geometry.</summary>
public static class PlacementGeometry
{
    public const double DefaultClearance = 2;

    public const double PlayerSafetyMargin = 4;

    public const double RoadAccessDistance = 12;

    public static PlacementFootprint GetOrientedFootprint(
        double width,
        double depth,
        double rotationY = 0)
    {
        double safeWidth = PositiveOrDefault(width, 1);
        double safeDepth = PositiveOrDefault(depth, 1);
        double turns = double.IsFinite(rotationY) ? rotationY / (Math.PI / 2) : 0;
        long quarterTurns = Math.Abs((long)Math.Floor(turns + 0.5)) % 2;
        return quarterTurns == 0
            ? new PlacementFootprint(safeWidth, safeDepth)
            : new PlacementFootprint(safeDepth, safeWidth);
    }

    public static PlacementRect CreateRect(
        double x,
        double z,
        double width,
        double depth,
        double rotationY = 0,
        double clearance = DefaultClearance)
    {
        if (!double.IsFinite(x)) throw new ArgumentOutOfRangeException(nameof(x));
        if (!double.IsFinite(z)) throw new ArgumentOutOfRangeException(nameof(z));
        PlacementFootprint footprint = GetOrientedFootprint(width, depth, rotationY);
        double safeClearance = double.IsFinite(clearance) ? Math.Max(0, clearance) : DefaultClearance;
        return new PlacementRect(
            x - footprint.Width / 2 - safeClearance,
            x + footprint.Width / 2 + safeClearance,
            z - footprint.Depth / 2 - safeClearance,
            z + footprint.Depth / 2 + safeClearance);
    }

    public static bool Overlaps(PlacementRect? first, PlacementRect? second) =>
        first is { IsFinite: true }
        && second is { IsFinite: true }
        && first.MaxX > second.MinX
        && first.MinX < second.MaxX
        && first.MaxZ > second.MinZ
        && first.MinZ < second.MaxZ;

    public static double Distance(PlacementRect? first, PlacementRect? second)
    {
        if (first is not { IsFinite: true } || second is not { IsFinite: true })
        {
            return double.PositiveInfinity;
        }
        double deltaX = Math.Max(first.MinX - second.MaxX, Math.Max(second.MinX - first.MaxX, 0));
        double deltaZ = Math.Max(first.MinZ - second.MaxZ, Math.Max(second.MinZ - first.MaxZ, 0));
        return Math.Sqrt(deltaX * deltaX + deltaZ * deltaZ);
    }

    public static bool IsInside(PlacementRect? rect, PlanarBounds? bounds) =>
        rect is { IsFinite: true }
        && bounds is not null
        && rect.MinX >= bounds.MinX
        && rect.MaxX <= bounds.MaxX
        && rect.MinZ >= bounds.MinZ
        && rect.MaxZ <= bounds.MaxZ;

    public static bool IsPlayerOccupied(
        PlacementRect? rect,
        PlacementVector3? player,
        double margin = PlayerSafetyMargin)
    {
        if (rect is not { IsFinite: true } || player is not { IsFinite: true }) return false;
        double safeMargin = double.IsFinite(margin) ? Math.Max(0, margin) : PlayerSafetyMargin;
        return player.X > rect.MinX - safeMargin
            && player.X < rect.MaxX + safeMargin
            && player.Z > rect.MinZ - safeMargin
            && player.Z < rect.MaxZ + safeMargin;
    }

    public static bool HasRoadAccess(
        PlacementRect? footprint,
        IEnumerable<PlacementRect>? roads,
        double maximumDistance = RoadAccessDistance)
    {
        if (footprint is not { IsFinite: true } || roads is null) return false;
        double safeDistance = double.IsFinite(maximumDistance)
            ? Math.Max(0, maximumDistance)
            : RoadAccessDistance;
        return roads.Any(road => Distance(footprint, road) <= safeDistance);
    }

    public static IReadOnlyList<PlacementVector3> GetWaterSamplePoints(PlacementRect rect, double y)
    {
        ArgumentNullException.ThrowIfNull(rect);
        if (!rect.IsFinite) throw new ArgumentException("Placement rectangle must be finite.", nameof(rect));
        double safeY = double.IsFinite(y) ? y : 0;
        return new ReadOnlyCollection<PlacementVector3>(
        [
            new((rect.MinX + rect.MaxX) / 2, safeY, (rect.MinZ + rect.MaxZ) / 2),
            new(rect.MinX, safeY, rect.MinZ),
            new(rect.MinX, safeY, rect.MaxZ),
            new(rect.MaxX, safeY, rect.MinZ),
            new(rect.MaxX, safeY, rect.MaxZ),
        ]);
    }

    public static double GetSlopeDegrees(PlacementRect? rect, PlacementTerrainHeights? heights)
    {
        if (rect is not { IsFinite: true } || heights is null) return 0;
        double width = Math.Max(1, rect.Width);
        double depth = Math.Max(1, rect.Depth);
        double northWest = FiniteOrZero(heights.NorthWest);
        double northEast = FiniteOrZero(heights.NorthEast);
        double southWest = FiniteOrZero(heights.SouthWest);
        double southEast = FiniteOrZero(heights.SouthEast);
        double gradientX = (((northEast + southEast) - (northWest + southWest)) * 0.5) / width;
        double gradientZ = (((southWest + southEast) - (northWest + northEast)) * 0.5) / depth;
        return Math.Atan(Math.Sqrt(gradientX * gradientX + gradientZ * gradientZ)) * 180 / Math.PI;
    }

    private static double PositiveOrDefault(double value, double fallback) =>
        double.IsFinite(value) && value > 0 ? value : fallback;

    private static double FiniteOrZero(double value) => double.IsFinite(value) ? value : 0;
}

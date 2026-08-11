using MetroPulse.Domain.Simulation;

namespace MetroPulse.Domain.Traffic;

public sealed record TrafficObstacle(
    string Id,
    TrafficPoint Center,
    double HalfX,
    double HalfZ,
    double RotationY,
    bool Active = true);

public sealed record TrafficObstacleHit(
    string ObstacleId,
    double Distance,
    double LateralClearance);

/// <summary>Bounded obstacle-ahead queries backed by the shared spatial grid.</summary>
public sealed class TrafficObstacleIndex
{
    private readonly SpatialHashGrid<TrafficObstacle> grid;

    public TrafficObstacleIndex(double cellSize = 24)
    {
        grid = new SpatialHashGrid<TrafficObstacle>(
            cellSize,
            obstacle => obstacle.Id,
            obstacle => new SpatialPoint(obstacle.Center.X, obstacle.Center.Z));
    }

    public int IndexedCount => grid.IndexedCount;

    public void Rebuild(IEnumerable<TrafficObstacle> obstacles)
    {
        ArgumentNullException.ThrowIfNull(obstacles);
        TrafficObstacle[] active = obstacles.Where(obstacle => obstacle.Active).ToArray();
        foreach (TrafficObstacle obstacle in active)
        {
            Validate(obstacle);
        }
        grid.Rebuild(active);
    }

    public TrafficObstacleHit? FindAhead(
        TrafficPoint origin,
        double rotationY,
        double speed,
        double vehicleWidth,
        double vehicleLength,
        TrafficNavigationConfig? config = null)
    {
        if (!double.IsFinite(origin.X) || !double.IsFinite(origin.Z)
            || !double.IsFinite(rotationY) || !double.IsFinite(speed)
            || !double.IsFinite(vehicleWidth) || vehicleWidth <= 0
            || !double.IsFinite(vehicleLength) || vehicleLength <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(origin), "Obstacle query inputs must be finite with positive dimensions.");
        }
        config ??= TrafficNavigationModel.DefaultConfig;
        double lookAhead = Math.Clamp(
            config.ObstacleLookAheadMinimum + Math.Abs(speed) * 0.45,
            config.ObstacleLookAheadMinimum,
            config.ObstacleLookAheadMaximum);
        double forwardX = Math.Sin(rotationY);
        double forwardZ = Math.Cos(rotationY);
        double rightX = forwardZ;
        double rightZ = -forwardX;
        TrafficPoint queryCenter = new(
            origin.X + forwardX * lookAhead / 2,
            origin.Z + forwardZ * lookAhead / 2);
        double queryRadius = lookAhead / 2 + Math.Max(vehicleWidth, vehicleLength) + 8;
        SpatialQueryResult<TrafficObstacle> nearby = grid.Query(
            new SpatialPoint(queryCenter.X, queryCenter.Z),
            queryRadius);

        TrafficObstacleHit? closest = null;
        foreach (TrafficObstacle obstacle in nearby.Items)
        {
            double offsetX = obstacle.Center.X - origin.X;
            double offsetZ = obstacle.Center.Z - origin.Z;
            double centerForward = offsetX * forwardX + offsetZ * forwardZ;
            double forwardRadius = ProjectedRadius(obstacle, forwardX, forwardZ);
            double nearDistance = centerForward - forwardRadius - vehicleLength / 2;
            if (nearDistance < -0.6 || nearDistance > lookAhead) continue;
            double centerLateral = Math.Abs(offsetX * rightX + offsetZ * rightZ);
            double lateralRadius = ProjectedRadius(obstacle, rightX, rightZ);
            double lateralClearance = centerLateral - lateralRadius - vehicleWidth / 2;
            if (lateralClearance > config.ObstacleClearance) continue;
            var hit = new TrafficObstacleHit(obstacle.Id, Math.Max(0, nearDistance), lateralClearance);
            if (closest is null || hit.Distance < closest.Distance
                || (hit.Distance == closest.Distance
                    && StringComparer.Ordinal.Compare(hit.ObstacleId, closest.ObstacleId) < 0))
            {
                closest = hit;
            }
        }
        return closest;
    }

    private static double ProjectedRadius(TrafficObstacle obstacle, double axisX, double axisZ)
    {
        double cosine = Math.Cos(obstacle.RotationY);
        double sine = Math.Sin(obstacle.RotationY);
        double localXAxisX = cosine;
        double localXAxisZ = -sine;
        double localZAxisX = sine;
        double localZAxisZ = cosine;
        return Math.Abs(axisX * localXAxisX + axisZ * localXAxisZ) * obstacle.HalfX
            + Math.Abs(axisX * localZAxisX + axisZ * localZAxisZ) * obstacle.HalfZ;
    }

    private static void Validate(TrafficObstacle obstacle)
    {
        ArgumentNullException.ThrowIfNull(obstacle);
        if (string.IsNullOrWhiteSpace(obstacle.Id)
            || !double.IsFinite(obstacle.Center.X) || !double.IsFinite(obstacle.Center.Z)
            || !double.IsFinite(obstacle.HalfX) || obstacle.HalfX <= 0
            || !double.IsFinite(obstacle.HalfZ) || obstacle.HalfZ <= 0
            || !double.IsFinite(obstacle.RotationY))
        {
            throw new ArgumentException("Traffic obstacles require a stable ID and finite positive geometry.", nameof(obstacle));
        }
    }
}

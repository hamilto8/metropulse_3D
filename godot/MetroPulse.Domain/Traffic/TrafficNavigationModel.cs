namespace MetroPulse.Domain.Traffic;

public sealed record TrafficPoint(double X, double Z);

public sealed record NavigationProjection(
    double X,
    double Z,
    double Progress,
    double Deviation);

public sealed record TrafficNavigationConfig
{
    public double MaxLaneCenterDeviation { get; init; } = 1.5;

    public double RoadHalfWidth { get; init; } = 7;

    public double LaneCenterOffset { get; init; } = 3.5;

    public double RoadEdgeClearance { get; init; } = 0.35;

    public double TurnLookAheadDistance { get; init; } = 18;

    public double MinimumTurnSpeed { get; init; } = 5.5;

    public double ObstacleLookAheadMinimum { get; init; } = 7;

    public double ObstacleLookAheadMaximum { get; init; } = 22;

    public double ObstacleClearance { get; init; } = 0.45;
}

/// <summary>Renderer-independent road-segment and turn geometry used by traffic adapters.</summary>
public static class TrafficNavigationModel
{
    public static readonly TrafficNavigationConfig DefaultConfig = new();

    public static NavigationProjection? ProjectToSegment(
        TrafficPoint position,
        TrafficPoint currentNode,
        TrafficPoint targetNode)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(currentNode);
        ArgumentNullException.ThrowIfNull(targetNode);
        double segmentX = targetNode.X - currentNode.X;
        double segmentZ = targetNode.Z - currentNode.Z;
        double lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
        if (!double.IsFinite(lengthSquared) || lengthSquared < 1e-6) return null;

        double progress = Math.Clamp(
            ((position.X - currentNode.X) * segmentX + (position.Z - currentNode.Z) * segmentZ) / lengthSquared,
            0,
            1);
        double x = currentNode.X + segmentX * progress;
        double z = currentNode.Z + segmentZ * progress;
        double deviation = Math.Sqrt(Math.Pow(position.X - x, 2) + Math.Pow(position.Z - z, 2));
        if (!double.IsFinite(progress) || !double.IsFinite(x) || !double.IsFinite(z) || !double.IsFinite(deviation))
        {
            return null;
        }
        return new NavigationProjection(x, z, progress, deviation);
    }

    public static bool HasReachedTarget(
        TrafficPoint position,
        TrafficPoint targetNode,
        TrafficPoint? currentNode = null,
        double threshold = 4.5)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(targetNode);
        double minimumThreshold = double.IsFinite(threshold) ? Math.Max(1, threshold) : 1;
        if (Math.Sqrt(Math.Pow(position.X - targetNode.X, 2) + Math.Pow(position.Z - targetNode.Z, 2)) <= minimumThreshold)
        {
            return true;
        }
        if (currentNode is null) return false;
        double segmentX = targetNode.X - currentNode.X;
        double segmentZ = targetNode.Z - currentNode.Z;
        double fromTargetX = position.X - targetNode.X;
        double fromTargetZ = position.Z - targetNode.Z;
        return segmentX * fromTargetX + segmentZ * fromTargetZ >= 0;
    }

    public static double GetTurnSpeedLimit(
        TrafficPoint position,
        TrafficPoint targetNode,
        double rotationY,
        double? maximumSpeed = null,
        TrafficNavigationConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(targetNode);
        config ??= DefaultConfig;
        double dx = targetNode.X - position.X;
        double dz = targetNode.Z - position.Z;
        double distance = Math.Sqrt(dx * dx + dz * dz);
        if (distance < 1e-6) return config.MinimumTurnSpeed;
        double desiredAngle = Math.Atan2(dx, dz);
        double difference = desiredAngle - rotationY;
        while (difference < -Math.PI) difference += Math.PI * 2;
        while (difference > Math.PI) difference -= Math.PI * 2;
        double severity = Math.Min(1, Math.Abs(difference) / (Math.PI * 0.5));
        if (severity < 0.12 || distance > config.TurnLookAheadDistance) return double.PositiveInfinity;
        double safeMaximum = maximumSpeed is not null && double.IsFinite(maximumSpeed.Value)
            ? Math.Max(0, maximumSpeed.Value)
            : 20;
        return Math.Max(config.MinimumTurnSpeed, safeMaximum * (1 - severity * 0.72));
    }
}

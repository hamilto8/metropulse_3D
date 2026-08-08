namespace MetroPulse.Domain.Camera;

public sealed record CameraGroundConstraintResult(
    bool Constrained,
    double MinimumY,
    CameraVector3 Position,
    CameraVector3 Target);

/// <summary>Pure terrain-contact constraint and horizon-leveling geometry.</summary>
public static class CameraGroundConstraintModel
{
    public const double GroundClearance = 0.75;
    public const double MinimumHorizontalLookDistance = 5;
    private const double ContactEpsilon = 0.001;
    private const double DirectionEpsilon = 1e-6;

    public static CameraGroundConstraintResult Constrain(
        CameraVector3 position,
        CameraVector3 target,
        double terrainHeight = 0,
        double clearance = GroundClearance,
        bool levelTarget = true,
        CameraVector3? fallbackForward = null)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(target);
        double safeTerrainHeight = double.IsFinite(terrainHeight) ? terrainHeight : 0;
        double safeClearance = double.IsFinite(clearance) && clearance >= 0 ? clearance : GroundClearance;
        double minimumY = safeTerrainHeight + safeClearance;
        if (position.Y > minimumY + ContactEpsilon)
        {
            return new CameraGroundConstraintResult(false, minimumY, position, target);
        }

        var horizontal = new CameraVector3(target.X - position.X, 0, target.Z - position.Z);
        if (!horizontal.IsFinite || horizontal.LengthSquared <= DirectionEpsilon)
        {
            CameraVector3 fallback = fallbackForward ?? CameraVector3.Forward;
            horizontal = new CameraVector3(fallback.X, 0, fallback.Z);
        }
        if (!horizontal.IsFinite || horizontal.LengthSquared <= DirectionEpsilon)
        {
            horizontal = CameraVector3.Forward;
        }
        CameraVector3 direction = horizontal.Normalize();
        double horizontalDistance = Math.Sqrt(
            Math.Pow(target.X - position.X, 2) + Math.Pow(target.Z - position.Z, 2));
        double lookDistance = Math.Max(
            double.IsFinite(horizontalDistance) ? horizontalDistance : 0,
            MinimumHorizontalLookDistance);
        CameraVector3 constrainedPosition = position with { Y = minimumY };
        CameraVector3 constrainedTarget = levelTarget
            ? new CameraVector3(
                constrainedPosition.X + direction.X * lookDistance,
                minimumY,
                constrainedPosition.Z + direction.Z * lookDistance)
            : target;
        return new CameraGroundConstraintResult(true, minimumY, constrainedPosition, constrainedTarget);
    }
}

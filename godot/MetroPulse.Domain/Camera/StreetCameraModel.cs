namespace MetroPulse.Domain.Camera;

/// <summary>Pure street-altitude, local-pivot, yaw/pitch, and horizon-leveling math.</summary>
public static class StreetCameraModel
{
    public const double MaximumSurfaceDistance = 8;
    public const double ExitSurfaceDistance = 10;
    public const double PivotDistance = 0.75;
    public const double MinimumPitch = -55 * Math.PI / 180;
    public const double MaximumPitch = 65 * Math.PI / 180;
    public const double LevelingResponse = 4.5;
    private const double DirectionEpsilon = 1e-8;

    public static bool IsStreetAltitude(double cameraY, double surfaceY, bool alreadyActive = false) =>
        double.IsFinite(cameraY)
        && double.IsFinite(surfaceY)
        && cameraY - surfaceY <= (alreadyActive ? ExitSurfaceDistance : MaximumSurfaceDistance);

    public static CameraVector3 RotateLookDirection(
        CameraVector3? sourceDirection,
        double yawDelta = 0,
        double pitchDelta = 0,
        bool lockLevel = false)
    {
        CameraVector3 direction = NormalizeDirection(sourceDirection);
        double yaw = Math.Atan2(direction.X, -direction.Z) + FiniteOr(yawDelta);
        double currentPitch = Math.Asin(Math.Clamp(direction.Y, -1, 1));
        double pitch = lockLevel
            ? 0
            : Math.Clamp(currentPitch + FiniteOr(pitchDelta), MinimumPitch, MaximumPitch);
        double horizontalScale = Math.Cos(pitch);
        return new CameraVector3(
            Math.Sin(yaw) * horizontalScale,
            Math.Sin(pitch),
            -Math.Cos(yaw) * horizontalScale).Normalize();
    }

    public static CameraVector3 LevelLookDirection(
        CameraVector3? sourceDirection,
        double delta,
        double response = LevelingResponse)
    {
        CameraVector3 direction = NormalizeDirection(sourceDirection);
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        double safeResponse = double.IsFinite(response) && response > 0 ? response : LevelingResponse;
        double currentPitch = Math.Asin(Math.Clamp(direction.Y, -1, 1));
        double pitch = Math.Abs(currentPitch) < 1e-4
            ? 0
            : currentPitch * Math.Exp(-safeResponse * safeDelta);
        double yaw = Math.Atan2(direction.X, -direction.Z);
        double horizontalScale = Math.Cos(pitch);
        return new CameraVector3(
            Math.Sin(yaw) * horizontalScale,
            Math.Sin(pitch),
            -Math.Cos(yaw) * horizontalScale).Normalize();
    }

    public static CameraVector3 CreateLocalPivot(
        CameraVector3 cameraPosition,
        CameraVector3 lookDirection,
        double distance = PivotDistance)
    {
        ArgumentNullException.ThrowIfNull(cameraPosition);
        double safeDistance = double.IsFinite(distance) && distance > 0 ? distance : PivotDistance;
        return cameraPosition.Add(NormalizeDirection(lookDirection).Scale(safeDistance));
    }

    public static CameraVector3 RestoreMacroPivot(
        CameraVector3 cameraPosition,
        CameraVector3 currentTarget,
        double minimumDistance)
    {
        ArgumentNullException.ThrowIfNull(cameraPosition);
        ArgumentNullException.ThrowIfNull(currentTarget);
        double safeMinimum = double.IsFinite(minimumDistance) ? Math.Max(0, minimumDistance) : 5;
        CameraVector3 direction = currentTarget.Subtract(cameraPosition).Normalize();
        return currentTarget.DistanceTo(cameraPosition) < safeMinimum
            ? cameraPosition.Add(direction.Scale(safeMinimum))
            : currentTarget;
    }

    private static CameraVector3 NormalizeDirection(CameraVector3? direction)
    {
        if (direction is null || !direction.IsFinite || direction.LengthSquared <= DirectionEpsilon)
        {
            return CameraVector3.Forward;
        }
        return direction.Normalize();
    }

    private static double FiniteOr(double value) => double.IsFinite(value) ? value : 0;
}

namespace MetroPulse.Domain.Camera;

public static class CameraTargetTypes
{
    public const string Aircraft = "AIRCRAFT";
    public const string Vehicle = "VEHICLE";
    public const string Pedestrian = "PEDESTRIAN";
}

public sealed record ChaseCameraRequest
{
    public required CameraVector3 TargetPosition { get; init; }

    public string Type { get; init; } = CameraTargetTypes.Pedestrian;

    public double Speed { get; init; }

    public double MeshHeading { get; init; }

    public CameraQuaternion? ChassisQuaternion { get; init; }

    public bool HasPhysicsVehicle { get; init; }

    public bool UserControlled { get; init; }

    public double ChaseYaw { get; init; }

    public double ChasePitch { get; init; }
}

/// <summary>Pure chase framing, chassis heading, transition easing, and speed-FOV math.</summary>
public static class ChaseCameraModel
{
    public const double DefaultFieldOfView = 60;

    public static double GetPlanarHeading(CameraQuaternion? chassisQuaternion, double meshHeading = 0)
    {
        if (chassisQuaternion is not null)
        {
            double forwardX = 2 * (
                chassisQuaternion.X * chassisQuaternion.Z
                + chassisQuaternion.W * chassisQuaternion.Y);
            double forwardZ = 1 - 2 * (
                chassisQuaternion.X * chassisQuaternion.X
                + chassisQuaternion.Y * chassisQuaternion.Y);
            if (double.IsFinite(forwardX) && double.IsFinite(forwardZ))
            {
                return Math.Atan2(forwardX, forwardZ);
            }
        }
        return double.IsFinite(meshHeading) ? meshHeading : 0;
    }

    public static CameraPose GetDesiredPose(ChaseCameraRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.TargetPosition);
        if (!request.TargetPosition.IsFinite)
        {
            throw new ArgumentException("Target position must be finite.", nameof(request));
        }
        double rotation = GetPlanarHeading(request.ChassisQuaternion, request.MeshHeading);
        double viewRotation = rotation + FiniteOr(request.ChaseYaw);
        double pitch = FiniteOr(request.ChasePitch);
        bool aircraft = request.Type == CameraTargetTypes.Aircraft;
        bool physicsCar = !aircraft && (request.HasPhysicsVehicle || request.UserControlled);
        double distance = aircraft ? 28 : physicsCar ? 15 : request.Type == CameraTargetTypes.Vehicle ? 17 : 8;
        double height = aircraft ? 9 : physicsCar ? 4.5 : request.Type == CameraTargetTypes.Vehicle ? 6.5 : 3.5;
        double horizontalDistance = distance * Math.Cos(pitch);
        double offsetX = -Math.Sin(viewRotation) * horizontalDistance;
        double offsetZ = -Math.Cos(viewRotation) * horizontalDistance;
        CameraVector3 cameraPosition = new(
            request.TargetPosition.X + offsetX,
            request.TargetPosition.Y + height + Math.Sin(pitch) * distance,
            request.TargetPosition.Z + offsetZ);
        CameraVector3 lookAt = new(
            request.TargetPosition.X,
            request.TargetPosition.Y + (aircraft ? 2.2 : 1.4),
            request.TargetPosition.Z);

        if (physicsCar || aircraft)
        {
            double speed = Math.Abs(FiniteOr(request.Speed));
            double forwardDistance = aircraft ? Math.Min(14, speed * 0.25) : Math.Min(6, speed * 0.12);
            lookAt = lookAt with
            {
                X = lookAt.X + Math.Sin(rotation) * forwardDistance,
                Z = lookAt.Z + Math.Cos(rotation) * forwardDistance,
            };
        }
        return new CameraPose(cameraPosition, lookAt);
    }

    public static double EaseQuintic(double progress)
    {
        double value = double.IsFinite(progress) ? progress : 0;
        return value * value * value * (value * (value * 6 - 15) + 10);
    }

    public static CameraPose InterpolatePose(CameraPose from, CameraPose to, double progress)
    {
        ArgumentNullException.ThrowIfNull(from);
        ArgumentNullException.ThrowIfNull(to);
        double weight = EaseQuintic(Math.Clamp(FiniteOr(progress), 0, 1));
        return new CameraPose(
            CameraVector3.Lerp(from.Position, to.Position, weight),
            CameraVector3.Lerp(from.LookAt, to.LookAt, weight));
    }

    public static double GetTargetFieldOfView(double speed, bool aircraft)
    {
        double ratio = Math.Min(1, Math.Abs(FiniteOr(speed)) / (aircraft ? 64 : 130));
        return DefaultFieldOfView + ratio * (aircraft ? 10 : 16);
    }

    public static double SmoothFieldOfView(double current, double target, double delta)
    {
        double safeCurrent = double.IsFinite(current) ? current : DefaultFieldOfView;
        double safeTarget = double.IsFinite(target) ? target : DefaultFieldOfView;
        double factor = Math.Min(1, Math.Max(0, FiniteOr(delta)) * 6);
        return safeCurrent + (safeTarget - safeCurrent) * factor;
    }

    private static double FiniteOr(double value) => double.IsFinite(value) ? value : 0;
}

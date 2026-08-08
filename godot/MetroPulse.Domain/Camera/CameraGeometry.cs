namespace MetroPulse.Domain.Camera;

public sealed record CameraVector3(double X, double Y, double Z)
{
    public static readonly CameraVector3 Zero = new(0, 0, 0);

    public static readonly CameraVector3 Forward = new(0, 0, -1);

    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);

    public double LengthSquared => X * X + Y * Y + Z * Z;

    public double Length => Math.Sqrt(LengthSquared);

    public CameraVector3 Add(CameraVector3 other) => new(X + other.X, Y + other.Y, Z + other.Z);

    public CameraVector3 Subtract(CameraVector3 other) => new(X - other.X, Y - other.Y, Z - other.Z);

    public CameraVector3 Scale(double scalar) => new(X * scalar, Y * scalar, Z * scalar);

    public CameraVector3 Normalize(CameraVector3? fallback = null)
    {
        if (!IsFinite || LengthSquared <= 1e-16) return fallback ?? Forward;
        return Scale(1 / Length);
    }

    public double DistanceTo(CameraVector3 other) => Subtract(other).Length;

    public static CameraVector3 Lerp(CameraVector3 from, CameraVector3 to, double weight) => new(
        from.X + (to.X - from.X) * weight,
        from.Y + (to.Y - from.Y) * weight,
        from.Z + (to.Z - from.Z) * weight);
}

public sealed record CameraQuaternion(double X, double Y, double Z, double W);

public sealed record CameraPose(CameraVector3 Position, CameraVector3 LookAt);

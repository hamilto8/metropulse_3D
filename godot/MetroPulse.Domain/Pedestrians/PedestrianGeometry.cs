namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianVector3(double X, double Y, double Z)
{
    public static readonly PedestrianVector3 Zero = new(0, 0, 0);

    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);

    public double LengthSquared => X * X + Y * Y + Z * Z;

    public double Length => Math.Sqrt(LengthSquared);

    public PedestrianVector3 Add(PedestrianVector3 other) => new(X + other.X, Y + other.Y, Z + other.Z);

    public PedestrianVector3 Scale(double scalar) => new(X * scalar, Y * scalar, Z * scalar);

    public double DistanceSquaredTo(PedestrianVector3 other)
    {
        double dx = X - other.X;
        double dy = Y - other.Y;
        double dz = Z - other.Z;
        return dx * dx + dy * dy + dz * dz;
    }

    public double DistanceTo(PedestrianVector3 other) => Math.Sqrt(DistanceSquaredTo(other));

    public PedestrianVector3 Normalize(PedestrianVector3? fallback = null)
    {
        if (!IsFinite || LengthSquared < 1e-12) return fallback ?? new PedestrianVector3(0, 0, 1);
        return Scale(1 / Length);
    }
}

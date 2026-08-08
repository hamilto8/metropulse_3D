namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianCollisionConfig(
    double Radius = 0.42,
    double Height = 2.65,
    double MaximumStep = 0.2,
    int MaximumSubsteps = 64,
    int ResolveIterations = 3,
    double Skin = 0.015);

public sealed record PedestrianCollisionBox(
    string Id,
    double X,
    double Y,
    double Z,
    double HalfX,
    double HalfY,
    double HalfZ,
    double RotationY = 0)
{
    public double Cos => Math.Cos(RotationY);

    public double Sin => Math.Sin(RotationY);
}

public sealed record PedestrianMovementResult(PedestrianVector3 Position, bool Collided);

/// <summary>Pure bounded pedestrian circle sweep and oriented-box slide resolution.</summary>
public static class PedestrianCollisionModel
{
    public static readonly PedestrianCollisionConfig DefaultConfig = new();

    public static PedestrianMovementResult Move(
        PedestrianVector3? position,
        PedestrianVector3? displacement,
        IReadOnlyList<PedestrianCollisionBox>? activeBoxes,
        double? radius = null,
        double? height = null,
        PedestrianCollisionConfig? config = null)
    {
        config ??= DefaultConfig;
        if (position is null || displacement is null)
        {
            return new PedestrianMovementResult(PedestrianVector3.Zero, false);
        }
        double safeRadius = radius is not null && double.IsFinite(radius.Value)
            ? Math.Max(0.1, radius.Value)
            : config.Radius;
        double safeHeight = height is not null && double.IsFinite(height.Value)
            ? Math.Max(0.5, height.Value)
            : config.Height;
        double x = FiniteOr(position.X);
        double y = FiniteOr(position.Y);
        double z = FiniteOr(position.Z);
        double moveX = FiniteOr(displacement.X);
        double moveZ = FiniteOr(displacement.Z);
        double distance = Math.Sqrt(moveX * moveX + moveZ * moveZ);
        double maximumTravel = config.MaximumStep * config.MaximumSubsteps;
        if (distance > maximumTravel)
        {
            double scale = maximumTravel / distance;
            moveX *= scale;
            moveZ *= scale;
            distance = maximumTravel;
        }
        int steps = Math.Clamp(
            Math.Max(1, (int)Math.Ceiling(distance / config.MaximumStep)),
            1,
            config.MaximumSubsteps);
        double stepX = moveX / steps;
        double stepZ = moveZ / steps;
        bool collided = false;
        IReadOnlyList<PedestrianCollisionBox> boxes = activeBoxes ?? Array.Empty<PedestrianCollisionBox>();

        for (int step = 0; step < steps; step += 1)
        {
            x += stepX;
            z += stepZ;
            for (int iteration = 0; iteration < config.ResolveIterations; iteration += 1)
            {
                bool resolved = false;
                foreach (PedestrianCollisionBox box in boxes)
                {
                    if (box is null || !VerticalRangesOverlap(y, safeHeight, box, config)) continue;
                    Separation? separation = CircleBoxSeparation(x, z, safeRadius, box, config);
                    if (separation is null) continue;
                    x += separation.X * separation.Depth;
                    z += separation.Z * separation.Depth;
                    collided = true;
                    resolved = true;
                }
                if (!resolved) break;
            }
        }
        return new PedestrianMovementResult(new PedestrianVector3(x, y, z), collided);
    }

    private static bool VerticalRangesOverlap(
        double footY,
        double height,
        PedestrianCollisionBox box,
        PedestrianCollisionConfig config)
    {
        double pedestrianTop = footY + height;
        double boxBottom = box.Y - box.HalfY;
        double boxTop = box.Y + box.HalfY;
        return pedestrianTop > boxBottom + config.Skin && footY < boxTop - config.Skin;
    }

    private static Separation? CircleBoxSeparation(
        double x,
        double z,
        double radius,
        PedestrianCollisionBox box,
        PedestrianCollisionConfig config)
    {
        double dx = x - box.X;
        double dz = z - box.Z;
        double localX = box.Cos * dx - box.Sin * dz;
        double localZ = box.Sin * dx + box.Cos * dz;
        double closestX = Math.Clamp(localX, -box.HalfX, box.HalfX);
        double closestZ = Math.Clamp(localZ, -box.HalfZ, box.HalfZ);
        double offsetX = localX - closestX;
        double offsetZ = localZ - closestZ;
        double distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
        if (distanceSquared >= radius * radius) return null;

        double normalX;
        double normalZ;
        double depth;
        if (distanceSquared > 1e-10)
        {
            double distance = Math.Sqrt(distanceSquared);
            normalX = offsetX / distance;
            normalZ = offsetZ / distance;
            depth = radius - distance;
        }
        else
        {
            (depth, normalX, normalZ) = new (double Depth, double X, double Z)[]
            {
                (localX + box.HalfX + radius, -1, 0),
                (box.HalfX - localX + radius, 1, 0),
                (localZ + box.HalfZ + radius, 0, -1),
                (box.HalfZ - localZ + radius, 0, 1),
            }.OrderBy(exit => exit.Depth).First();
        }
        return new Separation(
            box.Cos * normalX + box.Sin * normalZ,
            -box.Sin * normalX + box.Cos * normalZ,
            depth + config.Skin);
    }

    private static double FiniteOr(double value) => double.IsFinite(value) ? value : 0;

    private sealed record Separation(double X, double Z, double Depth);
}

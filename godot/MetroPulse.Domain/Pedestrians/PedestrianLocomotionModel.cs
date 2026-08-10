namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianLocomotionConfig(
    double WalkSpeed = 4.5,
    double SprintSpeed = 7.5,
    double GroundAcceleration = 30,
    double AirAcceleration = 8,
    double GroundFriction = 24,
    double JumpSpeed = 6.5,
    double Gravity = 19.6,
    double MaximumFallSpeed = 45,
    double MaximumStepHeight = 0.45,
    double MaximumSlopeDegrees = 46);

public sealed record PedestrianPlanarVelocity(double X, double Z)
{
    public static readonly PedestrianPlanarVelocity Zero = new(0, 0);

    public double Length => Math.Sqrt((X * X) + (Z * Z));
}

public enum PedestrianAnimationState
{
    Idle,
    Walk,
    Sprint,
    Jump,
    Fall,
}

/// <summary>Engine-neutral tuning and state classification for the player pedestrian.</summary>
public static class PedestrianLocomotionModel
{
    public static readonly PedestrianLocomotionConfig DefaultConfig = new();

    public static PedestrianPlanarVelocity AdvancePlanarVelocity(
        PedestrianPlanarVelocity current,
        PedestrianPlanarVelocity direction,
        bool sprint,
        bool grounded,
        double delta,
        PedestrianLocomotionConfig? config = null)
    {
        PedestrianLocomotionConfig tuning = config ?? DefaultConfig;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        PedestrianPlanarVelocity normalized = Normalize(direction);
        double targetSpeed = sprint ? tuning.SprintSpeed : tuning.WalkSpeed;
        double targetX = normalized.X * targetSpeed;
        double targetZ = normalized.Z * targetSpeed;
        double rate = normalized.Length > 0
            ? (grounded ? tuning.GroundAcceleration : tuning.AirAcceleration)
            : (grounded ? tuning.GroundFriction : 0);
        return new PedestrianPlanarVelocity(
            MoveToward(FiniteOrZero(current.X), targetX, rate * safeDelta),
            MoveToward(FiniteOrZero(current.Z), targetZ, rate * safeDelta));
    }

    public static double AdvanceVerticalVelocity(
        double current,
        bool grounded,
        bool jumpPressed,
        double delta,
        PedestrianLocomotionConfig? config = null)
    {
        PedestrianLocomotionConfig tuning = config ?? DefaultConfig;
        if (grounded)
        {
            return jumpPressed ? tuning.JumpSpeed : Math.Min(0, FiniteOrZero(current));
        }
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        return Math.Max(-tuning.MaximumFallSpeed, FiniteOrZero(current) - (tuning.Gravity * safeDelta));
    }

    public static PedestrianAnimationState ClassifyAnimation(
        double planarSpeed,
        double verticalSpeed,
        bool grounded,
        bool sprint)
    {
        if (!grounded)
        {
            return FiniteOrZero(verticalSpeed) > 0.1
                ? PedestrianAnimationState.Jump
                : PedestrianAnimationState.Fall;
        }
        double speed = Math.Max(0, FiniteOrZero(planarSpeed));
        if (speed < 0.15) return PedestrianAnimationState.Idle;
        return sprint ? PedestrianAnimationState.Sprint : PedestrianAnimationState.Walk;
    }

    public static bool RequiresRecovery(
        PedestrianVector3 position,
        Func<double, double, bool> withinWorldBounds,
        Func<double, double, double, bool> isWater,
        double minimumY = -3)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(withinWorldBounds);
        ArgumentNullException.ThrowIfNull(isWater);
        return !position.IsFinite
            || position.Y < minimumY
            || !withinWorldBounds(position.X, position.Z)
            || isWater(position.X, position.Y, position.Z);
    }

    private static PedestrianPlanarVelocity Normalize(PedestrianPlanarVelocity value)
    {
        double x = FiniteOrZero(value.X);
        double z = FiniteOrZero(value.Z);
        double length = Math.Sqrt((x * x) + (z * z));
        return length <= 1e-9 ? PedestrianPlanarVelocity.Zero : new(x / length, z / length);
    }

    private static double MoveToward(double from, double to, double maximumDelta)
    {
        if (Math.Abs(to - from) <= maximumDelta) return to;
        return from + (Math.Sign(to - from) * maximumDelta);
    }

    private static double FiniteOrZero(double value) => double.IsFinite(value) ? value : 0;
}

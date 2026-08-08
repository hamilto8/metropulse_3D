namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianKnockdownConfig(
    double Duration = 4,
    double StandDuration = 0.65,
    double Gravity = 18,
    double HorizontalDamping = 3.5,
    double MinimumThrowSpeed = 3.25,
    double MaximumThrowSpeed = 7.5,
    double MinimumLiftSpeed = 2.5,
    double MaximumLiftSpeed = 5);

public sealed record PedestrianKnockdownState(
    bool Active,
    double Elapsed,
    PedestrianVector3 Position,
    PedestrianVector3 Velocity,
    bool Grounded,
    double RestRoll,
    double TumbleRate,
    double RotationX,
    double RotationZ,
    double LimbPose)
{
    public double Remaining(PedestrianKnockdownConfig? config = null) =>
        Math.Max(0, (config ?? PedestrianKnockdownModel.DefaultConfig).Duration - Elapsed);
}

/// <summary>Pure bounded knockdown throw, terrain contact, tumble, and stand-up state.</summary>
public static class PedestrianKnockdownModel
{
    public static readonly PedestrianKnockdownConfig DefaultConfig = new();

    public static PedestrianKnockdownState Start(
        PedestrianVector3 position,
        PedestrianVector3? knockDirection,
        double impactSpeed = 8,
        double fallSideSample = 0.5,
        double tumbleSample = 0.5,
        PedestrianKnockdownConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(position);
        if (!position.IsFinite)
        {
            throw new ArgumentException("Pedestrian position must be finite.", nameof(position));
        }
        config ??= DefaultConfig;
        PedestrianVector3 rawDirection = knockDirection ?? new PedestrianVector3(0, 0, 1);
        var planarDirection = new PedestrianVector3(rawDirection.X, 0, rawDirection.Z);
        if (!planarDirection.IsFinite || planarDirection.LengthSquared < 1e-6)
        {
            planarDirection = new PedestrianVector3(0, 0, 1);
        }
        PedestrianVector3 direction = planarDirection.Normalize();
        double safeImpact = double.IsFinite(impactSpeed) ? Math.Abs(impactSpeed) : 8;
        double throwSpeed = Math.Clamp(
            safeImpact * 0.22,
            config.MinimumThrowSpeed,
            config.MaximumThrowSpeed);
        double liftSpeed = Math.Clamp(
            2.3 + safeImpact * 0.12,
            config.MinimumLiftSpeed,
            config.MaximumLiftSpeed);
        double side = Sample(fallSideSample) < 0.5 ? -1 : 1;
        PedestrianVector3 velocity = direction.Scale(throwSpeed) with { Y = liftSpeed };
        return new PedestrianKnockdownState(
            true,
            0,
            position.Add(direction.Scale(0.2)),
            velocity,
            false,
            side * 1.42,
            side * (3.5 + Sample(tumbleSample) * 2),
            0,
            0,
            1);
    }

    public static PedestrianKnockdownState Update(
        PedestrianKnockdownState state,
        double delta,
        Func<double, double, double>? getTerrainHeight = null,
        PedestrianKnockdownConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        config ??= DefaultConfig;
        if (!state.Active) return Reset(state, Terrain(state.Position, getTerrainHeight));
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        double elapsed = state.Elapsed + safeDelta;
        PedestrianVector3 velocity = state.Velocity with
        {
            Y = state.Velocity.Y - config.Gravity * safeDelta,
        };
        PedestrianVector3 position = state.Position.Add(velocity.Scale(safeDelta));
        double damping = Math.Exp(-config.HorizontalDamping * safeDelta);
        velocity = velocity with { X = velocity.X * damping, Z = velocity.Z * damping };
        double ground = Terrain(position, getTerrainHeight);
        bool grounded = state.Grounded;
        if (position.Y <= ground)
        {
            position = position with { Y = ground };
            velocity = velocity with { Y = 0 };
            grounded = true;
        }

        double rotationX;
        double rotationZ;
        if (grounded)
        {
            rotationX = Lerp(state.RotationX, -0.18, 0.25);
            rotationZ = Lerp(state.RotationZ, state.RestRoll, 0.25);
        }
        else
        {
            rotationX = Lerp(state.RotationX, -0.35, 0.18);
            rotationZ = state.RotationZ + state.TumbleRate * safeDelta;
        }
        double limbPose = state.LimbPose;
        double standStart = config.Duration - config.StandDuration;
        if (elapsed >= standStart)
        {
            double standProgress = Smoothstep((elapsed - standStart) / config.StandDuration);
            rotationX = Lerp(-0.18, 0, standProgress);
            rotationZ = Lerp(state.RestRoll, 0, standProgress);
            limbPose = 1 - standProgress;
        }

        PedestrianKnockdownState next = state with
        {
            Elapsed = elapsed,
            Position = position,
            Velocity = velocity,
            Grounded = grounded,
            RotationX = rotationX,
            RotationZ = rotationZ,
            LimbPose = limbPose,
        };
        return elapsed < config.Duration ? next : Reset(next, ground);
    }

    public static PedestrianKnockdownState Reset(PedestrianKnockdownState state, double ground = 0)
    {
        ArgumentNullException.ThrowIfNull(state);
        double safeGround = double.IsFinite(ground) ? ground : 0;
        return state with
        {
            Active = false,
            Position = state.Position with { Y = safeGround },
            Velocity = PedestrianVector3.Zero,
            Grounded = true,
            RotationX = 0,
            RotationZ = 0,
            LimbPose = 0,
        };
    }

    private static double Terrain(
        PedestrianVector3 position,
        Func<double, double, double>? getTerrainHeight)
    {
        double height = getTerrainHeight?.Invoke(position.X, position.Z) ?? 0;
        return double.IsFinite(height) ? height : 0;
    }

    private static double Sample(double value) => double.IsFinite(value) ? Math.Clamp(value, 0, 1) : 0.5;

    private static double Smoothstep(double value)
    {
        double t = Math.Clamp(value, 0, 1);
        return t * t * (3 - 2 * t);
    }

    private static double Lerp(double from, double to, double weight) => from + (to - from) * weight;
}

namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianTrafficConfig(
    double ImpatienceProbability = 0.2,
    double ImpatienceDelay = 3.5,
    double ReactionTime = 0.18,
    double Clearance = 4.5,
    double MinimumDetectionDistance = 7,
    double MaximumDetectionDistance = 36,
    double BrakeMultiplier = 3.5,
    double MinimumBrakeDeceleration = 28,
    double EmergencyStopDistance = 3.1,
    double LargeVehicleEmergencyStopDistance = 4.2);

public sealed record PedestrianYieldKinematics(
    double Speed,
    double BrakeDeceleration,
    double StoppingDistance,
    double DetectionDistance);

public sealed record PedestrianTrafficParticipant(
    bool HasRuntimeBody = true,
    bool KnockedDown = false,
    bool IsHijacking = false,
    string? Archetype = null,
    bool HasCafeSeat = false,
    string? BehaviorMode = null);

public sealed record PedestrianTrafficEncounter(
    bool Impatient,
    double Elapsed = 0,
    bool Honked = false,
    bool Released = false);

public sealed record PedestrianTrafficAction(
    PedestrianTrafficEncounter State,
    bool ShouldYield,
    bool ShouldHonk);

/// <summary>Pure vehicle braking and driver-disposition policy for pedestrian encounters.</summary>
public static class PedestrianTrafficModel
{
    public static readonly PedestrianTrafficConfig DefaultConfig = new();

    public static PedestrianYieldKinematics GetYieldKinematics(
        double speed,
        double acceleration,
        PedestrianTrafficConfig? config = null)
    {
        config ??= DefaultConfig;
        double safeSpeed = NonNegative(Math.Abs(speed), 0);
        double safeAcceleration = NonNegative(acceleration, 0);
        double brakeMultiplier = NonNegative(config.BrakeMultiplier, DefaultConfig.BrakeMultiplier);
        double minimumBrake = NonNegative(config.MinimumBrakeDeceleration, DefaultConfig.MinimumBrakeDeceleration);
        double brakeDeceleration = Math.Max(minimumBrake, safeAcceleration * brakeMultiplier);
        double reactionTime = NonNegative(config.ReactionTime, DefaultConfig.ReactionTime);
        double clearance = NonNegative(config.Clearance, DefaultConfig.Clearance);
        double minimumDistance = NonNegative(config.MinimumDetectionDistance, DefaultConfig.MinimumDetectionDistance);
        double maximumDistance = Math.Max(
            minimumDistance,
            NonNegative(config.MaximumDetectionDistance, DefaultConfig.MaximumDetectionDistance));
        double stoppingDistance = brakeDeceleration > 0
            ? safeSpeed * safeSpeed / (2 * brakeDeceleration)
            : maximumDistance;
        double detectionDistance = Math.Max(
            minimumDistance,
            Math.Min(maximumDistance, stoppingDistance + safeSpeed * reactionTime + clearance));
        return new PedestrianYieldKinematics(
            safeSpeed,
            brakeDeceleration,
            stoppingDistance,
            detectionDistance);
    }

    public static double ApproachTargetSpeed(
        double currentSpeed,
        double targetSpeed,
        double acceleration,
        double delta,
        bool pedestrianBlocked = false,
        PedestrianTrafficConfig? config = null)
    {
        double current = double.IsFinite(currentSpeed) ? currentSpeed : 0;
        double target = double.IsFinite(targetSpeed) ? targetSpeed : 0;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        double safeAcceleration = NonNegative(acceleration, 0);
        if (current < target) return Math.Min(target, current + safeAcceleration * safeDelta);
        if (current <= target) return current;
        double deceleration = pedestrianBlocked
            ? GetYieldKinematics(current, safeAcceleration, config).BrakeDeceleration
            : safeAcceleration * 1.8;
        return Math.Max(target, current - deceleration * safeDelta);
    }

    public static double GetEmergencyStopDistance(string? vehicleType, PedestrianTrafficConfig? config = null)
    {
        config ??= DefaultConfig;
        bool largeVehicle = vehicleType is "BUS" or "TRUCK" or "DUMP_TRUCK";
        return largeVehicle
            ? NonNegative(config.LargeVehicleEmergencyStopDistance, DefaultConfig.LargeVehicleEmergencyStopDistance)
            : NonNegative(config.EmergencyStopDistance, DefaultConfig.EmergencyStopDistance);
    }

    public static bool IsTrafficParticipant(PedestrianTrafficParticipant? pedestrian)
    {
        if (pedestrian is null || !pedestrian.HasRuntimeBody || pedestrian.KnockedDown || pedestrian.IsHijacking)
        {
            return false;
        }
        bool seatedCafePatron = pedestrian.Archetype == "CAFE_READER"
            && (pedestrian.HasCafeSeat || pedestrian.BehaviorMode == "SITTING_READING");
        return !seatedCafePatron;
    }

    public static PedestrianTrafficEncounter CreateEncounter(
        double dispositionSample,
        PedestrianTrafficConfig? config = null)
    {
        config ??= DefaultConfig;
        double roll = double.IsFinite(dispositionSample) ? Math.Clamp(dispositionSample, 0, 1) : 0.5;
        double probability = double.IsFinite(config.ImpatienceProbability)
            ? Math.Clamp(config.ImpatienceProbability, 0, 1)
            : DefaultConfig.ImpatienceProbability;
        return new PedestrianTrafficEncounter(roll < probability);
    }

    public static PedestrianTrafficAction UpdateEncounter(
        PedestrianTrafficEncounter? state,
        double delta,
        PedestrianTrafficConfig? config = null)
    {
        if (state is null)
        {
            return new PedestrianTrafficAction(new PedestrianTrafficEncounter(false), false, false);
        }
        config ??= DefaultConfig;
        double elapsed = state.Elapsed + (double.IsFinite(delta) ? Math.Max(0, delta) : 0);
        PedestrianTrafficEncounter next = state with { Elapsed = elapsed };
        if (!next.Impatient)
        {
            return new PedestrianTrafficAction(next, true, false);
        }
        double delay = double.IsFinite(config.ImpatienceDelay)
            ? Math.Max(0, config.ImpatienceDelay)
            : DefaultConfig.ImpatienceDelay;
        if (next.Elapsed < delay)
        {
            return new PedestrianTrafficAction(next, true, false);
        }
        bool shouldHonk = !next.Honked;
        next = next with { Honked = true, Released = true };
        return new PedestrianTrafficAction(next, false, shouldHonk);
    }

    private static double NonNegative(double value, double fallback) =>
        double.IsFinite(value) ? Math.Max(0, value) : fallback;
}

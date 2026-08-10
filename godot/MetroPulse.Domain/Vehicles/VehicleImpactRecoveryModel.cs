namespace MetroPulse.Domain.Vehicles;

public sealed record VehicleImpactRecoveryConfig(
    double MinimumReportSpeed = 1.5,
    double PedestrianKnockdownSpeed = 4,
    double MotorbikeEjectionSpeed = 8,
    double ImpactDebounceSeconds = 0.2,
    double MaximumResponseImpulse = 4.5,
    double MaximumSupportedRollRadians = 0.85,
    double MaximumSupportedPitchRadians = 0.85,
    double UnsafeDropMeters = 2,
    double StuckDurationSeconds = 2.5);

public sealed record VehicleImpactDecision(
    bool Reported,
    bool KnockdownPedestrian,
    bool EjectRider,
    double ResponseImpulse,
    string? Code = null);

public sealed record VehicleRecoveryDecision(bool Recover, string? Code = null);

/// <summary>Pure impact thresholds, forgiving response clamp, and supported-pose recovery policy.</summary>
public static class VehicleImpactRecoveryModel
{
    public static readonly VehicleImpactRecoveryConfig DefaultConfig = new();

    public static VehicleImpactDecision EvaluateImpact(
        double relativeSpeed,
        double secondsSinceLastImpact,
        bool hitPedestrian,
        bool motorbike,
        VehicleImpactRecoveryConfig? config = null)
    {
        VehicleImpactRecoveryConfig rules = config ?? DefaultConfig;
        double speed = double.IsFinite(relativeSpeed) ? Math.Abs(relativeSpeed) : 0;
        double elapsed = double.IsFinite(secondsSinceLastImpact) ? Math.Max(0, secondsSinceLastImpact) : 0;
        if (elapsed < rules.ImpactDebounceSeconds)
        {
            return new VehicleImpactDecision(false, false, false, 0, "IMPACT_DEBOUNCED");
        }
        if (speed < rules.MinimumReportSpeed)
        {
            return new VehicleImpactDecision(false, false, false, 0, "IMPACT_BELOW_THRESHOLD");
        }
        return new VehicleImpactDecision(
            true,
            hitPedestrian && speed >= rules.PedestrianKnockdownSpeed,
            motorbike && speed >= rules.MotorbikeEjectionSpeed,
            Math.Min(rules.MaximumResponseImpulse, speed * 0.18));
    }

    public static VehicleRecoveryDecision EvaluateRecovery(
        double bodyHeight,
        double surfaceHeight,
        bool withinBounds,
        bool water,
        double pitchRadians,
        double rollRadians,
        bool grounded,
        double stuckDuration,
        bool forced = false,
        VehicleImpactRecoveryConfig? config = null)
    {
        VehicleImpactRecoveryConfig rules = config ?? DefaultConfig;
        if (forced) return new VehicleRecoveryDecision(true, "VEHICLE_RESET_REQUESTED");
        if (!withinBounds) return new VehicleRecoveryDecision(true, "VEHICLE_OUT_OF_BOUNDS");
        if (water) return new VehicleRecoveryDecision(true, "VEHICLE_IN_WATER");
        if (!double.IsFinite(bodyHeight) || !double.IsFinite(surfaceHeight)
            || bodyHeight < surfaceHeight - rules.UnsafeDropMeters)
        {
            return new VehicleRecoveryDecision(true, "VEHICLE_BELOW_SURFACE");
        }
        if (!double.IsFinite(pitchRadians) || !double.IsFinite(rollRadians)
            || Math.Abs(pitchRadians) > rules.MaximumSupportedPitchRadians
            || Math.Abs(rollRadians) > rules.MaximumSupportedRollRadians)
        {
            return new VehicleRecoveryDecision(true, "VEHICLE_ROLLED");
        }
        if (grounded && double.IsFinite(stuckDuration) && stuckDuration >= rules.StuckDurationSeconds)
        {
            return new VehicleRecoveryDecision(true, "VEHICLE_STUCK");
        }
        return new VehicleRecoveryDecision(false);
    }
}

namespace MetroPulse.Domain.Vehicles;

public sealed record VehiclePossessionConfig(
    double MaximumEntryDistance = 3,
    double HijackDuration = 1.25,
    double MaximumExitSpeed = 1.5,
    double MaximumExitRollRadians = 0.7);

public sealed record VehicleEntryDecision(
    bool Allowed,
    bool RequiresHijack,
    double RequiredDuration,
    string? Code = null);

public sealed record VehicleHijackProgress(
    double Elapsed,
    bool Completed,
    bool Canceled,
    string? Code = null);

public sealed record VehicleExitDecision(bool Allowed, string? Code = null);

public static class VehiclePossessionModel
{
    public static readonly VehiclePossessionConfig DefaultConfig = new();

    public static VehicleEntryDecision EvaluateEntry(
        double distance,
        bool occupied,
        bool authorized,
        bool vehicleSupported,
        VehiclePossessionConfig? config = null)
    {
        VehiclePossessionConfig rules = config ?? DefaultConfig;
        if (!double.IsFinite(distance) || distance < 0 || distance > rules.MaximumEntryDistance)
        {
            return new VehicleEntryDecision(false, false, 0, "VEHICLE_OUT_OF_RANGE");
        }
        if (!vehicleSupported)
        {
            return new VehicleEntryDecision(false, false, 0, "VEHICLE_UNSUPPORTED");
        }
        bool hijack = occupied && !authorized;
        return new VehicleEntryDecision(true, hijack, hijack ? rules.HijackDuration : 0);
    }

    public static VehicleHijackProgress AdvanceHijack(
        VehicleHijackProgress progress,
        double delta,
        bool remainsEligible,
        VehiclePossessionConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(progress);
        if (progress.Completed || progress.Canceled) return progress;
        if (!remainsEligible)
        {
            return progress with { Canceled = true, Code = "HIJACK_INTERRUPTED" };
        }
        VehiclePossessionConfig rules = config ?? DefaultConfig;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.25) : 0;
        double elapsed = Math.Min(rules.HijackDuration, Math.Max(0, progress.Elapsed) + safeDelta);
        return progress with { Elapsed = elapsed, Completed = elapsed >= rules.HijackDuration };
    }

    public static VehicleExitDecision EvaluateExit(
        double speed,
        double rollRadians,
        bool grounded,
        bool exitPoseSafe,
        VehiclePossessionConfig? config = null)
    {
        VehiclePossessionConfig rules = config ?? DefaultConfig;
        if (!double.IsFinite(speed) || Math.Abs(speed) > rules.MaximumExitSpeed)
        {
            return new VehicleExitDecision(false, "VEHICLE_EXIT_MOVING");
        }
        if (!grounded || !double.IsFinite(rollRadians) || Math.Abs(rollRadians) > rules.MaximumExitRollRadians)
        {
            return new VehicleExitDecision(false, "VEHICLE_EXIT_AIRBORNE_OR_ROLLED");
        }
        return exitPoseSafe
            ? new VehicleExitDecision(true)
            : new VehicleExitDecision(false, "VEHICLE_EXIT_POSE_BLOCKED");
    }
}

namespace MetroPulse.Domain.Aircraft;

public sealed record AircraftAudioProfile(
    double RpmRatio,
    double EngineFrequency,
    double HarmonicFrequency,
    double BladeFrequency,
    double FilterFrequency,
    double EngineGain,
    double PropellerGain,
    double AirflowGain);

/// <summary>Pure propeller and airflow telemetry consumed by future audio adapters.</summary>
public static class AircraftAudioModel
{
    public static AircraftAudioProfile GetProfile(
        AircraftFlightState? state = null,
        double maximumSpeed = 64)
    {
        state ??= new AircraftFlightState();
        double throttle = Math.Clamp(FiniteOrZero(state.Throttle), 0, 1);
        double speedRatio = Math.Clamp(
            Math.Abs(FiniteOrZero(state.Speed)) / Math.Max(1, FiniteOrFallback(maximumSpeed, 64)),
            0,
            1);
        bool crashed = state.Crashed;
        bool grounded = state.Grounded;
        double rpmRatio = crashed
            ? 0
            : Math.Clamp(0.18 + throttle * 0.72 + speedRatio * 0.1, 0.18, 1);
        double airflow = grounded ? speedRatio * 0.38 : speedRatio;

        return new AircraftAudioProfile(
            rpmRatio,
            38 + rpmRatio * 76,
            76 + rpmRatio * 152,
            54 + rpmRatio * 142,
            320 + rpmRatio * 1_080 + speedRatio * 240,
            crashed ? 0.001 : 0.035 + rpmRatio * 0.085,
            crashed ? 0.001 : 0.018 + rpmRatio * 0.09,
            crashed ? 0.001 : 0.004 + airflow * 0.075);
    }

    private static double FiniteOrZero(double value) => double.IsFinite(value) ? value : 0;

    private static double FiniteOrFallback(double value, double fallback) =>
        double.IsFinite(value) ? value : fallback;
}

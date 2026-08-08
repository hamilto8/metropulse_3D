namespace MetroPulse.Domain.TimeWeather;

public sealed record TimeOfDayVisualConfig(
    double NightStart = 17,
    double FullNightStart = 19,
    double FullNightEnd = 5,
    double NightEnd = 7,
    double DayExposure = 1.35,
    double NightExposure = 1.46,
    double DayBloomStrength = 0.34,
    double NightBloomStrength = 0.38,
    double DayBloomThreshold = 0.88,
    double NightBloomThreshold = 0.86);

/// <summary>Pure simulation-time advancement and day/night classification.</summary>
public static class SimulationTimeModel
{
    public const double DefaultSpeed = 1;
    public const double BaseGameMinutesPerRealSecond = 1;

    public static readonly IReadOnlyList<double> SpeedOptions = Array.AsReadOnly([0.5, 1, 5, 15]);

    public static TimeOfDayVisualConfig DefaultVisualConfig { get; } = new();

    public static double NormalizeSpeed(double speed) => SpeedOptions.Contains(speed) ? speed : DefaultSpeed;

    public static double Advance(double time, double deltaSeconds, double speed = DefaultSpeed)
    {
        double currentTime = double.IsFinite(time) ? time : 0;
        double elapsedSeconds = double.IsFinite(deltaSeconds) ? Math.Max(0, deltaSeconds) : 0;
        double hoursElapsed = elapsedSeconds * BaseGameMinutesPerRealSecond * NormalizeSpeed(speed) / 60;
        return WrapHour(currentTime + hoursElapsed);
    }

    public static double NormalizeHour(double time) => double.IsFinite(time) ? WrapHour(time) : 12;

    public static double GetNightFactor(double time, TimeOfDayVisualConfig? config = null)
    {
        TimeOfDayVisualConfig values = config ?? DefaultVisualConfig;
        double hour = NormalizeHour(time);
        if (hour >= values.FullNightStart || hour < values.FullNightEnd) return 1;
        if (hour >= values.NightStart && hour < values.FullNightStart)
        {
            return SmoothStep(hour, values.NightStart, values.FullNightStart);
        }
        if (hour >= values.FullNightEnd && hour < values.NightEnd)
        {
            return 1 - SmoothStep(hour, values.FullNightEnd, values.NightEnd);
        }
        return 0;
    }

    private static double WrapHour(double value) => ((value % 24) + 24) % 24;

    private static double SmoothStep(double value, double minimum, double maximum)
    {
        if (value <= minimum) return 0;
        if (value >= maximum) return 1;
        double progress = (value - minimum) / (maximum - minimum);
        return progress * progress * (3 - (2 * progress));
    }
}

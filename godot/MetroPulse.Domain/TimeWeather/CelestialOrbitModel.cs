namespace MetroPulse.Domain.TimeWeather;

public sealed record CelestialOrbitConfig(
    double Radius = 1400,
    double LateralDrift = 260,
    double SunBodyRadius = 110,
    double MoonBodyRadius = 68,
    double CameraFarPlane = 2200);

public sealed record HorizontalCenter(double X = 0, double Z = 0);

public sealed record CelestialAngles(double Sun, double Moon);

public sealed record CelestialPosition(double X, double Y, double Z);

/// <summary>Pure sun/moon orbit geometry shared by environment and camera adapters.</summary>
public static class CelestialOrbitModel
{
    private const double FullDayHours = 24;
    private const double SunriseHour = 6;

    public static CelestialOrbitConfig DefaultConfig { get; } = new();

    public static CelestialAngles GetAngles(double time)
    {
        double hour = FiniteOr(time);
        double sun = (hour - SunriseHour) / FullDayHours * Math.PI * 2;
        return new CelestialAngles(sun, sun + Math.PI);
    }

    public static CelestialPosition GetPosition(
        double time,
        string? body,
        HorizontalCenter? center = null,
        CelestialOrbitConfig? config = null)
    {
        HorizontalCenter origin = center ?? new HorizontalCenter();
        CelestialOrbitConfig values = config ?? DefaultConfig;
        CelestialAngles angles = GetAngles(time);
        bool isMoon = body == "moon";
        double angle = isMoon ? angles.Moon : angles.Sun;
        double radius = Math.Max(1, FiniteOr(values.Radius, DefaultConfig.Radius));
        double lateralDrift = Math.Max(0, FiniteOr(values.LateralDrift, DefaultConfig.LateralDrift));
        double centerX = FiniteOr(origin.X);
        double centerZ = FiniteOr(origin.Z);
        double zDirection = isMoon ? -1 : 1;
        return new CelestialPosition(
            centerX + (Math.Cos(angle) * radius),
            Math.Sin(angle) * radius,
            centerZ + (zDirection * Math.Sin(angles.Sun * 0.5) * lateralDrift));
    }

    public static bool IsVisible(double positionY, double bodyRadius)
    {
        double y = FiniteOr(positionY, double.NegativeInfinity);
        double radius = Math.Max(0, FiniteOr(bodyRadius));
        return y + radius > 0;
    }

    private static double FiniteOr(double value, double fallback = 0) => double.IsFinite(value) ? value : fallback;
}

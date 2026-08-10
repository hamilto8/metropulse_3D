using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.TimeWeather;

public sealed record PresentationColor(double Red, double Green, double Blue)
{
    public static PresentationColor FromRgb(int rgb) => new(
        ((rgb >> 16) & 0xff) / 255d,
        ((rgb >> 8) & 0xff) / 255d,
        (rgb & 0xff) / 255d);

    public static PresentationColor Lerp(PresentationColor from, PresentationColor to, double amount)
    {
        double weight = Math.Clamp(double.IsFinite(amount) ? amount : 0, 0, 1);
        return new(
            from.Red + ((to.Red - from.Red) * weight),
            from.Green + ((to.Green - from.Green) * weight),
            from.Blue + ((to.Blue - from.Blue) * weight));
    }
}

public sealed record EnvironmentPresentationSnapshot(
    double Hour,
    string WeatherMode,
    PresentationColor SkyTop,
    PresentationColor SkyHorizon,
    double NightFactor,
    double FogDensity,
    double RainOpacity,
    double Wetness,
    double Exposure,
    double BloomStrength,
    double BloomThreshold,
    double SunEnergy,
    double MoonEnergy,
    double AmbientEnergy,
    CelestialPosition SunPosition,
    CelestialPosition MoonPosition,
    bool SunVisible,
    bool MoonVisible);

public sealed class EnvironmentPresentationModel
{
    private readonly IReadOnlyDictionary<string, WeatherDefinition> weather;
    private readonly string defaultWeather;

    public EnvironmentPresentationModel(IReadOnlyList<WeatherDefinition> definitions, string defaultWeather)
    {
        ArgumentNullException.ThrowIfNull(definitions);
        weather = definitions.ToDictionary(item => item.Id!, StringComparer.Ordinal);
        if (weather.Count == 0 || !weather.ContainsKey(defaultWeather))
        {
            throw new ArgumentException("Environment presentation requires a valid default weather mode.", nameof(defaultWeather));
        }
        this.defaultWeather = defaultWeather;
    }

    public static EnvironmentPresentationModel LoadProduction()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        return new EnvironmentPresentationModel(content.WeatherRecords, content.DefaultWeatherMode);
    }

    public EnvironmentPresentationSnapshot Evaluate(double time, string? weatherMode, double cameraHeight = 0)
    {
        double hour = SimulationTimeModel.NormalizeHour(time);
        string mode = weatherMode is not null && weather.ContainsKey(weatherMode) ? weatherMode : defaultWeather;
        WeatherDefinition definition = weather[mode];
        double night = SimulationTimeModel.GetNightFactor(hour);
        (PresentationColor top, PresentationColor horizon) = ApplyWeather(GetSkyPalette(hour), mode);
        double altitudeProgress = SmoothStep(double.IsFinite(cameraHeight) ? cameraHeight : 0, 60, 300);
        double altitudeScale = Lerp(1, 0.32, altitudeProgress);
        TimeOfDayVisualConfig visuals = SimulationTimeModel.DefaultVisualConfig;
        CelestialOrbitConfig orbit = CelestialOrbitModel.DefaultConfig;
        CelestialPosition sun = CelestialOrbitModel.GetPosition(hour, "sun");
        CelestialPosition moon = CelestialOrbitModel.GetPosition(hour, "moon");
        return new EnvironmentPresentationSnapshot(
            hour,
            mode,
            top,
            horizon,
            night,
            definition.FogDensity * altitudeScale,
            definition.RainOpacity,
            definition.Wetness,
            Lerp(visuals.DayExposure, visuals.NightExposure, night),
            Lerp(visuals.DayBloomStrength, visuals.NightBloomStrength, night),
            Lerp(visuals.DayBloomThreshold, visuals.NightBloomThreshold, night),
            Lerp(1.15, 0.08, night),
            Lerp(0.05, 0.52, night),
            Lerp(0.82, 0.3, night),
            sun,
            moon,
            CelestialOrbitModel.IsVisible(sun.Y, orbit.SunBodyRadius),
            CelestialOrbitModel.IsVisible(moon.Y, orbit.MoonBodyRadius));
    }

    private static (PresentationColor Top, PresentationColor Horizon) GetSkyPalette(double hour)
    {
        PresentationColor nightTop = PresentationColor.FromRgb(0x080b20);
        PresentationColor nightHorizon = PresentationColor.FromRgb(0x1a2850);
        PresentationColor dayTop = PresentationColor.FromRgb(0x2f72d8);
        PresentationColor dayHorizon = PresentationColor.FromRgb(0x72b8ef);
        PresentationColor dawnTop = PresentationColor.FromRgb(0x5969a8);
        PresentationColor dawnHorizon = PresentationColor.FromRgb(0xf2a066);
        PresentationColor duskTop = PresentationColor.FromRgb(0x3b315f);
        PresentationColor duskHorizon = PresentationColor.FromRgb(0xd96879);
        if (hour >= 5 && hour < 7)
        {
            double progress = (hour - 5) / 2;
            PresentationColor top = PresentationColor.Lerp(nightTop, dawnTop, Math.Min(1, progress * 2));
            PresentationColor horizon = PresentationColor.Lerp(nightHorizon, dawnHorizon, Math.Min(1, progress * 2));
            if (progress > 0.5)
            {
                top = PresentationColor.Lerp(top, dayTop, (progress - 0.5) * 2);
                horizon = PresentationColor.Lerp(horizon, dayHorizon, (progress - 0.5) * 2);
            }
            return (top, horizon);
        }
        if (hour >= 7 && hour < 17)
        {
            return (dayTop, dayHorizon);
        }
        if (hour >= 17 && hour < 19)
        {
            double progress = (hour - 17) / 2;
            PresentationColor top = PresentationColor.Lerp(dayTop, duskTop, Math.Min(1, progress * 2));
            PresentationColor horizon = PresentationColor.Lerp(dayHorizon, duskHorizon, Math.Min(1, progress * 2));
            if (progress > 0.5)
            {
                top = PresentationColor.Lerp(top, nightTop, (progress - 0.5) * 2);
                horizon = PresentationColor.Lerp(horizon, nightHorizon, (progress - 0.5) * 2);
            }
            return (top, horizon);
        }
        return (nightTop, nightHorizon);
    }

    private static (PresentationColor Top, PresentationColor Horizon) ApplyWeather(
        (PresentationColor Top, PresentationColor Horizon) palette,
        string mode) => mode switch
        {
            "mist" => (
                PresentationColor.Lerp(palette.Top, PresentationColor.FromRgb(0x23324b), 0.38),
                PresentationColor.Lerp(palette.Horizon, PresentationColor.FromRgb(0x53647a), 0.46)),
            "rain" => (
                PresentationColor.Lerp(palette.Top, PresentationColor.FromRgb(0x18263a), 0.48),
                PresentationColor.Lerp(palette.Horizon, PresentationColor.FromRgb(0x354a62), 0.52)),
            "thunderstorm" => (
                PresentationColor.Lerp(palette.Top, PresentationColor.FromRgb(0x101827), 0.62),
                PresentationColor.Lerp(palette.Horizon, PresentationColor.FromRgb(0x26354a), 0.6)),
            _ => palette,
        };

    private static double Lerp(double from, double to, double amount) => from + ((to - from) * amount);

    private static double SmoothStep(double value, double minimum, double maximum)
    {
        double progress = Math.Clamp((value - minimum) / (maximum - minimum), 0, 1);
        return progress * progress * (3 - (2 * progress));
    }
}

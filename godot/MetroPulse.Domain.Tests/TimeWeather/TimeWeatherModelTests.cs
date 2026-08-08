using MetroPulse.Domain.TimeWeather;
using Xunit;

namespace MetroPulse.Domain.Tests.TimeWeather;

public sealed class TimeWeatherModelTests
{
    private static readonly WeatherCycleModel Weather = WeatherCycleModel.LoadProduction();

    [Fact]
    public void CanonicalWeatherDefinitionsProvideOneStableCycle()
    {
        Assert.Equal(["clear", "mist", "rain", "thunderstorm"], Weather.Sequence);
        Assert.Equal("clear", Weather.NormalizeMode("unknown"));
        Assert.Equal("mist", Weather.GetNextMode("clear"));
        Assert.Equal("clear", Weather.GetNextMode("thunderstorm"));
        Assert.Equal(0.48, Weather.GetDefinition("rain").GripMultiplier);
    }

    [Fact]
    public void WeatherClockCarriesOverflowThroughEveryMode()
    {
        var state = new WeatherCycleState("clear", 45, 0);
        foreach (string expectedMode in new[] { "mist", "rain", "thunderstorm", "clear" })
        {
            state = Weather.Step(state.Mode, state.RemainingSeconds, state.RemainingSeconds + 0.25);
            Assert.Equal(expectedMode, state.Mode);
            Assert.Equal(1, state.Transitions);
            Assert.Equal(Weather.GetDefinition(expectedMode).DurationSeconds - 0.25, state.RemainingSeconds, 10);
        }
    }

    [Fact]
    public void WeatherClockHandlesDisabledMalformedAndLargeDeltas()
    {
        Assert.Equal(new WeatherCycleState("clear", 0, 0), Weather.Step("clear", 10, 5, enabled: false));
        Assert.Equal(new WeatherCycleState("clear", 45, 0), Weather.Step("invalid", double.NaN, double.NaN));

        WeatherCycleState state = Weather.Step("clear", 45, 45 + 143 + 30);
        Assert.Equal("rain", state.Mode);
        Assert.Equal(40, state.RemainingSeconds);
        Assert.Equal(6, state.Transitions);
    }

    [Fact]
    public void SimulationTimeUsesDocumentedRateMultipliersAndWraps()
    {
        Assert.Equal(1, SimulationTimeModel.BaseGameMinutesPerRealSecond);
        Assert.Equal(11, SimulationTimeModel.Advance(10, 60, 1));
        Assert.Equal(10.5, SimulationTimeModel.Advance(10, 60, 0.5));
        Assert.Equal(15, SimulationTimeModel.Advance(10, 60, 5));
        Assert.Equal(1, SimulationTimeModel.Advance(10, 60, 15));
        Assert.Equal(0.5, SimulationTimeModel.Advance(23.5, 60, 1));
        Assert.Equal(0, SimulationTimeModel.Advance(double.NaN, double.NaN));
        Assert.Equal(12, SimulationTimeModel.Advance(12, -5));
        Assert.Equal(15, SimulationTimeModel.NormalizeSpeed(15));
        Assert.Equal(SimulationTimeModel.DefaultSpeed, SimulationTimeModel.NormalizeSpeed(999));
    }

    [Fact]
    public void NightFactorWrapsAndTransitionsSmoothly()
    {
        Assert.Equal(2, SimulationTimeModel.NormalizeHour(26));
        Assert.Equal(23, SimulationTimeModel.NormalizeHour(-1));
        Assert.Equal(1, SimulationTimeModel.GetNightFactor(2));
        Assert.Equal(0, SimulationTimeModel.GetNightFactor(12));
        Assert.Equal(0, SimulationTimeModel.GetNightFactor(17));
        Assert.Equal(1, SimulationTimeModel.GetNightFactor(19));
        Assert.InRange(SimulationTimeModel.GetNightFactor(18), double.Epsilon, 1 - double.Epsilon);
        Assert.InRange(SimulationTimeModel.GetNightFactor(6), double.Epsilon, 1 - double.Epsilon);
        Assert.Equal(0, SimulationTimeModel.GetNightFactor(double.NaN));
    }

    [Fact]
    public void SunriseAndSunsetPlaceBodiesBeyondPlayableTerrain()
    {
        var center = new HorizontalCenter(120, 40);
        CelestialPosition sunriseSun = CelestialOrbitModel.GetPosition(6, "sun", center);
        CelestialPosition sunriseMoon = CelestialOrbitModel.GetPosition(6, "moon", center);
        CelestialPosition sunsetSun = CelestialOrbitModel.GetPosition(18, "sun", center);
        CelestialOrbitConfig config = CelestialOrbitModel.DefaultConfig;

        Assert.Equal(center.X + config.Radius, sunriseSun.X);
        Assert.InRange(Math.Abs(sunriseSun.Y), 0, 1e-9);
        Assert.Equal(center.X - config.Radius, sunriseMoon.X);
        Assert.Equal(center.X - config.Radius, sunsetSun.X);
        Assert.True(config.Radius > 900);
        Assert.True(config.CameraFarPlane > config.Radius + config.SunBodyRadius);
    }

    [Fact]
    public void SunAndMoonRemainOppositeAndMalformedValuesAreSanitized()
    {
        CelestialAngles angles = CelestialOrbitModel.GetAngles(12);
        Assert.InRange(Math.Abs((angles.Moon - angles.Sun) - Math.PI), 0, 1e-9);

        CelestialPosition malformed = CelestialOrbitModel.GetPosition(
            double.NaN,
            "sun",
            new HorizontalCenter(double.NaN, double.NaN));
        Assert.True(double.IsFinite(malformed.X));
        Assert.True(double.IsFinite(malformed.Y));
        Assert.True(double.IsFinite(malformed.Z));
    }

    [Fact]
    public void CelestialVisibilityUsesTopEdgeHorizonCrossing()
    {
        Assert.False(CelestialOrbitModel.IsVisible(-111, CelestialOrbitModel.DefaultConfig.SunBodyRadius));
        Assert.True(CelestialOrbitModel.IsVisible(-109, CelestialOrbitModel.DefaultConfig.SunBodyRadius));
        Assert.False(CelestialOrbitModel.IsVisible(double.NaN, CelestialOrbitModel.DefaultConfig.SunBodyRadius));
    }
}

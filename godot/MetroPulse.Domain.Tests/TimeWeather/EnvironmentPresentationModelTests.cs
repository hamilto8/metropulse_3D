using MetroPulse.Domain.TimeWeather;
using Xunit;

namespace MetroPulse.Domain.Tests.TimeWeather;

public sealed class EnvironmentPresentationModelTests
{
    [Fact]
    public void FixedTimeWeatherMatrixIsBoundedRecognizableAndDeterministic()
    {
        EnvironmentPresentationModel model = EnvironmentPresentationModel.LoadProduction();
        foreach (double hour in new double[] { 6, 12, 18, 0 })
        {
            foreach (string weather in new[] { "clear", "mist", "rain", "thunderstorm" })
            {
                EnvironmentPresentationSnapshot first = model.Evaluate(hour, weather, 12);
                EnvironmentPresentationSnapshot second = model.Evaluate(hour, weather, 12);
                Assert.Equal(first, second);
                Assert.Equal(weather, first.WeatherMode);
                Assert.InRange(first.NightFactor, 0, 1);
                Assert.InRange(first.RainOpacity, 0, 1);
                Assert.InRange(first.Wetness, 0, 1);
                Assert.InRange(first.SkyTop.Red, 0, 1);
                Assert.InRange(first.SkyHorizon.Blue, 0, 1);
                Assert.True(first.SunVisible || first.MoonVisible);
            }
        }
    }

    [Fact]
    public void WeatherAndAltitudePreserveRelativeVisibilityAndNightReadability()
    {
        EnvironmentPresentationModel model = EnvironmentPresentationModel.LoadProduction();
        EnvironmentPresentationSnapshot clear = model.Evaluate(0, "clear", 0);
        EnvironmentPresentationSnapshot storm = model.Evaluate(0, "thunderstorm", 0);
        EnvironmentPresentationSnapshot overview = model.Evaluate(0, "thunderstorm", 320);

        Assert.True(storm.FogDensity > clear.FogDensity);
        Assert.True(overview.FogDensity < storm.FogDensity);
        Assert.True(storm.SkyHorizon.Blue > 0.1);
        Assert.True(storm.MoonEnergy > storm.SunEnergy);
        Assert.Equal("clear", model.Evaluate(double.NaN, "unknown").WeatherMode);
        Assert.Equal(12, model.Evaluate(double.NaN, null).Hour);
    }
}

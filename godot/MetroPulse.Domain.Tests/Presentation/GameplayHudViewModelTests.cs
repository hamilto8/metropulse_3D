using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.TimeWeather;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class GameplayHudViewModelTests
{
    [Fact]
    public void VehicleAndHeatTelemetryUseAuthoritativeUnitsAndResponse()
    {
        GameplayHudSnapshot view = GameplayHudViewModel.Build(Source(
            ControlKind.Vehicle,
            speed: 10,
            heat: new HeatEnforcementState(42, 2, 0, 1, "incident", 1, "Vehicle hijack reported", null),
            response: new("player", ["police-1", "police-2"], 18)));

        Assert.True(view.Visible);
        Assert.True(view.Vehicle.Visible);
        Assert.Equal("36", view.Vehicle.Speed);
        Assert.Equal("WANTED 2", view.Heat.Tier);
        Assert.Equal("2 responders · nearest 18 m", view.Heat.Detail);
        Assert.False(view.Flight.Visible);
        Assert.Equal("12:00 · Clear", view.TimeWeather);
    }

    [Fact]
    public void AircraftStripIsLatentAndArrestStateRemainsTextual()
    {
        GameplayHudSource source = Source(ControlKind.Aircraft) with
        {
            Flight = new FlightTelemetryView(50, 240, 0.75, "AIRBORNE"),
            EnforcementOutcome = EnforcementOutcomes.Arrested,
        };
        GameplayHudSnapshot view = GameplayHudViewModel.Build(source);

        Assert.False(view.Vehicle.Visible);
        Assert.True(view.Flight.Visible);
        Assert.Equal("180 km/h", view.Flight.Speed);
        Assert.Equal("240 m", view.Flight.Altitude);
        Assert.Equal("75%", view.Flight.Throttle);
        Assert.True(view.Heat.Arrested);
        Assert.Equal("ARRESTED", view.Heat.Tier);
    }

    [Fact]
    public void NewsAlertsAndMissionHistoryPreserveAuthoritativeOrderingAndText()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        string missionId = content.Missions.Definitions[0].Id!;
        var outcomes = new MissionOutcomeService();
        _ = outcomes.Apply(new MissionOutcomeTransaction(
            "mission:test:result",
            new OutcomeSource(OutcomeSourceKinds.Mission, missionId, "SUCCESS"),
            [new NewsPublishedCommand("news-test", "Bridge reopened", "Freight is moving again.", 3)],
            new OutcomeSummary("Mission complete", "The bridge response succeeded.")));
        var alerts = new AlertService();
        _ = alerts.Publish(new AlertInput
        {
            Id = "alert-test",
            DedupeKey = "alert-test",
            Type = AlertTypes.Infrastructure,
            Severity = AlertSeverities.Warning,
            Title = "Bridge congestion",
            Cause = "A lane remains restricted.",
            Recommendation = "Use the alternate route.",
            Location = AlertLocation.Named("Primary Bridge"),
        });
        GameplayHudSource source = Source(ControlKind.Pedestrian) with
        {
            Alerts = alerts.Snapshot(),
            Outcomes = outcomes.Snapshot(),
            MissionRegistry = content.Missions,
        };

        GameplayHudSnapshot view = GameplayHudViewModel.Build(source);

        Assert.Equal("Bridge reopened", Assert.Single(view.News).Headline);
        Assert.Equal("Bridge congestion", Assert.Single(view.Toasts).Title);
        Assert.Equal("mission:test:result", Assert.Single(view.History).Id);
        Assert.Equal("Success", view.History[0].Outcome);
    }

    private static GameplayHudSource Source(
        ControlKind kind,
        double speed = 0,
        HeatEnforcementState? heat = null,
        MetroPulse.Domain.Traffic.EnforcementResponseSnapshot? response = null)
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var outcomes = new MissionOutcomeService();
        var alerts = new AlertService();
        return new GameplayHudSource(
            GameState.StreetVehicle,
            kind,
            speed,
            "SEDAN",
            null,
            heat ?? HeatEnforcementState.Clear,
            response,
            EnforcementOutcomes.None,
            new EnvironmentPresentationModel(content.WeatherRecords, content.DefaultWeatherMode).Evaluate(12, "clear"),
            null,
            null,
            null,
            alerts.Snapshot(),
            outcomes.Snapshot(),
            content.Missions);
    }
}

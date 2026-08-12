using System.Globalization;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.Traffic;

namespace MetroPulse.Domain.Presentation;

public sealed record FlightTelemetryView(double SpeedMetresPerSecond, double AltitudeMetres, double Throttle, string Mode);

public sealed record VehicleHudView(bool Visible, string VehicleType, string Speed, string SpeedDescription);

public sealed record FlightHudView(bool Visible, string Speed, string Altitude, string Throttle, string Mode);

public sealed record HeatHudView(bool Visible, string Tier, string Heat, string Detail, bool Arrested);

public sealed record MissionHudSummary(bool Visible, string Title, string Objective, string Timer, string Reward);

public sealed record NewsCardView(string Id, string Headline, string Body, double Priority);

public sealed record ToastView(string Id, string Severity, string Title, string Detail);

public sealed record MissionHistoryCardView(string Id, string Outcome, string Title, string Description);

public sealed record GameplayHudSource(
    GameState State,
    ControlKind ControlledKind,
    double VehicleSpeedMetresPerSecond,
    string? VehicleType,
    FlightTelemetryView? Flight,
    HeatEnforcementState Heat,
    EnforcementResponseSnapshot? Response,
    string EnforcementOutcome,
    EnvironmentPresentationSnapshot Environment,
    MissionExecutionState? Mission,
    MissionDefinition? MissionDefinition,
    MissionWorldPoint? MissionTarget,
    AlertSnapshot Alerts,
    MissionOutcomeSnapshot Outcomes,
    MissionRegistry MissionRegistry);

public sealed record GameplayHudSnapshot(
    bool Visible,
    string TimeWeather,
    VehicleHudView Vehicle,
    FlightHudView Flight,
    HeatHudView Heat,
    MissionHudSummary Mission,
    IReadOnlyList<NewsCardView> News,
    IReadOnlyList<ToastView> Toasts,
    IReadOnlyList<MissionHistoryCardView> History);

/// <summary>Pure projection for gameplay HUD, notifications, and history; owns no gameplay facts.</summary>
public static class GameplayHudViewModel
{
    public static GameplayHudSnapshot Build(GameplayHudSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(source.Heat);
        ArgumentNullException.ThrowIfNull(source.Environment);
        ArgumentNullException.ThrowIfNull(source.Alerts);
        ArgumentNullException.ThrowIfNull(source.Outcomes);
        ArgumentNullException.ThrowIfNull(source.MissionRegistry);

        bool visible = source.State is GameState.StreetOnFoot or GameState.StreetVehicle;
        VehicleHudView vehicle = new(
            source.ControlledKind == ControlKind.Vehicle,
            Title(source.VehicleType ?? "vehicle"),
            $"{Math.Round(Math.Max(0, source.VehicleSpeedMetresPerSecond) * 3.6):0}",
            $"{Math.Max(0, source.VehicleSpeedMetresPerSecond):0.0} metres per second");
        FlightTelemetryView? flightSource = source.ControlledKind == ControlKind.Aircraft ? source.Flight : null;
        FlightHudView flight = flightSource is null
            ? new(false, "0 km/h", "0 m", "0%", "Unavailable")
            : new(
                true,
                $"{Math.Round(Math.Max(0, flightSource.SpeedMetresPerSecond) * 3.6):0} km/h",
                $"{Math.Round(Math.Max(0, flightSource.AltitudeMetres)):0} m",
                $"{Math.Round(Math.Clamp(flightSource.Throttle, 0, 1) * 100):0}%",
                Title(flightSource.Mode));
        bool arrested = source.EnforcementOutcome == EnforcementOutcomes.Arrested;
        HeatHudView heat = new(
            source.Heat.Wanted || arrested,
            source.Heat.Wanted ? $"WANTED {source.Heat.WantedTier}" : arrested ? "ARRESTED" : "CLEAR",
            $"Heat {Math.Round(source.Heat.Heat):0}",
            source.Response is null
                ? source.Heat.LastReason ?? (arrested ? "Safe recovery initiated" : "No active enforcement response")
                : $"{source.Response.ResponderIds.Count} responders · nearest {source.Response.NearestDistance:0} m",
            arrested);
        MissionHudSummary mission = BuildMission(source.Mission, source.MissionDefinition, source.MissionTarget);
        NewsCardView[] news = source.Outcomes.State.News
            .OrderByDescending(pair => pair.Value.Priority)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .Take(3)
            .Select(pair => new NewsCardView(pair.Key, pair.Value.Headline, pair.Value.Body, pair.Value.Priority))
            .ToArray();
        ToastView[] toasts = source.Alerts.Active
            .OrderByDescending(alert => SeverityRank(alert.Severity))
            .ThenByDescending(alert => alert.LastObservedAt, StringComparer.Ordinal)
            .Take(3)
            .Select(alert => new ToastView(alert.Id, alert.Severity, alert.Title, $"{alert.Cause} {alert.Recommendation}"))
            .ToArray();
        MissionHistoryCardView[] history = MissionResultViewModel.BuildHistory(
                source.Outcomes.Transactions,
                source.MissionRegistry)
            .Select(result => new MissionHistoryCardView(result.TransactionId, result.OutcomeLabel, result.MissionTitle, result.Description))
            .ToArray();
        return new GameplayHudSnapshot(
            visible,
            $"{FormatHour(source.Environment.Hour)} · {Title(source.Environment.WeatherMode)}",
            vehicle,
            flight,
            heat,
            mission,
            Array.AsReadOnly(news),
            Array.AsReadOnly(toasts),
            Array.AsReadOnly(history));
    }

    private static MissionHudSummary BuildMission(
        MissionExecutionState? execution,
        MissionDefinition? mission,
        MissionWorldPoint? target)
    {
        if (execution is null || mission is null) return new(false, string.Empty, string.Empty, string.Empty, string.Empty);
        string objective = execution.Objective == MissionObjectiveTypes.Survival
            ? "Survive until the timer expires"
            : target is null ? "Objective resolving" : $"Next: {target.Label ?? "mission target"}";
        return new(
            true,
            mission.Title ?? mission.Id ?? "Mission",
            objective,
            $"{Math.Ceiling(execution.TimeRemaining):0}s",
            $"{execution.Payout.ToString("N0", CultureInfo.InvariantCulture)} Capital");
    }

    private static int SeverityRank(string severity) => severity switch
    {
        AlertSeverities.Critical => 4,
        AlertSeverities.Warning => 3,
        AlertSeverities.Success => 2,
        _ => 1,
    };

    private static string FormatHour(double hour)
    {
        int minutes = (int)Math.Round(SimulationTimeModel.NormalizeHour(hour) * 60) % (24 * 60);
        return $"{minutes / 60:00}:{minutes % 60:00}";
    }

    private static string Title(string value) => string.Join(' ', value
        .Split(['_', '-'], StringSplitOptions.RemoveEmptyEntries)
        .Select(word => string.Concat(char.ToUpperInvariant(word[0]), word[1..].ToLowerInvariant())));
}

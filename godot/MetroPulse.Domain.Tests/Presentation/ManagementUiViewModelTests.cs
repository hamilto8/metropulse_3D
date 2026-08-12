using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Services;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class ManagementUiViewModelTests
{
    [Fact]
    public void AggregateProjectionCoversTopBarToolsCatalogAndValidForecast()
    {
        TestAuthorities authorities = CreateAuthorities();
        BuildingDefinition selected = authorities.Catalog[0];
        PlacementPreview preview = PlacementIntelligence.CreatePreview(
            PlacementSpec.FromBuilding(selected),
            PlacementEconomySnapshot.FromEconomy(authorities.Ledger.Snapshot()),
            authorities.Ledger.Treasury);
        ManagementUiSnapshot view = ManagementUiViewModel.Build(Source(
            authorities,
            selected,
            new PlacementDecision(true, [], null, preview, new PlacementVector3(10, 0, 20))));

        Assert.Equal(["capital", "population", "jobs", "energy", "satisfaction", "time", "weather"], view.TopBar.Metrics.Select(item => item.Id));
        Assert.Equal(CityToolSectionIds.All, view.Tools.Select(section => section.Id));
        Assert.Equal(authorities.Catalog.Count, view.Catalog.Count);
        Assert.Equal("$650,000", view.TopBar.Metrics.Single(item => item.Id == "capital").Value);
        Assert.Equal("12:00", view.TopBar.Metrics.Single(item => item.Id == "time").Value);
        Assert.Equal("Keyboard", view.TopBar.Device);
        Assert.True(view.Forecast.Valid);
        Assert.Contains(view.Forecast.Facts, fact => fact.StartsWith("Capacity:", StringComparison.Ordinal));
    }

    [Fact]
    public void PriorityAlertUsesSeverityAndPlacementPreservesExactBlockerRemedy()
    {
        TestAuthorities authorities = CreateAuthorities();
        _ = authorities.Alerts.Publish(Alert("warning", AlertSeverities.Warning, "Budget warning"));
        _ = authorities.Alerts.Publish(Alert("critical", AlertSeverities.Critical, "Bridge closed"));
        BuildingDefinition selected = authorities.Catalog[0];
        var blocker = new PlacementBlocker(
            PlacementBlockerCodes.ProtectedLandmark,
            40,
            "Central Park is protected.",
            "Move outside the protected landmark envelope.",
            new Dictionary<string, object?>());

        ManagementUiSnapshot view = ManagementUiViewModel.Build(Source(
            authorities,
            selected,
            new PlacementDecision(false, [blocker], blocker, null, new PlacementVector3(-75, 0, -75))));

        Assert.Equal("Bridge closed", view.TopBar.PriorityAlert.Title);
        Assert.Equal(AlertSeverities.Critical, view.TopBar.PriorityAlert.Severity);
        Assert.False(view.Forecast.Valid);
        Assert.Equal(blocker.Message, view.Forecast.Status);
        Assert.Equal(blocker.Remedy, view.Forecast.Remedy);
        Assert.Equal("X -75, Z -75", view.Forecast.Position);
    }

    private static ManagementUiSource Source(
        TestAuthorities authorities,
        BuildingDefinition selected,
        PlacementDecision placement) => new(
        CityEconomyViewModel.FromSnapshot(authorities.Ledger.Snapshot()),
        authorities.Ledger.GetFiscalOverview(),
        authorities.Services.Snapshot(),
        authorities.Traffic.Snapshot(),
        authorities.Alerts.Snapshot(),
        new EnvironmentPresentationModel(
            authorities.Content.WeatherRecords,
            authorities.Content.DefaultWeatherMode).Evaluate(12, "clear"),
        GameState.Builder,
        "KEYBOARD",
        5,
        authorities.Catalog,
        selected,
        placement,
        true,
        "PLACE",
        2,
        1,
        false);

    private static AlertInput Alert(string id, string severity, string title) => new()
    {
        Id = id,
        DedupeKey = id,
        Type = AlertTypes.Infrastructure,
        Severity = severity,
        Title = title,
        Cause = "Integration fixture",
        Recommendation = "Review City Tools.",
        Location = AlertLocation.Named("Primary Bridge"),
    };

    private static TestAuthorities CreateAuthorities()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var ledger = new EconomyLedger(
            content.EconomyBalance,
            content.EconomyBalance.StartingTreasury,
            content.EconomyBalance.BaseRevenuePerSecond,
            1_200,
            70,
            100);
        var outcomes = new MissionOutcomeService(ledger, content);
        var services = new CityServiceModel(ledger, outcomes);
        var traffic = new TrafficProductivityModel(ledger, content.EconomyBalance.Policies!);
        var alerts = new AlertService();
        IReadOnlyList<BuildingDefinition> catalog = ConstructionVocabulary.FilterCatalog(
            content.BuildingRecords,
            includeAdvanced: false,
            unlockedTiers: [ProgressionTiers.Operator]);
        return new TestAuthorities(content, ledger, outcomes, services, traffic, alerts, catalog);
    }

    private sealed record TestAuthorities(
        GameContentRegistry Content,
        EconomyLedger Ledger,
        MissionOutcomeService Outcomes,
        CityServiceModel Services,
        TrafficProductivityModel Traffic,
        AlertService Alerts,
        IReadOnlyList<BuildingDefinition> Catalog);
}

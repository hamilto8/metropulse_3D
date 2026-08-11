using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Services;
using Xunit;

namespace MetroPulse.Domain.Tests.Services;

public sealed class IncidentResponseServiceTests
{
    private static readonly IncidentDefinition Definition = new()
    {
        Id = "bridge-relay-test",
        Type = "ENERGY_RELAY_DAMAGE",
        Title = "Bridge relay damaged",
        Cause = "A transformer strike scattered debris across the service bay.",
        TargetId = "bridge-relay",
        InfrastructureId = "bridge-relay",
        DistrictId = "PRIMARY_BRIDGE_CORRIDOR",
        Service = ServiceTypes.Power,
        Severity = 5,
        CleanupCost = 1_500,
        RepairCost = 4_500,
        CoverageMultiplier = 0.4,
        Position = new OutcomePosition(205, 18),
        InfluenceRadius = 90,
    };

    [Fact]
    public void ReportAtomicallyCreatesDamageOutageWorkAndManagementAlert()
    {
        (_, MissionOutcomeService outcomes, AlertService alerts, IncidentResponseService response) = CreateHarness();

        IncidentReportResult result = response.ReportIncident(Definition);
        MissionOutcomeSnapshot snapshot = outcomes.Snapshot();

        Assert.True(result.Incident.Active);
        Assert.Equal("DAMAGED", snapshot.State.Infrastructure["bridge-relay"].State);
        Assert.Equal(205, snapshot.State.ServiceOutages["outage:bridge-relay-test"].Position!.X);
        Assert.Equal(90, snapshot.State.ServiceOutages["outage:bridge-relay-test"].InfluenceRadius);
        Assert.Equal(WorkOrderTypes.Cleanup, snapshot.State.Repairs["work:bridge-relay-test:cleanup"].WorkType);
        Assert.Equal(
            "work:bridge-relay-test:cleanup",
            snapshot.State.Repairs["work:bridge-relay-test:repair"].PrerequisiteTargetId);
        Assert.Equal(6_000, Assert.Single(response.GetIncidentSummaries()).ResponseCost);
        Assert.Equal(AlertFocusActions.ManagementCamera, Assert.Single(alerts.Snapshot().Active).FocusAction.Type);

        IncidentReportResult duplicate = response.ReportIncident(Definition);
        Assert.True(duplicate.Duplicate);
        Assert.Single(outcomes.Snapshot().Transactions);
    }

    [Fact]
    public void FundingAndStreetWorkEnforceCleanupBeforeRepairAndResolveEverything()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes, AlertService alerts, IncidentResponseService response) = CreateHarness();
        response.ReportIncident(Definition);

        IncidentFundingResult funded = response.ScheduleResponse(Definition.Id);
        Assert.Equal(4_000, economy.Treasury);
        Assert.All(funded.WorkOrders, order => Assert.Equal(RepairStatuses.Scheduled, order.Status));
        Assert.Equal(AlertFocusActions.StreetWaypoint, Assert.Single(alerts.Snapshot().Active).FocusAction.Type);
        Assert.True(response.ScheduleResponse(Definition.Id).Duplicate);
        Assert.Equal(4_000, economy.Treasury);
        Assert.Contains("completed first", Assert.Throws<InvalidOperationException>(() =>
            response.PerformStreetWork("work:bridge-relay-test:repair")).Message, StringComparison.Ordinal);

        response.PerformStreetWork("work:bridge-relay-test:cleanup");
        Assert.Equal(0.5, response.GetWorkOrder("work:bridge-relay-test:cleanup")!.Progress);
        response.PerformStreetWork("work:bridge-relay-test:cleanup");
        Assert.Equal(RepairStatuses.Complete, response.GetWorkOrder("work:bridge-relay-test:cleanup")!.Status);
        response.PerformStreetWork("work:bridge-relay-test:repair");
        StreetWorkResult completed = response.PerformStreetWork("work:bridge-relay-test:repair");

        Assert.False(completed.Incident!.Active);
        Assert.False(outcomes.Snapshot().State.ServiceOutages["outage:bridge-relay-test"].Active);
        Assert.Equal("ACTIVE", outcomes.Snapshot().State.Infrastructure["bridge-relay"].State);
        Assert.Equal(1, outcomes.Snapshot().State.Infrastructure["bridge-relay"].Condition);
        Assert.Contains(alerts.Snapshot().Active, alert => alert.Severity == AlertSeverities.Success);
        Assert.Equal(
            AlertStates.Resolved,
            alerts.Snapshot().Items.Single(alert => alert.DedupeKey == "service-incident:bridge-relay-test").State);
    }

    [Fact]
    public void UnaffordableResponseLeavesCapitalAndOrdersUntouched()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes, _, IncidentResponseService response) = CreateHarness(5_999);
        response.ReportIncident(Definition);

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => response.ScheduleResponse(Definition.Id));
        Assert.Contains("requires $6,000 Capital", error.Message, StringComparison.Ordinal);
        Assert.Equal(5_999, economy.Treasury);
        Assert.All(response.GetWorkOrders(), order => Assert.Equal(RepairStatuses.NotStarted, order.Status));
        Assert.Single(outcomes.Snapshot().Transactions);
    }

    [Fact]
    public void OutcomeAndAlertPersistenceResumePartiallyCompletedFieldWork()
    {
        (EconomyLedger sourceEconomy, MissionOutcomeService sourceOutcomes, AlertService sourceAlerts, IncidentResponseService source) =
            CreateHarness();
        source.ReportIncident(Definition);
        source.ScheduleResponse(Definition.Id);
        source.PerformStreetWork("work:bridge-relay-test:cleanup");
        MissionOutcomeStateDocument outcomeState = sourceOutcomes.Serialize();
        AlertStateDocument alertState = sourceAlerts.Serialize();
        MissionOutcomeService.ValidateState(outcomeState, sourceEconomy, GameContentRegistry.LoadProduction());

        (EconomyLedger restoredEconomy, MissionOutcomeService restoredOutcomes, AlertService restoredAlerts, _) =
            CreateHarness(sourceEconomy.Treasury);
        var restoreEvents = new List<MissionOutcomeEvent>();
        restoredOutcomes.Subscribe(restoreEvents.Add);
        restoredOutcomes.Restore(outcomeState);
        restoredAlerts.Restore(alertState);
        var restored = new IncidentResponseService(restoredOutcomes, restoredEconomy, restoredAlerts);

        Assert.Equal("RESTORED", Assert.Single(restoreEvents).Type);
        Assert.Equal(0.5, restored.GetWorkOrder("work:bridge-relay-test:cleanup")!.Progress);
        restored.PerformStreetWork("work:bridge-relay-test:cleanup");
        Assert.Equal(RepairStatuses.Complete, restored.GetWorkOrder("work:bridge-relay-test:cleanup")!.Status);
        Assert.Equal(4_000, restoredEconomy.Treasury);
        Assert.Equal(AlertFocusActions.StreetWaypoint, Assert.Single(restoredAlerts.Snapshot().Active).FocusAction.Type);
    }

    private static (EconomyLedger Economy, MissionOutcomeService Outcomes, AlertService Alerts, IncidentResponseService Response)
        CreateHarness(double treasury = 10_000)
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(content.EconomyBalance, treasury, 0);
        var outcomes = new MissionOutcomeService(economy, content);
        var alerts = new AlertService(now: () => new DateTimeOffset(2026, 7, 18, 12, 0, 0, TimeSpan.Zero));
        return (economy, outcomes, alerts, new IncidentResponseService(outcomes, economy, alerts));
    }
}

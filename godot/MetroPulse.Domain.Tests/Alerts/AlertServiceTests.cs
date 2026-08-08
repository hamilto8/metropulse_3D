using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using Xunit;

namespace MetroPulse.Domain.Tests.Alerts;

public sealed class AlertServiceTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void LifecycleMatchesFrozenPhaseZeroEvidenceExactly()
    {
        string[] times =
        [
            "2026-08-07T12:00:00.000Z",
            "2026-08-07T12:00:01.000Z",
            "2026-08-07T12:00:02.000Z",
        ];
        int nowIndex = 0;
        var service = new AlertService(
            now: () => DateTimeOffset.Parse(times[Math.Min(nowIndex++, times.Length - 1)]),
            idFactory: () => $"baseline-alert-{nowIndex}");
        AlertInput input = BaselineInput();
        AlertRecord first = service.Publish(input);
        AlertRecord duplicate = service.Publish(input with
        {
            Cause = "Two reports confirm the same obstruction.",
        });
        AlertSnapshot active = service.Snapshot();
        AlertRecord resolved = service.Resolve(first.Id, "The disabled vehicle was cleared.")!;
        AlertStateDocument serialized = service.Serialize();

        JsonElement expected = ReadFixtureAlerts();
        AssertJsonEqual(expected.GetProperty("first"), first);
        AssertJsonEqual(expected.GetProperty("duplicate"), duplicate);
        AssertJsonEqual(expected.GetProperty("active"), active);
        AssertJsonEqual(expected.GetProperty("resolved"), resolved);
        AssertJsonEqual(expected.GetProperty("serialized"), serialized);
    }

    [Fact]
    public void DuplicatesSupersessionAndHistoryRemainBounded()
    {
        int ids = 0;
        DateTimeOffset time = DateTimeOffset.Parse("2026-07-18T12:00:00.000Z");
        var service = new AlertService(() => time, () => $"alert-{++ids}", maxRecords: 10);
        AlertRecord first = service.Publish(StructuredAlert());
        AlertRecord duplicate = service.Publish(StructuredAlert() with { Severity = AlertSeverities.Critical });
        Assert.Equal(first.Id, duplicate.Id);
        Assert.Equal(first.StartTime, duplicate.StartTime);
        Assert.Equal(2, duplicate.Occurrences);
        Assert.Single(service.Snapshot().Active);

        AlertRecord replacement = service.Publish(StructuredAlert() with
        {
            DedupeKey = "traffic:bridge-repair",
            Title = "Bridge repair crew dispatched",
            Supersedes = new[] { first.Id },
        });
        Assert.Equal(AlertStates.Superseded, service.Find(first.Id)!.State);
        Assert.Equal(replacement.Id, service.Find(first.Id)!.SupersededBy);
        Assert.Equal(AlertStates.Resolved, service.Resolve(replacement.Id, "Repair completed")!.State);

        for (int index = 0; index < 20; index += 1)
        {
            time = time.AddSeconds(1);
            AlertRecord record = service.Publish(StructuredAlert() with
            {
                DedupeKey = $"history:{index}",
                Title = $"History {index}",
                FocusAction = new AlertFocusAction(),
            });
            service.Resolve(record.Id);
        }
        Assert.True(service.Serialize().Items.Count <= 10);
    }

    [Fact]
    public void TimedExpiryAndStructuredStateRoundTripDeterministically()
    {
        DateTimeOffset time = DateTimeOffset.Parse("2026-07-18T12:00:00.000Z");
        var service = new AlertService(() => time, () => "alert-timed");
        service.Publish(StructuredAlert() with
        {
            Duration = new AlertDuration { Kind = AlertDurationKinds.Timed, Seconds = 30 },
            FocusAction = new AlertFocusAction { Type = AlertFocusActions.StreetWaypoint },
        });
        time = DateTimeOffset.Parse("2026-07-18T12:00:29.999Z");
        Assert.Empty(service.Expire());
        time = DateTimeOffset.Parse("2026-07-18T12:00:30.000Z");
        Assert.Single(service.Expire());

        AlertStateDocument state = service.Serialize();
        AlertService.ValidateState(state);
        string json = JsonSerializer.Serialize(state, JsonOptions);
        AlertStateDocument decoded = JsonSerializer.Deserialize<AlertStateDocument>(json, JsonOptions)!;
        var restored = new AlertService(() => time);
        restored.Restore(decoded);
        AssertJsonEqual(JsonSerializer.SerializeToElement(state, JsonOptions), restored.Serialize());
    }

    [Fact]
    public void LegacyMigrationAndMalformedRecordsFailBeforeMutation()
    {
        var service = new AlertService(
            () => DateTimeOffset.Parse("2026-07-18T12:00:00.000Z"),
            () => "legacy-alert");
        service.RestoreLegacy([
            new LegacyAlertItem("08:00", "Police dispatched to city sector", "danger"),
        ]);
        AlertRecord migrated = Assert.Single(service.Snapshot().Active);
        Assert.Equal(AlertTypes.Crime, migrated.Type);
        Assert.Equal(AlertSeverities.Critical, migrated.Severity);
        Assert.Equal("Citywide", migrated.Location.Label);
        Assert.NotEmpty(migrated.Recommendation);

        Assert.Throws<ArgumentException>(() => service.Publish(StructuredAlert() with
        {
            Location = AlertLocation.Named("Unknown area"),
            FocusAction = new AlertFocusAction { Type = AlertFocusActions.ManagementCamera },
        }));
        AlertStateDocument state = service.Serialize();
        long revision = service.Snapshot().Revision;
        Assert.Throws<ArgumentOutOfRangeException>(() => service.Restore(state with
        {
            Items = new[] { state.Items[0] with { Version = 99 } },
        }));
        Assert.Equal(revision, service.Snapshot().Revision);
        Assert.Single(service.Snapshot().Items);
    }

    [Fact]
    public void OrderingAndListenerFailuresCannotBreakAlertAuthority()
    {
        int ids = 0;
        DateTimeOffset time = DateTimeOffset.Parse("2026-07-18T12:00:00.000Z");
        var service = new AlertService(() => time, () => $"alert-{++ids}");
        int observed = 0;
        service.Subscribe(_ => throw new InvalidOperationException("presentation failed"));
        Func<bool> unsubscribe = service.Subscribe(_ => observed += 1, emitCurrent: true);
        service.Publish(StructuredAlert() with
        {
            DedupeKey = "info",
            Severity = AlertSeverities.Info,
            FocusAction = new AlertFocusAction(),
        });
        time = time.AddSeconds(1);
        service.Publish(StructuredAlert() with
        {
            DedupeKey = "critical",
            Severity = AlertSeverities.Critical,
            FocusAction = new AlertFocusAction(),
        });
        Assert.Equal("critical", service.Snapshot().Items[0].DedupeKey);
        Assert.Equal(3, observed);
        Assert.True(unsubscribe());
        Assert.False(unsubscribe());
    }

    [Fact]
    public void EconomyAdapterPublishesUpdatesAndResolvesOneFiscalAlert()
    {
        EconomyBalanceDefinition balance = GameContentRegistry.LoadProduction().EconomyBalance;
        var economy = new EconomyLedger(balance, 10, 0);
        var alerts = new AlertService(
            () => DateTimeOffset.Parse("2026-07-18T12:00:00.000Z"),
            () => "economy-alert");
        using var adapter = new EconomyAlertAdapter(economy, alerts);

        economy.RegisterBuilding(new EconomyBuilding("cost-center", operatingCostRate: 1));
        AlertRecord warning = Assert.Single(alerts.Snapshot().Active);
        Assert.Equal(AlertTypes.Economy, warning.Type);
        Assert.Equal(AlertSeverities.Warning, warning.Severity);
        Assert.Contains("runway", warning.Cause, StringComparison.OrdinalIgnoreCase);

        economy.Update(10);
        AlertRecord critical = Assert.Single(alerts.Snapshot().Active);
        Assert.Equal(warning.Id, critical.Id);
        Assert.Equal(AlertSeverities.Critical, critical.Severity);
        Assert.Contains("stabilization grant", critical.Recommendation, StringComparison.OrdinalIgnoreCase);
        economy.RequestEmergencyAssistance();
        Assert.Single(alerts.Snapshot().Active);
        economy.RemoveBuilding("cost-center");
        Assert.Empty(alerts.Snapshot().Active);
    }

    private static AlertInput BaselineInput() => new()
    {
        DedupeKey = "baseline:bridge",
        Type = AlertTypes.Infrastructure,
        Severity = AlertSeverities.Warning,
        Title = "Bridge lane obstructed",
        Cause = "A disabled vehicle blocks one lane.",
        Location = new AlertLocation
        {
            Label = "Primary bridge",
            DistrictId = "PRIMARY_BRIDGE_CORRIDOR",
            Position = new AlertPosition(160, 0, 0),
        },
        Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
        Recommendation = "Clear the vehicle or enable bridge priority.",
        RelatedEntityIds = new[] { "baseline-disabled-vehicle" },
        FocusAction = new AlertFocusAction { Type = AlertFocusActions.ManagementCamera },
    };

    private static AlertInput StructuredAlert() => new()
    {
        DedupeKey = "traffic:bridge-gridlock",
        Type = AlertTypes.Traffic,
        Severity = AlertSeverities.Warning,
        Title = "Bridge traffic is stalled",
        Cause = "A disabled vehicle is blocking the eastbound lane.",
        Location = new AlertLocation
        {
            Label = "West Core bridge",
            DistrictId = "WEST_CORE",
            Position = new AlertPosition(160, 3, 0),
        },
        Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
        Recommendation = "Focus the bridge and dispatch a repair crew.",
        RelatedEntityIds = new[] { "bridge-primary", "vehicle-17" },
        FocusAction = new AlertFocusAction { Type = AlertFocusActions.ManagementCamera },
    };

    private static JsonElement ReadFixtureAlerts()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("settings-bindings-alerts.json"));
        return fixture.RootElement.GetProperty("data").GetProperty("alerts").Clone();
    }

    private static void AssertJsonEqual(JsonElement expected, object actual)
    {
        JsonNode? expectedNode = JsonNode.Parse(expected.GetRawText());
        JsonNode? actualNode = JsonSerializer.SerializeToNode(actual, JsonOptions);
        Assert.True(JsonNode.DeepEquals(expectedNode, actualNode), $"Expected {expectedNode}; actual {actualNode}");
    }
}

using System.Globalization;
using MetroPulse.Domain.Traffic;

namespace MetroPulse.Domain.Alerts;

/// <summary>Publishes structured alerts from authoritative aggregate mobility changes.</summary>
public sealed class TrafficAlertAdapter : IDisposable
{
    private readonly AlertService alerts;
    private readonly Func<bool> unsubscribe;

    public TrafficAlertAdapter(TrafficProductivityModel model, AlertService alerts)
    {
        ArgumentNullException.ThrowIfNull(model);
        this.alerts = alerts ?? throw new ArgumentNullException(nameof(alerts));
        unsubscribe = model.Subscribe(trafficEvent => Sync(trafficEvent.Current), emitCurrent: true);
    }

    public bool Sync(TrafficProductivitySnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        SyncCongestion(snapshot);
        SyncBridge(snapshot);
        SyncDeliveries(snapshot);
        return true;
    }

    public void Dispose() => unsubscribe();

    private void SyncCongestion(TrafficProductivitySnapshot snapshot)
    {
        const string key = "traffic:network-congestion";
        if (snapshot.Network.Congestion < 0.5)
        {
            alerts.Resolve(key, "Aggregate congestion returned below the disruption threshold");
            return;
        }

        TrafficHotspot? hotspot = snapshot.Network.Hotspots.FirstOrDefault();
        AlertLocation location = hotspot is null
            ? AlertLocation.Named("City road network")
            : new AlertLocation
            {
                Label = hotspot.Label,
                Position = new AlertPosition(hotspot.X, hotspot.Z),
            };
        alerts.Publish(new AlertInput
        {
            DedupeKey = key,
            Type = AlertTypes.Traffic,
            Severity = snapshot.Network.Congestion >= 0.75 ? AlertSeverities.Critical : AlertSeverities.Warning,
            Title = "Road congestion is reducing city productivity",
            Cause = $"{JavascriptRound(snapshot.Network.Congestion * 100)}% aggregate congestion leaves productivity at {snapshot.Productivity.Percent}% and {snapshot.Jobs.JobsDelayedByCommute.ToString("N0", CultureInfo.InvariantCulture)} jobs commute-limited.",
            Location = location,
            Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
            Recommendation = "Clear incidents, connect road segments, or review bridge priority and its disclosed tradeoff.",
            RelatedEntityIds = hotspot is null ? Array.Empty<string>() : new[] { hotspot.Id },
            FocusAction = hotspot is null
                ? new AlertFocusAction()
                : new AlertFocusAction
                {
                    Type = AlertFocusActions.ManagementCamera,
                    Position = new AlertPosition(hotspot.X, hotspot.Z),
                },
        });
    }

    private void SyncBridge(TrafficProductivitySnapshot snapshot)
    {
        const string key = "traffic:bridge-disruption";
        if (!snapshot.Bridge.OutageActive && snapshot.Bridge.Access == TrafficAccess.Open)
        {
            alerts.Resolve(key, "Primary bridge access and service returned to normal");
            return;
        }

        alerts.Publish(new AlertInput
        {
            DedupeKey = key,
            Type = AlertTypes.Traffic,
            Severity = snapshot.Bridge.Access == TrafficAccess.Closed ? AlertSeverities.Critical : AlertSeverities.Warning,
            Title = snapshot.Bridge.Access == TrafficAccess.Closed ? "Primary bridge closed" : "Primary bridge flow restricted",
            Cause = $"{snapshot.Bridge.StreetStatus}; on-time deliveries are {snapshot.Deliveries.OnTimePercent}%.",
            Location = BridgeLocation(),
            Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
            Recommendation = snapshot.Bridge.OutageActive
                ? "Fund and complete the linked street repair work before relying on bridge priority."
                : "Inspect the bridge restriction and restore access.",
            RelatedEntityIds = new[] { TrafficProductivityModel.PrimaryBridgeId }.Concat(snapshot.Bridge.OutageIds).ToArray(),
            FocusAction = BridgeFocus(),
        });
    }

    private void SyncDeliveries(TrafficProductivitySnapshot snapshot)
    {
        const string key = "traffic:delivery-reliability";
        if (snapshot.Deliveries.Reliability >= 0.72)
        {
            alerts.Resolve(key, "Delivery reliability recovered above the backlog threshold");
            return;
        }

        alerts.Publish(new AlertInput
        {
            DedupeKey = key,
            Type = AlertTypes.Economy,
            Severity = AlertSeverities.Warning,
            Title = "Delivery backlog is creating contract demand",
            Cause = $"{snapshot.Deliveries.DelayedPercent}% of aggregate deliveries are delayed by road and bridge conditions.",
            Location = AlertLocation.Named("Citywide logistics network"),
            Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
            Recommendation = "Freight contracts now pay a disruption premium; freight priority improves reliability but costs $120/min and 2 satisfaction.",
            RelatedEntityIds = Array.Empty<string>(),
            FocusAction = BridgeFocus(),
        });
    }

    private static AlertLocation BridgeLocation() => new()
    {
        Label = "Primary bridge corridor",
        DistrictId = TrafficProductivityModel.PrimaryBridgeDistrict,
        Position = new AlertPosition(155, 0),
    };

    private static AlertFocusAction BridgeFocus() => new()
    {
        Type = AlertFocusActions.ManagementCamera,
        Position = new AlertPosition(155, 0),
    };

    private static int JavascriptRound(double value) => checked((int)Math.Floor(value + 0.5));
}

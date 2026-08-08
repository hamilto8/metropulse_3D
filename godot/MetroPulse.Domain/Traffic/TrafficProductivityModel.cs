using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Traffic;

/// <summary>
/// Authoritative aggregate road-mobility model. Visible vehicles consume its immutable
/// presentation targets and never feed their sampled state back into city productivity.
/// </summary>
public sealed class TrafficProductivityModel
{
    public const int StateVersion = 1;
    public const string PrimaryBridgeId = "primary-bridge";
    public const string PrimaryBridgeDistrict = "PRIMARY_BRIDGE_CORRIDOR";
    public const double BridgeMinimumX = 100;
    public const double BridgeMaximumX = 210;

    private static readonly HashSet<string> FreightObjectives = ["COURIER", "DELIVERY"];
    private readonly EconomyLedger economy;
    private readonly MissionOutcomeService? outcomes;
    private readonly Func<RoadNetworkSnapshot?>? roadProvider;
    private readonly List<Action<TrafficProductivityEvent>> listeners = [];
    private readonly IReadOnlyDictionary<string, TrafficPolicyProfile> policyProfiles;
    private readonly int presentationVehicleCap;
    private string policy = BridgePolicies.Balanced;
    private long revision;
    private TrafficProductivitySnapshot snapshot = null!;

    public TrafficProductivityModel(
        EconomyLedger economy,
        PolicyBalanceDefinition policyBalance,
        MissionOutcomeService? outcomes = null,
        Func<RoadNetworkSnapshot?>? roadProvider = null,
        int presentationVehicleCap = 48)
    {
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));
        ArgumentNullException.ThrowIfNull(policyBalance);
        if (!double.IsFinite(policyBalance.FreightPriorityCostPerSecond)
            || policyBalance.FreightPriorityCostPerSecond < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(policyBalance));
        }
        this.outcomes = outcomes;
        this.roadProvider = roadProvider;
        this.presentationVehicleCap = Math.Max(0, presentationVehicleCap);
        policyProfiles = new ReadOnlyDictionary<string, TrafficPolicyProfile>(
            new Dictionary<string, TrafficPolicyProfile>(StringComparer.Ordinal)
            {
                [BridgePolicies.Balanced] = new(
                    BridgePolicies.Balanced,
                    "Balanced access",
                    1,
                    0,
                    0,
                    0,
                    "Equal bridge access; no operating cost or freight advantage."),
                [BridgePolicies.FreightPriority] = new(
                    BridgePolicies.FreightPriority,
                    "Freight priority",
                    1.28,
                    0.1,
                    2,
                    policyBalance.FreightPriorityCostPerSecond,
                    "Faster, more reliable deliveries for $120/min and −2 satisfaction while active."),
            });
        Update(force: true);
    }

    public string BridgePolicy => policy;

    public TrafficProductivitySnapshot Snapshot() => snapshot;

    public IReadOnlyList<TrafficPolicyProfile> GetPolicyOptions() => Array.AsReadOnly(
        policyProfiles.Values.Select(profile => profile with { Active = profile.Id == policy }).ToArray());

    public TrafficProductivitySnapshot SetBridgePolicy(string value)
    {
        string normalized = StablePolicy(value);
        if (normalized == policy) return snapshot;
        policy = normalized;
        return Update(force: true, reason: "BRIDGE_POLICY_CHANGED");
    }

    public bool ToggleBridgePriority(bool? forceEnabled = null)
    {
        bool enabled = forceEnabled ?? policy != BridgePolicies.FreightPriority;
        SetBridgePolicy(enabled ? BridgePolicies.FreightPriority : BridgePolicies.Balanced);
        return enabled;
    }

    public TrafficProductivitySnapshot Update(bool force = false, string reason = "INPUTS_CHANGED")
    {
        TrafficProductivitySnapshot? previous = revision == 0 ? null : snapshot;
        TrafficProductivitySnapshot next = Calculate();
        if (!force && previous is not null && MateriallyEquals(previous, next)) return previous;

        revision += 1;
        snapshot = next with { Revision = revision };
        economy.SetMobilityFeedback(new EconomyMobilityFeedback
        {
            Revision = revision,
            ProductivityMultiplier = snapshot.Productivity.Multiplier,
            JobAccessMultiplier = snapshot.Jobs.AccessMultiplier,
            SatisfactionModifier = snapshot.Satisfaction.Modifier,
            DeliveryReliability = snapshot.Deliveries.Reliability,
            Congestion = snapshot.Network.Congestion,
            BridgeCongestion = snapshot.Bridge.Congestion,
            ManagementCostRate = snapshot.Policy.OperatingCostRate,
            Explanation = snapshot.Explanation,
        });
        Notify(new TrafficProductivityEvent(reason, previous, snapshot));
        return snapshot;
    }

    public Func<bool> Subscribe(Action<TrafficProductivityEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent) listener(new TrafficProductivityEvent("SNAPSHOT", null, snapshot));
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public TrafficMissionImpact GetMissionImpact(TrafficMissionRequest mission)
    {
        ArgumentNullException.ThrowIfNull(mission);
        string objective = (mission.MissionType ?? mission.ObjectiveType ?? "DELIVERY").ToUpperInvariant();
        bool freight = FreightObjectives.Contains(objective);
        bool crossesBridge = MissionCrossesPrimaryBridge(mission);
        bool blocked = crossesBridge && snapshot.Bridge.Access == TrafficAccess.Closed;
        double disruption = crossesBridge
            ? Math.Max(snapshot.Network.Congestion, snapshot.Bridge.Congestion)
            : snapshot.Network.Congestion;
        string difficulty = disruption >= 0.72
            ? "SEVERE"
            : disruption >= 0.48 ? "ELEVATED" : disruption >= 0.28 ? "BUSY" : "NORMAL";
        double rewardMultiplier = 1 + (freight ? (1 - snapshot.Deliveries.Reliability) * 0.35 : disruption * 0.1);
        double timeLimitMultiplier = 1 + disruption * (crossesBridge ? 0.2 : 0.1);
        string demandStatus = freight && snapshot.Deliveries.Reliability < 0.78 ? "SURGE" : "NORMAL";
        return new TrafficMissionImpact(
            !blocked,
            blocked ? "The primary bridge is closed; this route has no safe authored alternative." : null,
            objective,
            crossesBridge,
            difficulty,
            disruption,
            demandStatus,
            rewardMultiplier,
            timeLimitMultiplier,
            blocked
                ? "Unavailable: primary bridge closed."
                : $"{difficulty.ToLowerInvariant()} traffic · {JavascriptRound(timeLimitMultiplier * 100)}% time allowance · {JavascriptRound(rewardMultiplier * 100)}% reward");
    }

    public TrafficStreetDirective GetStreetDirective(TrafficPoint? position = null)
    {
        position ??= new TrafficPoint(0, 0);
        bool onBridge = position.X >= BridgeMinimumX && position.X <= BridgeMaximumX && Math.Abs(position.Z) <= 18;
        return new TrafficStreetDirective(
            onBridge,
            onBridge ? snapshot.Bridge.Access : TrafficAccess.Open,
            onBridge ? snapshot.Presentation.BridgeSpeedMultiplier : snapshot.Presentation.SpeedMultiplier,
            onBridge && policy == BridgePolicies.FreightPriority,
            onBridge && snapshot.Bridge.OutageActive,
            onBridge ? snapshot.Bridge.StreetStatus : "City traffic flow");
    }

    public TrafficProductivityState Serialize() => new() { BridgePolicy = policy };

    public TrafficProductivitySnapshot Restore(TrafficProductivityState state)
    {
        ValidateState(state);
        policy = StablePolicy(state.BridgePolicy);
        return Update(force: true, reason: "STATE_RESTORED");
    }

    public static void ValidateState(TrafficProductivityState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.Version != StateVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(state), $"Unsupported traffic productivity state version: {state.Version}");
        }
        _ = StablePolicy(state.BridgePolicy);
    }

    private TrafficProductivitySnapshot Calculate()
    {
        EconomyLedgerSnapshot economySnapshot = economy.Snapshot();
        MissionOutcomeState? outcomeState = outcomes?.Snapshot().State;
        RoadNetworkSnapshot roads = roadProvider?.Invoke() ?? RoadNetworkSnapshot.Empty;
        TrafficPolicyProfile profile = policyProfiles[policy];
        IEnumerable<KeyValuePair<string, OutcomeTrafficState>> trafficPolicies = outcomeState is null
            ? Array.Empty<KeyValuePair<string, OutcomeTrafficState>>()
            : outcomeState.Traffic;
        KeyValuePair<string, OutcomeServiceOutageState>[] activeOutages = (outcomeState?.ServiceOutages
                ?? new Dictionary<string, OutcomeServiceOutageState>())
            .Where(entry => entry.Value.Active)
            .ToArray();
        KeyValuePair<string, OutcomeTrafficState>[] bridgePolicies = trafficPolicies
            .Where(entry => IsBridgeScope(entry.Key, entry.Value.DistrictId))
            .ToArray();
        KeyValuePair<string, OutcomeTrafficState>[] cityPolicies = trafficPolicies
            .Where(entry => entry.Key == "CITY" || !IsBridgeScope(entry.Key, entry.Value.DistrictId))
            .ToArray();
        string networkAccess = TrafficAccess.Open;
        string bridgeAccess = TrafficAccess.Open;
        double networkHazard = 0;
        double bridgeHazard = 0;
        double densityMultiplier = 1;
        double bridgeDensityMultiplier = 1;

        foreach ((_, OutcomeTrafficState traffic) in cityPolicies)
        {
            networkAccess = WorstAccess(networkAccess, traffic.Access);
            networkHazard = Math.Max(networkHazard, traffic.HazardLevel);
            densityMultiplier *= Math.Max(0.1, traffic.DensityMultiplier);
        }
        foreach ((_, OutcomeTrafficState traffic) in bridgePolicies)
        {
            bridgeAccess = WorstAccess(bridgeAccess, traffic.Access);
            bridgeHazard = Math.Max(bridgeHazard, traffic.HazardLevel);
            bridgeDensityMultiplier *= Math.Max(0.1, traffic.DensityMultiplier);
        }
        if (outcomeState?.Infrastructure.TryGetValue(PrimaryBridgeId, out OutcomeInfrastructureState? infrastructure) == true)
        {
            bridgeAccess = WorstAccess(bridgeAccess, infrastructure.Access);
        }
        KeyValuePair<string, OutcomeServiceOutageState>[] bridgeOutages = activeOutages
            .Where(entry => IsBridgeScope(entry.Key, entry.Value.DistrictId))
            .ToArray();
        double outageSeverity = Clamp(activeOutages.Sum(entry => entry.Value.Severity) / 8, 0, 1);
        double bridgeOutageSeverity = Clamp(bridgeOutages.Sum(entry => entry.Value.Severity) / 5, 0, 1);

        double workforce = Math.Max(0, economySnapshot.Demographics.Workforce);
        double jobCapacity = Math.Max(0, economySnapshot.Demographics.JobCapacity);
        double commuterDemand = 42 + Math.Min(55, workforce / 55) + Math.Min(35, jobCapacity / 90);
        double freightDemand = 24 + economySnapshot.Demand.Operations * 0.22 + economySnapshot.Demand.Commercial * 0.14;
        RoadNetworkSegment[] segments = roads.Segments?.Where(segment => segment is not null).ToArray()
            ?? Array.Empty<RoadNetworkSegment>();
        int connectedRoads = segments.Count(segment => segment.Connected);
        int disconnectedRoads = segments.Length - connectedRoads;
        int roadCapacity = 150 + connectedRoads * 12;
        double totalDemand = (commuterDemand + freightDemand) * densityMultiplier;
        double accessPenalty = networkAccess == TrafficAccess.Closed ? 0.52 : networkAccess == TrafficAccess.Restricted ? 0.16 : 0;
        double congestion = Clamp(
            0.08
            + Math.Max(0, totalDemand / roadCapacity - 0.48) * 0.72
            + networkHazard * 0.18
            + outageSeverity * 0.12
            + accessPenalty
            + disconnectedRoads * 0.015,
            0,
            1);
        double bridgeDemand = (commuterDemand * 0.36 + freightDemand * 0.62) * bridgeDensityMultiplier;
        double bridgeCapacity = 58 * profile.BridgeCapacityMultiplier;
        double bridgeAccessPenalty = bridgeAccess == TrafficAccess.Closed ? 0.72 : bridgeAccess == TrafficAccess.Restricted ? 0.2 : 0;
        double bridgeCongestion = Clamp(
            0.1
            + Math.Max(0, bridgeDemand / bridgeCapacity - 0.42) * 0.72
            + bridgeHazard * 0.24
            + bridgeOutageSeverity * 0.2
            + bridgeAccessPenalty,
            0,
            1);
        double deliveryReliability = Clamp(
            1
            - congestion * 0.3
            - bridgeCongestion * 0.26
            - outageSeverity * 0.12
            - (bridgeAccess == TrafficAccess.Closed ? 0.32 : 0)
            + profile.FreightReliabilityBonus,
            0.2,
            1);
        double jobAccessMultiplier = Clamp(1 - congestion * 0.18 - bridgeCongestion * 0.08, 0.65, 1);
        int potentialJobs = (int)Math.Min(workforce, jobCapacity == 0 ? workforce : jobCapacity);
        int accessibleJobs = JavascriptRound(potentialJobs * jobAccessMultiplier);
        double productivityMultiplier = Clamp(
            1 - congestion * 0.22 - bridgeCongestion * 0.1 - outageSeverity * 0.08,
            0.55,
            1);
        double satisfactionModifier = -(
            congestion * 9
            + bridgeCongestion * 4
            + outageSeverity * 3
            + profile.CommuterSatisfactionPenalty);
        double presentationDensity = Clamp(0.58 + congestion * 0.42, 0.5, 1);
        int targetVehicles = JavascriptRound(presentationVehicleCap * presentationDensity);
        string streetStatus = bridgeAccess == TrafficAccess.Closed
            ? "Bridge closed — barricades active"
            : bridgeOutages.Length > 0
                ? "Bridge service outage — reduced flow"
                : policy == BridgePolicies.FreightPriority
                    ? "Freight priority lane active"
                    : bridgeCongestion >= 0.55 ? "Heavy bridge traffic" : "Bridge open";
        RoadNetworkSegment? topRoadHotspot = segments.FirstOrDefault(segment => !segment.Connected && segment.Position is not null);
        var hotspots = new List<TrafficHotspot>();
        if (bridgeCongestion >= 0.35 || bridgeOutages.Length > 0)
        {
            hotspots.Add(new TrafficHotspot(
                PrimaryBridgeId,
                "Primary bridge corridor",
                155,
                0,
                Math.Max(bridgeCongestion, bridgeOutageSeverity),
                streetStatus));
        }
        if (topRoadHotspot?.Position is not null)
        {
            hotspots.Add(new TrafficHotspot(
                topRoadHotspot.Id,
                "Disconnected road segment",
                topRoadHotspot.Position.X,
                topRoadHotspot.Position.Z,
                0.4,
                "Road change has no network connection."));
        }
        int delayedDeliveries = JavascriptRound((1 - deliveryReliability) * 100);
        int roundedCongestion = JavascriptRound(congestion * 100);
        int productivityPercent = JavascriptRound(productivityMultiplier * 100);
        int roundedBridgeCongestion = JavascriptRound(bridgeCongestion * 100);
        int onTimePercent = JavascriptRound(deliveryReliability * 100);
        int roundedSatisfaction = JavascriptRound(satisfactionModifier);
        IReadOnlyList<string> explanations = Array.AsReadOnly(new[]
        {
            $"{roundedCongestion}% network congestion reduces productivity to {productivityPercent}%.",
            $"{roundedBridgeCongestion}% bridge congestion leaves {onTimePercent}% of deliveries on time.",
            $"{accessibleJobs.ToString("N0", CultureInfo.InvariantCulture)} jobs remain reachable; traffic changes satisfaction by {roundedSatisfaction}.",
            profile.Tradeoff,
        });

        return new TrafficProductivitySnapshot(
            StateVersion,
            0,
            new TrafficNetworkProductivity(
                congestion,
                Rating(congestion),
                networkAccess,
                JavascriptRound(totalDemand),
                roadCapacity,
                connectedRoads,
                disconnectedRoads,
                Array.AsReadOnly(hotspots.ToArray())),
            new BridgeProductivity(
                PrimaryBridgeId,
                bridgeCongestion,
                Rating(bridgeCongestion),
                bridgeAccess,
                JavascriptRound(bridgeDemand),
                JavascriptRound(bridgeCapacity),
                bridgeOutages.Length > 0,
                Array.AsReadOnly(bridgeOutages.Select(entry => entry.Key).ToArray()),
                streetStatus),
            new TrafficJobAccess(jobAccessMultiplier, accessibleJobs, Math.Max(0, potentialJobs - accessibleJobs)),
            new TrafficDeliveryProductivity(
                deliveryReliability,
                onTimePercent,
                delayedDeliveries,
                delayedDeliveries >= 22 ? "SURGE" : delayedDeliveries >= 10 ? "ELEVATED" : "NORMAL"),
            new TrafficProductivity(productivityMultiplier, productivityPercent),
            new TrafficSatisfaction(satisfactionModifier, roundedSatisfaction),
            profile,
            new TrafficPresentation(
                targetVehicles,
                presentationDensity,
                Clamp(1 - congestion * 0.48, 0.35, 1),
                bridgeAccess == TrafficAccess.Closed
                    ? 0
                    : Clamp((1 - bridgeCongestion * 0.5) * (policy == BridgePolicies.FreightPriority ? 1.1 : 1), 0.3, 1.05)),
            explanations,
            new TrafficProductivityInputs(workforce, jobCapacity, activeOutages.Length));
    }

    private static string StablePolicy(string? value)
    {
        string normalized = (value ?? string.Empty).ToUpperInvariant();
        if (normalized is not BridgePolicies.Balanced and not BridgePolicies.FreightPriority)
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"Unsupported bridge policy: {value}");
        }
        return normalized;
    }

    private static int AccessRank(string access) => access switch
    {
        TrafficAccess.Closed => 2,
        TrafficAccess.Restricted => 1,
        _ => 0,
    };

    private static string WorstAccess(string current, string? candidate)
    {
        string normalized = candidate is TrafficAccess.Closed or TrafficAccess.Restricted or TrafficAccess.Open
            ? candidate
            : TrafficAccess.Open;
        return AccessRank(normalized) > AccessRank(current) ? normalized : current;
    }

    private static bool IsBridgeScope(string id, string? districtId) =>
        id.Contains("bridge", StringComparison.OrdinalIgnoreCase) || districtId == PrimaryBridgeDistrict;

    private static bool MissionCrossesPrimaryBridge(TrafficMissionRequest mission)
    {
        if (mission.Pickup is null || mission.Dropoff is null) return false;
        return (mission.Pickup.X < BridgeMinimumX && mission.Dropoff.X > BridgeMaximumX)
            || (mission.Dropoff.X < BridgeMinimumX && mission.Pickup.X > BridgeMaximumX);
    }

    private static bool MateriallyEquals(TrafficProductivitySnapshot left, TrafficProductivitySnapshot right) =>
        JsonSerializer.Serialize(left with { Revision = 0 }) == JsonSerializer.Serialize(right with { Revision = 0 });

    private static string Rating(double congestion) => congestion >= 0.75
        ? "GRIDLOCKED"
        : congestion >= 0.5 ? "HEAVY" : congestion >= 0.28 ? "BUSY" : "FLOWING";

    private static double Clamp(double value, double minimum, double maximum) => Math.Min(maximum, Math.Max(minimum, value));

    private static int JavascriptRound(double value) => checked((int)Math.Floor(value + 0.5));

    private void Notify(TrafficProductivityEvent trafficEvent)
    {
        foreach (Action<TrafficProductivityEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(trafficEvent);
            }
            catch (Exception)
            {
                // Presentation listeners cannot break the aggregate authority.
            }
        }
    }
}

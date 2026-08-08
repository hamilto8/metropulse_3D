using System.Text.Json;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class CityConditionServiceTests
{
    [Fact]
    public void TrafficAndBridgeMergeLiveMetricsWithAuthoredConsequences()
    {
        (_, MissionOutcomeService outcomes, CityConditionService conditions) = CreateHarness();
        MissionOutcomeReceipt receipt = ApplyConditions(outcomes);

        CityConditionResult traffic = conditions.GetTraffic("primary-bridge", "PRIMARY_BRIDGE_CORRIDOR");
        Assert.Equal(0.6, Number(traffic.Value, "baseCongestion"));
        Assert.Equal(0.96, Number(traffic.Value, "congestion"), 9);
        Assert.Equal(AccessStates.Restricted, Text(traffic.Value, "access"));
        Assert.Equal(0.8, Number(traffic.Value, "enforcement"));
        Assert.Equal(20, traffic.Facts.GetProperty("activeVehicles").GetInt32());
        Assert.Equal(receipt.TransactionId, Assert.Single(traffic.Sources).TransactionId);

        CityConditionResult bridge = conditions.Query(new CityConditionRequest
        {
            Type = CityConditionTypes.Bridge,
            BridgeId = "primary-bridge",
        });
        Assert.Equal("DEGRADED", Text(bridge.Value, "state"));
        Assert.Equal(AccessStates.Restricted, Text(bridge.Value, "access"));
        Assert.Equal(0.65, Number(bridge.Value, "condition"));
        Assert.Equal(0.7, Number(bridge.Value, "safety"));
        Assert.Equal(RepairStatuses.InProgress, Text(bridge.Value, "repairStatus"));
        Assert.Equal(0.35, Number(bridge.Value, "repairProgress"));
        Assert.Equal(0.96, Number(bridge.Value, "congestion"), 9);
    }

    [Fact]
    public void ServiceSafetyAndRepairQueriesAreDistrictAware()
    {
        (_, MissionOutcomeService outcomes, CityConditionService conditions) = CreateHarness();
        ApplyConditions(outcomes);

        CityConditionResult affected = conditions.GetServiceCoverage(ServiceTypes.Power, "PRIMARY_BRIDGE_CORRIDOR");
        CityConditionResult unaffected = conditions.GetServiceCoverage(ServiceTypes.Power, "WEST_CORE");
        Assert.Equal(0.5, Number(affected.Value, "coverage"));
        Assert.True(affected.Value.GetProperty("outageActive").GetBoolean());
        Assert.Equal(1, Number(unaffected.Value, "coverage"));
        Assert.False(unaffected.Value.GetProperty("outageActive").GetBoolean());

        CityConditionResult safety = conditions.GetSafety("PRIMARY_BRIDGE_CORRIDOR");
        Assert.Equal(70, Number(safety.Value, "score"));
        Assert.Equal("STRAINED", Text(safety.Value, "rating"));
        Assert.Equal(1, safety.Value.GetProperty("activeIncidentCount").GetInt32());

        CityConditionResult repair = conditions.GetRepair("primary-bridge");
        Assert.Equal(RepairStatuses.InProgress, Text(repair.Value, "status"));
        Assert.Equal(0.35, Number(repair.Value, "progress"));
        Assert.Equal(2_500, Number(repair.Value, "estimatedCost"));
        CityConditionResult unknown = conditions.GetRepair("unknown-target");
        Assert.Equal(RepairStatuses.NotStarted, Text(unknown.Value, "status"));
        Assert.Equal(0, Number(unknown.Value, "progress"));
    }

    [Fact]
    public void LandWeatherDistrictAndFlagQueriesExposePlainValues()
    {
        (_, MissionOutcomeService outcomes, CityConditionService conditions) = CreateHarness();
        ApplyConditions(outcomes);

        CityConditionResult land = conditions.GetLandValue(220, 0);
        Assert.Equal("PRIMARY_BRIDGE_CORRIDOR", Text(land.Value, "districtId"));
        Assert.Equal(92, Number(land.Value, "landValue"));
        Assert.Equal(-8, Number(land.Facts, "authoredModifier"));

        CityConditionResult weather = conditions.GetWeather();
        Assert.Equal("rain", Text(weather.Value, "mode"));
        Assert.Equal(0.72, Number(weather.Value, "visibility"));
        Assert.Equal(0.7, Number(weather.Value, "roadGrip"));

        CityConditionResult bridgeDistrict = conditions.GetDistrict("PRIMARY_BRIDGE_CORRIDOR");
        Assert.True(bridgeDistrict.Value.GetProperty("unlocked").GetBoolean());
        Assert.Equal("DISRUPTED", Text(bridgeDistrict.Value, "state"));
        Assert.True(conditions.GetDistrict("EAST_CYBER_METROPOLIS").Value.GetProperty("unlocked").GetBoolean());

        CityConditionResult flag = conditions.GetAuthoredFlag("bridge.diversion.active");
        Assert.True(flag.Value.GetBoolean());
        Assert.True(flag.Facts.GetProperty("set").GetBoolean());
        Assert.Equal(JsonValueKind.Null, conditions.GetAuthoredFlag("unset.flag").Value.ValueKind);
    }

    [Fact]
    public void RequirementEvaluationSupportsPathsOperatorsAllAndAny()
    {
        (_, MissionOutcomeService outcomes, CityConditionService conditions) = CreateHarness();
        ApplyConditions(outcomes);

        CityConditionEvaluation access = conditions.Evaluate(new CityConditionRequirement(
            new CityConditionRequest { Type = CityConditionTypes.Bridge, BridgeId = "primary-bridge" },
            ConditionOperators.Equals,
            "access",
            ConditionValues.From(AccessStates.Restricted)));
        Assert.True(access.Passed);
        Assert.Equal(AccessStates.Restricted, access.Actual!.Value.GetString());

        CityConditionEvaluationSet all = conditions.EvaluateAll(
        [
            new CityConditionRequirement(
                new CityConditionRequest { Type = CityConditionTypes.Weather },
                ConditionOperators.In,
                "mode",
                ConditionValues.From(new[] { "rain", "storm" })),
            new CityConditionRequirement(
                new CityConditionRequest { Type = CityConditionTypes.AuthoredFlag, FlagId = "bridge.diversion.active" },
                ConditionOperators.Truthy),
        ]);
        Assert.True(all.Passed);
        Assert.Equal(2, all.Results.Count);

        CityConditionEvaluationSet any = conditions.EvaluateAll(
        [
            new CityConditionRequirement(
                new CityConditionRequest { Type = CityConditionTypes.Repair, TargetId = "primary-bridge" },
                ConditionOperators.GreaterThan,
                "progress",
                ConditionValues.From(0.9)),
            new CityConditionRequirement(
                new CityConditionRequest { Type = CityConditionTypes.Safety, DistrictId = "PRIMARY_BRIDGE_CORRIDOR" },
                ConditionOperators.GreaterThanOrEqual,
                "score",
                ConditionValues.From(70)),
        ], "ANY");
        Assert.True(any.Passed);
    }

    [Fact]
    public void CustomResolversCannotReplaceBuiltInOwnership()
    {
        (_, _, CityConditionService conditions) = CreateHarness();
        Assert.Throws<InvalidOperationException>(() => conditions.RegisterResolver(
            CityConditionTypes.Weather,
            (_, _) => throw new InvalidOperationException()));
        Func<bool> unregister = conditions.RegisterResolver("TRANSIT_CAPACITY", (request, context) =>
            new CityConditionResult(
                "TRANSIT_CAPACITY",
                request.Parameters!["lineId"].GetString()!,
                ConditionValues.From(context.Economy.CityPulse.Population / 100d),
                ConditionValues.From(new { }),
                Array.Empty<CityConditionSource>(),
                context.Economy.Revision));
        CityConditionResult result = conditions.Query(new CityConditionRequest
        {
            Type = "TRANSIT_CAPACITY",
            Parameters = new Dictionary<string, JsonElement> { ["lineId"] = ConditionValues.From("west-loop") },
        });
        Assert.Equal(0, result.Value.GetDouble());
        Assert.True(unregister());
        Assert.False(unregister());
        Assert.Throws<ArgumentOutOfRangeException>(() => conditions.Query(new CityConditionRequest
        {
            Type = "TRANSIT_CAPACITY",
        }));
    }

    [Fact]
    public void InvalidRequestsFailClosedWithActionableErrors()
    {
        (_, _, CityConditionService conditions) = CreateHarness();
        Assert.Throws<ArgumentOutOfRangeException>(() => conditions.Query(new CityConditionRequest
        {
            Type = "REMOVED_CONDITION",
        }));
        Assert.Throws<ArgumentOutOfRangeException>(() => conditions.GetServiceCoverage("internet"));
        Assert.Throws<ArgumentOutOfRangeException>(() => conditions.GetDistrict("ATLANTIS"));
        Assert.Throws<ArgumentException>(() => conditions.GetLandValue(1));
        Assert.Throws<ArgumentOutOfRangeException>(() => conditions.EvaluateAll([], "SOME"));
    }

    private static (EconomyLedger Economy, MissionOutcomeService Outcomes, CityConditionService Conditions) CreateHarness()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(
            content.EconomyBalance,
            10_000,
            0,
            landValue: 100,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(100, 100),
                Water = new EconomyServiceBase(100, 100),
                Fire = new EconomyServiceBase(100, 100),
            });
        var outcomes = new MissionOutcomeService(economy, content);
        var conditions = new CityConditionService(
            economy,
            outcomes,
            trafficProvider: () => new TrafficConditionMetrics
            {
                Revision = 7,
                Index = 0.4,
                ActiveVehicles = 20,
                StoppedVehicles = 8,
                CrashedVehicles = 1,
                Bridge = new TrafficBridgeMetrics(0.6, 10, 6),
            },
            bridgeProvider: id => new BridgeConditionState(id),
            weatherProvider: () => new WeatherConditionState("rain"));
        return (economy, outcomes, conditions);
    }

    private static MissionOutcomeReceipt ApplyConditions(MissionOutcomeService outcomes) => outcomes.Apply(
        new MissionOutcomeTransaction(
            "management:bridge-diversion",
            new OutcomeSource(
                OutcomeSourceKinds.Management,
                "bridge-diversion",
                "APPROVED",
                Reason: "Council approved a restricted bridge diversion."),
            [
                new InfrastructureStateSetCommand(
                    "primary-bridge", "DEGRADED", "PRIMARY_BRIDGE_CORRIDOR",
                    AccessStates.Restricted, 0.65, 0.7),
                new RepairSetCommand(
                    "primary-bridge", RepairStatuses.InProgress, 0.35, 2_500),
                new ServiceOutageSetCommand(
                    "bridge-power", ServiceTypes.Power, "PRIMARY_BRIDGE_CORRIDOR",
                    Severity: 0.5, CoverageMultiplier: 0.5),
                new TrafficSetCommand(
                    "primary-bridge", "PRIMARY_BRIDGE_CORRIDOR", 1.5,
                    AccessStates.Restricted, 0.8, 0.4),
                new IncidentRecordedCommand(
                    "bridge-collision", "COLLISION", "PRIMARY_BRIDGE_CORRIDOR", 5,
                    LandValueModifier: -8, Position: new OutcomePosition(220, 0), InfluenceRadius: 100),
                new UnlockSetCommand("EAST_CYBER_METROPOLIS"),
                new AuthoredFlagSetCommand("bridge.diversion.active", OutcomeValues.From(true)),
            ],
            new OutcomeSummary(
                "Bridge diversion approved",
                "The bridge is restricted while crews respond to a collision.")));

    private static double Number(JsonElement value, string property) => value.GetProperty(property).GetDouble();

    private static string Text(JsonElement value, string property) => value.GetProperty(property).GetString()!;
}

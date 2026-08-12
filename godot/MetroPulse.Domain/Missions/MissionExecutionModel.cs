using System.Text.Json;

namespace MetroPulse.Domain.Missions;

/// <summary>
/// Renderer-free execution authority for mission pickup eligibility, vehicle binding,
/// route beats, timers, checkpoints, objective completion, and retry payloads.
/// </summary>
public sealed class MissionExecutionModel
{
    public const double PickupRadius = 16;
    public const double ObjectiveRadius = 10.5;
    public const double SabotageMaximumSpeed = 1;
    public const int StateVersion = 1;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly MissionRegistry registry;
    private readonly MissionLifecycleController lifecycle;
    private readonly double rewardScale;
    private readonly bool temporaryMayhemEnabled;
    private MissionExecutionState? state;

    public MissionExecutionModel(
        MissionRegistry missionRegistry,
        MissionLifecycleController lifecycleController,
        double rewardScale,
        bool temporaryMayhemEnabled = false)
    {
        registry = missionRegistry ?? throw new ArgumentNullException(nameof(missionRegistry));
        lifecycle = lifecycleController ?? throw new ArgumentNullException(nameof(lifecycleController));
        if (!double.IsFinite(rewardScale) || rewardScale <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(rewardScale));
        }
        this.rewardScale = rewardScale;
        this.temporaryMayhemEnabled = temporaryMayhemEnabled;
    }

    public MissionExecutionState? Snapshot => state;

    public MissionWorldPoint? NavigationTarget => state is null || state.RouteIndex >= state.Route.Count
        ? null
        : state.Route[state.RouteIndex];

    public IReadOnlyList<MissionOfferMarker> GetOfferMarkers(
        MissionVehicleSnapshot? vehicle = null,
        Func<MissionDefinition, MissionTrafficModifier>? trafficProvider = null)
    {
        if (lifecycle.Phase != MissionPhases.Idle || state is not null)
        {
            return Array.Empty<MissionOfferMarker>();
        }

        var markers = new List<MissionOfferMarker>();
        foreach (MissionDefinition mission in registry.GetMvpMissions(temporaryMayhemEnabled))
        {
            MissionAvailability availability = lifecycle.EvaluateAvailability(mission);
            if (!availability.Available) continue;
            if (vehicle is not null && !string.Equals(vehicle.TypeId, mission.VehicleType, StringComparison.Ordinal)) continue;
            MissionTrafficModifier traffic = trafficProvider?.Invoke(mission) ?? new MissionTrafficModifier();
            if (!traffic.Available) continue;
            MissionWorldPoint pickup = Point(mission.Pickup!);
            double distance = vehicle is null ? double.PositiveInfinity : Distance(vehicle.X, vehicle.Z, pickup);
            MissionOfferDecision decision = EvaluateOffer(mission.Id!, vehicle, traffic, requireProximity: true);
            markers.Add(new MissionOfferMarker(
                $"mission-pickup:{mission.Id}",
                mission.Id!,
                mission.Title!,
                mission.VehicleType!,
                pickup,
                decision.Allowed,
                decision.Reason,
                distance));
        }

        return Array.AsReadOnly(markers.ToArray());
    }

    public MissionOfferDecision EvaluateOffer(
        string missionId,
        MissionVehicleSnapshot? vehicle,
        MissionTrafficModifier? traffic = null,
        bool requireProximity = true)
    {
        MissionDefinition mission = registry.Get(missionId)
            ?? throw new ArgumentOutOfRangeException(nameof(missionId), $"Unknown mission: {missionId}");
        MissionAvailability availability = lifecycle.EvaluateAvailability(mission);
        MissionTrafficModifier modifier = traffic ?? new MissionTrafficModifier();
        ValidateModifier(modifier);
        double distance = vehicle is null ? double.PositiveInfinity : Distance(vehicle.X, vehicle.Z, Point(mission.Pickup!));
        string? reason = null;
        if (!IsInFeatureScope(mission)) reason = "Mission is outside the active feature scope.";
        else if (!availability.Available) reason = availability.Reasons.FirstOrDefault() ?? "Mission is unavailable.";
        else if (!modifier.Available) reason = modifier.Reason ?? "The current route is unavailable.";
        else if (vehicle is null || !vehicle.DirectlyControlled) reason = "Take direct control of a vehicle first.";
        else if (!string.Equals(vehicle.TypeId, mission.VehicleType, StringComparison.Ordinal))
            reason = $"Requires a {mission.VehicleType} vehicle.";
        else if (requireProximity && distance >= PickupRadius) reason = "Drive into the mission pickup marker first.";
        return new MissionOfferDecision(reason is null, reason, availability, distance, modifier);
    }

    public MissionOfferView BuildOffer(
        string missionId,
        MissionVehicleSnapshot? vehicle,
        MissionTrafficModifier? traffic = null)
    {
        MissionDefinition mission = registry.Get(missionId)
            ?? throw new ArgumentOutOfRangeException(nameof(missionId), $"Unknown mission: {missionId}");
        MissionOfferDecision eligibility = EvaluateOffer(missionId, vehicle, traffic);
        var risks = new List<string>();
        if (eligibility.Availability.Weather is { } weather && weather.Disposition != MissionWeatherDispositions.Allowed)
            risks.Add(weather.Reason);
        if (eligibility.Traffic is { Available: true } modifier
            && (modifier.TimeLimitMultiplier != 1 || modifier.RewardMultiplier != 1)
            && !string.IsNullOrWhiteSpace(modifier.Reason)) risks.Add(modifier.Reason);
        if (ObjectiveOf(mission) == MissionObjectiveTypes.Race) risks.Add("A rival can finish before the route timer expires.");
        if (ObjectiveOf(mission) == MissionObjectiveTypes.Sabotage) risks.Add("The target action requires an uninterrupted stopped-vehicle hold.");
        if (ObjectiveOf(mission) == MissionObjectiveTypes.Survival) risks.Add("Survive until the activity timer expires.");
        return new MissionOfferView(
            mission.Id!,
            mission.Title!,
            ObjectiveOf(mission),
            mission.PassengerName ?? "Mission contact",
            mission.PassengerRole ?? "Citizen",
            mission.VehicleType!,
            Point(mission.Pickup!),
            ObjectiveOf(mission) == MissionObjectiveTypes.Survival ? null : Point(mission.Dropoff!),
            RoundCurrency(mission.BaseReward * rewardScale * eligibility.Traffic.RewardMultiplier),
            mission.TimeLimit * eligibility.Traffic.TimeLimitMultiplier,
            Array.AsReadOnly(risks.Distinct(StringComparer.Ordinal).ToArray()),
            Array.AsReadOnly(eligibility.Availability.Prerequisites.Where(item => !item.Passed).Select(item => item.Reason).ToArray()),
            eligibility);
    }

    public MissionObjectiveActionDecision EvaluateObjectiveAction(MissionVehicleSnapshot? vehicle)
    {
        MissionExecutionState current = RequireActive();
        MissionDefinition mission = registry.Get(current.MissionId)!;
        string prompt = mission.SabotageAction ?? "Perform mission action";
        if (current.Objective != MissionObjectiveTypes.Sabotage)
            return new MissionObjectiveActionDecision(false, "The active objective does not use an interaction action.", double.PositiveInfinity, prompt);
        string? reason = ValidateBoundVehicle(current, vehicle);
        double distance = vehicle is null || NavigationTarget is not { } target
            ? double.PositiveInfinity
            : Distance(vehicle.X, vehicle.Z, target);
        if (reason is null && distance >= ObjectiveRadius) reason = "Reach the sabotage target first.";
        if (reason is null && Math.Abs(vehicle!.Speed) > SabotageMaximumSpeed)
            reason = "Stop the vehicle before starting the sabotage action.";
        return new MissionObjectiveActionDecision(reason is null, reason, distance, prompt);
    }

    public MissionLifecycleState BeginBriefing(
        string missionId,
        MissionVehicleSnapshot vehicle,
        MissionTrafficModifier? traffic = null)
    {
        MissionOfferDecision decision = EvaluateOffer(missionId, vehicle, traffic);
        if (!decision.Allowed)
        {
            throw new MissionLifecycleException(decision.Reason!, "MISSION_PICKUP_INELIGIBLE");
        }
        lifecycle.Prepare(missionId);
        return lifecycle.BeginBriefing();
    }

    public MissionExecutionState Accept(
        MissionVehicleSnapshot vehicle,
        MissionAcceptanceChoice? choice = null,
        MissionTrafficModifier? traffic = null,
        double timerLeniency = 1)
    {
        if (lifecycle.Phase != MissionPhases.Briefing || lifecycle.CurrentMission is not { } mission)
        {
            throw new MissionLifecycleException("Mission acceptance requires an active briefing.", "INVALID_MISSION_PHASE");
        }
        if (!double.IsFinite(timerLeniency) || timerLeniency <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(timerLeniency));
        }
        MissionOfferDecision decision = EvaluateOffer(mission.Id!, vehicle, traffic);
        if (!decision.Allowed)
        {
            lifecycle.AbandonBriefing();
            throw new MissionLifecycleException(decision.Reason!, "MISSION_ACCEPTANCE_INELIGIBLE");
        }

        MissionAcceptanceChoice acceptedChoice = choice ?? new MissionAcceptanceChoice();
        if (!double.IsFinite(acceptedChoice.RushBonus) || acceptedChoice.RushBonus < 0
            || (acceptedChoice.TimeLimitOverride is { } timeOverride && (!double.IsFinite(timeOverride) || timeOverride <= 0)))
        {
            throw new ArgumentOutOfRangeException(nameof(choice));
        }
        MissionTrafficModifier modifier = decision.Traffic;
        double authoredTime = acceptedChoice.TimeLimitOverride ?? mission.TimeLimit;
        double baseTime = authoredTime * modifier.TimeLimitMultiplier * timerLeniency;
        double basePayout = RoundCurrency((mission.BaseReward + acceptedChoice.RushBonus) * rewardScale * modifier.RewardMultiplier);
        JsonElement? choiceJson = acceptedChoice == new MissionAcceptanceChoice()
            ? null
            : JsonSerializer.SerializeToElement(acceptedChoice, JsonOptions);
        MissionLifecycleState lifecycleState = lifecycle.Accept(baseTime, basePayout, choiceJson);
        MissionLifecycleRun run = lifecycleState.Run!;
        IReadOnlyList<MissionWorldPoint> route = BuildRoute(mission);
        MissionRival? leader = mission.Rivals?.OrderBy(item => item.FinishTime).ThenBy(item => item.Name, StringComparer.Ordinal).FirstOrDefault();
        state = new MissionExecutionState
        {
            MissionId = mission.Id!,
            Objective = ObjectiveOf(mission),
            VehicleId = vehicle.StableId,
            VehicleType = vehicle.TypeId,
            InitialTimeLimit = run.InitialTimeLimit,
            TimeRemaining = run.InitialTimeLimit,
            BasePayout = run.BaseReward,
            Payout = run.BaseReward,
            Route = route,
            RouteIndex = 0,
            RaceElapsed = 0,
            RaceLeaderName = leader?.Name,
            RaceLeaderFinishTime = leader?.FinishTime,
            SabotageActive = false,
            SabotageProgress = 0,
            SabotageTargetCheckpointRecorded = false,
            CongestionSamples = 0,
            CongestionTotal = 0,
        };
        lifecycle.BeginExecution();
        return state;
    }

    public MissionExecutionUpdate BeginObjectiveHold(MissionVehicleSnapshot? vehicle)
    {
        MissionExecutionState current = RequireActive();
        MissionObjectiveActionDecision decision = EvaluateObjectiveAction(vehicle);
        if (!decision.Allowed) return new MissionExecutionUpdate(current, MissionExecutionSignals.None, decision.Reason);
        state = current with { SabotageActive = true, SabotageProgress = 0 };
        return new MissionExecutionUpdate(state, MissionExecutionSignals.HoldStarted);
    }

    public MissionExecutionUpdate Advance(
        double delta,
        MissionVehicleSnapshot? vehicle,
        double congestion = 0)
    {
        if (!double.IsFinite(delta) || delta < 0) throw new ArgumentOutOfRangeException(nameof(delta));
        if (!double.IsFinite(congestion)) throw new ArgumentOutOfRangeException(nameof(congestion));
        MissionExecutionState current = RequireActive();
        if (lifecycle.Phase == MissionPhases.Checkpoint) lifecycle.ResumeFromCheckpoint();
        string? vehicleFailure = ValidateBoundVehicle(current, vehicle);
        if (vehicleFailure is not null) return Fail(vehicleFailure);

        double boundedCongestion = Math.Clamp(congestion, 0, 1);
        current = current with
        {
            TimeRemaining = Math.Max(0, current.TimeRemaining - delta),
            RaceElapsed = current.Objective == MissionObjectiveTypes.Race ? current.RaceElapsed + delta : current.RaceElapsed,
            CongestionSamples = current.CongestionSamples + 1,
            CongestionTotal = current.CongestionTotal + boundedCongestion,
        };
        state = current;

        if (current.Objective == MissionObjectiveTypes.Race
            && current.RaceLeaderFinishTime is { } rivalFinish
            && current.RaceElapsed >= rivalFinish)
        {
            return Fail("race_lost");
        }
        if (current.TimeRemaining <= 0)
        {
            return current.Objective == MissionObjectiveTypes.Survival ? Complete() : Fail("timeout");
        }
        if (current.Objective == MissionObjectiveTypes.Survival)
        {
            return new MissionExecutionUpdate(current, MissionExecutionSignals.None);
        }

        MissionWorldPoint target = NavigationTarget
            ?? throw new InvalidOperationException("The active routed mission has no navigation target.");
        double distance = Distance(vehicle!.X, vehicle.Z, target);
        if (current.Objective == MissionObjectiveTypes.Sabotage && current.SabotageActive)
        {
            if (distance >= ObjectiveRadius || Math.Abs(vehicle.Speed) > SabotageMaximumSpeed)
            {
                state = current with { SabotageActive = false, SabotageProgress = 0 };
                return new MissionExecutionUpdate(state, MissionExecutionSignals.HoldInterrupted, "Hold position at the sabotage target.");
            }
            MissionDefinition sabotage = registry.Get(current.MissionId)!;
            state = current with { SabotageProgress = current.SabotageProgress + delta };
            return state.SabotageProgress >= sabotage.SabotageDuration
                ? Complete()
                : new MissionExecutionUpdate(state, MissionExecutionSignals.None);
        }
        if (distance >= ObjectiveRadius)
        {
            return new MissionExecutionUpdate(current, MissionExecutionSignals.None);
        }
        if (current.Objective == MissionObjectiveTypes.Race && current.RouteIndex < current.Route.Count - 1)
        {
            state = current with { RouteIndex = current.RouteIndex + 1 };
            MissionCheckpoint checkpoint = RecordCheckpoint($"route-{state.RouteIndex}");
            return new MissionExecutionUpdate(state, MissionExecutionSignals.Checkpoint, Checkpoint: checkpoint);
        }
        if (current.Objective == MissionObjectiveTypes.Sabotage)
        {
            if (!current.SabotageTargetCheckpointRecorded)
            {
                state = current with { SabotageTargetCheckpointRecorded = true };
                MissionCheckpoint checkpoint = RecordCheckpoint("sabotage-target");
                return new MissionExecutionUpdate(state, MissionExecutionSignals.ObjectiveReady, Checkpoint: checkpoint);
            }
            return new MissionExecutionUpdate(current, MissionExecutionSignals.ObjectiveReady);
        }
        return Complete();
    }

    public MissionExecutionUpdate Fail(string reason)
    {
        MissionExecutionState current = RequireActive();
        string normalized = string.IsNullOrWhiteSpace(reason) ? "failed" : reason.Trim();
        lifecycle.ResolveFailure(normalized, FailureSummary(normalized));
        return new MissionExecutionUpdate(current, MissionExecutionSignals.Failed, normalized);
    }

    public MissionExecutionState Restore(MissionExecutionState value)
    {
        ArgumentNullException.ThrowIfNull(value);
        ValidateState(value, registry, lifecycle.Snapshot());
        state = Freeze(value);
        return state;
    }

    public MissionExecutionState RecoverForRetry(
        MissionVehicleSnapshot vehicle,
        MissionRetryDecision decision)
    {
        ArgumentNullException.ThrowIfNull(vehicle);
        ArgumentNullException.ThrowIfNull(decision);
        if (lifecycle.Phase != MissionPhases.Recovery || !decision.Allowed || state is null)
            throw new MissionLifecycleException("Mission retry recovery is not prepared.", "MISSION_RETRY_UNAVAILABLE");
        string? vehicleError = ValidateBoundVehicle(state, vehicle);
        if (vehicleError is not null)
            throw new MissionLifecycleException("The saved mission vehicle must be reacquired before retry.", "MISSION_VEHICLE_UNAVAILABLE");

        MissionExecutionState recovered = state with
        {
            TimeRemaining = state.InitialTimeLimit,
            Payout = state.BasePayout,
            RouteIndex = 0,
            RaceElapsed = 0,
            SabotageActive = false,
            SabotageProgress = 0,
            SabotageTargetCheckpointRecorded = false,
            CongestionSamples = 0,
            CongestionTotal = 0,
        };
        if (decision.Checkpoint is { } checkpoint)
        {
            MissionExecutionCheckpointPayload payload = checkpoint.Payload.Deserialize<MissionExecutionCheckpointPayload>(JsonOptions)
                ?? throw new InvalidDataException("Mission retry checkpoint payload is unavailable.");
            recovered = recovered with
            {
                TimeRemaining = payload.TimeRemaining,
                Payout = payload.Payout,
                RouteIndex = payload.RouteIndex,
                RaceElapsed = payload.RaceElapsed,
                SabotageTargetCheckpointRecorded = recovered.Objective == MissionObjectiveTypes.Sabotage,
                CongestionSamples = payload.CongestionSamples,
                CongestionTotal = payload.CongestionTotal,
            };
        }
        lifecycle.FinishRecovery(retry: true);
        lifecycle.BeginExecution();
        ValidateState(recovered, registry, lifecycle.Snapshot());
        state = Freeze(recovered);
        return state;
    }

    public void Clear()
    {
        if (lifecycle.Phase is not (MissionPhases.Idle or MissionPhases.Result or MissionPhases.Recovery))
        {
            throw new MissionLifecycleException("Active mission execution cannot be discarded before result recovery.", "MISSION_EXECUTION_OWNED");
        }
        state = null;
    }

    public static bool ValidateState(
        MissionExecutionState value,
        MissionRegistry registry,
        MissionLifecycleState lifecycleState)
    {
        ArgumentNullException.ThrowIfNull(value);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(lifecycleState);
        if (value.Version != StateVersion) throw new InvalidDataException($"Unsupported mission execution state version: {value.Version}");
        MissionDefinition mission = registry.Get(value.MissionId)
            ?? throw new InvalidDataException($"Mission execution references unknown mission {value.MissionId}.");
        if (lifecycleState.Run?.MissionId != value.MissionId)
            throw new InvalidDataException("Mission execution does not match the lifecycle run.");
        if (value.Objective != ObjectiveOf(mission) || value.VehicleType != mission.VehicleType)
            throw new InvalidDataException("Mission execution objective or vehicle type differs from authored content.");
        if (string.IsNullOrWhiteSpace(value.VehicleId)) throw new InvalidDataException("Mission execution vehicle ID is missing.");
        if (!FiniteNonNegative(value.InitialTimeLimit) || value.InitialTimeLimit <= 0
            || !FiniteNonNegative(value.TimeRemaining) || value.TimeRemaining > value.InitialTimeLimit
            || !FiniteNonNegative(value.BasePayout) || !FiniteNonNegative(value.Payout)
            || value.RouteIndex < 0 || value.RouteIndex >= Math.Max(1, value.Route.Count)
            || !FiniteNonNegative(value.RaceElapsed) || !FiniteNonNegative(value.SabotageProgress)
            || value.CongestionSamples < 0 || !FiniteNonNegative(value.CongestionTotal))
            throw new InvalidDataException("Mission execution contains invalid numeric state.");
        IReadOnlyList<MissionWorldPoint> authoredRoute = BuildRoute(mission);
        if (!value.Route.SequenceEqual(authoredRoute)) throw new InvalidDataException("Mission execution route differs from authored content.");
        if (value.Objective == MissionObjectiveTypes.Survival && value.Route.Count != 0)
            throw new InvalidDataException("Survival missions cannot own a destination route.");
        return true;
    }

    private MissionExecutionUpdate Complete()
    {
        MissionExecutionState current = RequireActive();
        double? satisfaction = null;
        double payout = current.BasePayout;
        MissionDefinition mission = registry.Get(current.MissionId)!;
        if (current.Objective == MissionObjectiveTypes.Taxi)
        {
            double usedRatio = 1 - (current.TimeRemaining / Math.Max(1, current.InitialTimeLimit));
            double averageCongestion = current.CongestionSamples > 0 ? current.CongestionTotal / current.CongestionSamples : 0;
            satisfaction = Math.Round(Math.Clamp(100 - (usedRatio * 42) - (averageCongestion * 35), 25, 100), MidpointRounding.AwayFromZero);
            payout = RoundCurrency(current.BasePayout * (0.75 + (satisfaction.Value / 200)));
            state = current with { Payout = payout };
        }
        string summary = current.Objective == MissionObjectiveTypes.Taxi
            ? $"{mission.PassengerName} arrived with {satisfaction}% satisfaction."
            : $"{mission.Title} completed successfully.";
        lifecycle.ResolveSuccess(payout, summary, satisfaction);
        return new MissionExecutionUpdate(state!, MissionExecutionSignals.Completed, Satisfaction: satisfaction);
    }

    private MissionCheckpoint RecordCheckpoint(string suffix)
    {
        MissionExecutionState current = state!;
        MissionExecutionCheckpointPayload payload = new()
        {
            TimeRemaining = current.TimeRemaining,
            Payout = current.Payout,
            RouteIndex = current.RouteIndex,
            RaceElapsed = current.RaceElapsed,
            CongestionSamples = current.CongestionSamples,
            CongestionTotal = current.CongestionTotal,
        };
        MissionLifecycleState checkpointState = lifecycle.RecordCheckpoint(
            $"{current.MissionId}:{suffix}",
            JsonSerializer.SerializeToElement(payload, JsonOptions));
        MissionCheckpoint checkpoint = checkpointState.Run!.Checkpoint!;
        lifecycle.ResumeFromCheckpoint();
        return checkpoint;
    }

    private MissionExecutionState RequireActive()
    {
        if (state is null || lifecycle.Phase is not (MissionPhases.Active or MissionPhases.Checkpoint))
            throw new MissionLifecycleException("Mission execution is not active.", "MISSION_EXECUTION_INACTIVE");
        return state;
    }

    private static string? ValidateBoundVehicle(MissionExecutionState current, MissionVehicleSnapshot? vehicle)
    {
        if (vehicle is null || !vehicle.DirectlyControlled) return "vehicle_lost";
        if (vehicle.StableId != current.VehicleId || vehicle.TypeId != current.VehicleType) return "vehicle_lost";
        return null;
    }

    private bool IsInFeatureScope(MissionDefinition mission) =>
        Content.ContentDefinitions.MvpMissionIds.Contains(mission.Id!, StringComparer.Ordinal)
        && (temporaryMayhemEnabled || mission.RequiresMayhem != true);

    private static void ValidateModifier(MissionTrafficModifier modifier)
    {
        if (!double.IsFinite(modifier.RewardMultiplier) || modifier.RewardMultiplier <= 0
            || !double.IsFinite(modifier.TimeLimitMultiplier) || modifier.TimeLimitMultiplier <= 0)
            throw new ArgumentOutOfRangeException(nameof(modifier));
    }

    private static IReadOnlyList<MissionWorldPoint> BuildRoute(MissionDefinition mission)
    {
        if (ObjectiveOf(mission) == MissionObjectiveTypes.Survival) return Array.Empty<MissionWorldPoint>();
        IEnumerable<MissionLocation> points = ObjectiveOf(mission) == MissionObjectiveTypes.Race
            ? (mission.Checkpoints ?? Array.Empty<MissionLocation>()).Append(mission.Dropoff!)
            : [mission.Dropoff!];
        return Array.AsReadOnly(points.Select(Point).ToArray());
    }

    private static MissionWorldPoint Point(MissionLocation location) =>
        new(location.X, location.Z, location.District, location.DistrictId);

    private static double Distance(double x, double z, MissionWorldPoint point) =>
        Math.Sqrt(Math.Pow(x - point.X, 2) + Math.Pow(z - point.Z, 2));

    private static string ObjectiveOf(MissionDefinition mission) => mission.MissionType ?? mission.ObjectiveType ?? MissionObjectiveTypes.Delivery;

    private static double RoundCurrency(double value) => Math.Floor(value + 0.5);

    private static bool FiniteNonNegative(double value) => double.IsFinite(value) && value >= 0;

    private static string FailureSummary(string reason) => reason switch
    {
        "timeout" => "Time ran out.",
        "vehicle_lost" => "The accepted mission vehicle was lost or changed.",
        "race_lost" => "A rival crossed the finish line first.",
        "cancelled" or "canceled" or "abandoned" => "The mission was abandoned.",
        "arrest" or "arrested" or "captured" => "The player was arrested during the mission.",
        _ => $"The mission failed because {reason.Replace('_', ' ')}.",
    };

    private static MissionExecutionState Freeze(MissionExecutionState value) => value with
    {
        Route = Array.AsReadOnly(value.Route.ToArray()),
    };
}

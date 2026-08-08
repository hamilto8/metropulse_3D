using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Missions;

/// <summary>
/// Deterministic authority for mission availability, execution ownership, cleanup, and recovery.
/// Rendering and scene transitions consume its snapshots but do not own lifecycle state.
/// </summary>
public sealed class MissionLifecycleController
{
    public const int StateVersion = 1;

    private static readonly HashSet<string> PhaseValues =
    [
        MissionPhases.Idle,
        MissionPhases.Preparation,
        MissionPhases.Briefing,
        MissionPhases.Approach,
        MissionPhases.Active,
        MissionPhases.Checkpoint,
        MissionPhases.Completion,
        MissionPhases.Failure,
        MissionPhases.Cleanup,
        MissionPhases.Result,
        MissionPhases.Recovery,
    ];

    private static readonly HashSet<string> MissionCriticalPhases =
        new(PhaseValues.Where(phase => phase != MissionPhases.Idle), StringComparer.Ordinal);

    private static readonly HashSet<string> SaveBlockingPhases =
    [
        MissionPhases.Preparation,
        MissionPhases.Briefing,
        MissionPhases.Completion,
        MissionPhases.Failure,
        MissionPhases.Cleanup,
        MissionPhases.Recovery,
    ];

    private static readonly HashSet<string> WeatherDispositions =
    [
        MissionWeatherDispositions.Allowed,
        MissionWeatherDispositions.Adapted,
        MissionWeatherDispositions.Delayed,
        MissionWeatherDispositions.Blocked,
    ];

    private static readonly HashSet<string> RetryStrategies =
    [
        MissionRetryStrategies.Restart,
        MissionRetryStrategies.LastCheckpoint,
        MissionRetryStrategies.NoRetry,
    ];

    private static readonly IReadOnlyDictionary<string, MissionLifecycleRetryPolicy> DefaultRetryPolicies =
        new ReadOnlyDictionary<string, MissionLifecycleRetryPolicy>(
            new Dictionary<string, MissionLifecycleRetryPolicy>(StringComparer.Ordinal)
            {
                ["TAXI"] = new(MissionRetryStrategies.Restart, 3),
                ["COURIER"] = new(MissionRetryStrategies.Restart, 3),
                ["DELIVERY"] = new(MissionRetryStrategies.Restart, 3),
                ["RACE"] = new(MissionRetryStrategies.LastCheckpoint, 3),
                ["SABOTAGE"] = new(MissionRetryStrategies.LastCheckpoint, 3),
                ["SURVIVAL"] = new(MissionRetryStrategies.Restart, 2),
            });

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private readonly IReadOnlyDictionary<string, MissionDefinition> missions;
    private readonly CityConditionService? conditionService;
    private readonly MissionOutcomeService? outcomeService;
    private readonly Func<string?> weatherProvider;
    private readonly IReadOnlyDictionary<string, MissionWeatherPolicyDefinition> weatherPolicies;
    private readonly List<Action<MissionLifecycleEvent>> listeners = [];
    private MissionLifecycleState state = CreateInitialState();

    public MissionLifecycleController(
        IReadOnlyList<MissionDefinition> missions,
        CityConditionService? conditionService = null,
        MissionOutcomeService? outcomeService = null,
        Func<string?>? weatherProvider = null,
        IReadOnlyDictionary<string, MissionWeatherPolicyDefinition>? weatherPolicies = null)
    {
        ArgumentNullException.ThrowIfNull(missions);
        if (missions.Count == 0) throw new ArgumentException("MissionLifecycleController requires missions.", nameof(missions));

        var byId = new Dictionary<string, MissionDefinition>(StringComparer.Ordinal);
        foreach (MissionDefinition mission in missions)
        {
            string id = RequireText(mission.Id, "mission.id");
            if (!byId.TryAdd(id, mission)) throw new InvalidOperationException("Mission lifecycle mission IDs must be unique.");
        }

        this.missions = new ReadOnlyDictionary<string, MissionDefinition>(byId);
        this.conditionService = conditionService;
        this.outcomeService = outcomeService;
        this.weatherProvider = weatherProvider ?? (() => "clear");
        this.weatherPolicies = weatherPolicies ?? GameContentRegistry.LoadProduction().MissionWeatherPolicies;
    }

    public string Phase => state.Phase;

    public bool IsMissionCritical => MissionCriticalPhases.Contains(state.Phase);

    public bool HasActiveRun => state.Run is not null;

    public MissionDefinition? CurrentMission =>
        state.SelectedMissionId is null ? null : missions.GetValueOrDefault(state.SelectedMissionId);

    public MissionLifecycleState Snapshot() => state;

    public MissionLifecycleProgress ProgressSnapshot() => state.Progress;

    public MissionAvailability EvaluateAvailability(string missionId, string? weatherMode = null)
    {
        if (!missions.TryGetValue(missionId, out MissionDefinition? mission))
        {
            return new MissionAvailability(
                missionId,
                false,
                MissionAvailabilityStatuses.Blocked,
                Array.AsReadOnly(["Mission data is unavailable."]),
                Array.Empty<MissionPrerequisiteResult>(),
                null);
        }

        return EvaluateAvailability(mission, weatherMode);
    }

    public MissionAvailability EvaluateAvailability(MissionDefinition mission, string? weatherMode = null)
    {
        ArgumentNullException.ThrowIfNull(mission);
        string? missionId = mission.Id;
        if (missionId is null || !missions.ContainsKey(missionId))
        {
            return new MissionAvailability(
                missionId,
                false,
                MissionAvailabilityStatuses.Blocked,
                Array.AsReadOnly(["Mission data is unavailable."]),
                Array.Empty<MissionPrerequisiteResult>(),
                null);
        }

        MissionPrerequisiteResult[] prerequisites = (mission.Prerequisites ?? Array.Empty<MissionPrerequisite>())
            .Select(EvaluatePrerequisite)
            .ToArray();
        var failed = prerequisites.Where(result => !result.Passed).ToList();

        OutcomeFollowUpState? followUp = outcomeService?.Snapshot().State.FollowUpMissions.GetValueOrDefault(missionId);
        if (followUp is not null && followUp.Status is FollowUpStatuses.Locked or FollowUpStatuses.Failed or FollowUpStatuses.Expired)
        {
            failed.Add(new MissionPrerequisiteResult(
                false,
                $"Mission status is {followUp.Status.ToLowerInvariant()}.",
                new MissionPrerequisite { Type = MissionPrerequisiteTypes.FollowUpStatus }));
        }

        if (mission.Repeatable == false && state.Progress.CompletedMissionIds.Contains(missionId, StringComparer.Ordinal))
        {
            failed.Add(new MissionPrerequisiteResult(
                false,
                "This mission has already been completed.",
                new MissionPrerequisite { Type = MissionPrerequisiteTypes.MissionCompleted }));
        }

        MissionWeatherDecision weather = EvaluateMissionWeather(
            mission,
            weatherMode ?? weatherProvider() ?? "clear",
            weatherPolicies);
        var reasons = failed.Select(result => result.Reason).ToList();
        string status = MissionAvailabilityStatuses.Available;
        if (failed.Count > 0)
        {
            status = MissionAvailabilityStatuses.Locked;
        }
        else if (weather.Delayed)
        {
            status = MissionAvailabilityStatuses.Delayed;
            reasons.Add(weather.Reason);
        }
        else if (!weather.Allowed)
        {
            status = MissionAvailabilityStatuses.Blocked;
            reasons.Add(weather.Reason);
        }

        return new MissionAvailability(
            missionId,
            status == MissionAvailabilityStatuses.Available,
            status,
            Array.AsReadOnly(reasons.ToArray()),
            Array.AsReadOnly(prerequisites),
            weather);
    }

    public MissionLifecycleState Prepare(string missionId, string? weatherMode = null)
    {
        RequirePhase(MissionPhases.Idle);
        MissionAvailability availability = EvaluateAvailability(missionId, weatherMode);
        if (!availability.Available)
        {
            throw new MissionLifecycleException(
                availability.Reasons.FirstOrDefault() ?? "Mission is unavailable.",
                $"MISSION_{availability.Status}",
                Detail(availability));
        }

        Commit(state with { Phase = MissionPhases.Preparation, SelectedMissionId = missionId }, Detail(availability));
        return Snapshot();
    }

    public MissionLifecycleState BeginBriefing()
    {
        RequirePhase(MissionPhases.Preparation);
        Commit(state with { Phase = MissionPhases.Briefing });
        return Snapshot();
    }

    public bool AbandonBriefing()
    {
        if (Phase is not (MissionPhases.Preparation or MissionPhases.Briefing)) return false;
        ResetToIdle(Detail(new { reason = "briefing-abandoned" }));
        return true;
    }

    public MissionLifecycleState Accept(double baseTimeLimit, double baseReward, JsonElement? choice = null)
    {
        RequirePhase(MissionPhases.Briefing);
        if (!double.IsFinite(baseTimeLimit) || !double.IsFinite(baseReward) || baseTimeLimit <= 0 || baseReward < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(baseTimeLimit), "Mission baseTimeLimit must be positive and baseReward cannot be negative.");
        }

        MissionDefinition mission = CurrentMission!;
        MissionAvailability availability = EvaluateAvailability(mission);
        if (!availability.Available)
        {
            throw new MissionLifecycleException(
                availability.Reasons[0],
                $"MISSION_{availability.Status}",
                Detail(availability));
        }

        var runCounts = state.Progress.RunCounts.ToDictionary(item => item.MissionId, item => item.Count, StringComparer.Ordinal);
        int runNumber = runCounts.GetValueOrDefault(mission.Id!) + 1;
        runCounts[mission.Id!] = runNumber;
        MissionLifecycleProgress progress = state.Progress with
        {
            RunCounts = Array.AsReadOnly(runCounts.Select(pair => new MissionRunCount(pair.Key, pair.Value)).ToArray()),
        };
        MissionWeatherDecision weather = availability.Weather!;
        var run = new MissionLifecycleRun
        {
            RunId = $"{mission.Id}:run-{runNumber}",
            MissionId = mission.Id!,
            Objective = ObjectiveOf(mission),
            RunNumber = runNumber,
            Attempt = 1,
            RetryPolicy = NormalizeRetryPolicy(mission),
            Weather = weather,
            Choice = choice?.Clone(),
            InitialTimeLimit = baseTimeLimit * weather.TimeLimitMultiplier,
            BaseReward = Math.Floor((baseReward * weather.RewardMultiplier) + 0.5),
            Checkpoint = null,
            Resolution = null,
            TransactionId = null,
            Receipt = null,
            CleanupError = null,
        };

        Commit(state with { Phase = MissionPhases.Approach, Progress = progress, Run = run });
        return Snapshot();
    }

    public MissionLifecycleState BeginExecution()
    {
        RequirePhase(MissionPhases.Approach);
        Commit(state with { Phase = MissionPhases.Active });
        return Snapshot();
    }

    public MissionLifecycleState RecordCheckpoint(string checkpointId, JsonElement? payload = null)
    {
        RequirePhase(MissionPhases.Active);
        string id = RequireText(checkpointId, nameof(checkpointId));
        int sequence = (state.Run!.Checkpoint?.Sequence ?? 0) + 1;
        MissionCheckpoint checkpoint = new(id, sequence, (payload ?? EmptyObject()).Clone());
        Commit(
            state with { Phase = MissionPhases.Checkpoint, Run = state.Run with { Checkpoint = checkpoint } },
            Detail(new { checkpoint }));
        return Snapshot();
    }

    public MissionLifecycleState ResumeFromCheckpoint()
    {
        RequirePhase(MissionPhases.Checkpoint);
        Commit(state with { Phase = MissionPhases.Active });
        return Snapshot();
    }

    public MissionLifecycleState ResolveSuccess(double? payout = null, string? summary = null)
    {
        if (payout is not null && (!double.IsFinite(payout.Value) || payout < 0))
        {
            throw new ArgumentOutOfRangeException(nameof(payout), "Mission payout cannot be negative.");
        }
        return Resolve(new MissionResolution("SUCCESS", payout, summary), MissionPhases.Completion);
    }

    public MissionLifecycleState ResolveFailure(string reason, string? summary = null)
    {
        string normalizedReason = RequireText(reason, nameof(reason));
        return Resolve(new MissionResolution("FAILURE", Summary: summary, Reason: normalizedReason), MissionPhases.Failure);
    }

    public MissionLifecycleState BeginCleanup()
    {
        if (Phase is not (MissionPhases.Completion or MissionPhases.Failure))
        {
            Reject($"Cannot begin cleanup from {Phase}", "INVALID_MISSION_PHASE");
        }

        MissionLifecycleRun run = state.Run!;
        string transactionId = $"mission:{run.RunId}:attempt-{run.Attempt}:{run.Resolution!.Outcome}";
        Commit(state with
        {
            Phase = MissionPhases.Cleanup,
            Run = run with { TransactionId = transactionId, CleanupError = null },
        });
        return Snapshot();
    }

    public MissionOutcomeTransaction CreateOutcomeTransaction(
        IReadOnlyList<OutcomeCommand>? commands = null,
        string? title = null,
        string? description = null)
    {
        RequirePhase(MissionPhases.Cleanup);
        MissionDefinition mission = CurrentMission!;
        MissionLifecycleRun run = state.Run!;
        double payout = run.Resolution!.Outcome == "SUCCESS"
            ? run.Resolution.Payout ?? run.BaseReward
            : 0;
        IReadOnlyList<OutcomeCommand> normalizedCommands = commands is { Count: > 0 }
            ? Array.AsReadOnly(commands.ToArray())
            : Array.AsReadOnly<OutcomeCommand>(
            [
                new CapitalAdjustedCommand(
                    payout,
                    Reason: run.Resolution.Outcome == "SUCCESS"
                        ? $"{mission.Title} paid {payout.ToString("N0", CultureInfo.GetCultureInfo("en-US"))} Capital."
                        : $"{mission.Title} ended without a Capital reward."),
            ]);
        var source = new OutcomeSource(
            OutcomeSourceKinds.Mission,
            mission.Id!,
            run.Resolution.Outcome,
            run.RunId,
            Reason: run.Resolution.Reason);
        var summary = new OutcomeSummary(
            title ?? (run.Resolution.Outcome == "SUCCESS" ? $"{mission.Title} complete" : $"{mission.Title} failed"),
            description ?? run.Resolution.Summary ?? (run.Resolution.Outcome == "SUCCESS"
                ? "The mission completed and its city consequences were committed."
                : "The mission failed; recovery remains available under its retry policy."));
        return new MissionOutcomeTransaction(run.TransactionId!, source, normalizedCommands, summary);
    }

    public MissionLifecycleState CommitCleanup(MissionOutcomeReceipt receipt)
    {
        RequirePhase(MissionPhases.Cleanup);
        ArgumentNullException.ThrowIfNull(receipt);
        if (receipt.TransactionId != state.Run!.TransactionId)
        {
            Reject("Cleanup receipt does not match the active mission transaction", "INVALID_OUTCOME_RECEIPT");
        }

        MissionLifecycleProgress progress = state.Progress;
        if (state.Run.Resolution!.Outcome == "SUCCESS")
        {
            string[] completed = progress.CompletedMissionIds
                .Append(CurrentMission!.Id!)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            progress = progress with
            {
                CompletedMissionIds = Array.AsReadOnly(completed),
                ChronologyStep = Math.Max(progress.ChronologyStep, completed.Length),
            };
        }

        Commit(
            state with
            {
                Phase = MissionPhases.Result,
                Progress = progress,
                Run = state.Run with { Receipt = FreezeReceipt(receipt), CleanupError = null },
            },
            Detail(new { receipt }));
        return Snapshot();
    }

    public MissionLifecycleState RecordCleanupFailure(Exception? error)
    {
        RequirePhase(MissionPhases.Cleanup);
        string message = string.IsNullOrWhiteSpace(error?.Message) ? "Unknown mission cleanup failure" : error.Message;
        Commit(
            state with { Run = state.Run! with { CleanupError = message } },
            Detail(new { cleanupError = message }));
        return Snapshot();
    }

    public MissionRetryDecision GetRetryDecision()
    {
        if (Phase != MissionPhases.Result || state.Run?.Resolution?.Outcome != "FAILURE")
        {
            return new MissionRetryDecision(false, "Only a failed mission result can be retried.", null, null);
        }

        MissionLifecycleRun run = state.Run;
        if (run.RetryPolicy.Strategy == MissionRetryStrategies.NoRetry)
        {
            return new MissionRetryDecision(false, "This activity does not support retry.", run.RetryPolicy.Strategy, null);
        }
        if (run.Attempt >= run.RetryPolicy.MaxAttempts)
        {
            return new MissionRetryDecision(
                false,
                $"Retry limit reached ({run.RetryPolicy.MaxAttempts} attempts).",
                run.RetryPolicy.Strategy,
                null);
        }

        MissionCheckpoint? checkpoint = run.RetryPolicy.Strategy == MissionRetryStrategies.LastCheckpoint
            ? run.Checkpoint
            : null;
        return new MissionRetryDecision(
            true,
            checkpoint is null ? "Restart from mission approach." : $"Retry from {checkpoint.Id}.",
            run.RetryPolicy.Strategy,
            checkpoint,
            run.Attempt + 1,
            run.RetryPolicy.MaxAttempts - run.Attempt);
    }

    public MissionRecoveryResult BeginRecovery(bool retry = false)
    {
        RequirePhase(MissionPhases.Result);
        MissionRetryDecision? decision = retry ? GetRetryDecision() : null;
        if (retry && !decision!.Allowed)
        {
            throw new MissionLifecycleException(
                decision.Reason,
                "MISSION_RETRY_UNAVAILABLE",
                Detail(decision));
        }

        MissionLifecycleRun run = state.Run!;
        if (retry)
        {
            run = run with
            {
                Attempt = decision!.NextAttempt!.Value,
                Resolution = null,
                TransactionId = null,
                Receipt = null,
                CleanupError = null,
            };
        }
        Commit(state with { Phase = MissionPhases.Recovery, Run = run }, Detail(new { retry, decision }));
        return new MissionRecoveryResult(Snapshot(), retry, decision);
    }

    public MissionLifecycleState FinishRecovery(bool retry = false)
    {
        RequirePhase(MissionPhases.Recovery);
        if (retry)
        {
            Commit(state with { Phase = MissionPhases.Approach });
        }
        else
        {
            ResetToIdle(Detail(new { reason = "result-acknowledged" }));
        }
        return Snapshot();
    }

    public MissionSaveDecision CanSave()
    {
        bool blocked = SaveBlockingPhases.Contains(Phase);
        return new MissionSaveDecision(
            !blocked,
            blocked ? "MISSION_COMMIT_IN_PROGRESS" : null,
            blocked ? $"Saving is deferred while mission {Phase.ToLowerInvariant()} is being committed." : null);
    }

    public MissionDialogueHistoryEntry RecordDialogueChoice(
        string missionId,
        string nodeId,
        string choice,
        string next)
    {
        var entry = new MissionDialogueHistoryEntry(
            RequireText(missionId, nameof(missionId)),
            RequireText(nodeId, nameof(nodeId)),
            RequireText(choice, nameof(choice)),
            RequireText(next, nameof(next)));
        MissionLifecycleProgress progress = state.Progress with
        {
            DialogueChoices = Array.AsReadOnly(state.Progress.DialogueChoices.Append(entry).ToArray()),
        };
        Touch(state with { Progress = progress }, "DIALOGUE_CHOICE_RECORDED", Detail(entry));
        return entry;
    }

    public MissionLifecycleState Serialize() => Snapshot();

    public MissionLifecycleState Restore(MissionLifecycleState value)
    {
        ArgumentNullException.ThrowIfNull(value);
        ValidateState(value, missions.Keys.ToArray());
        MissionLifecycleState restored = FreezeState(value);
        state = restored;
        Publish("RESTORED", null, null);
        return Snapshot();
    }

    public MissionLifecycleProgress RestoreProgress(MissionLifecycleProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);
        MissionLifecycleProgress normalized = NormalizeProgress(progress, missions.Keys.ToArray());
        Touch(state with { Progress = normalized }, "PROGRESS_RESTORED", null);
        return ProgressSnapshot();
    }

    public Func<bool> Subscribe(Action<MissionLifecycleEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent) listener(new MissionLifecycleEvent("SNAPSHOT", null, Snapshot()));
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public void Destroy() => listeners.Clear();

    public static MissionWeatherDecision EvaluateMissionWeather(
        MissionDefinition mission,
        string weatherMode,
        IReadOnlyDictionary<string, MissionWeatherPolicyDefinition> policies)
    {
        ArgumentNullException.ThrowIfNull(mission);
        ArgumentNullException.ThrowIfNull(policies);
        string policyId = RequireText(mission.WeatherPolicy, $"{mission.Id}.weatherPolicy");
        if (!policies.TryGetValue(policyId, out MissionWeatherPolicyDefinition? policy))
        {
            throw new ArgumentOutOfRangeException(nameof(mission), $"Unknown mission weather policy: {policyId}");
        }

        string mode = RequireText(string.IsNullOrWhiteSpace(weatherMode) ? "clear" : weatherMode, nameof(weatherMode))
            .ToLowerInvariant();
        NormalizedWeather fallback = NormalizeWeather(
            policy.DefaultDisposition ?? MissionWeatherDispositions.Allowed,
            policy.DefaultReason,
            policy.TimeLimitMultiplier ?? 1,
            policy.RewardMultiplier ?? 1);
        MissionWeatherModeDefinition? authoredMode = policy.Modes?.GetValueOrDefault(mode);
        NormalizedWeather normalized = authoredMode is null
            ? fallback
            : NormalizeWeather(
                authoredMode.Disposition ?? fallback.Disposition,
                authoredMode.Reason ?? fallback.Reason,
                authoredMode.TimeLimitMultiplier ?? fallback.TimeLimitMultiplier,
                authoredMode.RewardMultiplier ?? fallback.RewardMultiplier);
        string title = string.IsNullOrWhiteSpace(mission.Title) ? mission.Id ?? "Mission" : mission.Title;
        string reason = normalized.Reason ?? normalized.Disposition switch
        {
            MissionWeatherDispositions.Delayed => $"{title} is delayed until conditions improve.",
            MissionWeatherDispositions.Blocked => $"{title} cannot be attempted in {mode} weather.",
            MissionWeatherDispositions.Adapted => $"{title} is adapted for {mode} conditions.",
            _ => $"{title} allows {mode} conditions.",
        };
        return new MissionWeatherDecision(
            mode,
            normalized.Disposition,
            reason,
            normalized.TimeLimitMultiplier,
            normalized.RewardMultiplier,
            normalized.Disposition is MissionWeatherDispositions.Allowed or MissionWeatherDispositions.Adapted,
            normalized.Disposition == MissionWeatherDispositions.Delayed);
    }

    public static bool ValidateState(
        MissionLifecycleState value,
        IReadOnlyCollection<string>? knownMissionIds = null)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (value.Version != StateVersion) throw new ArgumentOutOfRangeException(nameof(value), $"Unsupported mission lifecycle version: {value.Version}");
        if (value.Revision < 0) throw new ArgumentOutOfRangeException(nameof(value), "Mission lifecycle revision must be non-negative.");
        if (!PhaseValues.Contains(value.Phase)) throw new ArgumentOutOfRangeException(nameof(value), $"Unknown mission lifecycle phase: {value.Phase}");
        NormalizeProgress(value.Progress, knownMissionIds);

        if (value.Phase == MissionPhases.Idle)
        {
            if (value.SelectedMissionId is not null || value.Run is not null)
            {
                throw new InvalidOperationException("Idle mission lifecycle cannot retain a selection or run.");
            }
            return true;
        }

        string missionId = RequireText(value.SelectedMissionId, "mission lifecycle selectedMissionId");
        if (knownMissionIds is not null && !knownMissionIds.Contains(missionId))
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"Mission lifecycle references unknown mission {missionId}");
        }
        if (value.Phase is MissionPhases.Preparation or MissionPhases.Briefing)
        {
            if (value.Run is not null) throw new InvalidOperationException($"{value.Phase} cannot retain an accepted mission run.");
            return true;
        }

        MissionLifecycleRun run = value.Run ?? throw new InvalidOperationException("Mission lifecycle run is required.");
        if (run.MissionId != missionId) throw new InvalidOperationException("Mission lifecycle run and selection IDs must match.");
        RequireText(run.RunId, "mission lifecycle run.runId");
        RequireText(run.Objective, "mission lifecycle run.objective");
        if (run.RunNumber < 1 || run.Attempt < 1) throw new ArgumentOutOfRangeException(nameof(value), "Mission run number and attempt must be positive.");
        ValidateRetryPolicy(run.RetryPolicy);
        ValidateWeather(run.Weather);
        if (!double.IsFinite(run.InitialTimeLimit) || run.InitialTimeLimit <= 0 ||
            !double.IsFinite(run.BaseReward) || run.BaseReward < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Mission run time and reward are invalid.");
        }
        if (run.Checkpoint is not null)
        {
            RequireText(run.Checkpoint.Id, "mission lifecycle checkpoint.id");
            if (run.Checkpoint.Sequence < 1) throw new ArgumentOutOfRangeException(nameof(value), "Mission checkpoint sequence must be positive.");
        }
        return true;
    }

    private MissionPrerequisiteResult EvaluatePrerequisite(MissionPrerequisite requirement)
    {
        ArgumentNullException.ThrowIfNull(requirement);
        string type = RequireText(requirement.Type, "mission prerequisite.type").ToUpperInvariant();
        bool passed;
        string? reason = requirement.Reason;
        switch (type)
        {
            case MissionPrerequisiteTypes.MissionCompleted:
                {
                    string missionId = RequireText(requirement.MissionId, "mission prerequisite.missionId");
                    passed = state.Progress.CompletedMissionIds.Contains(missionId, StringComparer.Ordinal);
                    reason ??= $"Complete {missions.GetValueOrDefault(missionId)?.Title ?? missionId} first.";
                    break;
                }
            case MissionPrerequisiteTypes.FollowUpStatus:
                {
                    string missionId = RequireText(requirement.MissionId, "mission prerequisite.missionId");
                    string expected = RequireText(requirement.Status ?? FollowUpStatuses.Available, "mission prerequisite.status")
                        .ToUpperInvariant();
                    string? actual = outcomeService?.Snapshot().State.FollowUpMissions.GetValueOrDefault(missionId)?.Status;
                    passed = actual == expected;
                    reason ??= $"{missions.GetValueOrDefault(missionId)?.Title ?? missionId} must be {expected.ToLowerInvariant()}.";
                    break;
                }
            case MissionPrerequisiteTypes.CityCondition:
                {
                    if (conditionService is null)
                    {
                        passed = false;
                        reason ??= "Required city conditions cannot currently be evaluated.";
                        break;
                    }
                    if (requirement.Requirement is null)
                    {
                        throw new ArgumentException("CITY_CONDITION prerequisite requires a requirement.", nameof(requirement));
                    }
                    CityConditionRequirement condition = requirement.Requirement.Value.Deserialize<CityConditionRequirement>(JsonOptions)
                        ?? throw new ArgumentException("CITY_CONDITION prerequisite is invalid.", nameof(requirement));
                    passed = conditionService.Evaluate(condition).Passed;
                    reason ??= "Required city conditions are not met.";
                    break;
                }
            default:
                throw new ArgumentOutOfRangeException(nameof(requirement), $"Unsupported mission prerequisite type: {type}");
        }

        return new MissionPrerequisiteResult(passed, reason, FreezePrerequisite(requirement));
    }

    private MissionLifecycleState Resolve(MissionResolution resolution, string phase)
    {
        RequirePhase(MissionPhases.Active);
        Commit(
            state with { Phase = phase, Run = state.Run! with { Resolution = resolution } },
            Detail(new { resolution }));
        return Snapshot();
    }

    private static MissionLifecycleState CreateInitialState() => new()
    {
        Revision = 0,
        Phase = MissionPhases.Idle,
        SelectedMissionId = null,
        Run = null,
        Progress = new MissionLifecycleProgress
        {
            CompletedMissionIds = Array.Empty<string>(),
            DialogueChoices = Array.Empty<MissionDialogueHistoryEntry>(),
            ChronologyStep = 0,
            RunCounts = Array.Empty<MissionRunCount>(),
        },
    };

    private static string ObjectiveOf(MissionDefinition mission) =>
        string.IsNullOrWhiteSpace(mission.MissionType)
            ? string.IsNullOrWhiteSpace(mission.ObjectiveType) ? "DELIVERY" : mission.ObjectiveType
            : mission.MissionType;

    private static MissionLifecycleRetryPolicy NormalizeRetryPolicy(MissionDefinition mission)
    {
        string objective = ObjectiveOf(mission).ToUpperInvariant();
        MissionLifecycleRetryPolicy fallback = DefaultRetryPolicies.GetValueOrDefault(objective)
            ?? DefaultRetryPolicies["DELIVERY"];
        string strategy = (mission.RetryPolicy?.Strategy ?? fallback.Strategy).ToUpperInvariant();
        double authoredMaxAttempts = mission.RetryPolicy is null || double.IsNaN(mission.RetryPolicy.MaxAttempts)
            ? fallback.MaxAttempts
            : mission.RetryPolicy.MaxAttempts;
        if (!double.IsFinite(authoredMaxAttempts) || authoredMaxAttempts != Math.Truncate(authoredMaxAttempts))
        {
            throw new ArgumentOutOfRangeException(nameof(mission), "Retry maxAttempts must be a positive integer.");
        }
        int maxAttempts = checked((int)authoredMaxAttempts);
        var policy = new MissionLifecycleRetryPolicy(strategy, maxAttempts);
        ValidateRetryPolicy(policy);
        return policy;
    }

    private static void ValidateRetryPolicy(MissionLifecycleRetryPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        if (!RetryStrategies.Contains(policy.Strategy))
        {
            throw new ArgumentOutOfRangeException(nameof(policy), $"Unsupported retry strategy: {policy.Strategy}");
        }
        if (policy.MaxAttempts < 1) throw new ArgumentOutOfRangeException(nameof(policy), "Retry maxAttempts must be positive.");
    }

    private static NormalizedWeather NormalizeWeather(
        string disposition,
        string? reason,
        double timeLimitMultiplier,
        double rewardMultiplier)
    {
        string normalizedDisposition = RequireText(disposition, nameof(disposition)).ToUpperInvariant();
        if (!WeatherDispositions.Contains(normalizedDisposition))
        {
            throw new ArgumentOutOfRangeException(nameof(disposition), $"Unsupported mission weather disposition: {normalizedDisposition}");
        }
        if (!double.IsFinite(timeLimitMultiplier) || !double.IsFinite(rewardMultiplier) ||
            timeLimitMultiplier <= 0 || rewardMultiplier < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(timeLimitMultiplier), "Mission weather multipliers must be positive (reward may be zero).");
        }
        return new NormalizedWeather(
            normalizedDisposition,
            string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
            timeLimitMultiplier,
            rewardMultiplier);
    }

    private static void ValidateWeather(MissionWeatherDecision weather)
    {
        ArgumentNullException.ThrowIfNull(weather);
        NormalizeWeather(weather.Disposition, weather.Reason, weather.TimeLimitMultiplier, weather.RewardMultiplier);
        RequireText(weather.Mode, "mission weather.mode");
    }

    private static MissionLifecycleProgress NormalizeProgress(
        MissionLifecycleProgress progress,
        IReadOnlyCollection<string>? knownMissionIds = null)
    {
        ArgumentNullException.ThrowIfNull(progress);
        if (progress.ChronologyStep < 0) throw new ArgumentOutOfRangeException(nameof(progress), "Mission chronologyStep must be non-negative.");
        string[] completed = progress.CompletedMissionIds
            .Select(id => RequireText(id, "completed mission ID"))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (knownMissionIds is not null)
        {
            string? unknown = completed.FirstOrDefault(id => !knownMissionIds.Contains(id));
            if (unknown is not null) throw new ArgumentOutOfRangeException(nameof(progress), $"Mission lifecycle references unknown completed mission {unknown}");
        }
        MissionRunCount[] counts = progress.RunCounts.Select(item =>
        {
            string id = RequireText(item.MissionId, "run count mission ID");
            if (item.Count < 0) throw new ArgumentOutOfRangeException(nameof(progress), "Mission run count must be non-negative.");
            return new MissionRunCount(id, item.Count);
        }).ToArray();
        MissionDialogueHistoryEntry[] dialogue = progress.DialogueChoices.Select(entry => new MissionDialogueHistoryEntry(
            RequireText(entry.MissionId, "dialogue missionId"),
            RequireText(entry.NodeId, "dialogue nodeId"),
            RequireText(entry.Choice, "dialogue choice"),
            RequireText(entry.Next, "dialogue next"))).ToArray();
        return new MissionLifecycleProgress
        {
            CompletedMissionIds = Array.AsReadOnly(completed),
            DialogueChoices = Array.AsReadOnly(dialogue),
            ChronologyStep = progress.ChronologyStep,
            RunCounts = Array.AsReadOnly(counts),
        };
    }

    private static MissionLifecycleState FreezeState(MissionLifecycleState value)
    {
        MissionLifecycleRun? run = value.Run is null ? null : value.Run with
        {
            Choice = value.Run.Choice?.Clone(),
            Checkpoint = value.Run.Checkpoint is null
                ? null
                : value.Run.Checkpoint with { Payload = value.Run.Checkpoint.Payload.Clone() },
            Receipt = value.Run.Receipt is null ? null : FreezeReceipt(value.Run.Receipt),
        };
        return value with { Progress = NormalizeProgress(value.Progress), Run = run };
    }

    private static MissionOutcomeReceipt FreezeReceipt(MissionOutcomeReceipt receipt) => receipt with
    {
        Commands = Array.AsReadOnly(receipt.Commands.ToArray()),
        Effects = Array.AsReadOnly(receipt.Effects.Select(effect => effect with
        {
            Before = effect.Before?.Clone(),
            After = effect.After?.Clone(),
        }).ToArray()),
    };

    private static MissionPrerequisite FreezePrerequisite(MissionPrerequisite requirement) => requirement with
    {
        Requirement = requirement.Requirement?.Clone(),
    };

    private void RequirePhase(params string[] allowed)
    {
        if (!allowed.Contains(Phase, StringComparer.Ordinal))
        {
            Reject($"Mission phase {Phase} is invalid; expected {string.Join(" or ", allowed)}", "INVALID_MISSION_PHASE");
        }
    }

    private void Reject(string message, string code) =>
        throw new MissionLifecycleException(message, code, Detail(new { phase = Phase }));

    private void ResetToIdle(JsonElement? detail)
    {
        string previousPhase = state.Phase;
        state = CreateInitialState() with
        {
            Revision = state.Revision + 1,
            Progress = state.Progress,
        };
        Publish("PHASE_CHANGED", previousPhase, detail);
    }

    private void Commit(MissionLifecycleState next, JsonElement? detail = null)
    {
        string previousPhase = state.Phase;
        state = FreezeState(next with { Revision = state.Revision + 1 });
        Publish("PHASE_CHANGED", previousPhase, detail);
    }

    private void Touch(MissionLifecycleState next, string type, JsonElement? detail)
    {
        state = FreezeState(next with { Revision = state.Revision + 1 });
        Publish(type, null, detail);
    }

    private void Publish(string type, string? previousPhase, JsonElement? detail)
    {
        var lifecycleEvent = new MissionLifecycleEvent(type, previousPhase, Snapshot(), detail?.Clone());
        foreach (Action<MissionLifecycleEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(lifecycleEvent);
            }
            catch
            {
                // Observers cannot interfere with the lifecycle authority.
            }
        }
    }

    private static JsonElement Detail<T>(T value) => JsonSerializer.SerializeToElement(value, JsonOptions);

    private static JsonElement EmptyObject() => JsonSerializer.SerializeToElement(new { });

    private static string RequireText(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} must be a non-empty string.", name);
        return value.Trim();
    }

    private sealed record NormalizedWeather(
        string Disposition,
        string? Reason,
        double TimeLimitMultiplier,
        double RewardMultiplier);
}

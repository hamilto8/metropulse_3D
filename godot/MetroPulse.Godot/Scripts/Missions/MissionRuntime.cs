using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Missions;

/// <summary>Single live session adapter for mission domain, world, interaction, pause, cleanup, and presentation.</summary>
public partial class MissionRuntime : Node
{
    public const int MissionPhysicsPriority = -790;
    private GameContentRegistry? content;
    private SettingsStore? settings;
    private PlayerControlRuntime? playerControl;
    private GodotSessionRuntimeHost? runtime;
    private LivingTrafficRuntime? traffic;
    private CityServicesRuntime? services;
    private RuntimeInputHost? input;
    private InteractionService? interactions;
    private MissionInteractionProvider? interactionProvider;
    private Func<bool>? unregisterInteractionProvider;
    private Func<bool>? unsubscribeInteractions;
    private Func<bool>? unregisterGameplayTick;
    private PauseHold? dialoguePause;

    public bool Initialized { get; private set; }

    public MissionRegistry Registry { get; private set; } = null!;

    public CityConditionService Conditions { get; private set; } = null!;

    public MissionLifecycleController Lifecycle { get; private set; } = null!;

    public MissionExecutionModel Execution { get; private set; } = null!;

    public MissionDialogueModel Dialogue { get; private set; } = null!;

    public MissionMarkerPresenter Markers { get; private set; } = null!;

    public MissionPresentation Presentation { get; private set; } = null!;

    public MissionResultView? LatestResult { get; private set; }

    public int CleanupCommitCount { get; private set; }

    public int CompletedResultCount { get; private set; }

    public InteractionEligibility InteractionReleaseEligibility() => interactionProvider?.ControlledEntityReleaseEligibility()
        ?? new InteractionEligibility(true);

    public MissionSaveDecision CanSave() => Lifecycle.CanSave();

    public MissionRuntimeState CaptureState()
    {
        EnsureInitialized();
        var state = new MissionRuntimeState
        {
            Lifecycle = Lifecycle.Serialize(),
            Execution = Execution.Snapshot,
            ResultTransactionId = Lifecycle.Phase == MissionPhases.Result ? Lifecycle.Snapshot().Run?.TransactionId : null,
        };
        MissionRuntimeState.Validate(state, Registry);
        return state;
    }

    public void Initialize(
        GameContentRegistry contentRegistry,
        SettingsStore settingsAuthority,
        CityEconomyRuntime economy,
        CityServicesRuntime serviceRuntime,
        PlayerControlRuntime controlOwner,
        GodotSessionRuntimeHost runtimeOwner,
        RuntimeInputHost inputOwner,
        LivingTrafficRuntime trafficRuntime,
        InteractionService interactionService,
        WorldEnvironmentController environment,
        MvpWorldGenerator world,
        Node3D effectRoot,
        Control hud,
        bool temporaryMayhemEnabled = false)
    {
        if (Initialized) throw new InvalidOperationException("Mission runtime is already initialized.");
        content = contentRegistry ?? throw new ArgumentNullException(nameof(contentRegistry));
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        ArgumentNullException.ThrowIfNull(economy);
        services = serviceRuntime ?? throw new ArgumentNullException(nameof(serviceRuntime));
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        traffic = trafficRuntime ?? throw new ArgumentNullException(nameof(trafficRuntime));
        interactions = interactionService ?? throw new ArgumentNullException(nameof(interactionService));
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(effectRoot);
        ArgumentNullException.ThrowIfNull(hud);

        Registry = content.Missions;
        Conditions = new CityConditionService(economy.Ledger, services.Outcomes);
        Lifecycle = new MissionLifecycleController(
            Registry.Definitions,
            Conditions,
            services.Outcomes,
            () => environment.Current?.WeatherMode ?? content.DefaultWeatherMode,
            content.MissionWeatherPolicies);
        Execution = new MissionExecutionModel(
            Registry,
            Lifecycle,
            content.EconomyBalance.Missions!.RewardScale,
            temporaryMayhemEnabled);
        Dialogue = new MissionDialogueModel(Registry, Lifecycle);
        Markers = new MissionMarkerPresenter { Name = "MissionMarkers" };
        effectRoot.AddChild(Markers);
        Markers.Initialize(world);
        Presentation = new MissionPresentation { Name = "MissionPresentation" };
        hud.AddChild(Presentation);
        Presentation.Initialize();
        interactionProvider = new MissionInteractionProvider(
            Registry,
            Lifecycle,
            Execution,
            CaptureControlledVehicle,
            OpenOffer,
            TrafficModifier);
        unregisterInteractionProvider = interactionProvider.Register(interactions);
        unsubscribeInteractions = interactions.Subscribe(snapshot =>
            Presentation.ApplyInteraction(snapshot, InteractionBindingLabel()));
        Presentation.DialogueChoiceRequested += ChooseDialogue;
        Presentation.DialogueConfirmRequested += ConfirmDialogue;
        Presentation.RetryRequested += OnRetryRequested;
        Presentation.ContinueRequested += AcknowledgeResult;

        runtime.SetMissionContextProvider(() => new TransitionContext(
            MissionActive: Lifecycle.HasActiveRun,
            MissionCritical: Lifecycle.IsMissionCritical,
            MissionState: Lifecycle.Phase));
        unregisterGameplayTick = runtime.Scheduler.RegisterTask(
            "missions.execution",
            SimulationStage.Gameplay,
            (delta, _) => AdvanceExecution(delta));
        ProcessPhysicsPriority = MissionPhysicsPriority;
        SetPhysicsProcess(true);
        Initialized = true;
        RefreshPresentation();
        _ = interactions.Refresh();
    }

    public bool OpenOffer(string missionId)
    {
        EnsureInitialized();
        if (Dialogue.Snapshot is not null || Lifecycle.Phase != MissionPhases.Idle) return false;
        MissionVehicleSnapshot? vehicle = CaptureControlledVehicle();
        if (vehicle is null) return false;
        try
        {
            Execution.BeginBriefing(missionId, vehicle, TrafficModifier(Registry.Get(missionId)!));
            MissionDialogueSnapshot dialogue = Dialogue.Open(missionId);
            dialoguePause = runtime!.Pause.Acquire(PauseReason.Dialogue, Name);
            runtime.SetDialogueOpen(true);
            Presentation.ShowDialogue(dialogue);
            RefreshPresentation();
            return true;
        }
        catch
        {
            _ = Dialogue.Close();
            CloseDialoguePause();
            RefreshPresentation();
            throw;
        }
    }

    public void ChooseDialogue(int index)
    {
        if (!Initialized || Dialogue.Snapshot is null) return;
        MissionDialogueDecision decision = Dialogue.Choose(index);
        if (decision.Snapshot is not null) Presentation.ShowDialogue(decision.Snapshot);
    }

    public void ConfirmDialogue()
    {
        if (!Initialized || Dialogue.Snapshot is null) return;
        MissionDialogueDecision decision = Dialogue.Snapshot.IsTerminal
            ? Dialogue.Confirm()
            : Dialogue.ChooseFocused();
        if (decision.Action == MissionDialogueActions.Navigated && decision.Snapshot is not null)
        {
            Presentation.ShowDialogue(decision.Snapshot);
            return;
        }
        if (decision.Action == MissionDialogueActions.StartMission)
        {
            MissionVehicleSnapshot vehicle = CaptureControlledVehicle()
                ?? throw new MissionLifecycleException("The accepted mission vehicle is unavailable.", "MISSION_VEHICLE_UNAVAILABLE");
            _ = Execution.Accept(
                vehicle,
                decision.Acceptance,
                TrafficModifier(Registry.Get(Dialogue.Snapshot.MissionId)!),
                settings!.Get("timerLeniency", 1d));
            _ = Dialogue.CompleteAccepted();
        }
        if (decision.Action is MissionDialogueActions.StartMission or MissionDialogueActions.Declined or MissionDialogueActions.Closed)
        {
            Presentation.HideDialogue();
            CloseDialoguePause();
            RefreshPresentation();
        }
    }

    public void CloseDialogue()
    {
        if (!Initialized || Dialogue.Snapshot is null) return;
        _ = Dialogue.Close();
        Presentation.HideDialogue();
        CloseDialoguePause();
        RefreshPresentation();
    }

    public MissionExecutionUpdate? AdvanceExecution(double delta)
    {
        if (!Initialized || Lifecycle.Phase is not (MissionPhases.Active or MissionPhases.Checkpoint)) return null;
        MissionExecutionUpdate update = Execution.Advance(
            delta,
            CaptureControlledVehicle(),
            traffic?.Productivity?.Snapshot().Network.Congestion ?? 0);
        RefreshPresentation();
        if (update.Signal is MissionExecutionSignals.Completed or MissionExecutionSignals.Failed)
        {
            CommitResult();
        }
        return update;
    }

    public bool CommitResult()
    {
        EnsureInitialized();
        if (Lifecycle.Phase is not (MissionPhases.Completion or MissionPhases.Failure)) return false;
        try
        {
            Lifecycle.BeginCleanup();
            MissionOutcomeTransaction transaction = Lifecycle.CreateOutcomeTransaction();
            MissionOutcomeReceipt receipt = services!.Outcomes.Apply(transaction);
            Lifecycle.CommitCleanup(receipt);
            CleanupCommitCount++;
            CompletedResultCount++;
            MissionOutcomeExplanation explanation = services.Outcomes.Explain(receipt.TransactionId)
                ?? throw new InvalidOperationException("The committed mission explanation is unavailable.");
            LatestResult = MissionResultViewModel.Build(
                explanation,
                Lifecycle.Snapshot(),
                Lifecycle.CurrentMission,
                Lifecycle.GetRetryDecision(),
                receipt.Sequence);
            PublishResultAlert(receipt);
            RefreshPresentation();
            Presentation.ShowResult(LatestResult);
            runtime!.TransitionTo(GameState.Result, new TransitionRequestOptions("mission-result-committed", Name));
            return true;
        }
        catch (Exception error)
        {
            if (Lifecycle.Phase == MissionPhases.Cleanup) Lifecycle.RecordCleanupFailure(error);
            throw;
        }
    }

    public void AcknowledgeResult()
    {
        if (!Initialized || Lifecycle.Phase != MissionPhases.Result) return;
        Lifecycle.BeginRecovery();
        Lifecycle.FinishRecovery();
        Execution.Clear();
        LatestResult = null;
        Presentation.HideResult();
        runtime!.TransitionTo(GameState.Management, new TransitionRequestOptions("mission-result-acknowledged", Name));
        RefreshPresentation();
    }

    public bool RetryResult()
    {
        EnsureInitialized();
        MissionRetryDecision decision = Lifecycle.GetRetryDecision();
        MissionExecutionState execution = Execution.Snapshot
            ?? throw new MissionLifecycleException("Mission retry execution state is unavailable.", "MISSION_RETRY_UNAVAILABLE");
        if (!decision.Allowed) return false;
        PlayerVehicleController vehicle = playerControl!.Vehicles.SingleOrDefault(candidate => candidate.StableId == execution.VehicleId)
            ?? throw new MissionLifecycleException("The saved mission vehicle is unavailable for retry.", "MISSION_VEHICLE_UNAVAILABLE");
        if (vehicle.TypeId != execution.VehicleType)
            throw new MissionLifecycleException("The saved mission vehicle type changed before retry.", "MISSION_VEHICLE_UNAVAILABLE");
        playerControl.PrepareRestoredVehicleControl(
            vehicle.StableId,
            vehicle.TypeId,
            vehicle.GlobalPosition,
            vehicle.Rotation.Y);
        runtime!.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("mission-retry-control", Name));
        MissionRecoveryResult recovery = Lifecycle.BeginRecovery(retry: true);
        _ = Execution.RecoverForRetry(
            CaptureControlledVehicle()
                ?? throw new MissionLifecycleException("Mission vehicle control was not reacquired.", "MISSION_VEHICLE_UNAVAILABLE"),
            recovery.Decision!);
        LatestResult = null;
        Presentation.HideResult();
        RefreshPresentation();
        return true;
    }

    public MissionRuntimeState RestoreState(MissionRuntimeState state)
    {
        EnsureInitialized();
        MissionRuntimeState.Validate(state, Registry);
        if (state.Lifecycle.Phase is MissionPhases.Active or MissionPhases.Checkpoint)
        {
            MissionVehicleSnapshot vehicle = CaptureControlledVehicle()
                ?? throw new InvalidDataException("Active mission restore requires the saved controlled vehicle first.");
            if (state.Execution is not { } execution
                || vehicle.StableId != execution.VehicleId
                || vehicle.TypeId != execution.VehicleType)
            {
                throw new InvalidDataException("Active mission restore did not reacquire the exact saved vehicle ID and type.");
            }
        }

        MissionOutcomeReceipt? resultReceipt = null;
        MissionOutcomeExplanation? resultExplanation = null;
        if (state.Lifecycle.Phase == MissionPhases.Result)
        {
            resultReceipt = services!.Outcomes.GetReceipt(state.ResultTransactionId!);
            resultExplanation = services.Outcomes.Explain(state.ResultTransactionId!);
            if (resultReceipt is null || resultExplanation is null)
                throw new InvalidDataException("RESULT restore requires its previously committed outcome receipt.");
        }

        Lifecycle.Restore(state.Lifecycle);
        if (state.Execution is not null) Execution.Restore(state.Execution);
        else Execution.Clear();
        LatestResult = resultReceipt is null
            ? null
            : MissionResultViewModel.Build(
                resultExplanation!,
                Lifecycle.Snapshot(),
                Lifecycle.CurrentMission,
                Lifecycle.GetRetryDecision(),
                resultReceipt.Sequence);
        RefreshPresentation();
        if (LatestResult is not null) Presentation.ShowResult(LatestResult);
        return CaptureState();
    }

    public void RefreshPresentation()
    {
        if (!Initialized && Markers is null) return;
        MissionVehicleSnapshot? vehicle = CaptureControlledVehicle();
        IReadOnlyList<MissionOfferMarker> offers = Lifecycle.Phase == MissionPhases.Idle
            ? Execution.GetOfferMarkers(vehicle, TrafficModifier)
            : Array.Empty<MissionOfferMarker>();
        Markers.ApplyOffers(offers);
        MissionExecutionState? execution = Execution.Snapshot;
        MissionWorldPoint? target = Lifecycle.Phase is MissionPhases.Active or MissionPhases.Checkpoint
            ? Execution.NavigationTarget
            : null;
        Markers.ApplyObjective(target is null ? null : execution?.MissionId, target);
        Presentation.ApplyMission(execution, execution is null ? null : Registry.Get(execution.MissionId), target);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        CloseDialoguePause();
        runtime?.SetMissionContextProvider(null);
        _ = unregisterGameplayTick?.Invoke();
        unregisterGameplayTick = null;
        _ = unsubscribeInteractions?.Invoke();
        unsubscribeInteractions = null;
        _ = unregisterInteractionProvider?.Invoke();
        unregisterInteractionProvider = null;
        Presentation.DialogueChoiceRequested -= ChooseDialogue;
        Presentation.DialogueConfirmRequested -= ConfirmDialogue;
        Presentation.RetryRequested -= OnRetryRequested;
        Presentation.ContinueRequested -= AcknowledgeResult;
        Presentation.Shutdown();
        Markers.Shutdown();
        if (GodotObject.IsInstanceValid(Presentation)) Presentation.Free();
        if (GodotObject.IsInstanceValid(Markers)) Markers.Free();
        Lifecycle.Destroy();
        interactionProvider = null;
        interactions = null;
        input = null;
        services = null;
        traffic = null;
        runtime = null;
        playerControl = null;
        settings = null;
        content = null;
        Initialized = false;
    }

    public override void _PhysicsProcess(double delta)
    {
        _ = delta;
        if (!Initialized || Dialogue.Snapshot is null || input is null) return;
        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        if (snapshot.Suspended) return;
        if (snapshot.JustPressed.Contains("BACK"))
        {
            CloseDialogue();
            return;
        }
        if (snapshot.JustPressed.Contains("NAVIGATE"))
        {
            Presentation.ShowDialogue(Dialogue.MoveFocus(1));
        }
        if (snapshot.JustPressed.Contains("CONFIRM")) ConfirmDialogue();
    }

    public override void _ExitTree() => Shutdown();

    private MissionVehicleSnapshot? CaptureControlledVehicle()
    {
        PlayerVehicleController? vehicle = playerControl?.ControlledVehicle;
        if (vehicle is null || playerControl?.ControlledKind != ControlKind.Vehicle) return null;
        return new MissionVehicleSnapshot(
            vehicle.StableId,
            vehicle.TypeId,
            vehicle.GlobalPosition.X,
            vehicle.GlobalPosition.Z,
            new Vector2(vehicle.LinearVelocity.X, vehicle.LinearVelocity.Z).Length(),
            vehicle.Controlled);
    }

    private MissionTrafficModifier TrafficModifier(MissionDefinition mission)
    {
        TrafficMissionImpact? impact = traffic?.Productivity?.GetMissionImpact(new TrafficMissionRequest(
            mission.MissionType,
            mission.ObjectiveType,
            mission.Pickup is null ? null : new TrafficPoint(mission.Pickup.X, mission.Pickup.Z),
            mission.Dropoff is null ? null : new TrafficPoint(mission.Dropoff.X, mission.Dropoff.Z)));
        return impact is null
            ? new MissionTrafficModifier()
            : new MissionTrafficModifier(
                impact.Available,
                impact.Available ? impact.Summary : impact.Reason,
                impact.RewardMultiplier,
                impact.TimeLimitMultiplier);
    }

    private string InteractionBindingLabel() => input?.LatestSnapshot.Prompts.GetValueOrDefault("INTERACT") ?? "Interact";

    private void CloseDialoguePause()
    {
        if (runtime is null) return;
        runtime.SetDialogueOpen(false);
        if (dialoguePause is not null) _ = runtime.Pause.Release(dialoguePause, Name);
        dialoguePause = null;
    }

    private void PublishResultAlert(MissionOutcomeReceipt receipt)
    {
        MissionDefinition mission = Lifecycle.CurrentMission!;
        MissionLocation location = mission.Dropoff ?? mission.Pickup!;
        bool success = Lifecycle.Snapshot().Run!.Resolution!.Outcome == "SUCCESS";
        _ = services!.Alerts.Publish(new AlertInput
        {
            DedupeKey = $"mission-outcome:{receipt.TransactionId}",
            Type = AlertTypes.Mission,
            Severity = success ? AlertSeverities.Success : AlertSeverities.Warning,
            Title = receipt.Summary.Title,
            Cause = receipt.Summary.Description,
            Location = new AlertLocation
            {
                Label = location.District ?? "Mission area",
                DistrictId = location.DistrictId,
                Position = new AlertPosition(location.X, 0, location.Z),
            },
            Duration = new AlertDuration { Kind = AlertDurationKinds.Persistent },
            Recommendation = success
                ? "Return to Management, review the committed changes, and choose the next district action."
                : "Review the debrief, retry from the available checkpoint, or return to Management to recover.",
            RelatedEntityIds = [mission.Id!, receipt.TransactionId],
            FocusAction = new AlertFocusAction
            {
                Type = AlertFocusActions.ManagementCamera,
                Position = new AlertPosition(location.X, 0, location.Z),
            },
        });
    }

    private void OnRetryRequested() => _ = RetryResult();

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Mission runtime is not initialized.");
    }
}

using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Services;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Services;

public sealed record CityServicesRuntimeState
{
    public int Version { get; init; } = 1;
    public required MissionOutcomeStateDocument Outcomes { get; init; }
    public required AlertStateDocument Alerts { get; init; }
}

/// <summary>Session owner for service readings, incident response, markers, interaction, and restore.</summary>
public partial class CityServicesRuntime : Node
{
    private Func<bool>? unregisterInteractionProvider;
    private PlayerControlRuntime? playerControl;
    private GodotSessionRuntimeHost? runtime;
    private InteractionService? interactions;
    private GameContentRegistry? content;
    private Func<bool>? missionCritical;
    private EconomyLedger? economy;

    public bool Initialized { get; private set; }

    public MissionOutcomeService Outcomes { get; private set; } = null!;

    public CityServiceModel Model { get; private set; } = null!;

    public IncidentResponseService Response { get; private set; } = null!;

    public AlertService Alerts { get; private set; } = null!;

    public EconomyAlertAdapter FiscalAlerts { get; private set; } = null!;

    public CityServiceMarkerPresenter Markers { get; private set; } = null!;

    public int CompletedStreetActions { get; private set; }

    public void Initialize(
        GameContentRegistry contentRegistry,
        CityEconomyRuntime economy,
        AlertService alerts,
        PlayerControlRuntime controlOwner,
        GodotSessionRuntimeHost runtimeOwner,
        InteractionService interactionService,
        MvpWorldGenerator world,
        Node3D effectRoot,
        Func<bool>? missionCriticalProvider = null)
    {
        if (Initialized) throw new InvalidOperationException("City services runtime is already initialized.");
        content = contentRegistry ?? throw new ArgumentNullException(nameof(contentRegistry));
        ArgumentNullException.ThrowIfNull(economy);
        this.economy = economy.Ledger;
        Alerts = alerts ?? throw new ArgumentNullException(nameof(alerts));
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        interactions = interactionService ?? throw new ArgumentNullException(nameof(interactionService));
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(effectRoot);
        missionCritical = missionCriticalProvider ?? (() => false);
        Outcomes = new MissionOutcomeService(economy.Ledger, content);
        Model = new CityServiceModel(economy.Ledger, Outcomes);
        Response = new IncidentResponseService(Outcomes, economy.Ledger, Alerts);
        FiscalAlerts = new EconomyAlertAdapter(economy.Ledger, Alerts);
        Markers = new CityServiceMarkerPresenter { Name = "CityServiceMarkers" };
        effectRoot.AddChild(Markers);
        Markers.Initialize(Model, world);
        unregisterInteractionProvider = interactions.RegisterProvider("city-service-work", PublishStreetWorkCandidates);
        Initialized = true;
    }

    public CityServicesRuntimeState CaptureState()
    {
        EnsureInitialized();
        return new CityServicesRuntimeState
        {
            Outcomes = Outcomes.Serialize(),
            Alerts = Alerts.Serialize(),
        };
    }

    public CityServiceSnapshot RestoreState(CityServicesRuntimeState state)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(state);
        if (state.Version != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(state), $"Unsupported city services state version: {state.Version}");
        }
        MissionOutcomeService.ValidateState(state.Outcomes, economy, content);
        AlertService.ValidateState(state.Alerts);
        CityServicesRuntimeState rollback = CaptureState();
        try
        {
            Outcomes.Restore(state.Outcomes);
            Alerts.Restore(state.Alerts);
            return Model.Snapshot();
        }
        catch
        {
            Outcomes.Restore(rollback.Outcomes);
            Alerts.Restore(rollback.Alerts);
            throw;
        }
    }

    public InteractionSnapshot RefreshInteractions()
    {
        EnsureInitialized();
        return interactions!.Refresh();
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unregisterInteractionProvider?.Invoke();
        unregisterInteractionProvider = null;
        FiscalAlerts.Dispose();
        Markers.Shutdown();
        if (GodotObject.IsInstanceValid(Markers)) Markers.Free();
        Model.Destroy();
        Outcomes.Destroy();
        playerControl = null;
        runtime = null;
        interactions = null;
        content = null;
        economy = null;
        missionCritical = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private IEnumerable<InteractionCandidateInput> PublishStreetWorkCandidates(
        IReadOnlyDictionary<string, object?> context)
    {
        _ = context;
        if (runtime?.StateMachine.State != GameState.StreetOnFoot
            || playerControl?.ControlledKind != ControlKind.Pedestrian
            || playerControl.Pedestrian is not { } pedestrian)
        {
            return Array.Empty<InteractionCandidateInput>();
        }
        bool missionAllowsWork = missionCritical?.Invoke() != true;
        return Response.GetWorkOrders()
            .Where(order => order.State.Position is not null
                && order.Status is not (RepairStatuses.Complete or RepairStatuses.Cancelled))
            .Select(order =>
            {
                OutcomePosition site = order.State.Position!;
                double distance = new Vector2(
                    pedestrian.GlobalPosition.X - (float)site.X,
                    pedestrian.GlobalPosition.Z - (float)site.Z).Length();
                bool near = distance <= order.State.InteractionRadius;
                bool allowed = near && order.Actionable && missionAllowsWork;
                string? failure = !missionAllowsWork
                    ? "Mission-critical work must be resolved first"
                    : !order.PrerequisiteMet
                        ? "Required cleanup must be completed first"
                        : order.Status is not (RepairStatuses.Scheduled or RepairStatuses.InProgress)
                            ? "Management must fund this service work first"
                            : !near ? "Move closer to the service work marker" : null;
                return new InteractionCandidateInput
                {
                    Id = $"service-work:{order.Id}",
                    Kind = "SERVICE_WORK",
                    Priority = InteractionPriorities.ServiceObjective,
                    Prompt = order.State.Label ?? $"Perform {order.WorkType.ToLowerInvariant()}",
                    AccessibilityLabel = $"{order.WorkType.ToLowerInvariant()} service objective",
                    Distance = distance,
                    Eligibility = new InteractionEligibility(allowed, failure),
                    FailureReason = failure,
                    Metadata = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["workOrderId"] = order.Id,
                        ["incidentId"] = order.IncidentId,
                        ["progress"] = order.Progress,
                        ["prerequisiteMet"] = order.PrerequisiteMet,
                    },
                    Action = _ => PerformStreetWork(order.Id),
                };
            })
            .Where(candidate => candidate.Distance <= 25)
            .ToArray();
    }

    private StreetWorkResult PerformStreetWork(string orderId)
    {
        StreetWorkResult result = Response.PerformStreetWork(orderId);
        CompletedStreetActions++;
        return result;
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("City services runtime is not initialized.");
    }

}

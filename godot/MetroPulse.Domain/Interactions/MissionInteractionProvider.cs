using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Interactions;

/// <summary>Publishes mission pickup and active-objective candidates into the shared interaction authority.</summary>
public sealed class MissionInteractionProvider
{
    public const string ProviderId = "missions";
    private readonly MissionRegistry registry;
    private readonly MissionLifecycleController lifecycle;
    private readonly MissionExecutionModel execution;
    private readonly Func<MissionVehicleSnapshot?> vehicleProvider;
    private readonly Func<MissionDefinition, MissionTrafficModifier> trafficProvider;
    private readonly Func<string, bool> openDetails;

    public MissionInteractionProvider(
        MissionRegistry missionRegistry,
        MissionLifecycleController lifecycleController,
        MissionExecutionModel executionModel,
        Func<MissionVehicleSnapshot?> controlledVehicleProvider,
        Func<string, bool> openMissionDetails,
        Func<MissionDefinition, MissionTrafficModifier>? missionTrafficProvider = null)
    {
        registry = missionRegistry ?? throw new ArgumentNullException(nameof(missionRegistry));
        lifecycle = lifecycleController ?? throw new ArgumentNullException(nameof(lifecycleController));
        execution = executionModel ?? throw new ArgumentNullException(nameof(executionModel));
        vehicleProvider = controlledVehicleProvider ?? throw new ArgumentNullException(nameof(controlledVehicleProvider));
        openDetails = openMissionDetails ?? throw new ArgumentNullException(nameof(openMissionDetails));
        trafficProvider = missionTrafficProvider ?? (_ => new MissionTrafficModifier());
    }

    public Func<bool> Register(InteractionService service)
    {
        ArgumentNullException.ThrowIfNull(service);
        return service.RegisterProvider(ProviderId, GetCandidates);
    }

    public InteractionEligibility ControlledEntityReleaseEligibility() => lifecycle.IsMissionCritical
        ? new InteractionEligibility(false, "Resolve the mission-critical objective before releasing control.")
        : new InteractionEligibility(true);

    public IEnumerable<InteractionCandidateInput> GetCandidates(IReadOnlyDictionary<string, object?> context)
    {
        _ = context;
        MissionVehicleSnapshot? vehicle = vehicleProvider();
        if (lifecycle.Phase == MissionPhases.Active
            && execution.Snapshot?.Objective == MissionObjectiveTypes.Sabotage)
        {
            MissionObjectiveActionDecision objective = execution.EvaluateObjectiveAction(vehicle);
            return
            [
                new InteractionCandidateInput
                {
                    Id = $"mission-objective:{execution.Snapshot.MissionId}",
                    Kind = "MISSION_OBJECTIVE",
                    Priority = InteractionPriorities.MissionObjective,
                    Prompt = objective.Prompt,
                    AccessibilityLabel = $"{objective.Prompt} for mission {execution.Snapshot.MissionId}",
                    Distance = objective.Distance,
                    Eligibility = new InteractionEligibility(objective.Allowed, objective.Reason),
                    FailureReason = objective.Reason,
                    Metadata = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["missionId"] = execution.Snapshot.MissionId,
                        ["objective"] = execution.Snapshot.Objective,
                    },
                    Action = _ => execution.BeginObjectiveHold(vehicleProvider()),
                },
            ];
        }
        if (lifecycle.Phase != MissionPhases.Idle) return Array.Empty<InteractionCandidateInput>();

        return execution.GetOfferMarkers(vehicle, trafficProvider)
            .Where(marker => marker.Distance < MissionExecutionModel.PickupRadius)
            .Select(marker =>
            {
                MissionDefinition mission = registry.Get(marker.MissionId)!;
                MissionOfferView offer = execution.BuildOffer(marker.MissionId, vehicle, trafficProvider(mission));
                return new InteractionCandidateInput
                {
                    Id = marker.Id,
                    Kind = "MISSION_PICKUP",
                    Priority = InteractionPriorities.MissionPickup,
                    Prompt = $"View mission details for {offer.ContactName}",
                    AccessibilityLabel = $"View mission details for {offer.ContactName}",
                    Distance = marker.Distance,
                    Eligibility = new InteractionEligibility(marker.Eligible, marker.IneligibleReason),
                    FailureReason = marker.IneligibleReason,
                    Metadata = new Dictionary<string, object?>(StringComparer.Ordinal)
                    {
                        ["missionId"] = marker.MissionId,
                        ["objective"] = offer.Objective,
                        ["requiredVehicleType"] = offer.RequiredVehicleType,
                        ["reward"] = offer.BaseReward,
                        ["timeLimit"] = offer.TimeLimit,
                    },
                    Action = _ => openDetails(marker.MissionId),
                };
            })
            .ToArray();
    }
}

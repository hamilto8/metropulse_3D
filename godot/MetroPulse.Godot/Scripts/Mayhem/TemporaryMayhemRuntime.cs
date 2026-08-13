using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Mayhem;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using MetroPulse.Domain.WorldEditing;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Effects;
using MetroPulse.Godot.Missions;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Mayhem;

/// <summary>
/// Feature-gated adapter that holds one open compensating transaction for the
/// complete temporary session. Stop and shutdown always roll it back.
/// </summary>
public partial class TemporaryMayhemRuntime : Node
{
    private const string SourcePrefix = "temporary-mayhem:";
    private readonly HashSet<string> affectedTargets = new(StringComparer.Ordinal);
    private readonly List<string> alertIds = [];
    private MvpWorldGenerator world = null!;
    private CityEconomyRuntime economy = null!;
    private LivingTrafficRuntime traffic = null!;
    private CityServicesRuntime services = null!;
    private MissionRuntime missions = null!;
    private SessionEffectRuntime effects = null!;
    private SessionAudioRuntime audio = null!;
    private PlayerInterface playerInterface = null!;
    private TemporaryMayhemModel model = null!;
    private WorldEditTransaction? transaction;
    private Func<bool>? unregisterTick;
    private int runSequence;

    public bool Initialized { get; private set; }

    public bool Active => model?.Active == true;

    public int ImpactCount { get; private set; }

    public int ChainReactionCount { get; private set; }

    public int PanicEventCount { get; private set; }

    public int BaselineColliderCount { get; private set; }

    public int BaselineBuildingCount { get; private set; }

    public int BaselineRoadClosureCount { get; private set; }

    public TemporaryMayhemControl Control { get; private set; } = null!;

    public TemporaryMayhemSnapshot Snapshot => model.Snapshot();

    public void Initialize(
        MvpWorldGenerator worldOwner,
        CityEconomyRuntime economyOwner,
        LivingTrafficRuntime trafficOwner,
        CityServicesRuntime servicesOwner,
        MissionRuntime missionOwner,
        GodotSessionRuntimeHost runtime,
        SessionEffectRuntime effectOwner,
        SessionAudioRuntime audioOwner,
        PlayerInterface interfaceOwner,
        string seed = "phase10-temporary-mayhem")
    {
        if (Initialized) throw new InvalidOperationException("Temporary Mayhem is already initialized.");
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        economy = economyOwner ?? throw new ArgumentNullException(nameof(economyOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        services = servicesOwner ?? throw new ArgumentNullException(nameof(servicesOwner));
        missions = missionOwner ?? throw new ArgumentNullException(nameof(missionOwner));
        ArgumentNullException.ThrowIfNull(runtime);
        effects = effectOwner ?? throw new ArgumentNullException(nameof(effectOwner));
        audio = audioOwner ?? throw new ArgumentNullException(nameof(audioOwner));
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        model = new TemporaryMayhemModel(
            world.MayhemTargets.Select(target => new MayhemTarget(
                target.Id, target.Position.X, target.Position.Y, target.Position.Z)),
            new RandomStreamRegistry(seed).Cosmetic);
        unregisterTick = runtime.Scheduler.RegisterTask(
            "mayhem.temporary",
            SimulationStage.Gameplay,
            (delta, _) => Advance(delta));
        Control = new TemporaryMayhemControl();
        playerInterface.Chrome.AddChild(Control);
        Control.Initialize(playerInterface, this);
        Initialized = true;
    }

    public void AcknowledgeWarningAndStart()
    {
        EnsureInitialized();
        if (Active) return;
        BaselineColliderCount = world.Colliders.Count;
        BaselineBuildingCount = economy.Ledger.Snapshot().Buildings.Count;
        BaselineRoadClosureCount = traffic.RoadGraph.TemporaryClosureCount;
        affectedTargets.Clear();
        alertIds.Clear();
        ImpactCount = 0;
        ChainReactionCount = 0;
        PanicEventCount = 0;
        transaction = new WorldEditTransaction("temporary Mayhem sandbox");
        runSequence++;
        model.Start(warningAcknowledged: true);
        playerInterface.Announce("Temporary Mayhem started. All damage will be restored when it ends.", assertive: true);
        Control.ApplyState();
    }

    public void AdvanceForTest(double deltaSeconds) => Advance(deltaSeconds);

    public void Stop()
    {
        if (!Initialized || model is null) return;
        _ = transaction?.Rollback();
        transaction = null;
        foreach (string alertId in alertIds) _ = services.Alerts.Resolve(alertId, "Temporary Mayhem ended and city state was restored");
        alertIds.Clear();
        _ = effects.ReleaseSourcesWithPrefix(SourcePrefix);
        affectedTargets.Clear();
        model.StopAndReset();
        if (traffic.Initialized) _ = traffic.RefreshProductivity("TEMPORARY_MAYHEM_RESTORED");
        if (playerInterface.Initialized)
            playerInterface.Announce("Temporary Mayhem ended. Buildings, roads, and economy state restored.", assertive: true);
        Control?.ApplyState();
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        Stop();
        _ = unregisterTick?.Invoke();
        unregisterTick = null;
        Control.Shutdown();
        if (GodotObject.IsInstanceValid(Control)) Control.QueueFree();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Advance(double deltaSeconds)
    {
        if (!Initialized || !Active) return;
        foreach (MayhemEvent mayhemEvent in model.Advance(deltaSeconds))
        {
            Vector3 target = ToVector(mayhemEvent.Target);
            if (mayhemEvent.Kind == MayhemEventKind.CometSpawned)
            {
                effects.TriggerComet(target + new Vector3(0, 95, 0), $"{SourcePrefix}{mayhemEvent.CometId}");
                continue;
            }
            ApplyImpact(mayhemEvent.Target, chainReaction: false);
            MayhemTarget? chained = world.MayhemTargets
                .Select(item => new MayhemTarget(item.Id, item.Position.X, item.Position.Y, item.Position.Z))
                .Where(candidate => !affectedTargets.Contains(candidate.Id)
                    && candidate.Id != mayhemEvent.Target.Id
                    && HorizontalDistance(candidate, mayhemEvent.Target) <= TemporaryMayhemPolicy.BuildingImpactRadius)
                .OrderBy(candidate => candidate.Id, StringComparer.Ordinal)
                .FirstOrDefault();
            if (chained is not null && affectedTargets.Count < TemporaryMayhemPolicy.MaximumDestroyedTargets)
            {
                ApplyImpact(chained, chainReaction: true);
            }
        }
    }

    private void ApplyImpact(MayhemTarget target, bool chainReaction)
    {
        if (transaction is null || !affectedTargets.Add(target.Id)) return;
        try
        {
            MayhemWorldObjectState suspended = transaction.Step(
                $"hide {target.Id}",
                () => world.SuspendMayhemTarget(target.Id)
                    ?? throw new InvalidOperationException($"Mayhem target '{target.Id}' is unavailable."),
                (state, _) => world.RestoreMayhemTarget(state));
            EconomyBuilding building = transaction.Step(
                $"remove economy {target.Id}",
                () => economy.SuspendAuthoredBuilding(target.Id)
                    ?? throw new InvalidOperationException($"Economy record for '{target.Id}' is unavailable."),
                (state, _) => economy.RestoreAuthoredBuilding(state));
            string incidentId = $"temporary-mayhem-{runSequence}-incident-{ImpactCount + 1}";
            _ = transaction.Step(
                $"record incident {incidentId}",
                () => economy.Ledger.RecordIncident(new EconomyIncident
                {
                    Id = incidentId,
                    Type = "BUILDING_DESTROYED",
                    Severity = chainReaction ? 0.75 : 1,
                    ReputationDelta = -2,
                    HappinessModifier = -3,
                    LandValueModifier = -5,
                    Position = new EconomyPoint(target.X, target.Z),
                    InfluenceRadius = TemporaryMayhemPolicy.AgentBlastRadius,
                }),
                (incident, _) => economy.Ledger.RollbackIncident(incident.Id));
            TemporaryRoadClosure closure = transaction.Step(
                $"close roads {incidentId}",
                () => traffic.RoadGraph.AddTemporaryClosure(
                    incidentId,
                    new TrafficPoint(target.X, target.Z),
                    TemporaryMayhemPolicy.AgentBlastRadius),
                (state, _) => traffic.RoadGraph.RemoveTemporaryClosure(state.Id));
            _ = suspended;
            _ = building;
            _ = closure;
            ImpactCount++;
            if (chainReaction) ChainReactionCount++;
            PanicEventCount++;
            Vector3 position = ToVector(target);
            effects.TriggerExplosion(position, $"{SourcePrefix}{incidentId}:explosion");
            effects.TriggerRubble(position, $"{SourcePrefix}{incidentId}:rubble");
            effects.TriggerFire(position + Vector3.Up * 2, $"{SourcePrefix}{incidentId}:fire");
            audio.PlaySpatial("police-siren", position);
            AlertRecord alert = services.Alerts.Publish(new AlertInput
            {
                Id = incidentId,
                DedupeKey = incidentId,
                Type = AlertTypes.Infrastructure,
                Severity = AlertSeverities.Critical,
                Title = chainReaction ? "Mayhem chain reaction" : "Comet impact",
                Cause = $"Temporary Mayhem damaged {target.Id}",
                Location = new AlertLocation
                {
                    Label = target.Id,
                    Position = new AlertPosition(target.X, target.Y, target.Z),
                },
                Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
                Recommendation = "Emergency crews are responding. End Temporary Mayhem to restore the city.",
                RelatedEntityIds = [target.Id],
            });
            alertIds.Add(alert.Id);
            playerInterface.Announce($"Emergency news: {alert.Title} at {target.Id}. Residents are seeking shelter.", assertive: true);
            _ = traffic.RefreshProductivity("TEMPORARY_MAYHEM_IMPACT");
        }
        catch
        {
            Stop();
            throw;
        }
    }

    private static Vector3 ToVector(MayhemTarget target) => new((float)target.X, (float)target.Y, (float)target.Z);

    private static double HorizontalDistance(MayhemTarget first, MayhemTarget second)
    {
        double x = first.X - second.X;
        double z = first.Z - second.Z;
        return Math.Sqrt(x * x + z * z);
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Temporary Mayhem is not initialized.");
    }
}

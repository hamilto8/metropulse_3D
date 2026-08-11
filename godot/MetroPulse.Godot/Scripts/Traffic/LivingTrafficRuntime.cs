using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Traffic;

/// <summary>Session-owned Godot adapter for the authoritative traffic population.</summary>
public partial class LivingTrafficRuntime : Node
{
    private readonly Dictionary<string, TrafficVehicleActor> actors = new(StringComparer.Ordinal);
    private readonly Dictionary<string, PlayerVehicleController> promoted = new(StringComparer.Ordinal);
    private readonly List<TrafficControlPostActor> controlPosts = [];
    private GameContentRegistry? content;
    private MvpWorldGenerator? world;
    private PlayerControlRuntime? playerControl;
    private Node3D? cameraOrigin;
    private Node3D? trafficRoot;
    private Node3D? controlRoot;
    private Func<bool>? unregisterProductivityTick;
    private TrafficAlertAdapter? trafficAlerts;

    public bool Initialized { get; private set; }

    public TrafficRoadGraph RoadGraph { get; private set; } = null!;

    public TrafficPopulationSimulation Simulation { get; private set; } = null!;

    public TrafficProductivityModel? Productivity { get; private set; }

    public AlertService? Alerts { get; private set; }

    public TrafficProductivityPresenter? ProductivityPresentation { get; private set; }

    public int ActorCount => actors.Count;

    public int MovingActorCount => actors.Values.Count(actor => !actor.Parked);

    public int ParkedActorCount => actors.Values.Count(actor => actor.Parked);

    public int PhysicalControlPostCount => controlPosts.Count;

    public int PromotedCount => promoted.Count;

    public void Initialize(
        GameContentRegistry contentRegistry,
        MvpWorldGenerator worldOwner,
        PlayerControlRuntime controlOwner,
        Node3D agentRoot,
        Node3D navigationRoot,
        Node3D cameraControlOrigin,
        string seed = RandomStreamRegistry.DefaultSeed)
    {
        if (Initialized) throw new InvalidOperationException("Living traffic is already initialized.");
        content = contentRegistry ?? throw new ArgumentNullException(nameof(contentRegistry));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));
        RoadGraph = TrafficRoadGraph.CreateProduction();
        Simulation = new TrafficPopulationSimulation(RoadGraph, new RandomStreamRegistry(seed));
        trafficRoot = new Node3D { Name = "AmbientTraffic" };
        agentRoot.AddChild(trafficRoot);
        controlRoot = new Node3D { Name = "TrafficControls" };
        navigationRoot.AddChild(controlRoot);
        BuildControlPosts();
        ReconcileActors(Simulation.Snapshot(), Vector3.Zero);
        ProcessPhysicsPriority = -780;
        SetPhysicsProcess(true);
        Initialized = true;
    }

    public void InitializeEconomy(EconomyLedger economy, PolicyBalanceDefinition policyBalance, SimulationScheduler scheduler)
    {
        EnsureInitialized();
        if (Productivity is not null) throw new InvalidOperationException("Traffic productivity is already initialized.");
        Productivity = new TrafficProductivityModel(
            economy ?? throw new ArgumentNullException(nameof(economy)),
            policyBalance ?? throw new ArgumentNullException(nameof(policyBalance)),
            roadProvider: RoadGraph.GetRoadNetworkSnapshot,
            presentationVehicleCap: Simulation.MovingCount);
        Alerts = new AlertService();
        trafficAlerts = new TrafficAlertAdapter(Productivity, Alerts);
        ProductivityPresentation = new TrafficProductivityPresenter { Name = "TrafficProductivityPresentation" };
        controlRoot!.AddChild(ProductivityPresentation);
        ProductivityPresentation.Initialize(Productivity);
        unregisterProductivityTick = (scheduler ?? throw new ArgumentNullException(nameof(scheduler))).RegisterTask(
            "traffic.productivity",
            SimulationStage.City,
            (_, _) => Productivity.Update());
    }

    public TrafficProductivitySnapshot RefreshProductivity(string reason = "ROAD_GRAPH_CHANGED")
    {
        EnsureInitialized();
        return Productivity?.Update(force: true, reason)
            ?? throw new InvalidOperationException("Traffic productivity is not initialized.");
    }

    public PlayerVehicleController PromoteForPlayerControl(string agentId)
    {
        EnsureInitialized();
        if (promoted.TryGetValue(agentId, out PlayerVehicleController? existing)) return existing;
        TrafficAgentSnapshot snapshot = Simulation.GetSnapshot(agentId);
        if (snapshot.Parked) throw new InvalidOperationException("Parked presentation vehicles cannot be promoted as moving agents.");
        _ = Simulation.SetPlayerControlled(agentId, true);
        double terrain = world!.Surface.GetTerrainHeight(snapshot.Position.X, snapshot.Position.Z);
        PlayerVehicleController vehicle = playerControl!.SpawnVehicle(
            snapshot.Id,
            snapshot.TypeId,
            new Vector3((float)snapshot.Position.X, (float)terrain, (float)snapshot.Position.Z),
            authorized: false,
            occupied: true,
            yaw: (float)snapshot.Heading);
        promoted.Add(agentId, vehicle);
        actors[agentId].SetPromoted(true);
        return vehicle;
    }

    public bool ResumeAiFromPlayerControl(string agentId)
    {
        EnsureInitialized();
        if (!promoted.TryGetValue(agentId, out PlayerVehicleController? vehicle) || vehicle.Controlled) return false;
        Vector3 forward = -vehicle.GlobalBasis.Z;
        double heading = Math.Atan2(forward.X, forward.Z);
        double speed = new Vector2(vehicle.LinearVelocity.X, vehicle.LinearVelocity.Z).Length();
        var position = new TrafficPoint(vehicle.GlobalPosition.X, vehicle.GlobalPosition.Z);
        Simulation.SyncPlayerPose(agentId, position, heading, speed);
        _ = Simulation.SetPlayerControlled(agentId, false, position, heading);
        if (!playerControl!.RemoveVehicle(agentId)) return false;
        promoted.Remove(agentId);
        actors[agentId].SetPromoted(false);
        return true;
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized) return;
        foreach ((string id, PlayerVehicleController vehicle) in promoted)
        {
            Vector3 forward = -vehicle.GlobalBasis.Z;
            Simulation.SyncPlayerPose(
                id,
                new TrafficPoint(vehicle.GlobalPosition.X, vehicle.GlobalPosition.Z),
                Math.Atan2(forward.X, forward.Z),
                new Vector2(vehicle.LinearVelocity.X, vehicle.LinearVelocity.Z).Length());
        }
        Vector3 focus = playerControl?.ControlledCameraTarget?.CaptureCameraTarget().Position
            ?? cameraOrigin?.GlobalPosition
            ?? Vector3.Zero;
        TrafficProductivitySnapshot? productivity = Productivity?.Snapshot();
        Simulation.Advance(
            delta,
            new TrafficPoint(focus.X, focus.Z),
            bridgePriorityEnabled: Productivity?.BridgePolicy == BridgePolicies.FreightPriority,
            speedMultiplier: productivity?.Presentation.SpeedMultiplier ?? 1,
            bridgeSpeedMultiplier: productivity?.Presentation.BridgeSpeedMultiplier ?? 1);
        ReconcileActors(Simulation.Snapshot(), focus);
        ApplyControlSignals();
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        _ = unregisterProductivityTick?.Invoke();
        unregisterProductivityTick = null;
        trafficAlerts?.Dispose();
        trafficAlerts = null;
        ProductivityPresentation?.Shutdown();
        foreach ((string id, PlayerVehicleController vehicle) in promoted.ToArray())
        {
            if (!vehicle.Controlled) _ = playerControl?.RemoveVehicle(id);
        }
        promoted.Clear();
        if (trafficRoot is not null && GodotObject.IsInstanceValid(trafficRoot)) trafficRoot.Free();
        if (controlRoot is not null && GodotObject.IsInstanceValid(controlRoot)) controlRoot.Free();
        actors.Clear();
        controlPosts.Clear();
        trafficRoot = null;
        controlRoot = null;
        content = null;
        world = null;
        playerControl = null;
        cameraOrigin = null;
        Productivity = null;
        Alerts = null;
        ProductivityPresentation = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void ReconcileActors(TrafficPopulationSnapshot snapshot, Vector3 focus)
    {
        foreach (TrafficAgentSnapshot agent in snapshot.Moving.Concat(snapshot.Parked))
        {
            if (!actors.TryGetValue(agent.Id, out TrafficVehicleActor? actor))
            {
                actor = new TrafficVehicleActor { Name = $"Traffic_{agent.Id}" };
                trafficRoot!.AddChild(actor);
                VehicleProfileRecord record = content!.GetVehicleProfile(agent.TypeId)
                    ?? throw new InvalidOperationException($"Traffic profile '{agent.TypeId}' is unavailable.");
                actor.Initialize(agent, record, world!);
                actors.Add(agent.Id, actor);
            }
            actor.Apply(agent, focus);
        }
        var activeIds = snapshot.Moving.Concat(snapshot.Parked).Select(agent => agent.Id).ToHashSet(StringComparer.Ordinal);
        foreach (string removedId in actors.Keys.Where(id => !activeIds.Contains(id)).ToArray())
        {
            actors[removedId].Free();
            actors.Remove(removedId);
        }
    }

    private void BuildControlPosts()
    {
        IReadOnlyDictionary<string, TrafficControl> controls = Simulation.Controls.Controls.ToDictionary(control => control.Id, StringComparer.Ordinal);
        foreach (TrafficControlPost definition in Simulation.Controls.Posts)
        {
            var post = new TrafficControlPostActor { Name = $"Post_{Sanitize(definition.Id)}" };
            controlRoot!.AddChild(post);
            post.Initialize(definition, controls[definition.ControlId], world!);
            controlPosts.Add(post);
        }
    }

    private void ApplyControlSignals()
    {
        IReadOnlyDictionary<string, TrafficControl> controls = Simulation.Controls.Controls.ToDictionary(control => control.Id, StringComparer.Ordinal);
        foreach (TrafficControlPostActor post in controlPosts)
        {
            TrafficControl control = controls[post.ControlId];
            if (control.Type != TrafficControlTypes.Signal) continue;
            post.ApplySignalState(Simulation.Controls.SignalState(control, post.Axis));
        }
    }

    private static string Sanitize(string id) => id.Replace(':', '_').Replace(',', '_');

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Living traffic runtime is not initialized.");
    }
}

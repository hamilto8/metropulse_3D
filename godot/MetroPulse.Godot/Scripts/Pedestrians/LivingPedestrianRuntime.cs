using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Pedestrians;

/// <summary>Session owner for ambient citizens and bounded vehicle/pedestrian interaction.</summary>
public partial class LivingPedestrianRuntime : Node
{
    private readonly Dictionary<string, PedestrianActor> actors = new(StringComparer.Ordinal);
    private MvpWorldGenerator? world;
    private PlayerControlRuntime? playerControl;
    private LivingTrafficRuntime? traffic;
    private Node3D? cameraOrigin;
    private Node3D? pedestrianRoot;
    private QualityProfilePolicy quality = QualityProfilePolicy.Resolve(QualityProfileIds.High);

    public bool Initialized { get; private set; }

    public PedestrianSidewalkGraph SidewalkGraph { get; private set; } = null!;

    public PedestrianPopulationSimulation Simulation { get; private set; } = null!;

    public int ActorCount => actors.Count;

    public int CollisionActorCount => actors.Values.Count(actor => actor.CollisionActive);

    public event Action<TrafficAgentSnapshot, PedestrianAgentSnapshot>? PlayerVehiclePedestrianHit;

    public void Initialize(
        GameContentRegistry content,
        MvpWorldGenerator worldOwner,
        PlayerControlRuntime controlOwner,
        LivingTrafficRuntime trafficOwner,
        Node3D agentRoot,
        Node3D cameraControlOrigin,
        string seed = RandomStreamRegistry.DefaultSeed,
        QualityProfilePolicy? qualityProfile = null)
    {
        if (Initialized) throw new InvalidOperationException("Living pedestrians are already initialized.");
        ArgumentNullException.ThrowIfNull(content);
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        playerControl = controlOwner ?? throw new ArgumentNullException(nameof(controlOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));
        quality = qualityProfile ?? QualityProfilePolicy.Resolve(QualityProfileIds.High);
        SidewalkGraph = PedestrianSidewalkGraph.CreateProduction();
        Simulation = new PedestrianPopulationSimulation(SidewalkGraph, new RandomStreamRegistry(seed), content);
        pedestrianRoot = new Node3D { Name = "AmbientPedestrians" };
        agentRoot.AddChild(pedestrianRoot);
        ReconcileActors(Simulation.Snapshot(), Vector3.Zero);
        ProcessPhysicsPriority = -790;
        SetPhysicsProcess(true);
        Initialized = true;
    }

    public PedestrianActor GetActor(string id) => actors.TryGetValue(id, out PedestrianActor? actor)
        ? actor
        : throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown pedestrian actor.");

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized) return;
        Vector3 focus = playerControl?.ControlledCameraTarget?.CaptureCameraTarget().Position
            ?? cameraOrigin?.GlobalPosition
            ?? Vector3.Zero;
        Simulation.Advance(
            delta,
            new PedestrianVector3(focus.X, focus.Y, focus.Z),
            (x, z) => world!.Surface.GetTerrainHeight(x, z));
        ApplyTrafficInteractions(delta);
        ReconcileActors(Simulation.Snapshot(), focus);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        if (pedestrianRoot is not null && GodotObject.IsInstanceValid(pedestrianRoot)) pedestrianRoot.Free();
        actors.Clear();
        pedestrianRoot = null;
        world = null;
        playerControl = null;
        traffic = null;
        cameraOrigin = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void ApplyTrafficInteractions(double delta)
    {
        TrafficPopulationSnapshot trafficSnapshot = traffic!.Simulation.Snapshot();
        foreach (TrafficAgentSnapshot vehicle in trafficSnapshot.Moving)
        {
            double detection = traffic.Simulation.GetPedestrianDetectionDistance(vehicle.Id);
            PedestrianTrafficContact? contact = Simulation.FindBlockingPedestrian(
                new PedestrianVector3(vehicle.Position.X, 0, vehicle.Position.Z),
                vehicle.Heading,
                detection);
            TrafficPedestrianInteraction action = traffic.Simulation.UpdatePedestrianEncounter(vehicle.Id, contact, delta);
            if (!action.ShouldKnockDown || contact is null) continue;
            PedestrianAgentSnapshot pedestrian = Simulation.GetSnapshot(contact.PedestrianId);
            _ = Simulation.KnockDown(
                contact.PedestrianId,
                new PedestrianVector3(Math.Sin(vehicle.Heading), 0.25, Math.Cos(vehicle.Heading)),
                vehicle.Speed);
            if (vehicle.PlayerControlled) PlayerVehiclePedestrianHit?.Invoke(vehicle, pedestrian);
        }
    }

    private void ReconcileActors(PedestrianPopulationSnapshot snapshot, Vector3 focus)
    {
        foreach (PedestrianAgentSnapshot citizen in snapshot.Citizens)
        {
            if (!actors.TryGetValue(citizen.Id, out PedestrianActor? actor))
            {
                actor = new PedestrianActor { Name = $"Pedestrian_{citizen.Id}" };
                pedestrianRoot!.AddChild(actor);
                actor.Initialize(citizen, world!, quality);
                actors.Add(citizen.Id, actor);
            }
            actor.Apply(citizen, focus);
        }
        HashSet<string> active = snapshot.Citizens.Select(citizen => citizen.Id).ToHashSet(StringComparer.Ordinal);
        foreach (string removedId in actors.Keys.Where(id => !active.Contains(id)).ToArray())
        {
            actors[removedId].Free();
            actors.Remove(removedId);
        }
    }
}

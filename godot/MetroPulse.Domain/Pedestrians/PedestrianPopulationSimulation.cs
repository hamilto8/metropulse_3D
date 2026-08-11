using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Domain.Pedestrians;

public static class PedestrianDetailTiers
{
    public const string Near = "NEAR";
    public const string Medium = "MEDIUM";
    public const string Far = "FAR";
}

public sealed record PedestrianPopulationConfig
{
    public int CitizenFloor { get; init; } = 60;
    public double NearDistance { get; init; } = 130;
    public double MediumDistance { get; init; } = 340;
}

public sealed record CafeSeat(string Id, PedestrianVector3 Position, double RotationY);

public sealed record PedestrianAgentSnapshot(
    string Id,
    string Name,
    PedestrianDescriptor Descriptor,
    PedestrianVector3 Position,
    double Heading,
    double Speed,
    string? CurrentNodeId,
    string? TargetNodeId,
    NpcBehaviorState Behavior,
    bool Seated,
    bool KnockedDown,
    PedestrianKnockdownState? Knockdown,
    string DetailTier,
    int SimulationCadence,
    string? AttackedById,
    int RecoveryCount);

public sealed record PedestrianTrafficContact(
    string PedestrianId,
    double Distance,
    double ForwardDistance,
    double LateralDistance,
    bool KnockedDown,
    bool Seated);

public sealed record PedestrianPopulationSnapshot(
    long Frame,
    IReadOnlyList<PedestrianAgentSnapshot> Citizens,
    int MaximumLocalCandidates,
    int TotalRecoveries,
    int ActiveKnockdowns);

/// <summary>Seeded 60-citizen lifecycle, sidewalk routing, special behavior, LOD, and knockdown owner.</summary>
public sealed class PedestrianPopulationSimulation
{
    private static readonly string[] FirstNames = ["Alex", "Jordan", "Elena", "Marcus", "Sophia", "Liam", "Chloe", "David", "Maya", "Lucas", "Zoe", "Daniel"];
    private static readonly string[] LastNames = ["V.", "K.", "M.", "S.", "R.", "T.", "L.", "H.", "W.", "P.", "B.", "N."];
    private static readonly IReadOnlyList<CafeSeat> Seats = Array.AsReadOnly(new CafeSeat[]
    {
        new("cafe-seat-1", new PedestrianVector3(13, 0.12, 41), Math.PI / 2),
        new("cafe-seat-2", new PedestrianVector3(13, 0.12, 37), Math.PI / 2),
        new("cafe-seat-3", new PedestrianVector3(41, 0.12, 13), Math.PI),
        new("cafe-seat-4", new PedestrianVector3(37, 0.12, 13), Math.PI),
        new("cafe-seat-5", new PedestrianVector3(63, 0.12, -41), -Math.PI / 2),
        new("cafe-seat-6", new PedestrianVector3(63, 0.12, -37), -Math.PI / 2),
    });

    private readonly PedestrianSidewalkGraph graph;
    private readonly RandomStreamRegistry randoms;
    private readonly GameContentRegistry content;
    private readonly PedestrianPopulationConfig config;
    private readonly Dictionary<string, Agent> citizens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SidewalkNodeSnapshot> nodes;
    private readonly SpatialHashGrid<Agent> grid;
    private long nextSerial;
    private long frame;
    private int nextSeat;
    private int maximumLocalCandidates;

    public PedestrianPopulationSimulation(
        PedestrianSidewalkGraph graph,
        RandomStreamRegistry randoms,
        GameContentRegistry? content = null,
        PedestrianPopulationConfig? config = null)
    {
        this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
        this.randoms = randoms ?? throw new ArgumentNullException(nameof(randoms));
        this.content = content ?? GameContentRegistry.LoadProduction();
        this.config = config ?? new PedestrianPopulationConfig();
        if (this.config.CitizenFloor < 0
            || !double.IsFinite(this.config.NearDistance) || this.config.NearDistance <= 0
            || !double.IsFinite(this.config.MediumDistance) || this.config.MediumDistance <= this.config.NearDistance)
        {
            throw new ArgumentOutOfRangeException(nameof(config));
        }
        nodes = graph.Snapshot().Nodes.ToDictionary(node => node.Id, StringComparer.Ordinal);
        grid = new SpatialHashGrid<Agent>(18, agent => agent.Id, agent => new SpatialPoint(agent.Position.X, agent.Position.Z));
        EnsureFloor();
        RebuildGrid();
    }

    public int CitizenCount => citizens.Count;

    public int MaximumLocalCandidates => maximumLocalCandidates;

    public PedestrianPopulationSnapshot Snapshot() => new(
        frame,
        new ReadOnlyCollection<PedestrianAgentSnapshot>(citizens.Values
            .OrderBy(agent => agent.Id, StringComparer.Ordinal)
            .Select(ToSnapshot)
            .ToArray()),
        maximumLocalCandidates,
        citizens.Values.Sum(agent => agent.RecoveryCount),
        citizens.Values.Count(agent => agent.Knockdown?.Active == true));

    public void Advance(double delta, PedestrianVector3 focus, Func<double, double, double>? terrain = null)
    {
        if (!double.IsFinite(delta) || delta < 0 || !focus.IsFinite) throw new ArgumentOutOfRangeException(nameof(delta));
        frame += 1;
        RebuildGrid();
        foreach (Agent agent in citizens.Values.OrderBy(agent => agent.Id, StringComparer.Ordinal))
        {
            UpdateTier(agent, focus);
            if (agent.Knockdown?.Active == true)
            {
                agent.Knockdown = PedestrianKnockdownModel.Update(agent.Knockdown, delta, terrain);
                agent.Position = agent.Knockdown.Position;
                continue;
            }
            if ((frame + agent.Serial) % agent.SimulationCadence != 0) continue;
            AdvanceAgent(agent, delta * agent.SimulationCadence);
        }
        EnsureFloor();
    }

    public PedestrianTrafficContact? FindBlockingPedestrian(
        PedestrianVector3 vehiclePosition,
        double vehicleHeading,
        double detectionDistance)
    {
        if (!vehiclePosition.IsFinite || !double.IsFinite(vehicleHeading)
            || !double.IsFinite(detectionDistance) || detectionDistance <= 0) return null;
        SpatialQueryResult<Agent> nearby = grid.Query(
            new SpatialPoint(vehiclePosition.X, vehiclePosition.Z), detectionDistance);
        maximumLocalCandidates = Math.Max(maximumLocalCandidates, nearby.CandidatesTested);
        double forwardX = Math.Sin(vehicleHeading);
        double forwardZ = Math.Cos(vehicleHeading);
        double rightX = forwardZ;
        double rightZ = -forwardX;
        PedestrianTrafficContact? closest = null;
        foreach (Agent agent in nearby.Items)
        {
            bool seated = agent.Seat is not null && agent.Behavior.Mode == NpcBehaviorModes.SittingReading;
            if (!PedestrianTrafficModel.IsTrafficParticipant(new PedestrianTrafficParticipant(
                KnockedDown: agent.Knockdown?.Active == true,
                Archetype: agent.Descriptor.Archetype,
                HasCafeSeat: agent.Seat is not null,
                BehaviorMode: agent.Behavior.Mode))) continue;
            double x = agent.Position.X - vehiclePosition.X;
            double z = agent.Position.Z - vehiclePosition.Z;
            double forward = x * forwardX + z * forwardZ;
            double lateral = Math.Abs(x * rightX + z * rightZ);
            double distance = Math.Sqrt(x * x + z * z);
            if (forward < -1.2 || forward > detectionDistance || lateral > 1.9) continue;
            var contact = new PedestrianTrafficContact(
                agent.Id, distance, forward, lateral, agent.Knockdown?.Active == true, seated);
            if (closest is null || contact.Distance < closest.Distance
                || (contact.Distance == closest.Distance
                    && StringComparer.Ordinal.Compare(contact.PedestrianId, closest.PedestrianId) < 0)) closest = contact;
        }
        return closest;
    }

    public bool KnockDown(string pedestrianId, PedestrianVector3 direction, double impactSpeed)
    {
        Agent agent = Get(pedestrianId);
        if (agent.Knockdown?.Active == true) return false;
        FinishAggression(agent);
        agent.Knockdown = PedestrianKnockdownModel.Start(
            agent.Position,
            direction,
            randoms.PedestrianBehavior,
            impactSpeed);
        agent.Position = agent.Knockdown.Position;
        return true;
    }

    public bool Cull(string pedestrianId)
    {
        Agent agent = Get(pedestrianId);
        FinishAggression(agent);
        citizens.Remove(pedestrianId);
        EnsureFloor();
        RebuildGrid();
        return true;
    }

    public void RecoverToSidewalk(string pedestrianId)
    {
        Agent agent = Get(pedestrianId);
        string nearest = graph.FindNearest(agent.Position);
        SidewalkNodeSnapshot node = nodes[nearest];
        agent.Position = node.Position;
        agent.CurrentNodeId = node.Id;
        agent.TargetNodeId = node.NextNodeIds[0];
        agent.Knockdown = null;
        agent.Speed = 0;
        agent.RecoveryCount += 1;
    }

    public PedestrianAgentSnapshot GetSnapshot(string pedestrianId) => ToSnapshot(Get(pedestrianId));

    private void AdvanceAgent(Agent agent, double delta)
    {
        if (agent.Descriptor.Archetype == "CAFE_READER" && agent.Behavior.Mode == NpcBehaviorModes.SittingReading)
        {
            agent.Speed = 0;
            if (agent.Seat is not null)
            {
                agent.Position = agent.Seat.Position;
                agent.Heading = agent.Seat.RotationY;
            }
            return;
        }
        if (agent.Descriptor.Archetype == "TOURIST")
        {
            agent.Behavior = NpcBehaviorModel.AdvanceTourist(agent.Behavior, delta, randoms.PedestrianBehavior);
            if (agent.Behavior.Mode == NpcBehaviorModes.TakingPhoto)
            {
                agent.Speed = Approach(agent.Speed, 0, 12 * delta);
                return;
            }
        }
        if (agent.Descriptor.Archetype == "CRIMINAL" && AdvanceCriminal(agent, delta)) return;

        double targetSpeed = agent.Descriptor.Profile.MaxSpeed;
        agent.Speed = Approach(agent.Speed, targetSpeed, 12 * delta);
        if (agent.TargetNodeId is null || agent.CurrentNodeId is null) return;
        SidewalkNodeSnapshot target = nodes[agent.TargetNodeId];
        SidewalkRouteAdvance route = graph.Advance(
            agent.CurrentNodeId, agent.TargetNodeId, agent.Position, randoms.PedestrianBehavior);
        if (route.Advanced)
        {
            agent.CurrentNodeId = route.CurrentNodeId;
            agent.TargetNodeId = route.TargetNodeId;
            target = nodes[route.TargetNodeId];
        }
        double desired = Math.Atan2(target.Position.X - agent.Position.X, target.Position.Z - agent.Position.Z);
        agent.Heading = ApproachAngle(agent.Heading, desired, Math.Min(1, delta * 7));
        agent.Position = new PedestrianVector3(
            agent.Position.X + Math.Sin(agent.Heading) * agent.Speed * delta,
            agent.Position.Y,
            agent.Position.Z + Math.Cos(agent.Heading) * agent.Speed * delta);
    }

    private bool AdvanceCriminal(Agent criminal, double delta)
    {
        NpcBehaviorState state = criminal.Behavior;
        if (state.Mode == NpcBehaviorModes.Loitering)
        {
            criminal.Behavior = state with { Timer = Math.Max(0, state.Timer - delta) };
            if (criminal.Behavior.Timer > 0) return false;
            SpatialQueryResult<Agent> nearby = grid.Query(
                new SpatialPoint(criminal.Position.X, criminal.Position.Z),
                NpcBehaviorModel.DefaultConfig.AggressionRadius);
            maximumLocalCandidates = Math.Max(maximumLocalCandidates, nearby.CandidatesTested);
            NpcCandidate? selectedTarget = NpcBehaviorModel.SelectAggressionTarget(
                criminal.Id,
                criminal.Position,
                nearby.Items.Select(candidate => new NpcCandidate(
                    candidate.Id,
                    candidate.Descriptor.Archetype,
                    candidate.Position,
                    candidate.Knockdown?.Active == true,
                    AttackedById: candidate.AttackedById)).ToArray());
            if (selectedTarget is null)
            {
                criminal.Behavior = criminal.Behavior with { Timer = 3 };
                return false;
            }
            Agent targetAgent = citizens[selectedTarget.Id];
            AggressionTransition begun = NpcBehaviorModel.BeginAggression(
                criminal.Id, criminal.Behavior, selectedTarget.Id, targetAgent.AttackedById);
            criminal.Behavior = begun.State;
            targetAgent.AttackedById = begun.TargetAttackedById;
            return false;
        }
        if (state.Mode != NpcBehaviorModes.Chasing || state.TargetId is null) return false;
        if (!citizens.TryGetValue(state.TargetId, out Agent? target)
            || target.Knockdown?.Active == true
            || state.ChaseElapsed >= NpcBehaviorModel.DefaultConfig.ChaseDuration)
        {
            FinishAggression(criminal);
            return false;
        }
        double distance = criminal.Position.DistanceTo(target.Position);
        if (distance > NpcBehaviorModel.DefaultConfig.AggressionRadius * 1.75)
        {
            FinishAggression(criminal);
            return false;
        }
        criminal.Behavior = state with
        {
            ChaseElapsed = state.ChaseElapsed + delta,
            AttackCooldown = Math.Max(0, state.AttackCooldown - delta),
        };
        PedestrianVector3 offset = new(
            target.Position.X - criminal.Position.X,
            target.Position.Y - criminal.Position.Y,
            target.Position.Z - criminal.Position.Z);
        criminal.Heading = Math.Atan2(offset.X, offset.Z);
        if (distance <= NpcBehaviorModel.DefaultConfig.AttackRange && criminal.Behavior.AttackCooldown <= 0)
        {
            _ = KnockDown(target.Id, offset, 7);
            FinishAggression(criminal);
            return true;
        }
        criminal.Speed = Approach(criminal.Speed, criminal.Descriptor.Profile.MaxSpeed * 1.35, 12 * delta);
        criminal.Position = new PedestrianVector3(
            criminal.Position.X + Math.Sin(criminal.Heading) * criminal.Speed * delta,
            criminal.Position.Y,
            criminal.Position.Z + Math.Cos(criminal.Heading) * criminal.Speed * delta);
        return true;
    }

    private void FinishAggression(Agent agent)
    {
        if (agent.Behavior.TargetId is not null && citizens.TryGetValue(agent.Behavior.TargetId, out Agent? target))
        {
            target.AttackedById = null;
        }
        if (agent.Descriptor.Archetype == "CRIMINAL")
        {
            agent.Behavior = NpcBehaviorModel.FinishAggression(
                agent.Id, agent.Behavior, agent.Id, randoms.PedestrianBehavior).State;
        }
    }

    private void EnsureFloor()
    {
        while (citizens.Count < config.CitizenFloor) Spawn();
    }

    private void Spawn()
    {
        long serial = nextSerial++;
        PedestrianDescriptor descriptor = PedestrianDescriptorModel.Create(serial, randoms.PedestrianSpawn, content);
        string name = $"{FirstNames[randoms.PedestrianSpawn.NextInt(FirstNames.Length)]} {LastNames[randoms.PedestrianSpawn.NextInt(LastNames.Length)]}";
        NpcBehaviorState behavior = NpcBehaviorModel.CreateState(descriptor.Archetype, randoms.PedestrianBehavior);
        SidewalkNodeSnapshot[] routable = nodes.Values
            .Where(node => node.NextNodeIds.Count > 0 && !node.ParkPath)
            .OrderBy(node => node.Id, StringComparer.Ordinal)
            .ToArray();
        SidewalkNodeSnapshot start = routable[(int)((serial * 37) % routable.Length)];
        CafeSeat? seat = descriptor.Archetype == "CAFE_READER" ? Seats[nextSeat++ % Seats.Count] : null;
        string? targetId = seat is null
            ? start.NextNodeIds[randoms.PedestrianSpawn.NextInt(start.NextNodeIds.Count)]
            : null;
        var agent = new Agent
        {
            Id = $"pedestrian-{serial:0000}",
            Serial = serial,
            Name = name,
            Descriptor = descriptor,
            Position = seat?.Position ?? start.Position,
            Heading = seat?.RotationY ?? (targetId is null ? 0 : HeadingTo(start.Position, nodes[targetId].Position)),
            CurrentNodeId = seat is null ? start.Id : null,
            TargetNodeId = targetId,
            Behavior = behavior,
            Seat = seat,
            DetailTier = PedestrianDetailTiers.Far,
            SimulationCadence = 8,
        };
        citizens.Add(agent.Id, agent);
    }

    private void UpdateTier(Agent agent, PedestrianVector3 focus)
    {
        double distance = agent.Position.DistanceSquaredTo(focus);
        if (distance <= config.NearDistance * config.NearDistance)
        {
            agent.DetailTier = PedestrianDetailTiers.Near;
            agent.SimulationCadence = 1;
        }
        else if (distance <= config.MediumDistance * config.MediumDistance)
        {
            agent.DetailTier = PedestrianDetailTiers.Medium;
            agent.SimulationCadence = 2;
        }
        else
        {
            agent.DetailTier = PedestrianDetailTiers.Far;
            agent.SimulationCadence = 8;
        }
    }

    private void RebuildGrid() => grid.Rebuild(citizens.Values);

    private Agent Get(string id) => citizens.TryGetValue(id, out Agent? agent)
        ? agent
        : throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown pedestrian agent.");

    private static PedestrianAgentSnapshot ToSnapshot(Agent agent) => new(
        agent.Id, agent.Name, agent.Descriptor, agent.Position, agent.Heading, agent.Speed,
        agent.CurrentNodeId, agent.TargetNodeId, agent.Behavior, agent.Seat is not null,
        agent.Knockdown?.Active == true, agent.Knockdown, agent.DetailTier,
        agent.SimulationCadence, agent.AttackedById, agent.RecoveryCount);

    private static double HeadingTo(PedestrianVector3 first, PedestrianVector3 second) =>
        Math.Atan2(second.X - first.X, second.Z - first.Z);

    private static double Approach(double current, double target, double maximumChange) =>
        current < target ? Math.Min(target, current + maximumChange) : Math.Max(target, current - maximumChange);

    private static double ApproachAngle(double current, double target, double weight)
    {
        double difference = target - current;
        while (difference < -Math.PI) difference += Math.PI * 2;
        while (difference > Math.PI) difference -= Math.PI * 2;
        return current + difference * Math.Clamp(weight, 0, 1);
    }

    private sealed class Agent
    {
        public required string Id { get; init; }
        public required long Serial { get; init; }
        public required string Name { get; init; }
        public required PedestrianDescriptor Descriptor { get; init; }
        public required PedestrianVector3 Position { get; set; }
        public double Heading { get; set; }
        public double Speed { get; set; }
        public string? CurrentNodeId { get; set; }
        public string? TargetNodeId { get; set; }
        public required NpcBehaviorState Behavior { get; set; }
        public CafeSeat? Seat { get; init; }
        public PedestrianKnockdownState? Knockdown { get; set; }
        public required string DetailTier { get; set; }
        public int SimulationCadence { get; set; }
        public string? AttackedById { get; set; }
        public int RecoveryCount { get; set; }
    }
}

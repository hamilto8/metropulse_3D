using System.Collections.ObjectModel;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Domain.Traffic;

public static class TrafficAgentDetailTiers
{
    public const string Near = "NEAR";
    public const string Medium = "MEDIUM";
    public const string Far = "FAR";
}

public static class TrafficDamageStates
{
    public const string Healthy = "HEALTHY";
    public const string Damaged = "DAMAGED";
    public const string Disabled = "DISABLED";
    public const string OnFire = "ON_FIRE";
}

public sealed record TrafficPopulationConfig
{
    public int MovingVehicleFloor { get; init; } = 48;

    public int ParkedVehicleCount { get; init; } = 12;

    public double NearDistance { get; init; } = 130;

    public double MediumDistance { get; init; } = 340;

    public double NeighborQueryRadius { get; init; } = 18;

    public double StuckRecoverySeconds { get; init; } = 4;

    public double FireDisableSeconds { get; init; } = 6;
}

public sealed record TrafficAgentSnapshot(
    string Id,
    string TypeId,
    TrafficPoint Position,
    double Heading,
    double Speed,
    double TargetSpeed,
    string CurrentNodeId,
    string TargetNodeId,
    bool Parked,
    bool PlayerControlled,
    bool Emergency,
    DriverRuleProfile Driver,
    bool Impatient,
    string DetailTier,
    int SimulationCadence,
    string DamageState,
    double Health,
    int RecoveryCount,
    int HornCount,
    bool HitAndRunOffender,
    string? PursuitTargetId,
    string? EnforcementTargetId,
    bool SirenActive);

public sealed record EnforcementResponseSnapshot(
    string TargetId,
    IReadOnlyList<string> ResponderIds,
    double NearestDistance);

public sealed record TrafficPedestrianInteraction(
    bool ShouldYield,
    bool ShouldHonk,
    bool ShouldKnockDown,
    bool HitAndRunStarted,
    double DetectionDistance,
    IReadOnlyList<string> ResponderIds);

public sealed record TrafficPopulationSnapshot(
    long Frame,
    IReadOnlyList<TrafficAgentSnapshot> Moving,
    IReadOnlyList<TrafficAgentSnapshot> Parked,
    int MaximumLocalCandidates,
    int TotalRecoveries,
    int TotalHorns);

/// <summary>
/// Authoritative seeded traffic lifecycle and coarse movement simulation. It
/// publishes immutable presentation state and delegates physics/rendering to engine adapters.
/// </summary>
public sealed class TrafficPopulationSimulation
{
    private static readonly string[] SpawnProfileIds = ["SEDAN", "SPORTS", "BUS", "TRUCK", "POLICE", "MOTORBIKE"];
    private readonly TrafficRoadGraph graph;
    private readonly RandomStreamRegistry randoms;
    private readonly TrafficPopulationConfig config;
    private readonly Dictionary<string, Agent> moving = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Agent> parked = new(StringComparer.Ordinal);
    private readonly SpatialHashGrid<Agent> vehicleGrid;
    private readonly List<Agent> nearbyAgents = [];
    private readonly Dictionary<string, RoadGraphNodeSnapshot> graphNodes = new(StringComparer.Ordinal);
    private long graphRevision = -1;
    private long nextMovingSerial;
    private long nextParkedSerial;
    private long frame;
    private int maximumLocalCandidates;

    public TrafficPopulationSimulation(
        TrafficRoadGraph graph,
        RandomStreamRegistry randoms,
        TrafficPopulationConfig? config = null)
    {
        this.graph = graph ?? throw new ArgumentNullException(nameof(graph));
        this.randoms = randoms ?? throw new ArgumentNullException(nameof(randoms));
        this.config = config ?? new TrafficPopulationConfig();
        ValidateConfig(this.config);
        Controls = new TrafficControlCoordinator();
        RefreshGraphNodes();
        vehicleGrid = new SpatialHashGrid<Agent>(24, agent => agent.Id, agent => new SpatialPoint(agent.Position.X, agent.Position.Z));
        EnsurePopulationFloor();
        while (parked.Count < this.config.ParkedVehicleCount) SpawnParked();
        vehicleGrid.Rebuild(moving.Values);
    }

    public TrafficControlCoordinator Controls { get; }

    public int MovingCount => moving.Count;

    public int ParkedCount => parked.Count;

    public int MaximumLocalCandidates => maximumLocalCandidates;

    public int GraphSnapshotRefreshCount { get; private set; }

    public TrafficPopulationSnapshot Snapshot() => new(
        frame,
        new ReadOnlyCollection<TrafficAgentSnapshot>(moving.Values
            .OrderBy(agent => agent.Id, StringComparer.Ordinal)
            .Select(ToSnapshot)
            .ToArray()),
        new ReadOnlyCollection<TrafficAgentSnapshot>(parked.Values
            .OrderBy(agent => agent.Id, StringComparer.Ordinal)
            .Select(ToSnapshot)
            .ToArray()),
        maximumLocalCandidates,
        moving.Values.Sum(agent => agent.RecoveryCount),
        moving.Values.Sum(agent => agent.HornCount));

    public void Advance(
        double delta,
        TrafficPoint focus,
        bool bridgePriorityEnabled = false,
        double speedMultiplier = 1,
        double bridgeSpeedMultiplier = 1)
    {
        if (!double.IsFinite(delta) || delta < 0 || !double.IsFinite(focus.X) || !double.IsFinite(focus.Z)
            || !double.IsFinite(speedMultiplier) || speedMultiplier < 0
            || !double.IsFinite(bridgeSpeedMultiplier) || bridgeSpeedMultiplier < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(delta));
        }
        RefreshGraphNodes();
        frame += 1;
        Controls.Advance(delta);
        vehicleGrid.Rebuild(moving.Values);
        AdvancePursuits(delta);
        foreach (Agent agent in moving.Values.OrderBy(agent => agent.Id, StringComparer.Ordinal))
        {
            UpdateTier(agent, focus);
            if (agent.PlayerControlled) continue;
            if ((frame + agent.Serial) % agent.SimulationCadence != 0) continue;
            AdvanceAgent(
                agent,
                delta * agent.SimulationCadence,
                bridgePriorityEnabled,
                speedMultiplier,
                bridgeSpeedMultiplier);
        }
        EnsurePopulationFloor();
    }

    public bool Cull(string agentId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(agentId);
        if (moving.TryGetValue(agentId, out Agent? target))
        {
            ClearPursuit(target);
            foreach (Agent offender in moving.Values.Where(agent =>
                agent.HitAndRun?.ResponderIds.Contains(agentId, StringComparer.Ordinal) == true).ToArray())
            {
                ClearPursuit(offender);
            }
        }
        bool removed = moving.Remove(agentId) || parked.Remove(agentId);
        if (removed) EnsurePopulationFloor();
        return removed;
    }

    public bool SetPlayerControlled(string agentId, bool controlled, TrafficPoint? pose = null, double? heading = null)
    {
        Agent agent = GetMoving(agentId);
        if (agent.PlayerControlled == controlled) return false;
        agent.PlayerControlled = controlled;
        if (pose is not null)
        {
            if (!double.IsFinite(pose.X) || !double.IsFinite(pose.Z)) throw new ArgumentOutOfRangeException(nameof(pose));
            agent.Position = pose;
        }
        if (heading is not null)
        {
            if (!double.IsFinite(heading.Value)) throw new ArgumentOutOfRangeException(nameof(heading));
            agent.Heading = heading.Value;
        }
        if (!controlled)
        {
            string nearest = graph.FindNearestRoutableNode(agent.Position);
            RoadGraphNodeSnapshot node = graphNodes[nearest];
            agent.CurrentNodeId = nearest;
            agent.TargetNodeId = node.NextNodeIds[0];
            agent.Position = graph.EnforceLaneCorridor(
                agent.Position, agent.CurrentNodeId, agent.TargetNodeId, ProfileWidth(agent.TypeId)).Position;
            agent.Speed = Math.Max(5, agent.Speed);
        }
        return true;
    }

    public void SyncPlayerPose(string agentId, TrafficPoint position, double heading, double speed)
    {
        Agent agent = GetMoving(agentId);
        if (!double.IsFinite(position.X) || !double.IsFinite(position.Z)
            || !double.IsFinite(heading) || !double.IsFinite(speed))
        {
            throw new ArgumentOutOfRangeException(nameof(position));
        }
        if (!agent.PlayerControlled) throw new InvalidOperationException("Only a player-controlled traffic agent can publish a physics pose.");
        agent.Position = position;
        agent.Heading = heading;
        agent.Speed = Math.Abs(speed);
    }

    public string ApplyDamage(string agentId, double amount, bool ignite = false)
    {
        Agent agent = GetMoving(agentId);
        double bounded = double.IsFinite(amount) ? Math.Clamp(amount, 0, 100) : 0;
        agent.Health = Math.Max(0, agent.Health - bounded);
        agent.DamageState = ignite
            ? TrafficDamageStates.OnFire
            : agent.Health <= 0
                ? TrafficDamageStates.Disabled
                : agent.Health < 55
                    ? TrafficDamageStates.Damaged
                    : TrafficDamageStates.Healthy;
        agent.FireElapsed = 0;
        return agent.DamageState;
    }

    public TrafficAgentSnapshot GetSnapshot(string agentId) => ToSnapshot(GetMoving(agentId));

    public double GetPedestrianDetectionDistance(string agentId)
    {
        Agent agent = GetMoving(agentId);
        return PedestrianTrafficModel.GetYieldKinematics(agent.Speed, 7).DetectionDistance;
    }

    public TrafficPedestrianInteraction UpdatePedestrianEncounter(
        string agentId,
        PedestrianTrafficContact? contact,
        double delta)
    {
        Agent agent = GetMoving(agentId);
        PedestrianYieldKinematics kinematics = PedestrianTrafficModel.GetYieldKinematics(agent.Speed, 7);
        if (contact is null)
        {
            agent.PedestrianId = null;
            agent.PedestrianEncounter = null;
            agent.PedestrianShouldYield = false;
            agent.PedestrianEmergencyStop = false;
            return new TrafficPedestrianInteraction(false, false, false, false, kinematics.DetectionDistance, []);
        }

        double impactDistance = PedestrianTrafficModel.GetEmergencyStopDistance(agent.TypeId);
        bool impact = agent.Speed > 2
            && contact.ForwardDistance <= impactDistance
            && contact.LateralDistance <= 1.55;
        if (impact)
        {
            agent.PedestrianId = null;
            agent.PedestrianEncounter = null;
            agent.PedestrianShouldYield = false;
            agent.PedestrianEmergencyStop = false;
            IReadOnlyList<string> responders = [];
            bool started = false;
            if (!agent.PlayerControlled && !agent.Emergency && agent.HitAndRun is null
                && agent.DamageState is not TrafficDamageStates.Disabled and not TrafficDamageStates.OnFire)
            {
                responders = BeginHitAndRun(agent, new TrafficPoint(
                    agent.Position.X + Math.Sin(agent.Heading) * contact.ForwardDistance,
                    agent.Position.Z + Math.Cos(agent.Heading) * contact.ForwardDistance));
                started = true;
            }
            return new TrafficPedestrianInteraction(false, false, true, started, kinematics.DetectionDistance, responders);
        }

        if (!string.Equals(agent.PedestrianId, contact.PedestrianId, StringComparison.Ordinal))
        {
            agent.PedestrianId = contact.PedestrianId;
            agent.PedestrianEncounter = new PedestrianTrafficEncounter(agent.Impatient);
        }
        PedestrianTrafficAction action = PedestrianTrafficModel.UpdateEncounter(agent.PedestrianEncounter, delta);
        agent.PedestrianEncounter = action.State;
        agent.PedestrianShouldYield = action.ShouldYield;
        agent.PedestrianEmergencyStop = action.ShouldYield && contact.Distance <= impactDistance;
        if (action.ShouldHonk) agent.HornCount += 1;
        return new TrafficPedestrianInteraction(
            action.ShouldYield, action.ShouldHonk, false, false, kinematics.DetectionDistance, []);
    }

    public EnforcementResponseSnapshot DispatchOrUpdateEnforcement(
        string targetId,
        TrafficPoint targetPosition,
        int requestedResponders)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(targetId);
        if (!double.IsFinite(targetPosition.X) || !double.IsFinite(targetPosition.Z))
        {
            throw new ArgumentOutOfRangeException(nameof(targetPosition));
        }
        int maximum = Math.Clamp(requestedResponders, 1, 4);
        foreach (Agent unavailable in moving.Values.Where(agent => agent.EnforcementTargetId == targetId
            && (agent.PlayerControlled
                || agent.DamageState is TrafficDamageStates.Disabled or TrafficDamageStates.OnFire)))
        {
            unavailable.EnforcementTargetId = null;
            unavailable.EnforcementTargetPosition = null;
            unavailable.SirenActive = unavailable.PursuitTargetId is not null;
        }
        Agent[] assigned = moving.Values
            .Where(agent => agent.EnforcementTargetId == targetId
                && agent.DamageState is not TrafficDamageStates.Disabled and not TrafficDamageStates.OnFire)
            .OrderBy(agent => DistanceSquared(agent.Position, targetPosition))
            .ThenBy(agent => agent.Id, StringComparer.Ordinal)
            .Take(maximum)
            .ToArray();
        if (assigned.Length < maximum)
        {
            SpatialQueryResult<Agent> nearby = vehicleGrid.Query(
                new SpatialPoint(targetPosition.X, targetPosition.Z), 500);
            maximumLocalCandidates = Math.Max(maximumLocalCandidates, nearby.CandidatesTested);
            HashSet<string> assignedIds = assigned.Select(agent => agent.Id).ToHashSet(StringComparer.Ordinal);
            Agent[] additions = nearby.Items
                .Where(agent => agent.TypeId == "POLICE"
                    && !agent.PlayerControlled
                    && agent.PursuitTargetId is null
                    && agent.EnforcementTargetId is null
                    && agent.DamageState is not TrafficDamageStates.Disabled and not TrafficDamageStates.OnFire
                    && !assignedIds.Contains(agent.Id))
                .OrderBy(agent => DistanceSquared(agent.Position, targetPosition))
                .ThenBy(agent => agent.Id, StringComparer.Ordinal)
                .Take(maximum - assigned.Length)
                .ToArray();
            foreach (Agent police in additions)
            {
                police.EnforcementTargetId = targetId;
                police.EnforcementTargetPosition = targetPosition;
                police.SirenActive = true;
            }
            assigned = assigned.Concat(additions).ToArray();
        }
        foreach (Agent police in assigned)
        {
            police.EnforcementTargetPosition = targetPosition;
            police.SirenActive = true;
        }
        double nearest = assigned.Length == 0
            ? double.PositiveInfinity
            : Math.Sqrt(assigned.Min(agent => DistanceSquared(agent.Position, targetPosition)));
        return new EnforcementResponseSnapshot(targetId, assigned.Select(agent => agent.Id).ToArray(), nearest);
    }

    public bool ClearEnforcement(string targetId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(targetId);
        bool cleared = false;
        foreach (Agent police in moving.Values.Where(agent => agent.EnforcementTargetId == targetId))
        {
            police.EnforcementTargetId = null;
            police.EnforcementTargetPosition = null;
            police.SirenActive = police.PursuitTargetId is not null;
            cleared = true;
        }
        return cleared;
    }

    private void AdvanceAgent(
        Agent agent,
        double delta,
        bool bridgePriorityEnabled,
        double speedMultiplier,
        double bridgeSpeedMultiplier)
    {
        if (agent.DamageState == TrafficDamageStates.OnFire)
        {
            agent.FireElapsed += delta;
            agent.Speed = Approach(agent.Speed, 0, 12 * delta);
            if (agent.FireElapsed >= config.FireDisableSeconds) agent.DamageState = TrafficDamageStates.Disabled;
            return;
        }
        if (agent.DamageState == TrafficDamageStates.Disabled)
        {
            agent.Speed = Approach(agent.Speed, 0, 18 * delta);
            return;
        }

        RoadGraphNodeSnapshot target = graphNodes[agent.TargetNodeId];
        double offsetX = target.Position.X - agent.Position.X;
        double offsetZ = target.Position.Z - agent.Position.Z;
        double distance = Math.Sqrt(offsetX * offsetX + offsetZ * offsetZ);
        double desiredHeading = distance > 1e-6 ? Math.Atan2(offsetX, offsetZ) : agent.Heading;
        bool onPrimaryBridge = agent.Position.X >= TrafficProductivityModel.BridgeMinimumX
            && agent.Position.X <= TrafficProductivityModel.BridgeMaximumX
            && Math.Abs(agent.Position.Z) <= 18;
        bool ordinaryTraffic = !agent.Emergency
            && agent.HitAndRun is null
            && agent.PursuitTargetId is null
            && agent.EnforcementTargetPosition is null;
        double directiveMultiplier = ordinaryTraffic
            ? onPrimaryBridge ? bridgeSpeedMultiplier : speedMultiplier
            : 1;
        double maximumSpeed = MaximumSpeedFor(agent) * directiveMultiplier;
        double turnLimit = TrafficNavigationModel.GetTurnSpeedLimit(
            agent.Position, target.Position, agent.Heading, maximumSpeed);
        double targetSpeed = Math.Min(maximumSpeed, turnLimit);
        if (ShouldStopForControl(agent, target, distance)) targetSpeed = 0;
        if (agent.PedestrianShouldYield) targetSpeed = 0;

        SpatialQueryMetrics nearby = vehicleGrid.QueryInto(
            new SpatialPoint(agent.Position.X, agent.Position.Z),
            config.NeighborQueryRadius,
            nearbyAgents);
        maximumLocalCandidates = Math.Max(maximumLocalCandidates, nearby.CandidatesTested);
        Agent? blocker = FindBlocker(agent, nearbyAgents);
        if (blocker is not null)
        {
            targetSpeed = Math.Min(targetSpeed, Math.Max(0, blocker.Speed - 2));
            if (agent.Impatient && agent.Speed < 0.5)
            {
                agent.ImpatienceElapsed += delta;
                if (agent.ImpatienceElapsed >= 3.5 && !agent.HornedForBlocker)
                {
                    agent.HornedForBlocker = true;
                    agent.HornCount += 1;
                }
            }
        }
        else
        {
            agent.ImpatienceElapsed = 0;
            agent.HornedForBlocker = false;
        }

        agent.TargetSpeed = targetSpeed;
        double acceleration = targetSpeed < agent.Speed ? 18 : 7;
        agent.Speed = agent.PedestrianShouldYield
            ? PedestrianTrafficModel.ApproachTargetSpeed(agent.Speed, targetSpeed, acceleration, delta, pedestrianBlocked: true)
            : Approach(agent.Speed, targetSpeed, acceleration * delta);
        if (agent.PedestrianEmergencyStop) agent.Speed = 0;
        agent.Heading = ApproachAngle(agent.Heading, desiredHeading, Math.Min(1, delta * 4));
        agent.Position = new TrafficPoint(
            agent.Position.X + Math.Sin(agent.Heading) * agent.Speed * delta,
            agent.Position.Z + Math.Cos(agent.Heading) * agent.Speed * delta);
        LaneCorridorResult corridor = graph.EnforceLaneCorridor(
            agent.Position, agent.CurrentNodeId, agent.TargetNodeId, ProfileWidth(agent.TypeId));
        agent.Position = corridor.Position;

        RouteAdvanceResult route = graph.AdvanceRoute(
            agent.CurrentNodeId,
            agent.TargetNodeId,
            agent.Position,
            randoms.TrafficBehavior,
            bridgePriorityEnabled);
        if (route.Advanced)
        {
            DepartStop(agent);
            agent.CurrentNodeId = route.CurrentNodeId;
            agent.TargetNodeId = route.TargetNodeId;
            if (agent.PursuitTargetId is not null && moving.TryGetValue(agent.PursuitTargetId, out Agent? offender))
            {
                agent.TargetNodeId = graphNodes[agent.CurrentNodeId].NextNodeIds
                    .OrderBy(id => DistanceSquared(graphNodes[id].Position, offender.Position))
                    .ThenBy(id => id, StringComparer.Ordinal)
                    .First();
            }
            else if (agent.EnforcementTargetPosition is not null)
            {
                TrafficPoint enforcementTarget = agent.EnforcementTargetPosition;
                agent.TargetNodeId = graphNodes[agent.CurrentNodeId].NextNodeIds
                    .OrderBy(id => DistanceSquared(graphNodes[id].Position, enforcementTarget))
                    .ThenBy(id => id, StringComparer.Ordinal)
                    .First();
            }
            LaneCorridorResult nextCorridor = graph.EnforceLaneCorridor(
                agent.Position, agent.CurrentNodeId, agent.TargetNodeId, ProfileWidth(agent.TypeId));
            agent.Position = nextCorridor.Position;
            agent.StuckElapsed = 0;
        }
        else if (agent.Speed < 0.1 && targetSpeed > 1)
        {
            agent.StuckElapsed += delta;
            if (agent.StuckElapsed >= config.StuckRecoverySeconds) Recover(agent);
        }
        else
        {
            agent.StuckElapsed = 0;
        }
    }

    private bool ShouldStopForControl(Agent agent, RoadGraphNodeSnapshot target, double distance)
    {
        TrafficApproach? approach = TrafficRulesModel.ParseApproach(target.Id);
        if (approach is null || distance > 16 || agent.Emergency || !agent.Driver.Compliant) return false;
        TrafficControl? control = Controls.FindControl(approach.X, approach.Z);
        if (control is null) return false;
        if (control.Type == TrafficControlTypes.Signal)
        {
            string state = Controls.SignalState(control, approach.Axis);
            return state is TrafficSignalStates.Red or TrafficSignalStates.Yellow;
        }
        if (!string.Equals(agent.StopControlId, control.Id, StringComparison.Ordinal))
        {
            DepartStop(agent);
            Controls.Arrive(control.Id, agent.Id);
            agent.StopControlId = control.Id;
        }
        return !Controls.CanProceed(control.Id, agent.Id);
    }

    private void DepartStop(Agent agent)
    {
        if (agent.StopControlId is null) return;
        _ = Controls.Depart(agent.StopControlId, agent.Id);
        agent.StopControlId = null;
    }

    private static Agent? FindBlocker(Agent source, IReadOnlyList<Agent> candidates)
    {
        double forwardX = Math.Sin(source.Heading);
        double forwardZ = Math.Cos(source.Heading);
        Agent? closest = null;
        double closestDistance = 12;
        foreach (Agent candidate in candidates)
        {
            if (ReferenceEquals(candidate, source) || candidate.Parked) continue;
            double x = candidate.Position.X - source.Position.X;
            double z = candidate.Position.Z - source.Position.Z;
            double forward = x * forwardX + z * forwardZ;
            if (forward <= 0 || forward >= closestDistance) continue;
            double lateral = Math.Abs(x * forwardZ - z * forwardX);
            if (lateral > 2.4) continue;
            closest = candidate;
            closestDistance = forward;
        }
        return closest;
    }

    private void Recover(Agent agent)
    {
        RoadGraphNodeSnapshot current = graphNodes[agent.CurrentNodeId];
        agent.Position = current.Position;
        agent.Speed = 4;
        agent.TargetSpeed = 4;
        agent.StuckElapsed = 0;
        agent.RecoveryCount += 1;
    }

    private void EnsurePopulationFloor()
    {
        while (moving.Count < config.MovingVehicleFloor) SpawnMoving();
    }

    private void SpawnMoving()
    {
        long serial = ++nextMovingSerial;
        RoadGraphNodeSnapshot[] spawnNodes = graphNodes.Values
            .Where(node => node.Id.Contains("_OUT:", StringComparison.Ordinal) && node.NextNodeIds.Count > 0)
            .OrderBy(node => node.Id, StringComparer.Ordinal)
            .ToArray();
        RoadGraphNodeSnapshot start = spawnNodes[randoms.TrafficSpawn.NextInt(spawnNodes.Length)];
        string targetId = start.NextNodeIds[randoms.TrafficSpawn.NextInt(start.NextNodeIds.Count)];
        string typeId = SpawnProfileIds[randoms.TrafficSpawn.NextInt(SpawnProfileIds.Length)];
        DriverRuleProfile driver = TrafficRulesModel.CreateDriverProfile(serial);
        var agent = new Agent
        {
            Id = $"traffic-moving-{serial:0000}",
            Serial = serial,
            TypeId = typeId,
            Position = start.Position,
            Heading = HeadingTo(start.Position, graphNodes[targetId].Position),
            Speed = 5 + randoms.TrafficSpawn.NextRange(0, 4),
            TargetSpeed = ProfileMaximumSpeed(typeId),
            CurrentNodeId = start.Id,
            TargetNodeId = targetId,
            Driver = driver,
            Impatient = randoms.TrafficBehavior.Chance(0.2),
            Emergency = typeId == "POLICE",
            DetailTier = TrafficAgentDetailTiers.Far,
            SimulationCadence = 8,
        };
        moving.Add(agent.Id, agent);
    }

    private void SpawnParked()
    {
        long serial = ++nextParkedSerial;
        RoadGraphNodeSnapshot[] nodes = graphNodes.Values
            .Where(node => node.Id.Contains("_OUT:", StringComparison.Ordinal))
            .OrderBy(node => node.Id, StringComparer.Ordinal)
            .ToArray();
        RoadGraphNodeSnapshot node = nodes[(int)((serial * 7) % nodes.Length)];
        string typeId = SpawnProfileIds[(int)(serial % 4)];
        var agent = new Agent
        {
            Id = $"traffic-parked-{serial:0000}",
            Serial = serial,
            TypeId = typeId,
            Position = new TrafficPoint(node.Position.X + 5, node.Position.Z + 5),
            CurrentNodeId = node.Id,
            TargetNodeId = node.NextNodeIds[0],
            Driver = TrafficRulesModel.CreateDriverProfile(serial),
            Parked = true,
            DetailTier = TrafficAgentDetailTiers.Far,
            SimulationCadence = int.MaxValue,
        };
        parked.Add(agent.Id, agent);
    }

    private void UpdateTier(Agent agent, TrafficPoint focus)
    {
        double x = agent.Position.X - focus.X;
        double z = agent.Position.Z - focus.Z;
        double distanceSquared = x * x + z * z;
        if (distanceSquared <= config.NearDistance * config.NearDistance)
        {
            agent.DetailTier = TrafficAgentDetailTiers.Near;
            agent.SimulationCadence = 1;
        }
        else if (distanceSquared <= config.MediumDistance * config.MediumDistance)
        {
            agent.DetailTier = TrafficAgentDetailTiers.Medium;
            agent.SimulationCadence = 2;
        }
        else
        {
            agent.DetailTier = TrafficAgentDetailTiers.Far;
            agent.SimulationCadence = 8;
        }
    }

    private Agent GetMoving(string id) => moving.TryGetValue(id, out Agent? agent)
        ? agent
        : throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown moving traffic agent.");

    private void RefreshGraphNodes()
    {
        if (graph.Revision == graphRevision) return;
        TrafficRoadGraphSnapshot graphSnapshot = graph.Snapshot();
        GraphSnapshotRefreshCount += 1;
        graphNodes.Clear();
        foreach (RoadGraphNodeSnapshot node in graphSnapshot.Nodes) graphNodes.Add(node.Id, node);
        foreach (Agent agent in moving.Values)
        {
            if (graphNodes.ContainsKey(agent.CurrentNodeId) && graphNodes.ContainsKey(agent.TargetNodeId)) continue;
            string nearest = graph.FindNearestRoutableNode(agent.Position);
            RoadGraphNodeSnapshot node = graphNodes[nearest];
            agent.CurrentNodeId = nearest;
            agent.TargetNodeId = node.NextNodeIds[0];
            agent.StuckElapsed = 0;
        }
        graphRevision = graphSnapshot.Revision;
    }

    private static TrafficAgentSnapshot ToSnapshot(Agent agent) => new(
        agent.Id,
        agent.TypeId,
        agent.Position,
        agent.Heading,
        agent.Speed,
        agent.TargetSpeed,
        agent.CurrentNodeId,
        agent.TargetNodeId,
        agent.Parked,
        agent.PlayerControlled,
        agent.Emergency,
        agent.Driver,
        agent.Impatient,
        agent.DetailTier,
        agent.SimulationCadence,
        agent.DamageState,
        agent.Health,
        agent.RecoveryCount,
        agent.HornCount,
        agent.HitAndRun is not null,
        agent.PursuitTargetId,
        agent.EnforcementTargetId,
        agent.SirenActive);

    private IReadOnlyList<string> BeginHitAndRun(Agent offender, TrafficPoint origin)
    {
        SpatialQueryResult<Agent> nearby = vehicleGrid.Query(
            new SpatialPoint(origin.X, origin.Z),
            HitAndRunPursuitModel.DefaultConfig.NearbyPoliceRadius);
        maximumLocalCandidates = Math.Max(maximumLocalCandidates, nearby.CandidatesTested);
        IReadOnlyList<string> responders = HitAndRunPursuitModel.SelectNearbyPolice(
            nearby.Items.Select(candidate => new HitAndRunPoliceCandidate(
                candidate.Id,
                candidate.Position,
                candidate.TypeId == "POLICE",
                candidate.PlayerControlled,
                candidate.DamageState is TrafficDamageStates.Disabled or TrafficDamageStates.OnFire,
                candidate.Parked,
                candidate.PursuitTargetId is not null || candidate.EnforcementTargetId is not null)).ToArray(),
            origin);
        offender.HitAndRun = HitAndRunPursuitModel.Create(
            offender.Id, ProfileMaximumSpeed(offender.TypeId), responders);
        foreach (string responderId in responders)
        {
            Agent police = moving[responderId];
            police.PursuitTargetId = offender.Id;
            police.SirenActive = true;
        }
        return responders;
    }

    private void AdvancePursuits(double delta)
    {
        foreach (Agent offender in moving.Values.Where(agent => agent.HitAndRun is not null).ToArray())
        {
            offender.HitAndRun = HitAndRunPursuitModel.Advance(offender.HitAndRun!, delta);
            if (!offender.HitAndRun.Active
                || offender.DamageState is TrafficDamageStates.Disabled or TrafficDamageStates.OnFire)
            {
                ClearPursuit(offender);
            }
        }
    }

    private void ClearPursuit(Agent offender)
    {
        if (offender.HitAndRun is null) return;
        foreach (string responderId in offender.HitAndRun.ResponderIds)
        {
            if (!moving.TryGetValue(responderId, out Agent? police)
                || police.PursuitTargetId != offender.Id) continue;
            police.PursuitTargetId = null;
            police.SirenActive = police.EnforcementTargetId is not null;
        }
        offender.HitAndRun = null;
    }

    private double MaximumSpeedFor(Agent agent)
    {
        if (agent.HitAndRun is not null) return agent.HitAndRun.EscapeSpeed;
        if (agent.PursuitTargetId is not null && moving.TryGetValue(agent.PursuitTargetId, out Agent? offender))
        {
            double distance = Math.Sqrt(DistanceSquared(agent.Position, offender.Position));
            return HitAndRunPursuitModel.GetPoliceSpeed(
                ProfileMaximumSpeed(agent.TypeId), offender.Speed, distance);
        }
        if (agent.EnforcementTargetPosition is not null)
        {
            return HitAndRunPursuitModel.DefaultConfig.PoliceMaximumSpeed;
        }
        return ProfileMaximumSpeed(agent.TypeId) * (agent.Emergency ? 1.12 : 1);
    }

    private static double DistanceSquared(TrafficPoint first, TrafficPoint second)
    {
        double x = first.X - second.X;
        double z = first.Z - second.Z;
        return x * x + z * z;
    }

    private static double ProfileMaximumSpeed(string typeId) => typeId switch
    {
        "SPORTS" => 22,
        "BUS" => 13,
        "TRUCK" => 12,
        "POLICE" => 21,
        "MOTORBIKE" => 19,
        _ => 16,
    };

    private static double ProfileWidth(string typeId) => typeId switch
    {
        "BUS" or "TRUCK" => 2.5,
        "MOTORBIKE" => 0.8,
        _ => 1.9,
    };

    private static double HeadingTo(TrafficPoint source, TrafficPoint target) =>
        Math.Atan2(target.X - source.X, target.Z - source.Z);

    private static double Approach(double current, double target, double maximumChange) =>
        current < target ? Math.Min(target, current + maximumChange) : Math.Max(target, current - maximumChange);

    private static double ApproachAngle(double current, double target, double weight)
    {
        double difference = target - current;
        while (difference < -Math.PI) difference += Math.PI * 2;
        while (difference > Math.PI) difference -= Math.PI * 2;
        return current + difference * Math.Clamp(weight, 0, 1);
    }

    private static void ValidateConfig(TrafficPopulationConfig config)
    {
        if (config.MovingVehicleFloor < 0 || config.ParkedVehicleCount < 0
            || !double.IsFinite(config.NearDistance) || config.NearDistance <= 0
            || !double.IsFinite(config.MediumDistance) || config.MediumDistance <= config.NearDistance
            || !double.IsFinite(config.NeighborQueryRadius) || config.NeighborQueryRadius <= 0
            || !double.IsFinite(config.StuckRecoverySeconds) || config.StuckRecoverySeconds <= 0
            || !double.IsFinite(config.FireDisableSeconds) || config.FireDisableSeconds <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(config), "Traffic population configuration is invalid.");
        }
    }

    private sealed class Agent
    {
        public required string Id { get; init; }
        public required long Serial { get; init; }
        public required string TypeId { get; init; }
        public required TrafficPoint Position { get; set; }
        public double Heading { get; set; }
        public double Speed { get; set; }
        public double TargetSpeed { get; set; }
        public required string CurrentNodeId { get; set; }
        public required string TargetNodeId { get; set; }
        public bool Parked { get; init; }
        public bool PlayerControlled { get; set; }
        public bool Emergency { get; init; }
        public required DriverRuleProfile Driver { get; init; }
        public bool Impatient { get; init; }
        public required string DetailTier { get; set; }
        public int SimulationCadence { get; set; }
        public string DamageState { get; set; } = TrafficDamageStates.Healthy;
        public double Health { get; set; } = 100;
        public double FireElapsed { get; set; }
        public double StuckElapsed { get; set; }
        public int RecoveryCount { get; set; }
        public double ImpatienceElapsed { get; set; }
        public bool HornedForBlocker { get; set; }
        public int HornCount { get; set; }
        public string? StopControlId { get; set; }
        public string? PedestrianId { get; set; }
        public PedestrianTrafficEncounter? PedestrianEncounter { get; set; }
        public bool PedestrianShouldYield { get; set; }
        public bool PedestrianEmergencyStop { get; set; }
        public HitAndRunPursuitState? HitAndRun { get; set; }
        public string? PursuitTargetId { get; set; }
        public string? EnforcementTargetId { get; set; }
        public TrafficPoint? EnforcementTargetPosition { get; set; }
        public bool SirenActive { get; set; }
    }
}

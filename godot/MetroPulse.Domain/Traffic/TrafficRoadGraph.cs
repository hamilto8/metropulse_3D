using System.Collections.ObjectModel;
using MetroPulse.Domain.Randomness;

namespace MetroPulse.Domain.Traffic;

public static class RoadGraphMetadata
{
    public const string Authored = "AUTHORED";
    public const string UserRoad = "USER_ROAD";
    public const string PrimaryBridge = "PRIMARY_BRIDGE";
}

public sealed record RoadGraphNodeSnapshot(
    string Id,
    TrafficPoint Position,
    IReadOnlyList<string> NextNodeIds,
    string Source,
    string? RoadId = null);

public sealed record RoadGraphEdgeSnapshot(
    string Id,
    string FromNodeId,
    string ToNodeId,
    double Length,
    bool HasBridgePriority,
    string Source,
    string? RoadId = null);

public sealed record TrafficRoadGraphSnapshot(
    long Revision,
    int BaseNodeCount,
    IReadOnlyList<RoadGraphNodeSnapshot> Nodes,
    IReadOnlyList<RoadGraphEdgeSnapshot> Edges,
    IReadOnlyList<string> UserRoadIds);

public sealed record UserRoadSegmentDefinition(
    string Id,
    TrafficPoint Center,
    double Width,
    double Depth,
    double RotationY,
    bool IsIntersection,
    bool IsBridge = false);

public sealed record UserRoadRegistration(
    string Id,
    bool Connected,
    IReadOnlyList<string> NodeIds);

public sealed record RouteAdvanceResult(
    string CurrentNodeId,
    string TargetNodeId,
    bool Advanced,
    bool UsedBridgePriority);

public sealed record LaneCorridorResult(
    TrafficPoint Position,
    NavigationProjection Projection,
    double MaximumDeviation,
    bool Corrected);

public sealed record TemporaryRoadClosure(
    string Id,
    IReadOnlyList<string> EdgeIds,
    TrafficPoint Center,
    double Radius);

/// <summary>
/// Sole mutable owner of authored and player-built traffic topology. Every
/// published snapshot is detached from the mutable adjacency graph.
/// </summary>
public sealed class TrafficRoadGraph
{
    public static readonly IReadOnlyList<double> ProductionRoadCoordinatesX = Array.AsReadOnly(
        new double[] { -100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750 });

    public static readonly IReadOnlyList<double> ProductionRoadCoordinatesZ = Array.AsReadOnly(
        new double[] { -100, -50, 0, 50, 100 });

    private const double LaneOffset = 3.5;
    private const double UserRoadConnectionRadius = 38;
    private readonly Dictionary<string, Node> nodes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, UserRoadRecord> userRoads = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TemporaryRoadClosure> temporaryClosures = new(StringComparer.Ordinal);
    private readonly int baseNodeCount;

    private TrafficRoadGraph()
    {
        BuildProductionGraph();
        baseNodeCount = nodes.Count;
    }

    public long Revision { get; private set; }

    public int NodeCount => nodes.Count;

    public int BaseNodeCount => baseNodeCount;

    public int TemporaryClosureCount => temporaryClosures.Count;

    public int BlockedEdgeCount => temporaryClosures.Values
        .SelectMany(closure => closure.EdgeIds)
        .Distinct(StringComparer.Ordinal)
        .Count();

    public static TrafficRoadGraph CreateProduction() => new();

    public TrafficRoadGraphSnapshot Snapshot()
    {
        RoadGraphNodeSnapshot[] nodeSnapshots = nodes.Values
            .OrderBy(node => node.Id, StringComparer.Ordinal)
            .Select(node => new RoadGraphNodeSnapshot(
                node.Id,
                node.Position,
                new ReadOnlyCollection<string>(node.NextNodeIds.Order(StringComparer.Ordinal).ToArray()),
                node.Source,
                node.RoadId))
            .ToArray();
        RoadGraphEdgeSnapshot[] edges = nodes.Values
            .OrderBy(node => node.Id, StringComparer.Ordinal)
            .SelectMany(node => node.NextNodeIds.Order(StringComparer.Ordinal).Select(targetId =>
            {
                Node target = nodes[targetId];
                double length = Distance(node.Position, target.Position);
                return new RoadGraphEdgeSnapshot(
                    $"{node.Id}->{targetId}",
                    node.Id,
                    targetId,
                    length,
                    IsPrimaryBridgeEdge(node.Position, target.Position),
                    node.Source == RoadGraphMetadata.UserRoad || target.Source == RoadGraphMetadata.UserRoad
                        ? RoadGraphMetadata.UserRoad
                        : RoadGraphMetadata.Authored,
                    node.RoadId ?? target.RoadId);
            }))
            .ToArray();
        return new TrafficRoadGraphSnapshot(
            Revision,
            baseNodeCount,
            new ReadOnlyCollection<RoadGraphNodeSnapshot>(nodeSnapshots),
            new ReadOnlyCollection<RoadGraphEdgeSnapshot>(edges),
            new ReadOnlyCollection<string>(userRoads.Keys.Order(StringComparer.Ordinal).ToArray()));
    }

    public RoadNetworkSnapshot GetRoadNetworkSnapshot()
    {
        RoadNetworkSegment[] segments = userRoads.Values
            .OrderBy(road => road.Definition.Id, StringComparer.Ordinal)
            .Select(road =>
            {
                HashSet<string> ownNodes = road.NodeIds.ToHashSet(StringComparer.Ordinal);
                bool connected = road.NodeIds.Any(nodeId => nodes[nodeId].NextNodeIds.Any(nextId => !ownNodes.Contains(nextId)));
                return new RoadNetworkSegment(road.Definition.Id, connected, road.Definition.Center);
            })
            .ToArray();
        return new RoadNetworkSnapshot(Array.AsReadOnly(segments), baseNodeCount);
    }

    public UserRoadRegistration RegisterUserRoad(UserRoadSegmentDefinition definition)
    {
        ValidateUserRoad(definition);
        if (userRoads.ContainsKey(definition.Id))
        {
            throw new InvalidOperationException($"User road '{definition.Id}' is already registered.");
        }

        string prefix = $"USER_ROAD:{definition.Id}";
        Node center = AddNode($"{prefix}:CENTER", definition.Center, RoadGraphMetadata.UserRoad, definition.Id);
        var roadNodes = new List<Node> { center };
        (string Suffix, double X, double Z)[] offsets = definition.IsIntersection
            ? [("N", 0, -definition.Depth / 2),
                ("S", 0, definition.Depth / 2),
                ("E", definition.Width / 2, 0),
                ("W", -definition.Width / 2, 0)]
            : [("N", 0, -definition.Depth / 2), ("S", 0, definition.Depth / 2)];

        double cosine = Math.Cos(definition.RotationY);
        double sine = Math.Sin(definition.RotationY);
        foreach ((string suffix, double offsetX, double offsetZ) in offsets)
        {
            TrafficPoint endpoint = new(
                definition.Center.X + offsetX * cosine + offsetZ * sine,
                definition.Center.Z - offsetX * sine + offsetZ * cosine);
            Node endpointNode = AddNode($"{prefix}:{suffix}", endpoint, RoadGraphMetadata.UserRoad, definition.Id);
            Connect(endpointNode, center);
            Connect(center, endpointNode);
            roadNodes.Add(endpointNode);
        }

        var roadNodeIds = roadNodes.Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
        double connectionRadius = definition.IsBridge ? 80 : UserRoadConnectionRadius;
        foreach (Node endpoint in roadNodes.Skip(1))
        {
            Node[] nearest = nodes.Values
                .Where(candidate => !roadNodeIds.Contains(candidate.Id))
                .Select(candidate => (Node: candidate, Distance: Distance(endpoint.Position, candidate.Position)))
                .Where(candidate => candidate.Distance <= connectionRadius)
                .OrderBy(candidate => candidate.Distance)
                .ThenBy(candidate => candidate.Node.Id, StringComparer.Ordinal)
                .Take(2)
                .Select(candidate => candidate.Node)
                .ToArray();
            foreach (Node candidate in nearest)
            {
                Connect(endpoint, candidate);
                Connect(candidate, endpoint);
            }
        }

        bool connected = roadNodes.Any(node => node.NextNodeIds.Any(nextId => !roadNodeIds.Contains(nextId)));
        userRoads.Add(definition.Id, new UserRoadRecord(definition, roadNodes.Select(node => node.Id).ToArray()));
        Revision += 1;
        return new UserRoadRegistration(
            definition.Id,
            connected,
            new ReadOnlyCollection<string>(roadNodes.Select(node => node.Id).ToArray()));
    }

    public bool UnregisterUserRoad(string roadId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(roadId);
        if (!userRoads.Remove(roadId, out UserRoadRecord? road))
        {
            return false;
        }
        var removed = road.NodeIds.ToHashSet(StringComparer.Ordinal);
        foreach (Node node in nodes.Values)
        {
            node.NextNodeIds.RemoveWhere(removed.Contains);
        }
        foreach (string nodeId in road.NodeIds)
        {
            nodes.Remove(nodeId);
        }
        Revision += 1;
        return true;
    }

    public TemporaryRoadClosure AddTemporaryClosure(
        string id,
        TrafficPoint center,
        double radius,
        int maximumEdges = 8)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        if (temporaryClosures.ContainsKey(id)) throw new InvalidOperationException($"Temporary road closure '{id}' already exists.");
        if (!double.IsFinite(center.X) || !double.IsFinite(center.Z)
            || !double.IsFinite(radius) || radius <= 0 || maximumEdges <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(radius), "Temporary closure geometry and capacity must be positive and finite.");
        }
        string[] edgeIds = nodes.Values
            .SelectMany(from => from.NextNodeIds.Select(toId => (From: from, To: nodes[toId])))
            .Select(edge => (Id: EdgeId(edge.From.Id, edge.To.Id), Distance: DistanceToSegment(center, edge.From.Position, edge.To.Position)))
            .Where(edge => edge.Distance <= radius)
            .OrderBy(edge => edge.Distance)
            .ThenBy(edge => edge.Id, StringComparer.Ordinal)
            .Take(maximumEdges)
            .Select(edge => edge.Id)
            .ToArray();
        var closure = new TemporaryRoadClosure(id.Trim(), Array.AsReadOnly(edgeIds), center, radius);
        temporaryClosures.Add(closure.Id, closure);
        Revision += 1;
        return closure;
    }

    public bool RemoveTemporaryClosure(string id)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        if (!temporaryClosures.Remove(id.Trim())) return false;
        Revision += 1;
        return true;
    }

    public RouteAdvanceResult AdvanceRoute(
        string currentNodeId,
        string targetNodeId,
        TrafficPoint position,
        IRandomStream random,
        bool bridgePriorityEnabled = false,
        double reachThreshold = 4.5)
    {
        ArgumentNullException.ThrowIfNull(random);
        Node current = GetNode(currentNodeId);
        Node target = GetNode(targetNodeId);
        if (!TrafficNavigationModel.HasReachedTarget(position, target.Position, current.Position, reachThreshold))
        {
            return new RouteAdvanceResult(current.Id, target.Id, false, false);
        }

        Node[] candidates = target.NextNodeIds
            .Select(id => nodes[id])
            .Where(candidate => !IsEdgeBlocked(target.Id, candidate.Id))
            .Where(candidate => !string.Equals(candidate.Id, current.Id, StringComparison.Ordinal))
            .OrderBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToArray();
        if (candidates.Length == 0)
        {
            candidates = target.NextNodeIds
                .Select(id => nodes[id])
                .Where(candidate => !IsEdgeBlocked(target.Id, candidate.Id))
                .OrderBy(candidate => candidate.Id, StringComparer.Ordinal)
                .ToArray();
        }
        if (candidates.Length == 0)
        {
            return new RouteAdvanceResult(target.Id, target.Id, false, false);
        }

        Node[] bridgeCandidates = bridgePriorityEnabled
            ? candidates.Where(candidate => IsPrimaryBridgeEdge(target.Position, candidate.Position)).ToArray()
            : [];
        bool usedPriority = bridgeCandidates.Length > 0;
        Node[] selection = usedPriority ? bridgeCandidates : candidates;
        Node next = selection[random.NextInt(selection.Length)];
        return new RouteAdvanceResult(target.Id, next.Id, true, usedPriority);
    }

    public LaneCorridorResult EnforceLaneCorridor(
        TrafficPoint position,
        string currentNodeId,
        string targetNodeId,
        double vehicleWidth,
        TrafficNavigationConfig? config = null)
    {
        if (!double.IsFinite(vehicleWidth) || vehicleWidth <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(vehicleWidth));
        }
        config ??= TrafficNavigationModel.DefaultConfig;
        Node current = GetNode(currentNodeId);
        Node target = GetNode(targetNodeId);
        NavigationProjection projection = TrafficNavigationModel.ProjectToSegment(position, current.Position, target.Position)
            ?? throw new InvalidOperationException("Cannot enforce a corridor for a degenerate graph edge.");
        double geometricMaximum = Math.Max(
            0.5,
            config.RoadHalfWidth - config.LaneCenterOffset - vehicleWidth / 2 - config.RoadEdgeClearance);
        double maximum = Math.Min(Math.Max(1, config.MaxLaneCenterDeviation), geometricMaximum);
        if (projection.Deviation <= maximum)
        {
            return new LaneCorridorResult(position, projection, maximum, false);
        }
        double offsetX = position.X - projection.X;
        double offsetZ = position.Z - projection.Z;
        double scale = maximum / projection.Deviation;
        return new LaneCorridorResult(
            new TrafficPoint(projection.X + offsetX * scale, projection.Z + offsetZ * scale),
            projection,
            maximum,
            true);
    }

    public string FindNearestRoutableNode(TrafficPoint position)
    {
        if (!double.IsFinite(position.X) || !double.IsFinite(position.Z))
        {
            throw new ArgumentOutOfRangeException(nameof(position));
        }
        return nodes.Values
            .Where(node => node.NextNodeIds.Any(target => !IsEdgeBlocked(node.Id, target)))
            .OrderBy(node => DistanceSquared(node.Position, position))
            .ThenBy(node => node.Id, StringComparer.Ordinal)
            .First()
            .Id;
    }

    private void BuildProductionGraph()
    {
        foreach (double x in ProductionRoadCoordinatesX)
        {
            foreach (double z in ProductionRoadCoordinatesZ)
            {
                AddNode($"EB_IN:{x},{z}", new(x - 10, z + LaneOffset));
                AddNode($"EB_OUT:{x},{z}", new(x + 10, z + LaneOffset));
                AddNode($"WB_IN:{x},{z}", new(x + 10, z - LaneOffset));
                AddNode($"WB_OUT:{x},{z}", new(x - 10, z - LaneOffset));
                AddNode($"SB_IN:{x},{z}", new(x - LaneOffset, z - 10));
                AddNode($"SB_OUT:{x},{z}", new(x - LaneOffset, z + 10));
                AddNode($"NB_IN:{x},{z}", new(x + LaneOffset, z + 10));
                AddNode($"NB_OUT:{x},{z}", new(x + LaneOffset, z - 10));
            }
        }

        for (int index = 0; index < ProductionRoadCoordinatesX.Count - 1; index += 1)
        {
            double first = ProductionRoadCoordinatesX[index];
            double second = ProductionRoadCoordinatesX[index + 1];
            foreach (double z in ProductionRoadCoordinatesZ)
            {
                if (first == 100 && second == 210 && z != 0) continue;
                Connect($"EB_OUT:{first},{z}", $"EB_IN:{second},{z}");
                Connect($"WB_OUT:{second},{z}", $"WB_IN:{first},{z}");
            }
        }
        for (int index = 0; index < ProductionRoadCoordinatesZ.Count - 1; index += 1)
        {
            double first = ProductionRoadCoordinatesZ[index];
            double second = ProductionRoadCoordinatesZ[index + 1];
            foreach (double x in ProductionRoadCoordinatesX)
            {
                Connect($"SB_OUT:{x},{first}", $"SB_IN:{x},{second}");
                Connect($"NB_OUT:{x},{second}", $"NB_IN:{x},{first}");
            }
        }

        foreach (double x in ProductionRoadCoordinatesX)
        {
            foreach (double z in ProductionRoadCoordinatesZ)
            {
                bool canDriveEast = x != 100 || z == 0;
                bool canDriveWest = x != 210 || z == 0;
                if (x < 750 && canDriveEast) Connect($"EB_IN:{x},{z}", $"EB_OUT:{x},{z}");
                if (z < 100) Connect($"EB_IN:{x},{z}", $"SB_OUT:{x},{z}");
                if (z > -100) Connect($"EB_IN:{x},{z}", $"NB_OUT:{x},{z}");

                if (x > -100 && canDriveWest) Connect($"WB_IN:{x},{z}", $"WB_OUT:{x},{z}");
                if (z > -100) Connect($"WB_IN:{x},{z}", $"NB_OUT:{x},{z}");
                if (z < 100) Connect($"WB_IN:{x},{z}", $"SB_OUT:{x},{z}");

                if (z < 100) Connect($"SB_IN:{x},{z}", $"SB_OUT:{x},{z}");
                if (x > -100 && canDriveWest) Connect($"SB_IN:{x},{z}", $"WB_OUT:{x},{z}");
                if (x < 750 && canDriveEast) Connect($"SB_IN:{x},{z}", $"EB_OUT:{x},{z}");

                if (z > -100) Connect($"NB_IN:{x},{z}", $"NB_OUT:{x},{z}");
                if (x < 750 && canDriveEast) Connect($"NB_IN:{x},{z}", $"EB_OUT:{x},{z}");
                if (x > -100 && canDriveWest) Connect($"NB_IN:{x},{z}", $"WB_OUT:{x},{z}");
            }
        }

        foreach (Node node in nodes.Values)
        {
            if (node.NextNodeIds.Count > 0) continue;
            string[] parts = node.Id.Split(':');
            string fallbackDirection = parts[0] switch
            {
                "EB_OUT" => "WB_IN",
                "WB_OUT" => "EB_IN",
                "NB_OUT" => "SB_IN",
                "SB_OUT" => "NB_IN",
                "EB_IN" => "WB_OUT",
                "WB_IN" => "EB_OUT",
                "NB_IN" => "SB_OUT",
                "SB_IN" => "NB_OUT",
                _ => throw new InvalidOperationException($"Unknown authored traffic direction '{parts[0]}'."),
            };
            Connect(node.Id, $"{fallbackDirection}:{parts[1]}");
        }
    }

    private Node AddNode(
        string id,
        TrafficPoint position,
        string source = RoadGraphMetadata.Authored,
        string? roadId = null)
    {
        var node = new Node(id, position, source, roadId);
        nodes.Add(id, node);
        return node;
    }

    private void Connect(string fromId, string toId) => Connect(GetNode(fromId), GetNode(toId));

    private static void Connect(Node from, Node to) => from.NextNodeIds.Add(to.Id);

    private Node GetNode(string id) => nodes.TryGetValue(id, out Node? node)
        ? node
        : throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown traffic road node.");

    private static void ValidateUserRoad(UserRoadSegmentDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        if (string.IsNullOrWhiteSpace(definition.Id) || definition.Id.Contains(':', StringComparison.Ordinal))
        {
            throw new ArgumentException("User-road IDs must be non-empty and cannot contain ':'.", nameof(definition));
        }
        if (!double.IsFinite(definition.Center.X) || !double.IsFinite(definition.Center.Z)
            || !double.IsFinite(definition.Width) || definition.Width < 10
            || !double.IsFinite(definition.Depth) || definition.Depth < 10
            || !double.IsFinite(definition.RotationY))
        {
            throw new ArgumentOutOfRangeException(nameof(definition), "User-road geometry must be finite and at least 10 metres wide/deep.");
        }
    }

    private static bool IsPrimaryBridgeEdge(TrafficPoint first, TrafficPoint second)
    {
        double minimumX = Math.Min(first.X, second.X);
        double maximumX = Math.Max(first.X, second.X);
        return minimumX <= 110 && maximumX >= 200 && Math.Abs(first.Z) <= 7 && Math.Abs(second.Z) <= 7;
    }

    private static double Distance(TrafficPoint first, TrafficPoint second) => Math.Sqrt(DistanceSquared(first, second));

    private static double DistanceSquared(TrafficPoint first, TrafficPoint second)
    {
        double x = first.X - second.X;
        double z = first.Z - second.Z;
        return x * x + z * z;
    }

    private bool IsEdgeBlocked(string fromId, string toId)
    {
        string edgeId = EdgeId(fromId, toId);
        return temporaryClosures.Values.Any(closure => closure.EdgeIds.Contains(edgeId, StringComparer.Ordinal));
    }

    private static string EdgeId(string fromId, string toId) => $"{fromId}->{toId}";

    private static double DistanceToSegment(TrafficPoint point, TrafficPoint start, TrafficPoint end)
    {
        double x = end.X - start.X;
        double z = end.Z - start.Z;
        double lengthSquared = x * x + z * z;
        if (lengthSquared <= double.Epsilon) return Distance(point, start);
        double projection = Math.Clamp(((point.X - start.X) * x + (point.Z - start.Z) * z) / lengthSquared, 0, 1);
        return Distance(point, new TrafficPoint(start.X + projection * x, start.Z + projection * z));
    }

    private sealed record UserRoadRecord(UserRoadSegmentDefinition Definition, IReadOnlyList<string> NodeIds);

    private sealed class Node(string id, TrafficPoint position, string source, string? roadId)
    {
        public string Id { get; } = id;

        public TrafficPoint Position { get; } = position;

        public string Source { get; } = source;

        public string? RoadId { get; } = roadId;

        public HashSet<string> NextNodeIds { get; } = new(StringComparer.Ordinal);
    }
}

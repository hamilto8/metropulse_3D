using System.Collections.ObjectModel;
using System.Globalization;
using MetroPulse.Domain.Randomness;

namespace MetroPulse.Domain.Pedestrians;

public sealed record SidewalkNodeSnapshot(
    string Id,
    PedestrianVector3 Position,
    IReadOnlyList<string> NextNodeIds,
    bool ParkPath);

public sealed record PedestrianSidewalkGraphSnapshot(IReadOnlyList<SidewalkNodeSnapshot> Nodes);

public sealed record SidewalkRouteAdvance(
    string CurrentNodeId,
    string TargetNodeId,
    bool Advanced);

/// <summary>Immutable authored sidewalk, crosswalk, bridge-walkway, and park-path topology.</summary>
public sealed class PedestrianSidewalkGraph
{
    public static readonly IReadOnlyList<double> ProductionCoordinatesX = Array.AsReadOnly(
        new double[] { -109, -91, -59, -41, -9, 9, 41, 59, 91, 109, 201, 219, 251, 269, 301, 319, 441, 459, 541, 559, 641, 659, 741, 759 });

    public static readonly IReadOnlyList<double> ProductionCoordinatesZ = Array.AsReadOnly(
        new double[] { -109, -91, -59, -41, -9, 9, 41, 59, 91, 109 });

    private readonly Dictionary<string, Node> nodes = new(StringComparer.Ordinal);

    private PedestrianSidewalkGraph() => Build();

    public int NodeCount => nodes.Count;

    public static PedestrianSidewalkGraph CreateProduction() => new();

    public PedestrianSidewalkGraphSnapshot Snapshot() => new(new ReadOnlyCollection<SidewalkNodeSnapshot>(nodes.Values
        .OrderBy(node => node.Id, StringComparer.Ordinal)
        .Select(node => new SidewalkNodeSnapshot(
            node.Id,
            node.Position,
            new ReadOnlyCollection<string>(node.Next.Order(StringComparer.Ordinal).ToArray()),
            node.ParkPath))
        .ToArray()));

    public SidewalkRouteAdvance Advance(
        string currentNodeId,
        string targetNodeId,
        PedestrianVector3 position,
        IRandomStream random,
        double threshold = 1.8)
    {
        ArgumentNullException.ThrowIfNull(position);
        ArgumentNullException.ThrowIfNull(random);
        if (random.Name != RandomStreamNames.PedestrianBehavior)
        {
            throw new ArgumentException("Sidewalk routing requires the pedestrian behavior stream.", nameof(random));
        }
        Node current = Get(currentNodeId);
        Node target = Get(targetNodeId);
        if (position.DistanceTo(target.Position) >= Math.Max(0.1, double.IsFinite(threshold) ? threshold : 1.8))
        {
            return new SidewalkRouteAdvance(current.Id, target.Id, false);
        }
        string[] candidates = target.Next
            .Where(id => !string.Equals(id, current.Id, StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();
        if (candidates.Length == 0) candidates = target.Next.Order(StringComparer.Ordinal).ToArray();
        if (candidates.Length == 0) throw new InvalidOperationException($"Sidewalk node '{target.Id}' is a dead end.");
        return new SidewalkRouteAdvance(target.Id, candidates[random.NextInt(candidates.Length)], true);
    }

    public string FindNearest(PedestrianVector3 position)
    {
        ArgumentNullException.ThrowIfNull(position);
        if (!position.IsFinite) throw new ArgumentException("Sidewalk query position must be finite.", nameof(position));
        return nodes.Values
            .OrderBy(node => node.Position.DistanceSquaredTo(position))
            .ThenBy(node => node.Id, StringComparer.Ordinal)
            .First()
            .Id;
    }

    private void Build()
    {
        foreach (double x in ProductionCoordinatesX)
        {
            foreach (double z in ProductionCoordinatesZ)
            {
                Add(CoordinateId(x, z), x, z, x < -60 && z < -60 ? 0.7 : 0.4);
            }
        }
        for (int xIndex = 0; xIndex < ProductionCoordinatesX.Count; xIndex += 1)
        {
            for (int zIndex = 0; zIndex < ProductionCoordinatesZ.Count; zIndex += 1)
            {
                double x = ProductionCoordinatesX[xIndex];
                double z = ProductionCoordinatesZ[zIndex];
                if (xIndex < ProductionCoordinatesX.Count - 1)
                {
                    double east = ProductionCoordinatesX[xIndex + 1];
                    bool riverGap = (x == 109 && east == 201) || (x == 319 && east == 441);
                    if (!riverGap || Math.Abs(z) <= 10) Connect(CoordinateId(x, z), CoordinateId(east, z));
                }
                if (zIndex < ProductionCoordinatesZ.Count - 1)
                {
                    Connect(CoordinateId(x, z), CoordinateId(x, ProductionCoordinatesZ[zIndex + 1]));
                }
            }
        }

        Add("park_center", -75, -75, 0.7, true);
        Add("park_n", -75, -91, 0.7, true);
        Add("park_s", -75, -59, 0.7, true);
        Add("park_w", -91, -75, 0.7, true);
        Add("park_e", -59, -75, 0.7, true);
        foreach (string edge in new[] { "park_n", "park_s", "park_w", "park_e" }) Connect("park_center", edge);
        Add("-75,-91", -75, -91, 0.7, true);
        Connect("park_n", "-75,-91");
        Connect("-75,-91", "-91,-91");
        Connect("-75,-91", "-59,-91");

        foreach (Node node in nodes.Values)
        {
            if (node.Next.Count == 0)
            {
                string fallback = nodes.Keys.Order(StringComparer.Ordinal).First(id => id != node.Id);
                node.Next.Add(fallback);
            }
        }
    }

    private void Add(string id, double x, double z, double y, bool park = false) =>
        nodes.Add(id, new Node(id, new PedestrianVector3(x, y, z), park));

    private void Connect(string firstId, string secondId)
    {
        Node first = Get(firstId);
        Node second = Get(secondId);
        first.Next.Add(second.Id);
        second.Next.Add(first.Id);
    }

    private Node Get(string id) => nodes.TryGetValue(id, out Node? node)
        ? node
        : throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown sidewalk node.");

    private static string CoordinateId(double x, double z) =>
        $"{x.ToString("0.################", CultureInfo.InvariantCulture)},{z.ToString("0.################", CultureInfo.InvariantCulture)}";

    private sealed class Node(string id, PedestrianVector3 position, bool parkPath)
    {
        public string Id { get; } = id;
        public PedestrianVector3 Position { get; } = position;
        public bool ParkPath { get; } = parkPath;
        public HashSet<string> Next { get; } = new(StringComparer.Ordinal);
    }
}

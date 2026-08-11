using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Traffic;

public sealed record TrafficControlPost(
    string Id,
    string ControlId,
    TrafficPoint Position,
    string FacingDirection);

public sealed record StopArrival(string AgentId, long Sequence, double ElapsedWaiting);

public sealed record TrafficControlSnapshot(
    string Id,
    string Type,
    string NorthSouthState,
    string EastWestState,
    IReadOnlyList<StopArrival> StopQueue);

/// <summary>Owns live signal time and deterministic four-way-stop arrival order.</summary>
public sealed class TrafficControlCoordinator
{
    private readonly IReadOnlyList<TrafficControl> controls;
    private readonly Dictionary<string, StopQueue> stopQueues = new(StringComparer.Ordinal);
    private long arrivalSequence;
    private double elapsed;

    public TrafficControlCoordinator(
        IReadOnlyList<double>? coordinatesX = null,
        IReadOnlyList<double>? coordinatesZ = null)
    {
        controls = TrafficRulesModel.CreateControlPlan(
            coordinatesX ?? TrafficRoadGraph.ProductionRoadCoordinatesX,
            coordinatesZ ?? TrafficRoadGraph.ProductionRoadCoordinatesZ);
        foreach (TrafficControl control in controls.Where(control => control.Type == TrafficControlTypes.Stop))
        {
            stopQueues.Add(control.Id, new StopQueue());
        }
        Posts = new ReadOnlyCollection<TrafficControlPost>(controls
            .SelectMany(CreatePosts)
            .OrderBy(post => post.Id, StringComparer.Ordinal)
            .ToArray());
    }

    public double Elapsed => elapsed;

    public IReadOnlyList<TrafficControl> Controls => controls;

    public IReadOnlyList<TrafficControlPost> Posts { get; }

    public void Advance(double delta)
    {
        if (!double.IsFinite(delta) || delta < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(delta));
        }
        elapsed += delta;
        foreach (StopQueue queue in stopQueues.Values)
        {
            queue.Advance(delta);
        }
    }

    public TrafficControl? FindControl(double x, double z) => controls.SingleOrDefault(
        control => control.X == x && control.Z == z);

    public string SignalState(TrafficControl control, string axis)
    {
        ArgumentNullException.ThrowIfNull(control);
        if (control.Type != TrafficControlTypes.Signal)
        {
            throw new ArgumentException("Signal state is available only for signal controls.", nameof(control));
        }
        return TrafficRulesModel.GetSignalState(elapsed, axis, control.PhaseOffset);
    }

    public StopArrival Arrive(string controlId, string agentId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(controlId);
        ArgumentException.ThrowIfNullOrWhiteSpace(agentId);
        StopQueue queue = GetStopQueue(controlId);
        return queue.Arrive(agentId, ++arrivalSequence);
    }

    public bool CanProceed(string controlId, string agentId)
    {
        StopQueue queue = GetStopQueue(controlId);
        StopArrival? first = queue.Arrivals.FirstOrDefault();
        return first is not null
            && string.Equals(first.AgentId, agentId, StringComparison.Ordinal)
            && first.ElapsedWaiting >= TrafficRulesModel.DefaultConfig.StopSignWaitDuration;
    }

    public bool Depart(string controlId, string agentId) => GetStopQueue(controlId).Remove(agentId);

    public TrafficControlSnapshot Snapshot(string controlId)
    {
        TrafficControl control = controls.SingleOrDefault(control => control.Id == controlId)
            ?? throw new ArgumentOutOfRangeException(nameof(controlId), controlId, "Unknown traffic control.");
        IReadOnlyList<StopArrival> arrivals = control.Type == TrafficControlTypes.Stop
            ? new ReadOnlyCollection<StopArrival>(GetStopQueue(controlId).Arrivals.ToArray())
            : Array.Empty<StopArrival>();
        return new TrafficControlSnapshot(
            control.Id,
            control.Type,
            control.Type == TrafficControlTypes.Signal ? SignalState(control, "NS") : TrafficSignalStates.Red,
            control.Type == TrafficControlTypes.Signal ? SignalState(control, "EW") : TrafficSignalStates.Red,
            arrivals);
    }

    private StopQueue GetStopQueue(string controlId) => stopQueues.TryGetValue(controlId, out StopQueue? queue)
        ? queue
        : throw new ArgumentOutOfRangeException(nameof(controlId), controlId, "Unknown four-way stop control.");

    private static IEnumerable<TrafficControlPost> CreatePosts(TrafficControl control)
    {
        const double offset = 8.5;
        yield return new($"{control.Id}:N", control.Id, new TrafficPoint(control.X - 6, control.Z - offset), "S");
        yield return new($"{control.Id}:S", control.Id, new TrafficPoint(control.X + 6, control.Z + offset), "N");
        yield return new($"{control.Id}:E", control.Id, new TrafficPoint(control.X + offset, control.Z - 6), "W");
        yield return new($"{control.Id}:W", control.Id, new TrafficPoint(control.X - offset, control.Z + 6), "E");
    }

    private sealed class StopQueue
    {
        private readonly List<StopArrival> arrivals = [];

        public IReadOnlyList<StopArrival> Arrivals => arrivals;

        public StopArrival Arrive(string agentId, long sequence)
        {
            StopArrival? existing = arrivals.SingleOrDefault(item => item.AgentId == agentId);
            if (existing is not null) return existing;
            var arrival = new StopArrival(agentId, sequence, 0);
            arrivals.Add(arrival);
            arrivals.Sort(static (left, right) => left.Sequence != right.Sequence
                ? left.Sequence.CompareTo(right.Sequence)
                : StringComparer.Ordinal.Compare(left.AgentId, right.AgentId));
            return arrival;
        }

        public void Advance(double delta)
        {
            for (int index = 0; index < arrivals.Count; index += 1)
            {
                arrivals[index] = arrivals[index] with { ElapsedWaiting = arrivals[index].ElapsedWaiting + delta };
            }
        }

        public bool Remove(string agentId)
        {
            int index = arrivals.FindIndex(item => item.AgentId == agentId);
            if (index < 0) return false;
            arrivals.RemoveAt(index);
            return true;
        }
    }
}

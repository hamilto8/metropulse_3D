using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Presentation;

public static class MinimapMarkerKinds
{
    public const string Player = "PLAYER";
    public const string Vehicle = "VEHICLE";
    public const string ParkedVehicle = "PARKED_VEHICLE";
    public const string Pedestrian = "PEDESTRIAN";
    public const string Emergency = "EMERGENCY";
    public const string Pickup = "PICKUP";
    public const string Checkpoint = "CHECKPOINT";
    public const string Objective = "OBJECTIVE";
    public const string WorkOrder = "WORK_ORDER";
}

public sealed record MinimapWorldPoint(double X, double Z);

public sealed record MinimapRoadInput(string Id, MinimapWorldPoint From, MinimapWorldPoint To, bool UserRoad = false);

public sealed record MinimapAgentInput(string Id, string Kind, MinimapWorldPoint Position, double Heading = 0, bool Parked = false, bool HeatResponder = false);

public sealed record MinimapMarkerInput(string Id, string Kind, string Label, MinimapWorldPoint Position);

public sealed record MinimapSource(
    GameState State,
    WorldBounds Bounds,
    IReadOnlyList<MinimapRoadInput> Roads,
    IReadOnlyList<MinimapAgentInput> Agents,
    MinimapWorldPoint? Player,
    double PlayerHeading,
    double Congestion,
    string? MissionObjective,
    IReadOnlyList<MinimapWorldPoint> MissionRoute,
    int MissionRouteIndex,
    IReadOnlyList<MinimapMarkerInput> MissionMarkers,
    IReadOnlyList<MinimapMarkerInput> WorkOrders);

public sealed record MinimapPoint(double X, double Y);

public sealed record MinimapLineView(string Id, MinimapPoint From, MinimapPoint To, bool UserRoad, double Congestion);

public sealed record MinimapIconView(string Id, string Kind, string Label, MinimapPoint Position, double Heading = 0);

public sealed record MinimapSnapshot(
    bool Visible,
    IReadOnlyList<MinimapLineView> Roads,
    IReadOnlyList<MinimapLineView> Route,
    IReadOnlyList<MinimapIconView> Icons,
    int HeatResponderCount,
    string AccessibilitySummary);

/// <summary>Bounds, filters, and normalizes authoritative world facts for a renderer.</summary>
public static class MinimapViewModel
{
    public static MinimapSnapshot Build(MinimapSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(source.Bounds);
        ArgumentNullException.ThrowIfNull(source.Roads);
        ArgumentNullException.ThrowIfNull(source.Agents);
        ArgumentNullException.ThrowIfNull(source.MissionRoute);
        ArgumentNullException.ThrowIfNull(source.MissionMarkers);
        ArgumentNullException.ThrowIfNull(source.WorkOrders);
        if (source.Bounds.MaxX <= source.Bounds.MinX || source.Bounds.MaxZ <= source.Bounds.MinZ)
            throw new ArgumentException("Minimap bounds must have positive area.", nameof(source));

        double congestion = Math.Clamp(source.Congestion, 0, 1);
        MinimapLineView[] roads = source.Roads
            .GroupBy(road => CanonicalEdge(road.From, road.To), StringComparer.Ordinal)
            .Select(group => group.First())
            .Select(road => new MinimapLineView(road.Id, Project(road.From, source.Bounds), Project(road.To, source.Bounds), road.UserRoad, congestion))
            .ToArray();
        bool survival = source.MissionObjective == MissionObjectiveTypes.Survival;
        MinimapWorldPoint[] remainingRoute = survival
            ? []
            : source.MissionRoute.Skip(Math.Clamp(source.MissionRouteIndex, 0, source.MissionRoute.Count)).ToArray();
        MinimapLineView[] route = remainingRoute.Zip(remainingRoute.Skip(1), (from, to) =>
                new MinimapLineView($"route:{from.X}:{from.Z}:{to.X}:{to.Z}", Project(from, source.Bounds), Project(to, source.Bounds), false, 0))
            .ToArray();
        var icons = new List<MinimapIconView>();
        if (source.Player is not null)
            icons.Add(new MinimapIconView("player", MinimapMarkerKinds.Player, "Player", Project(source.Player, source.Bounds), source.PlayerHeading));
        icons.AddRange(source.Agents.Select(agent => new MinimapIconView(
            agent.Id,
            agent.HeatResponder && !agent.Parked
                ? MinimapMarkerKinds.Emergency
                : agent.Parked ? MinimapMarkerKinds.ParkedVehicle : agent.Kind,
            agent.Id,
            Project(agent.Position, source.Bounds),
            agent.Heading)));
        if (!survival) icons.AddRange(source.MissionMarkers.Select(marker => Icon(marker, source.Bounds)));
        icons.AddRange(source.WorkOrders.Select(marker => Icon(marker, source.Bounds)));
        int heatResponders = source.Agents.Count(agent => agent.HeatResponder && !agent.Parked);
        int objectives = icons.Count(icon => icon.Kind is MinimapMarkerKinds.Pickup or MinimapMarkerKinds.Checkpoint or MinimapMarkerKinds.Objective or MinimapMarkerKinds.WorkOrder);
        return new MinimapSnapshot(
            source.State is GameState.StreetOnFoot or GameState.StreetVehicle,
            Array.AsReadOnly(roads),
            Array.AsReadOnly(route),
            Array.AsReadOnly(icons.ToArray()),
            heatResponders,
            $"Minimap with {roads.Length} road segments, {source.Agents.Count} live agents, {heatResponders} Heat responders, and {objectives} objectives or work orders.");
    }

    private static MinimapIconView Icon(MinimapMarkerInput marker, WorldBounds bounds) =>
        new(marker.Id, marker.Kind, marker.Label, Project(marker.Position, bounds));

    private static MinimapPoint Project(MinimapWorldPoint point, WorldBounds bounds) => new(
        Math.Clamp((point.X - bounds.MinX) / (bounds.MaxX - bounds.MinX), 0, 1),
        Math.Clamp((point.Z - bounds.MinZ) / (bounds.MaxZ - bounds.MinZ), 0, 1));

    private static string CanonicalEdge(MinimapWorldPoint from, MinimapWorldPoint to)
    {
        string a = $"{from.X:R},{from.Z:R}";
        string b = $"{to.X:R},{to.Z:R}";
        return string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}";
    }
}

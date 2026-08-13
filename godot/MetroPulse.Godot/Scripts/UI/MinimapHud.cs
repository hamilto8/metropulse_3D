using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Services;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Enforcement;
using MetroPulse.Godot.Missions;
using MetroPulse.Godot.Pedestrians;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;

namespace MetroPulse.Godot.UI;

public partial class MinimapHud : PanelContainer
{
    private double refreshIntervalSeconds = 0.2;
    private PlayerInterface playerInterface = null!;
    private LivingTrafficRuntime traffic = null!;
    private LivingPedestrianRuntime pedestrians = null!;
    private PlayerControlRuntime player = null!;
    private EnforcementRuntime enforcement = null!;
    private CityServicesRuntime services = null!;
    private MissionRuntime missions = null!;
    private GodotSessionRuntimeHost runtime = null!;
    private MinimapCanvas canvas = null!;
    private double refreshRemaining;

    public bool Initialized { get; private set; }

    public MinimapSnapshot? CurrentView { get; private set; }

    public int RefreshCount { get; private set; }

    public void Initialize(
        PlayerInterface interfaceOwner,
        LivingTrafficRuntime trafficOwner,
        LivingPedestrianRuntime pedestrianOwner,
        PlayerControlRuntime playerOwner,
        EnforcementRuntime enforcementOwner,
        CityServicesRuntime servicesOwner,
        MissionRuntime missionsOwner,
        GodotSessionRuntimeHost runtimeOwner,
        QualityProfilePolicy? qualityProfile = null)
    {
        if (Initialized) throw new InvalidOperationException("The minimap is already initialized.");
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        pedestrians = pedestrianOwner ?? throw new ArgumentNullException(nameof(pedestrianOwner));
        player = playerOwner ?? throw new ArgumentNullException(nameof(playerOwner));
        enforcement = enforcementOwner ?? throw new ArgumentNullException(nameof(enforcementOwner));
        services = servicesOwner ?? throw new ArgumentNullException(nameof(servicesOwner));
        missions = missionsOwner ?? throw new ArgumentNullException(nameof(missionsOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        refreshIntervalSeconds = (qualityProfile ?? QualityProfilePolicy.Resolve(QualityProfileIds.High)).MinimapRefreshSeconds;
        Name = "Minimap";
        ThemeTypeVariation = "GlassPanelStrong";
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "City minimap";
        AccessibilityDescription = "Roads, river, live agents, player, congestion, mission route, objectives, and work orders";
        var root = new VBoxContainer { Name = "Layout" };
        canvas = new MinimapCanvas { Name = "MapCanvas", SizeFlagsVertical = SizeFlags.ExpandFill, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        root.AddChild(canvas);
        root.AddChild(new Label
        {
            Text = "▲ Player  ◆ Objective  ■ Work  ✚ Emergency",
            ThemeTypeVariation = "Muted",
            HorizontalAlignment = HorizontalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        });
        AddChild(root);
        Initialized = true;
        SetProcess(true);
        RefreshNow();
    }

    public override void _Process(double delta)
    {
        if (!Initialized) return;
        refreshRemaining -= delta;
        if (refreshRemaining <= 0) RefreshNow();
    }

    public void RefreshNow()
    {
        EnsureInitialized();
        TrafficRoadGraphSnapshot graph = traffic.RoadGraph.Snapshot();
        IReadOnlyDictionary<string, RoadGraphNodeSnapshot> nodes = graph.Nodes.ToDictionary(node => node.Id, StringComparer.Ordinal);
        MinimapRoadInput[] roads = graph.Edges.Select(edge => new MinimapRoadInput(
            edge.Id,
            Point(nodes[edge.FromNodeId].Position),
            Point(nodes[edge.ToNodeId].Position),
            edge.Source == RoadGraphMetadata.UserRoad)).ToArray();
        TrafficPopulationSnapshot trafficSnapshot = traffic.Simulation.Snapshot();
        HashSet<string> responders = (enforcement.Response?.ResponderIds ?? Array.Empty<string>()).ToHashSet(StringComparer.Ordinal);
        IEnumerable<MinimapAgentInput> moving = trafficSnapshot.Moving.Select(agent => new MinimapAgentInput(
            agent.Id,
            MinimapMarkerKinds.Vehicle,
            Point(agent.Position),
            agent.Heading,
            HeatResponder: responders.Contains(agent.Id)));
        IEnumerable<MinimapAgentInput> parked = trafficSnapshot.Parked.Select(agent => new MinimapAgentInput(
            agent.Id,
            MinimapMarkerKinds.Vehicle,
            Point(agent.Position),
            agent.Heading,
            Parked: true,
            HeatResponder: responders.Contains(agent.Id)));
        PedestrianPopulationSnapshot pedestrianSnapshot = pedestrians.Simulation.Snapshot();
        IEnumerable<MinimapAgentInput> citizens = pedestrianSnapshot.Citizens.Select(agent => new MinimapAgentInput(
            agent.Id,
            MinimapMarkerKinds.Pedestrian,
            new MinimapWorldPoint(agent.Position.X, agent.Position.Z),
            agent.Heading));
        GameplayCameraTargetSnapshot? target = player.ControlledCameraTarget?.CaptureCameraTarget();
        MissionExecutionState? execution = missions.Execution.Snapshot;
        IReadOnlyList<MinimapWorldPoint> route = execution?.Route.Select(point => new MinimapWorldPoint(point.X, point.Z)).ToArray()
            ?? Array.Empty<MinimapWorldPoint>();
        IReadOnlyList<MinimapMarkerInput> missionMarkers = BuildMissionMarkers(execution);
        IncidentWorkOrder[] workOrders = services.Response.GetWorkOrders()
            .Where(order => order.Actionable && order.State.Position is not null)
            .ToArray();
        CurrentView = MinimapViewModel.Build(new MinimapSource(
            runtime.StateMachine.State,
            ContentDefinitions.WorldBounds,
            roads,
            moving.Concat(parked).Concat(citizens).ToArray(),
            target is null ? null : new MinimapWorldPoint(target.Position.X, target.Position.Z),
            target?.PlanarHeading ?? 0,
            traffic.Productivity?.Snapshot().Network.Congestion ?? 0,
            execution?.Objective,
            route,
            execution?.RouteIndex ?? 0,
            missionMarkers,
            workOrders.Select(order => new MinimapMarkerInput(
                order.Id,
                MinimapMarkerKinds.WorkOrder,
                order.State.Label ?? order.Id,
                new MinimapWorldPoint(order.State.Position!.X, order.State.Position.Z))).ToArray()));
        Visible = CurrentView.Visible;
        AccessibilityDescription = CurrentView.AccessibilitySummary;
        canvas.Apply(CurrentView);
        ApplyLayout(playerInterface.CurrentLayout);
        RefreshCount++;
        refreshRemaining = refreshIntervalSeconds;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetProcess(false);
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private IReadOnlyList<MinimapMarkerInput> BuildMissionMarkers(MissionExecutionState? execution)
    {
        if (execution is null || execution.Objective == MissionObjectiveTypes.Survival) return Array.Empty<MinimapMarkerInput>();
        return execution.Route.Select((point, index) => new { point, index })
            .Where(item => item.index >= execution.RouteIndex)
            .Select(item => new MinimapMarkerInput(
                $"mission:{execution.MissionId}:{item.index}",
                item.index == 0
                    ? MinimapMarkerKinds.Pickup
                    : item.index == execution.Route.Count - 1 ? MinimapMarkerKinds.Objective : MinimapMarkerKinds.Checkpoint,
                item.point.Label ?? (item.index == execution.Route.Count - 1 ? "Destination" : "Checkpoint"),
                new MinimapWorldPoint(item.point.X, item.point.Z)))
            .ToArray();
    }

    private void ApplyLayout(UiLayoutSnapshot layout)
    {
        float size = layout.MinimapSize;
        SetAnchorsPreset(LayoutPreset.BottomLeft);
        OffsetLeft = 16;
        OffsetTop = -(size + 72);
        OffsetRight = size + 16;
        OffsetBottom = -72;
    }

    private static MinimapWorldPoint Point(TrafficPoint point) => new(point.X, point.Z);

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("The minimap is not initialized.");
    }
}

public partial class MinimapCanvas : Control
{
    private MinimapSnapshot? view;

    public void Apply(MinimapSnapshot snapshot)
    {
        view = snapshot ?? throw new ArgumentNullException(nameof(snapshot));
        AccessibilityName = "Minimap drawing";
        AccessibilityDescription = snapshot.AccessibilitySummary;
        QueueRedraw();
    }

    public override void _Draw()
    {
        if (view is null) return;
        Rect2 area = new(new Vector2(8, 8), Size - new Vector2(16, 16));
        DrawRect(area, new Color("07131f"), true);
        DrawWater(area, 135, 185);
        DrawWater(area, 380, 420);
        foreach (MinimapLineView road in view.Roads)
        {
            Color roadColor = road.Congestion switch
            {
                > 0.72 => new Color("f97316"),
                > 0.4 => new Color("facc15"),
                _ => road.UserRoad ? new Color("d946ef") : new Color("64748b"),
            };
            DrawLine(ToCanvas(road.From, area), ToCanvas(road.To, area), roadColor, road.UserRoad ? 2.4f : 1.2f, true);
        }
        foreach (MinimapLineView route in view.Route) DrawDashed(ToCanvas(route.From, area), ToCanvas(route.To, area), new Color("22d3ee"));
        foreach (MinimapIconView icon in view.Icons) DrawIcon(icon, ToCanvas(icon.Position, area));
        DrawRect(area, new Color("22d3ee"), false, 1.5f);
    }

    private void DrawIcon(MinimapIconView icon, Vector2 point)
    {
        switch (icon.Kind)
        {
            case MinimapMarkerKinds.Player:
                Vector2 forward = new(MathF.Sin((float)icon.Heading), -MathF.Cos((float)icon.Heading));
                Vector2 right = new(-forward.Y, forward.X);
                DrawColoredPolygon([point + forward * 7, point - forward * 4 + right * 4, point - forward * 4 - right * 4], new Color("22d3ee"));
                break;
            case MinimapMarkerKinds.Emergency:
                DrawRect(new Rect2(point - new Vector2(3, 3), new Vector2(6, 6)), new Color("fb7185"), true);
                DrawLine(point - new Vector2(5, 0), point + new Vector2(5, 0), Colors.White, 1);
                DrawLine(point - new Vector2(0, 5), point + new Vector2(0, 5), Colors.White, 1);
                break;
            case MinimapMarkerKinds.ParkedVehicle:
                DrawArc(point, 2.5f, 0, MathF.Tau, 8, new Color("475569"), 1);
                break;
            case MinimapMarkerKinds.Vehicle:
                DrawCircle(point, 2.2f, new Color("94a3b8"));
                break;
            case MinimapMarkerKinds.Pedestrian:
                DrawCircle(point, 1.2f, new Color("a5f3fc"));
                break;
            case MinimapMarkerKinds.Pickup:
                DrawRect(new Rect2(point - new Vector2(4, 4), new Vector2(8, 8)), new Color("22c55e"), false, 2);
                break;
            case MinimapMarkerKinds.Checkpoint:
                DrawColoredPolygon([point + new Vector2(0, -5), point + new Vector2(5, 0), point + new Vector2(0, 5), point + new Vector2(-5, 0)], new Color("facc15"));
                break;
            case MinimapMarkerKinds.Objective:
                DrawCircle(point, 5, new Color("d946ef"), false, 2);
                break;
            case MinimapMarkerKinds.WorkOrder:
                DrawRect(new Rect2(point - new Vector2(4, 4), new Vector2(8, 8)), new Color("f97316"), true);
                break;
        }
    }

    private void DrawWater(Rect2 area, double minX, double maxX)
    {
        double worldWidth = ContentDefinitions.WorldBounds.MaxX - ContentDefinitions.WorldBounds.MinX;
        float left = area.Position.X + (float)((minX - ContentDefinitions.WorldBounds.MinX) / worldWidth) * area.Size.X;
        float right = area.Position.X + (float)((maxX - ContentDefinitions.WorldBounds.MinX) / worldWidth) * area.Size.X;
        DrawRect(new Rect2(left, area.Position.Y, right - left, area.Size.Y), new Color("0e7490", 0.55f), true);
    }

    private void DrawDashed(Vector2 from, Vector2 to, Color color)
    {
        float length = from.DistanceTo(to);
        if (length <= 0) return;
        Vector2 direction = (to - from) / length;
        for (float offset = 0; offset < length; offset += 8)
            DrawLine(from + direction * offset, from + direction * Math.Min(offset + 4, length), color, 2);
    }

    private static Vector2 ToCanvas(MinimapPoint point, Rect2 area) => new(
        area.Position.X + (float)point.X * area.Size.X,
        area.Position.Y + (float)point.Y * area.Size.Y);
}

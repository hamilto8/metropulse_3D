using Godot;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Presentation;
using MetroPulse.Godot.Enforcement;
using MetroPulse.Godot.Missions;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.UI;

/// <summary>Street gameplay telemetry, notification, news, arrest, and mission-history presentation.</summary>
public partial class GameplayHud : Control
{
    private const double RefreshIntervalSeconds = 0.1;
    private PlayerInterface playerInterface = null!;
    private PlayerControlRuntime player = null!;
    private EnforcementRuntime enforcement = null!;
    private GodotSessionRuntimeHost runtime = null!;
    private WorldEnvironmentController environment = null!;
    private CityServicesRuntime services = null!;
    private MissionRuntime missions = null!;
    private Label timeWeather = null!;
    private PanelContainer speedometer = null!;
    private Label vehicleType = null!;
    private Label speed = null!;
    private Label heat = null!;
    private Label arrest = null!;
    private VBoxContainer news = null!;
    private VBoxContainer toasts = null!;
    private PanelContainer historyPanel = null!;
    private VBoxContainer historyList = null!;
    private Button historyButton = null!;
    private Button historyClose = null!;
    private double refreshRemaining;
    private string contentSignature = string.Empty;
    private string arrestSignature = string.Empty;

    public bool Initialized { get; private set; }

    public GameplayHudSnapshot? CurrentView { get; private set; }

    public int RefreshCount { get; private set; }

    public bool HistoryVisible => historyPanel.Visible;

    public void Initialize(
        PlayerInterface interfaceOwner,
        PlayerControlRuntime playerOwner,
        EnforcementRuntime enforcementOwner,
        GodotSessionRuntimeHost runtimeOwner,
        WorldEnvironmentController environmentOwner,
        CityServicesRuntime servicesOwner,
        MissionRuntime missionsOwner)
    {
        if (Initialized) throw new InvalidOperationException("The gameplay HUD is already initialized.");
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        player = playerOwner ?? throw new ArgumentNullException(nameof(playerOwner));
        enforcement = enforcementOwner ?? throw new ArgumentNullException(nameof(enforcementOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        environment = environmentOwner ?? throw new ArgumentNullException(nameof(environmentOwner));
        services = servicesOwner ?? throw new ArgumentNullException(nameof(servicesOwner));
        missions = missionsOwner ?? throw new ArgumentNullException(nameof(missionsOwner));
        Name = "GameplayHud";
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "Street gameplay interface";
        AccessibilityDescription = "Vehicle speed, weather, enforcement Heat, news, alerts, and mission history";
        BuildControls();
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
        var controlledVehicle = player.ControlledVehicle;
        double vehicleSpeed = controlledVehicle is null
            ? 0
            : new Vector2(controlledVehicle.LinearVelocity.X, controlledVehicle.LinearVelocity.Z).Length();
        MissionExecutionState? execution = missions.Execution.Snapshot;
        CurrentView = GameplayHudViewModel.Build(new GameplayHudSource(
            runtime.StateMachine.State,
            player.ControlledKind,
            vehicleSpeed,
            controlledVehicle?.TypeId,
            null,
            enforcement.State,
            enforcement.Response,
            enforcement.LastOutcome,
            environment.Current ?? throw new InvalidOperationException("Environment presentation is unavailable."),
            execution,
            execution is null ? null : missions.Registry.Get(execution.MissionId),
            missions.Execution.NavigationTarget,
            services.Alerts.Snapshot(),
            services.Outcomes.Snapshot(),
            missions.Registry));

        Visible = CurrentView.Visible;
        if (!Visible)
        {
            historyPanel.Visible = false;
            refreshRemaining = RefreshIntervalSeconds;
            return;
        }
        timeWeather.Text = CurrentView.TimeWeather;
        timeWeather.AccessibilityName = $"Time and weather: {CurrentView.TimeWeather}";
        speedometer.Visible = CurrentView.Vehicle.Visible;
        vehicleType.Text = CurrentView.Vehicle.VehicleType;
        speed.Text = CurrentView.Vehicle.Speed;
        speed.AccessibilityName = $"Speed {CurrentView.Vehicle.Speed} kilometres per hour";
        speed.AccessibilityDescription = CurrentView.Vehicle.SpeedDescription;
        heat.Visible = CurrentView.Heat.Visible;
        heat.Text = $"{CurrentView.Heat.Tier} · {CurrentView.Heat.Heat}\n{CurrentView.Heat.Detail}";
        heat.AccessibilityName = CurrentView.Heat.Tier;
        heat.AccessibilityDescription = $"{CurrentView.Heat.Heat}. {CurrentView.Heat.Detail}";
        arrest.Visible = CurrentView.Heat.Arrested;
        arrest.Text = CurrentView.Heat.Arrested ? "ARRESTED\nSafe recovery in progress" : string.Empty;
        UpdateDynamicContent(CurrentView);
        ApplyLayout(playerInterface.CurrentLayout);
        RefreshCount++;
        refreshRemaining = RefreshIntervalSeconds;
    }

    public void ToggleHistory()
    {
        EnsureInitialized();
        historyPanel.Visible = !historyPanel.Visible;
        if (historyPanel.Visible) historyClose.CallDeferred(Control.MethodName.GrabFocus);
        else historyButton.CallDeferred(Control.MethodName.GrabFocus);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetProcess(false);
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildControls()
    {
        timeWeather = new Label { ThemeTypeVariation = "Metric", HorizontalAlignment = HorizontalAlignment.Right };
        AddChild(timeWeather);

        speedometer = new PanelContainer { ThemeTypeVariation = "GlassPanelStrong", MouseFilter = MouseFilterEnum.Ignore };
        speedometer.AccessibilityName = "Vehicle speedometer";
        var speedStack = new VBoxContainer { Alignment = BoxContainer.AlignmentMode.Center };
        vehicleType = new Label { HorizontalAlignment = HorizontalAlignment.Center, ThemeTypeVariation = "Muted" };
        speed = new Label { HorizontalAlignment = HorizontalAlignment.Center, ThemeTypeVariation = "Title" };
        var unit = new Label { Text = "km/h", HorizontalAlignment = HorizontalAlignment.Center, ThemeTypeVariation = "Muted" };
        speedStack.AddChild(vehicleType);
        speedStack.AddChild(speed);
        speedStack.AddChild(unit);
        speedometer.AddChild(speedStack);
        AddChild(speedometer);

        heat = new Label
        {
            ThemeTypeVariation = "Danger",
            HorizontalAlignment = HorizontalAlignment.Center,
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite,
        };
        AddChild(heat);

        news = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        AddChild(news);
        toasts = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        AddChild(toasts);

        arrest = new Label
        {
            ThemeTypeVariation = "Title",
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            AccessibilityName = "Arrest status",
            AccessibilityDescription = "The player was arrested and is being returned to a safe recovery point",
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Assertive,
            MouseFilter = MouseFilterEnum.Ignore,
        };
        AddChild(arrest);

        historyButton = AccessibilityFocus.Describe(
            new Button { Name = "MissionHistoryButton", Text = "Mission History", MouseFilter = MouseFilterEnum.Stop },
            "Mission History",
            "Open the history of committed mission results");
        historyButton.Pressed += ToggleHistory;
        AddChild(historyButton);
        AccessibilityFocus.LinkVertical([historyButton]);
        historyPanel = new PanelContainer
        {
            ThemeTypeVariation = "GlassPanelStrong",
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            AccessibilityName = "Mission history",
            AccessibilityDescription = "Committed mission results in newest-first order",
        };
        var historyRoot = new VBoxContainer();
        historyRoot.AddChild(new Label { Text = "MISSION HISTORY", ThemeTypeVariation = "Title" });
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        historyList = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        scroll.AddChild(historyList);
        historyRoot.AddChild(scroll);
        historyClose = AccessibilityFocus.Describe(new Button { Text = "Close" }, "Close mission history", "Return focus to the Mission History button");
        historyClose.Pressed += ToggleHistory;
        AccessibilityFocus.LinkVertical([historyClose]);
        historyRoot.AddChild(historyClose);
        historyPanel.AddChild(historyRoot);
        AddChild(historyPanel);
    }

    private void UpdateDynamicContent(GameplayHudSnapshot view)
    {
        string signature = string.Join('|',
            view.News.Select(item => item.Id)
                .Concat(view.Toasts.Select(item => item.Id))
                .Concat(view.History.Select(item => item.Id)));
        if (signature != contentSignature)
        {
            contentSignature = signature;
            Clear(news);
            foreach (NewsCardView item in view.News)
            {
                news.AddChild(Card($"NEWS · {item.Headline}", item.Body, "News item"));
            }
            Clear(toasts);
            foreach (ToastView item in view.Toasts)
            {
                toasts.AddChild(Card($"{item.Severity} · {item.Title}", item.Detail, "City alert"));
            }
            Clear(historyList);
            foreach (MissionHistoryCardView item in view.History)
            {
                historyList.AddChild(Card($"{item.Outcome} · {item.Title}", item.Description, "Mission result"));
            }
            if (view.History.Count == 0) historyList.AddChild(new Label { Text = "No committed mission results yet.", ThemeTypeVariation = "Muted" });
        }
        string nextArrestSignature = view.Heat.Arrested ? view.Heat.Detail : string.Empty;
        if (nextArrestSignature != arrestSignature)
        {
            arrestSignature = nextArrestSignature;
            if (view.Heat.Arrested) playerInterface.Announce("Arrested. Safe recovery in progress.", true);
        }
    }

    private static PanelContainer Card(string title, string detail, string accessiblePrefix)
    {
        var panel = new PanelContainer { ThemeTypeVariation = "GlassPanel" };
        panel.AccessibilityName = $"{accessiblePrefix}: {title}";
        panel.AccessibilityDescription = detail;
        var stack = new VBoxContainer();
        stack.AddChild(new Label { Text = title, ThemeTypeVariation = "Metric", AutowrapMode = TextServer.AutowrapMode.WordSmart });
        stack.AddChild(new Label { Text = detail, ThemeTypeVariation = "Muted", AutowrapMode = TextServer.AutowrapMode.WordSmart });
        panel.AddChild(stack);
        return panel;
    }

    private void ApplyLayout(UiLayoutSnapshot layout)
    {
        timeWeather.SetAnchorsPreset(LayoutPreset.TopRight);
        timeWeather.OffsetLeft = -240;
        timeWeather.OffsetTop = 16;
        timeWeather.OffsetRight = -16;
        timeWeather.OffsetBottom = 52;
        speedometer.SetAnchorsPreset(LayoutPreset.BottomRight);
        speedometer.OffsetLeft = -160;
        speedometer.OffsetTop = -160;
        speedometer.OffsetRight = -16;
        speedometer.OffsetBottom = -16;
        heat.SetAnchorsPreset(LayoutPreset.CenterTop);
        heat.OffsetLeft = -190;
        heat.OffsetTop = 16;
        heat.OffsetRight = 190;
        heat.OffsetBottom = 84;
        news.SetAnchorsPreset(LayoutPreset.TopLeft);
        news.OffsetLeft = layout.StackTopStats ? 12 : 360;
        news.OffsetTop = 16;
        news.OffsetRight = layout.StackTopStats ? 340 : 700;
        news.OffsetBottom = 240;
        toasts.SetAnchorsPreset(LayoutPreset.RightWide);
        toasts.OffsetLeft = -360;
        toasts.OffsetTop = 100;
        toasts.OffsetRight = -16;
        toasts.OffsetBottom = -190;
        arrest.SetAnchorsPreset(LayoutPreset.Center);
        arrest.OffsetLeft = -260;
        arrest.OffsetTop = -80;
        arrest.OffsetRight = 260;
        arrest.OffsetBottom = 80;
        historyButton.SetAnchorsPreset(LayoutPreset.BottomLeft);
        historyButton.OffsetLeft = 16;
        historyButton.OffsetTop = -58;
        historyButton.OffsetRight = 180;
        historyButton.OffsetBottom = -16;
        historyPanel.SetAnchorsPreset(LayoutPreset.Center);
        float width = Math.Min(layout.ModalMaximumWidth, 760);
        historyPanel.OffsetLeft = -width / 2;
        historyPanel.OffsetTop = -240;
        historyPanel.OffsetRight = width / 2;
        historyPanel.OffsetBottom = 240;
    }

    private static void Clear(Node node)
    {
        foreach (Node child in node.GetChildren()) child.Free();
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("The gameplay HUD is not initialized.");
    }
}

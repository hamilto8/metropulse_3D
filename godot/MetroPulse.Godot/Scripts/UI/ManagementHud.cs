using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Construction;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.UI;

/// <summary>Godot presentation adapter for authoritative management and builder authorities.</summary>
public partial class ManagementHud : Control
{
    private const double RefreshIntervalSeconds = 0.1;
    private PlayerInterface playerInterface = null!;
    private CityEconomyRuntime economy = null!;
    private CityEditorRuntime editor = null!;
    private CityServicesRuntime services = null!;
    private LivingTrafficRuntime traffic = null!;
    private GodotSessionRuntimeHost runtime = null!;
    private RuntimeInputHost input = null!;
    private WorldEnvironmentController environment = null!;
    private Camera3D camera = null!;
    private double refreshRemaining;
    private bool congestionOverlayVisible;
    private long lastProcessedPhysicsTick = -1;

    public bool Initialized { get; private set; }

    public ManagementUiSnapshot? CurrentView { get; private set; }

    public TopCityBar TopBar { get; private set; } = null!;

    public CityToolsPanel Tools { get; private set; } = null!;

    public BuilderPanel Builder { get; private set; } = null!;

    public ControlRibbon Ribbon { get; private set; } = null!;

    public int RefreshCount { get; private set; }

    public bool CongestionOverlayVisible => congestionOverlayVisible;

    public void Initialize(
        PlayerInterface interfaceOwner,
        CityEconomyRuntime economyOwner,
        CityEditorRuntime editorOwner,
        CityServicesRuntime serviceOwner,
        LivingTrafficRuntime trafficOwner,
        GodotSessionRuntimeHost runtimeOwner,
        RuntimeInputHost inputOwner,
        WorldEnvironmentController environmentOwner,
        Camera3D cameraOwner)
    {
        if (Initialized) throw new InvalidOperationException("The management HUD is already initialized.");
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        economy = economyOwner ?? throw new ArgumentNullException(nameof(economyOwner));
        editor = editorOwner ?? throw new ArgumentNullException(nameof(editorOwner));
        services = serviceOwner ?? throw new ArgumentNullException(nameof(serviceOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        environment = environmentOwner ?? throw new ArgumentNullException(nameof(environmentOwner));
        camera = cameraOwner ?? throw new ArgumentNullException(nameof(cameraOwner));

        Name = "ManagementHud";
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "City management interface";
        AccessibilityDescription = "City status, management tools, construction forecasts, and adaptive controls";
        BuildControls();
        WireEvents();
        Initialized = true;
        SetProcess(true);
        SetProcessUnhandledInput(true);
        RefreshNow();
    }

    public override void _Process(double delta)
    {
        if (!Initialized) return;
        refreshRemaining -= delta;
        if (refreshRemaining <= 0) RefreshNow();

        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        if (snapshot.PhysicsTick == lastProcessedPhysicsTick) return;
        lastProcessedPhysicsTick = snapshot.PhysicsTick;
        if (runtime.StateMachine.State == GameState.Management)
        {
            if (snapshot.JustPressed.Contains("BUILD") || snapshot.JustPressed.Contains("MODE")) RequestModeToggle();
            return;
        }
        if (runtime.StateMachine.State != GameState.Builder) return;
        if (snapshot.JustPressed.Contains("BACK"))
        {
            RequestModeToggle();
            return;
        }
        if (snapshot.JustPressed.Contains("ROTATE")) RunAction("Preview rotated", () => editor.RotateBlueprint());
        if (snapshot.JustPressed.Contains("DELETE")) RunAction("Selected city asset demolished", () => editor.DemolishSelected());
        if (snapshot.JustPressed.Contains("PLACE") && GetViewport().GuiGetHoveredControl() is null) ConfirmEdit();
        if (Math.Abs(snapshot.LeftStick.X) > RuntimeInputState.DefaultDeadzone
            || Math.Abs(snapshot.LeftStick.Y) > RuntimeInputState.DefaultDeadzone)
        {
            _ = editor.ControllerNavigate(snapshot.LeftStick.X, -snapshot.LeftStick.Y, delta);
        }
    }

    public override void _UnhandledInput(InputEvent inputEvent)
    {
        if (!Initialized
            || runtime.StateMachine.State != GameState.Builder
            || inputEvent is not InputEventMouseMotion
            || GetViewport().GuiGetHoveredControl() is not null)
        {
            return;
        }
        Vector2 pointer = GetViewport().GetMousePosition();
        Vector3 origin = camera.ProjectRayOrigin(pointer);
        Vector3 direction = camera.ProjectRayNormal(pointer);
        if (Math.Abs(direction.Y) < 0.0001) return;
        float distance = -origin.Y / direction.Y;
        if (distance <= 0) return;
        Vector3 worldPoint = origin + (direction * distance);
        _ = editor.SetAim(worldPoint.X, worldPoint.Z);
    }

    public void RefreshNow()
    {
        EnsureInitialized();
        GameState state = runtime.StateMachine.State;
        bool ownsPresentation = state is GameState.Management or GameState.Builder;
        Visible = ownsPresentation;
        editor.SetActive(state == GameState.Builder);
        if (!ownsPresentation)
        {
            refreshRemaining = RefreshIntervalSeconds;
            return;
        }

        CurrentView = ManagementUiViewModel.Build(new ManagementUiSource(
            economy.Current,
            economy.Ledger.GetFiscalOverview(),
            services.Model.Snapshot(),
            traffic.Productivity?.Snapshot()
                ?? throw new InvalidOperationException("Traffic productivity is unavailable."),
            services.Alerts.Snapshot(),
            environment.Current
                ?? throw new InvalidOperationException("Environment presentation is unavailable."),
            state,
            input.LatestSnapshot.ActiveInterface,
            runtime.CityTimeScale,
            editor.GetCatalog(includeAdvanced: false, includeLocked: true),
            editor.SelectedSpec,
            editor.CurrentDecision,
            editor.GridSnapEnabled,
            editor.Tool.ToString().ToUpperInvariant(),
            editor.Records.Count,
            editor.Zones.Count,
            congestionOverlayVisible));

        UiLayoutSnapshot layout = playerInterface.CurrentLayout;
        bool compact = layout.StackTopStats;
        TopBar.Apply(CurrentView.TopBar, compact);
        Tools.Apply(CurrentView.Tools);
        Builder.Apply(CurrentView);
        Builder.ApplyLayout(compact);
        Ribbon.Apply(input.LatestSnapshot, runtime.CityTimeScale, layout.UseTwoRowControlRibbon);
        Builder.Visible = CurrentView.BuilderVisible;
        ApplyLayout(layout);
        RefreshCount++;
        refreshRemaining = RefreshIntervalSeconds;
    }

    public void RequestModeToggle()
    {
        EnsureInitialized();
        GameState destination = runtime.StateMachine.State == GameState.Builder
            ? GameState.Management
            : GameState.Builder;
        RunAction(
            destination == GameState.Builder ? "Builder opened" : "Returned to Management",
            () => runtime.TransitionTo(destination, new TransitionRequestOptions("phase9:management-ui", nameof(ManagementHud))));
    }

    public void RequestTimeScale(double scale) =>
        RunAction($"City speed set to {scale:0.#} times", () => runtime.SetCityTimeScale(scale));

    public void RequestSectionAction(string sectionId)
    {
        switch (sectionId)
        {
            case CityToolSectionIds.Economy:
                RunAction("Emergency assistance request processed", () => economy.Ledger.RequestEmergencyAssistance());
                break;
            case CityToolSectionIds.Traffic:
                RunAction("Bridge traffic policy changed", () => traffic.Productivity!.ToggleBridgePriority());
                break;
            case CityToolSectionIds.Atmosphere:
                RunAction("Weather advanced", () => environment.CycleWeather());
                break;
            case CityToolSectionIds.Overlay:
                congestionOverlayVisible = !congestionOverlayVisible;
                playerInterface.Announce(congestionOverlayVisible ? "Congestion overlay shown" : "Congestion overlay hidden");
                RefreshNow();
                break;
        }
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetProcess(false);
        SetProcessUnhandledInput(false);
        TopBar.Shutdown();
        Tools.Shutdown();
        Builder.Shutdown();
        Ribbon.Shutdown();
        if (editor.Initialized) editor.SetActive(false);
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildControls()
    {
        TopBar = new TopCityBar();
        TopBar.Initialize();
        AddChild(TopBar);
        Tools = new CityToolsPanel();
        Tools.Initialize();
        AddChild(Tools);
        Builder = new BuilderPanel();
        Builder.Initialize();
        AddChild(Builder);
        Ribbon = new ControlRibbon();
        Ribbon.Initialize();
        AddChild(Ribbon);
    }

    private void WireEvents()
    {
        TopBar.ToolsRequested += () => Tools.SetCollapsed(!Tools.Collapsed);
        TopBar.ModeRequested += RequestModeToggle;
        Tools.SectionActionRequested += RequestSectionAction;
        Ribbon.TimeScaleRequested += RequestTimeScale;
        Builder.CatalogSelected += id => RunAction("Builder catalog selection changed", () => editor.SelectCatalog(id));
        Builder.ToolSelected += tool => RunAction($"{tool} tool selected", () => editor.SetTool(Enum.Parse<CityEditorTool>(tool, true)));
        Builder.ConfirmRequested += ConfirmEdit;
        Builder.GridToggleRequested += () => RunAction("Grid snap changed", editor.ToggleGridSnap);
        Builder.RotateRequested += () => RunAction("Preview rotated", () => editor.RotateBlueprint());
        Builder.CancelRequested += () => RunAction("Builder action cancelled", editor.Cancel);
        Builder.ZoneRequested += zone => RunAction($"{zone.ToLowerInvariant()} zone applied", () => editor.ApplyZone(zone));
    }

    private void ConfirmEdit()
    {
        switch (editor.Tool)
        {
            case CityEditorTool.Place:
                RunAction($"{editor.SelectedSpec.Name} placed", () => editor.Place());
                break;
            case CityEditorTool.Select:
                RunAction("Selection updated", () => editor.SelectAtAim());
                break;
            case CityEditorTool.Move:
                RunAction("Selected city asset moved", () => editor.MoveSelected());
                break;
            case CityEditorTool.Rotate:
                RunAction("Selected city asset rotated", () => editor.RotateSelected());
                break;
            case CityEditorTool.Demolish:
                RunAction("Selected city asset demolished", () => editor.DemolishSelected());
                break;
            case CityEditorTool.Zone:
                playerInterface.Announce("Choose Residential, Commercial, or Operations zoning", true);
                break;
        }
    }

    private void RunAction(string announcement, Action action)
    {
        EnsureInitialized();
        try
        {
            action();
            playerInterface.Announce(announcement);
            RefreshNow();
        }
        catch (Exception exception)
        {
            playerInterface.Announce(exception.Message, true);
        }
    }

    private void ApplyLayout(UiLayoutSnapshot layout)
    {
        TopBar.SetAnchorsPreset(LayoutPreset.TopWide);
        TopBar.OffsetLeft = 0;
        TopBar.OffsetTop = 0;
        TopBar.OffsetRight = 0;
        TopBar.OffsetBottom = layout.TopBarHeight;

        Ribbon.SetAnchorsPreset(LayoutPreset.BottomWide);
        Ribbon.OffsetLeft = 0;
        Ribbon.OffsetRight = 0;
        Ribbon.OffsetTop = -(layout.UseTwoRowControlRibbon ? 104 : 64);
        Ribbon.OffsetBottom = 0;

        Tools.SetAnchorsPreset(LayoutPreset.LeftWide);
        Tools.OffsetLeft = 0;
        Tools.OffsetTop = layout.TopBarHeight + 8;
        Tools.OffsetRight = layout.ToolPanelWidth;
        Tools.OffsetBottom = -(layout.UseTwoRowControlRibbon ? 112 : 72);
        if (RefreshCount == 0 && layout.CollapseToolsByDefault) Tools.SetCollapsed(true);

        Builder.SetAnchorsPreset(LayoutPreset.RightWide);
        Builder.OffsetLeft = layout.StackTopStats ? -Math.Min((float)layout.EffectiveWidth, layout.InspectorPanelWidth * 2f) : -(layout.InspectorPanelWidth * 2f);
        Builder.OffsetTop = layout.TopBarHeight + 8;
        Builder.OffsetRight = 0;
        Builder.OffsetBottom = -(layout.UseTwoRowControlRibbon ? 112 : 72);
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("The management HUD is not initialized.");
    }
}

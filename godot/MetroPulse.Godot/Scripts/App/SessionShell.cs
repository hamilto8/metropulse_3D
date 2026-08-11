using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Diagnostics;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Enforcement;
using MetroPulse.Godot.Pedestrians;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.App;

public partial class SessionShell : Node
{
    private Func<bool>? unsubscribeWeatherGrip;
    public bool IsShutDown { get; private set; }

    public bool IsInteractiveReleased { get; private set; }

    public RuntimeInputHost? InputHost { get; private set; }

    public MvpWorldGenerator? World { get; private set; }

    public GameContentRegistry? Content { get; private set; }

    public WorldEnvironmentController? Environment { get; private set; }

    public CachedBillboardSystem? Billboards { get; private set; }

    public GodotCameraWorldAdapter? CameraAdapter { get; private set; }

    public GodotSessionRuntimeHost? RuntimeHost { get; private set; }

    public GameplayCameraRig? GameplayCamera { get; private set; }

    public PlayerControlRuntime? PlayerControl { get; private set; }

    public PlayerVehicleInteractionPublisher? VehicleInteractions { get; private set; }

    public LivingTrafficRuntime? LivingTraffic { get; private set; }

    public LivingPedestrianRuntime? LivingPedestrians { get; private set; }

    public EnforcementRuntime? Enforcement { get; private set; }

    public CityEconomyRuntime? Economy { get; private set; }

    public override void _Ready()
    {
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            LogSeverity.Information,
            "session.created",
            "An empty disposable session shell was created."));
    }

    public void InitializeRuntimeInput(SettingsStore settings)
    {
        if (InputHost is not null)
        {
            throw new InvalidOperationException("The session runtime input owner already exists.");
        }

        Node runtimeServices = GetNode<Node>("RuntimeServices");
        InputHost = new RuntimeInputHost { Name = "RuntimeInputHost" };
        runtimeServices.AddChild(InputHost);
        InputHost.Initialize(settings);
        CameraAdapter ??= GetNode<GodotCameraWorldAdapter>("CameraRig");
        GameplayCamera = new GameplayCameraRig { Name = "GameplayCamera" };
        runtimeServices.AddChild(GameplayCamera);
        GameplayCamera.Initialize(InputHost, settings, CameraAdapter);
        PlayerControl = new PlayerControlRuntime { Name = "PlayerControl" };
        runtimeServices.AddChild(PlayerControl);
        PlayerControl.Initialize(
            InputHost,
            World ?? throw new InvalidOperationException("The world must exist before player control is initialized."),
            Content ?? throw new InvalidOperationException("Content must exist before player control is initialized."),
            GetNode<Node3D>("WorldRoot/AgentRoot"),
            CameraAdapter);
        LivingTraffic = new LivingTrafficRuntime { Name = "LivingTraffic" };
        runtimeServices.AddChild(LivingTraffic);
        LivingTraffic.Initialize(
            Content ?? throw new InvalidOperationException("Content must exist before traffic is initialized."),
            World ?? throw new InvalidOperationException("The world must exist before traffic is initialized."),
            PlayerControl,
            GetNode<Node3D>("WorldRoot/AgentRoot"),
            GetNode<Node3D>("WorldRoot/NavigationRoot"),
            CameraAdapter);
        LivingPedestrians = new LivingPedestrianRuntime { Name = "LivingPedestrians" };
        runtimeServices.AddChild(LivingPedestrians);
        LivingPedestrians.Initialize(
            Content ?? throw new InvalidOperationException("Content must exist before pedestrians are initialized."),
            World ?? throw new InvalidOperationException("The world must exist before pedestrians are initialized."),
            PlayerControl,
            LivingTraffic,
            GetNode<Node3D>("WorldRoot/AgentRoot"),
            CameraAdapter);
        RuntimeHost = new GodotSessionRuntimeHost { Name = "SessionRuntime" };
        runtimeServices.AddChild(RuntimeHost);
        RuntimeHost.Initialize(InputHost, GameplayCamera);
        RuntimeHost.SetControlBridge(PlayerControl);
        Economy = new CityEconomyRuntime { Name = "CityEconomy" };
        runtimeServices.AddChild(Economy);
        Economy.Initialize(
            Content ?? throw new InvalidOperationException("Content must exist before economy is initialized."),
            World?.Layout ?? throw new InvalidOperationException("The authored world layout must exist before economy is initialized."),
            RuntimeHost.Scheduler);
        VehicleInteractions = new PlayerVehicleInteractionPublisher { Name = "VehicleInteractions" };
        runtimeServices.AddChild(VehicleInteractions);
        VehicleInteractions.Initialize(PlayerControl, RuntimeHost, InputHost);
        Enforcement = new EnforcementRuntime { Name = "Enforcement" };
        runtimeServices.AddChild(Enforcement);
        Enforcement.Initialize(
            PlayerControl,
            LivingTraffic,
            LivingPedestrians,
            RuntimeHost,
            World ?? throw new InvalidOperationException("The world must exist before enforcement is initialized."));
        PlayerControl.RiderEjectionPrepared += OnRiderEjectionPrepared;
        unsubscribeWeatherGrip = Environment?.SubscribeState(
            snapshot => PlayerControl.ApplyWeatherGrip(snapshot.WeatherMode),
            emitCurrent: true);
    }

    public void InitializeWorld(GameContentRegistry content, SettingsStore settings)
    {
        if (World is not null)
        {
            throw new InvalidOperationException("The session world owner already exists.");
        }
        World = GetNode<MvpWorldGenerator>("WorldRoot/AuthoredWorld");
        Content = content;
        World.Initialize(content);
        CameraAdapter = GetNode<GodotCameraWorldAdapter>("CameraRig");
        CameraAdapter.Initialize(World, content);
        Environment = new WorldEnvironmentController { Name = "WorldPresentation" };
        GetNode<Node>("RuntimeServices").AddChild(Environment);
        Environment.Initialize(content, settings, World);
        Billboards = new CachedBillboardSystem { Name = "BillboardSystem" };
        GetNode<Node>("RuntimeServices").AddChild(Billboards);
        Billboards.Initialize(World);
        Billboards.ApplyStatus(Environment.Current?.Hour ?? 12, Environment.Current?.WeatherMode ?? content.DefaultWeatherMode);
    }

    public void Shutdown()
    {
        if (IsShutDown)
        {
            return;
        }

        IsShutDown = true;
        _ = unsubscribeWeatherGrip?.Invoke();
        unsubscribeWeatherGrip = null;
        if (PlayerControl is not null) PlayerControl.RiderEjectionPrepared -= OnRiderEjectionPrepared;
        VehicleInteractions?.Shutdown();
        Enforcement?.Shutdown();
        Economy?.Shutdown();
        RuntimeHost?.Shutdown();
        LivingPedestrians?.Shutdown();
        LivingTraffic?.Shutdown();
        PlayerControl?.Shutdown();
        GameplayCamera?.Shutdown();
        InputHost?.Shutdown();
        Environment?.Shutdown();
        Billboards?.Shutdown();
        World?.ShutdownWorld();
        Content = null;
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            LogSeverity.Information,
            "session.disposed",
            "The session shell released its owned runtime resources."));
    }

    public void ReleaseInteractiveControl()
    {
        if (IsShutDown)
        {
            throw new InvalidOperationException("A disposed session cannot receive interactive control.");
        }

        if (!IsInsideTree()
            || GetNodeOrNull<Node3D>("WorldRoot") is null
            || GetNodeOrNull<Camera3D>("CameraRig/MainCamera") is null
            || InputHost?.Initialized != true
            || GameplayCamera?.Initialized != true
            || PlayerControl?.Initialized != true
            || LivingTraffic?.Initialized != true
            || LivingPedestrians?.Initialized != true
            || Enforcement?.Initialized != true
            || Economy?.Initialized != true
            || RuntimeHost?.Initialized != true)
        {
            throw new InvalidOperationException("The session readiness contract is incomplete.");
        }

        IsInteractiveReleased = true;
        ProcessMode = ProcessModeEnum.Inherit;
    }

    public override void _ExitTree()
    {
        Shutdown();
    }

    private void OnRiderEjectionPrepared(PlayerVehicleController vehicle)
    {
        Callable.From(() => CompleteRiderEjection(vehicle)).CallDeferred();
    }

    private void CompleteRiderEjection(PlayerVehicleController vehicle)
    {
        if (IsShutDown || RuntimeHost?.StateMachine.State != GameState.StreetVehicle
            || !ReferenceEquals(PlayerControl?.ControlledVehicle, vehicle)) return;
        RuntimeHost.TransitionTo(
            GameState.StreetOnFoot,
            new TransitionRequestOptions("impact:rider-ejection", Name));
    }
}

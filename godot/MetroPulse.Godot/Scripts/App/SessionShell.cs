using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Aircraft;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Construction;
using MetroPulse.Godot.Diagnostics;
using MetroPulse.Godot.EastSide;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Effects;
using MetroPulse.Godot.Enforcement;
using MetroPulse.Godot.Mayhem;
using MetroPulse.Godot.Missions;
using MetroPulse.Godot.Pedestrians;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Rocket;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.App;

public partial class SessionShell : Node
{
    private Func<bool>? unsubscribeWeatherGrip;
    public bool IsShutDown { get; private set; }

    public bool IsInteractiveReleased { get; private set; }

    public RuntimeInputHost? InputHost { get; private set; }

    public FeatureFlagSet Features { get; private set; } = new();

    public SessionAudioRuntime? Audio { get; private set; }

    public SessionEffectRuntime? Effects { get; private set; }

    public MvpWorldGenerator? World { get; private set; }

    public GameContentRegistry? Content { get; private set; }

    public WorldEnvironmentController? Environment { get; private set; }

    public CachedBillboardSystem? Billboards { get; private set; }

    public GodotCameraWorldAdapter? CameraAdapter { get; private set; }

    public GodotSessionRuntimeHost? RuntimeHost { get; private set; }

    public GameplayCameraRig? GameplayCamera { get; private set; }

    public PlayerControlRuntime? PlayerControl { get; private set; }

    public AircraftRuntime? Aircraft { get; private set; }

    public TemporaryMayhemRuntime? TemporaryMayhem { get; private set; }

    public RocketLaunchRuntime? RocketLaunch { get; private set; }

    public PlayerVehicleInteractionPublisher? VehicleInteractions { get; private set; }

    public LivingTrafficRuntime? LivingTraffic { get; private set; }

    public LivingPedestrianRuntime? LivingPedestrians { get; private set; }

    public EnforcementRuntime? Enforcement { get; private set; }

    public CityEconomyRuntime? Economy { get; private set; }

    public CityEditorRuntime? Editor { get; private set; }

    public EastSideDevelopmentRuntime? EastSideDevelopment { get; private set; }

    public CityServicesRuntime? Services { get; private set; }

    public ManagementHud? ManagementUi { get; private set; }

    public MissionRuntime? Missions { get; private set; }

    public GameplayHud? GameplayUi { get; private set; }

    public MinimapHud? MinimapUi { get; private set; }

    public SessionModalController? Modals { get; private set; }

    public PlayerInterface? Interface { get; private set; }

    public override void _Ready()
    {
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            LogSeverity.Information,
            "session.created",
            "An empty disposable session shell was created."));
    }

    public void InitializeRuntimeInput(SettingsStore settings, FeatureFlagSet features)
    {
        if (InputHost is not null)
        {
            throw new InvalidOperationException("The session runtime input owner already exists.");
        }

        Features = features ?? throw new ArgumentNullException(nameof(features));
        CameraAdapter?.ConfigureFeatures(Features);
        Node runtimeServices = GetNode<Node>("RuntimeServices");
        Interface = new PlayerInterface { Name = "PlayerInterface" };
        GetNode<CanvasLayer>("HUD").AddChild(Interface);
        Interface.Initialize(settings);
        Audio = new SessionAudioRuntime { Name = "SessionAudio" };
        runtimeServices.AddChild(Audio);
        Audio.Initialize(settings, Interface);
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
            settings,
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
        Environment?.StartClock(RuntimeHost.Scheduler);
        RuntimeHost.SetControlBridge(PlayerControl);
        if (Features.IsEnabled(FeatureIds.Aircraft))
        {
            Aircraft = new AircraftRuntime { Name = "AircraftRuntime" };
            runtimeServices.AddChild(Aircraft);
            Aircraft.Initialize(
                World ?? throw new InvalidOperationException("The world must exist before aircraft are initialized."),
                Content,
                PlayerControl,
                RuntimeHost,
                InputHost,
                Audio,
                Interface,
                GetNode<Node3D>("WorldRoot/AgentRoot"));
        }
        Economy = new CityEconomyRuntime { Name = "CityEconomy" };
        runtimeServices.AddChild(Economy);
        Economy.Initialize(
            Content ?? throw new InvalidOperationException("Content must exist before economy is initialized."),
            World?.Layout ?? throw new InvalidOperationException("The authored world layout must exist before economy is initialized."),
            RuntimeHost.Scheduler);
        LivingTraffic.InitializeEconomy(
            Economy.Ledger,
            Content.EconomyBalance.Policies
                ?? throw new InvalidOperationException("Traffic productivity policy balance is unavailable."),
            RuntimeHost.Scheduler);
        Editor = new CityEditorRuntime { Name = "CityEditor" };
        runtimeServices.AddChild(Editor);
        Editor.Initialize(
            Content,
            Economy,
            World ?? throw new InvalidOperationException("The world must exist before the editor is initialized."),
            PlayerControl,
            LivingTraffic,
            GetNode<Node3D>("WorldRoot/UserWorld"),
            Features.IsEnabled(FeatureIds.EastSideDevelopment));
        if (Features.IsEnabled(FeatureIds.EastSideDevelopment))
        {
            EastSideDevelopment = new EastSideDevelopmentRuntime { Name = "EastSideDevelopmentRuntime" };
            runtimeServices.AddChild(EastSideDevelopment);
            EastSideDevelopment.Initialize(Economy, Editor, Interface);
        }
        VehicleInteractions = new PlayerVehicleInteractionPublisher { Name = "VehicleInteractions" };
        runtimeServices.AddChild(VehicleInteractions);
        VehicleInteractions.Initialize(PlayerControl, RuntimeHost, InputHost);
        Services = new CityServicesRuntime { Name = "CityServices" };
        runtimeServices.AddChild(Services);
        Services.Initialize(
            Content,
            Economy,
            LivingTraffic.Alerts ?? throw new InvalidOperationException("The shared alert authority is unavailable."),
            PlayerControl,
            RuntimeHost,
            VehicleInteractions.Service,
            World ?? throw new InvalidOperationException("The world must exist before city services are initialized."),
            GetNode<Node3D>("WorldRoot/EffectRoot"));
        ManagementUi = new ManagementHud { Name = "ManagementHud" };
        Interface.Chrome.AddChild(ManagementUi);
        ManagementUi.Initialize(
            Interface,
            Economy,
            Editor,
            Services,
            LivingTraffic,
            RuntimeHost,
            InputHost,
            Environment ?? throw new InvalidOperationException("The environment must exist before the management UI is initialized."),
            GetNode<Camera3D>("CameraRig/MainCamera"));
        Missions = new MissionRuntime { Name = "Missions" };
        runtimeServices.AddChild(Missions);
        Missions.Initialize(
            Content,
            settings,
            Economy,
            Services,
            PlayerControl,
            RuntimeHost,
            InputHost,
            LivingTraffic,
            VehicleInteractions.Service,
            Environment ?? throw new InvalidOperationException("The environment must exist before missions are initialized."),
            World,
            GetNode<Node3D>("WorldRoot/EffectRoot"),
            Interface,
            temporaryMayhemEnabled: Features.IsEnabled(FeatureIds.TemporaryMayhem));
        VehicleInteractions.SetControlledReleaseEligibilityProvider(
            () => Missions.InteractionReleaseEligibility());
        Services.SetMissionCriticalProvider(() => Missions.Lifecycle.IsMissionCritical);
        Enforcement = new EnforcementRuntime { Name = "Enforcement" };
        runtimeServices.AddChild(Enforcement);
        Enforcement.Initialize(
            PlayerControl,
            LivingTraffic,
            LivingPedestrians,
            RuntimeHost,
            World ?? throw new InvalidOperationException("The world must exist before enforcement is initialized."));
        Audio.AttachSources(
            LivingTraffic,
            PlayerControl,
            Environment ?? throw new InvalidOperationException("The environment must exist before audio sources are attached."));
        Effects = new SessionEffectRuntime { Name = "SessionEffects" };
        GetNode<Node3D>("WorldRoot/EffectRoot").AddChild(Effects);
        Effects.Initialize(
            settings,
            PlayerControl,
            LivingTraffic,
            Environment,
            GameplayCamera,
            Audio);
        if (Features.IsEnabled(FeatureIds.TemporaryMayhem))
        {
            TemporaryMayhem = new TemporaryMayhemRuntime { Name = "TemporaryMayhemRuntime" };
            runtimeServices.AddChild(TemporaryMayhem);
            TemporaryMayhem.Initialize(
                World ?? throw new InvalidOperationException("The world must exist before Temporary Mayhem is initialized."),
                Economy,
                LivingTraffic,
                Services,
                Missions,
                RuntimeHost,
                Effects,
                Audio,
                Interface);
        }
        if (Features.IsEnabled(FeatureIds.RocketLaunch))
        {
            RocketLaunch = new RocketLaunchRuntime { Name = "RocketLaunchRuntime" };
            runtimeServices.AddChild(RocketLaunch);
            RocketLaunch.Initialize(
                World ?? throw new InvalidOperationException("The world must exist before rocket launch is initialized."),
                RuntimeHost,
                GameplayCamera,
                Effects,
                Audio,
                Interface,
                GetNode<Node3D>("WorldRoot"));
        }
        GameplayUi = new GameplayHud { Name = "GameplayHud" };
        Interface.Chrome.AddChild(GameplayUi);
        GameplayUi.Initialize(
            Interface,
            PlayerControl,
            Enforcement,
            RuntimeHost,
            Environment ?? throw new InvalidOperationException("The environment must exist before the gameplay UI is initialized."),
            Services,
            Missions);
        MinimapUi = new MinimapHud { Name = "Minimap" };
        Interface.Chrome.AddChild(MinimapUi);
        MinimapUi.Initialize(
            Interface,
            LivingTraffic,
            LivingPedestrians,
            PlayerControl,
            Enforcement,
            Services,
            Missions,
            RuntimeHost);
        Modals = new SessionModalController { Name = "SessionModals" };
        Interface.ModalLayer.AddChild(Modals);
        Modals.Initialize(Interface, RuntimeHost, InputHost, settings);
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
        Modals?.Shutdown();
        TemporaryMayhem?.Shutdown();
        RocketLaunch?.Shutdown();
        EastSideDevelopment?.Shutdown();
        MinimapUi?.Shutdown();
        GameplayUi?.Shutdown();
        Missions?.Shutdown();
        ManagementUi?.Shutdown();
        Interface?.Shutdown();
        Effects?.Shutdown();
        Aircraft?.Shutdown();
        Services?.Shutdown();
        VehicleInteractions?.Shutdown();
        Enforcement?.Shutdown();
        Editor?.Shutdown();
        Economy?.Shutdown();
        RuntimeHost?.Shutdown();
        LivingPedestrians?.Shutdown();
        LivingTraffic?.Shutdown();
        PlayerControl?.Shutdown();
        Audio?.Shutdown();
        GameplayCamera?.Shutdown();
        InputHost?.Shutdown();
        Environment?.Shutdown();
        Billboards?.Shutdown();
        World?.ShutdownWorld();
        Content = null;
        Interface = null;
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
            || Audio?.Initialized != true
            || Effects?.Initialized != true
            || InputHost?.Initialized != true
            || GameplayCamera?.Initialized != true
            || PlayerControl?.Initialized != true
            || (Features.IsEnabled(FeatureIds.Aircraft) && Aircraft?.Initialized != true)
            || (Features.IsEnabled(FeatureIds.TemporaryMayhem) && TemporaryMayhem?.Initialized != true)
            || (Features.IsEnabled(FeatureIds.RocketLaunch) && RocketLaunch?.Initialized != true)
            || (Features.IsEnabled(FeatureIds.EastSideDevelopment) && EastSideDevelopment?.Initialized != true)
            || LivingTraffic?.Initialized != true
            || LivingPedestrians?.Initialized != true
            || Enforcement?.Initialized != true
            || Economy?.Initialized != true
            || Editor?.Initialized != true
            || Services?.Initialized != true
            || ManagementUi?.Initialized != true
            || Missions?.Initialized != true
            || GameplayUi?.Initialized != true
            || MinimapUi?.Initialized != true
            || Modals?.Initialized != true
            || Interface?.Initialized != true
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

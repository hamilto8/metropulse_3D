using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Diagnostics;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.App;

public partial class SessionShell : Node
{
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
        RuntimeHost = new GodotSessionRuntimeHost { Name = "SessionRuntime" };
        runtimeServices.AddChild(RuntimeHost);
        RuntimeHost.Initialize(InputHost, GameplayCamera);
        RuntimeHost.SetControlBridge(PlayerControl);
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
        RuntimeHost?.Shutdown();
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
}

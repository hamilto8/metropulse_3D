using Godot;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.Rocket;

public partial class RocketLaunchControl : PanelContainer
{
    private RocketLaunchRuntime runtime = null!;
    private Label status = null!;
    private Button launch = null!;
    private Button camera = null!;

    public bool Initialized { get; private set; }

    public string StatusText => status.Text;

    public void Initialize(RocketLaunchRuntime runtimeOwner)
    {
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        Name = "RocketLaunchControl";
        ThemeTypeVariation = "GlassPanel";
        MouseFilter = MouseFilterEnum.Stop;
        Position = new Vector2(18, 215);
        Size = new Vector2(250, 132);
        AccessibilityName = "Rocket launch controls";
        AccessibilityDescription = "Countdown, launch, camera, and reset controls for the space programme";
        var stack = new VBoxContainer();
        stack.AddChild(new Label { Text = "SPACE PROGRAMME", ThemeTypeVariation = "Title" });
        status = new Label { AccessibilityName = "Launch status" };
        launch = AccessibilityFocus.Describe(
            new Button { Name = "LaunchOrReset", ThemeTypeVariation = "AccentButton" },
            "Launch rocket",
            "Launch immediately or reset the launched rocket to its pad");
        camera = AccessibilityFocus.Describe(
            new Button { Name = "ViewLaunch", Text = "View launch" },
            "View rocket launch",
            "Move the Management camera to the launch complex");
        launch.Pressed += () =>
        {
            if (runtime.Launched) runtime.Reset();
            else runtime.LaunchNow();
        };
        camera.Pressed += () => runtime.ViewLaunch();
        stack.AddChild(status);
        stack.AddChild(launch);
        stack.AddChild(camera);
        AddChild(stack);
        AccessibilityFocus.LinkVertical([launch, camera]);
        Initialized = true;
        ApplyState();
    }

    public void ApplyState()
    {
        if (!Initialized) return;
        if (runtime.Launched)
        {
            status.Text = $"LIFTOFF • altitude {runtime.Snapshot.Altitude:0} m";
            launch.Text = "Reset rocket";
        }
        else
        {
            int seconds = (int)Math.Ceiling(runtime.Snapshot.Countdown);
            status.Text = $"T-{seconds / 60}:{seconds % 60:00}";
            launch.Text = "Launch now";
        }
        status.AccessibilityDescription = status.Text;
        launch.AccessibilityName = launch.Text;
    }

    public void Shutdown() => Initialized = false;

    public override void _ExitTree() => Shutdown();
}

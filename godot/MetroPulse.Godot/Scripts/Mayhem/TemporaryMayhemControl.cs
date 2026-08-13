using Godot;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.Mayhem;

/// <summary>Feature-owned controls with an explicit destructive-content confirmation boundary.</summary>
public partial class TemporaryMayhemControl : Control
{
    private PlayerInterface playerInterface = null!;
    private TemporaryMayhemRuntime runtime = null!;
    private PanelContainer statusPanel = null!;
    private PanelContainer warningPanel = null!;
    private Button toggle = null!;
    private Button confirm = null!;
    private Button cancel = null!;

    public bool Initialized { get; private set; }

    public bool WarningVisible => warningPanel.Visible;

    public string ToggleText => toggle.Text;

    public void Initialize(PlayerInterface interfaceOwner, TemporaryMayhemRuntime runtimeOwner)
    {
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        Name = "TemporaryMayhemControl";
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "Temporary Mayhem controls";
        BuildStatus();
        BuildWarning();
        Initialized = true;
        ApplyState();
    }

    public void ApplyState()
    {
        if (!Initialized) return;
        toggle.Text = runtime.Active ? "End Temporary Mayhem" : "Start Temporary Mayhem";
        toggle.AccessibilityName = toggle.Text;
        toggle.AccessibilityDescription = runtime.Active
            ? "Restore every temporarily damaged building, road, economy record, and incident"
            : "Open the destructive-content warning before starting the temporary sandbox";
    }

    public void OpenWarning()
    {
        if (runtime.Active)
        {
            runtime.Stop();
            ApplyState();
            return;
        }
        warningPanel.Visible = true;
        playerInterface.SetModalActive("temporary-mayhem-warning", true);
        playerInterface.Announce("Warning. Temporary Mayhem uses comet impacts, explosions, panic, and flashing effects.", assertive: true);
        confirm.CallDeferred(Control.MethodName.GrabFocus);
    }

    public void CloseWarning()
    {
        warningPanel.Visible = false;
        playerInterface.SetModalActive("temporary-mayhem-warning", false);
        toggle.CallDeferred(Control.MethodName.GrabFocus);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        playerInterface.SetModalActive("temporary-mayhem-warning", false);
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildStatus()
    {
        statusPanel = new PanelContainer
        {
            Name = "MayhemStatus",
            ThemeTypeVariation = "GlassPanel",
            MouseFilter = MouseFilterEnum.Stop,
            Position = new Vector2(18, 150),
            Size = new Vector2(230, 58),
        };
        toggle = AccessibilityFocus.Describe(
            new Button { Name = "MayhemToggle", FocusMode = FocusModeEnum.All },
            "Start Temporary Mayhem",
            "Open a warning before enabling temporary destructive events");
        toggle.Pressed += OpenWarning;
        AccessibilityFocus.LinkVertical([toggle]);
        statusPanel.AddChild(toggle);
        AddChild(statusPanel);
    }

    private void BuildWarning()
    {
        warningPanel = new PanelContainer
        {
            Name = "MayhemWarning",
            ThemeTypeVariation = "GlassPanelStrong",
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            Position = new Vector2(280, 170),
            Size = new Vector2(560, 260),
            AccessibilityName = "Temporary Mayhem warning",
            AccessibilityDescription = "Destructive-content and sensory-effects confirmation",
        };
        var stack = new VBoxContainer();
        stack.AddChild(new Label { Text = "TEMPORARY MAYHEM", ThemeTypeVariation = "Title" });
        stack.AddChild(new Label
        {
            Text = "Comets, explosions, sirens, panic alerts, screen shake, and flashing effects will occur. "
                + "Damage is capped and is fully rolled back when this mode ends. It is never saved.",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        });
        confirm = AccessibilityFocus.Describe(
            new Button { Text = "Acknowledge and start", ThemeTypeVariation = "AccentButton" },
            "Acknowledge warning and start Temporary Mayhem",
            "Start the capped temporary destructive sandbox");
        cancel = AccessibilityFocus.Describe(
            new Button { Text = "Cancel" },
            "Cancel Temporary Mayhem",
            "Close this warning without changing the city");
        confirm.Pressed += () =>
        {
            CloseWarning();
            runtime.AcknowledgeWarningAndStart();
            ApplyState();
        };
        cancel.Pressed += CloseWarning;
        stack.AddChild(confirm);
        stack.AddChild(cancel);
        warningPanel.AddChild(stack);
        AddChild(warningPanel);
        AccessibilityFocus.LinkVertical([confirm, cancel]);
    }
}

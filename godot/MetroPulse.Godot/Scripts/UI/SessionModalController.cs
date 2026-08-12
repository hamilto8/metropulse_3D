using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Runtime;

namespace MetroPulse.Godot.UI;

public partial class SessionModalController : Control
{
    private PlayerInterface playerInterface = null!;
    private GodotSessionRuntimeHost runtime = null!;
    private RuntimeInputHost input = null!;
    private SettingsStore settings = null!;
    private Func<bool>? unsubscribePause;
    private PanelContainer pausePanel = null!;
    private SettingsPanel settingsPanel = null!;
    private Button resume = null!;
    private Button openSettings = null!;
    private Button management = null!;
    private long lastPhysicsTick = -1;

    public bool Initialized { get; private set; }

    public bool PauseVisible => pausePanel.Visible;

    public bool SettingsVisible => settingsPanel.Visible;

    public SettingsPanel Settings => settingsPanel;

    public void Initialize(
        PlayerInterface interfaceOwner,
        GodotSessionRuntimeHost runtimeOwner,
        RuntimeInputHost inputOwner,
        SettingsStore settingsAuthority)
    {
        if (Initialized) throw new InvalidOperationException("Session modals are already initialized.");
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        Name = "SessionModals";
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "Pause and settings dialogs";
        BuildPause();
        settingsPanel = new SettingsPanel { Visible = false };
        settingsPanel.Initialize(settings);
        settingsPanel.CloseRequested += CloseSettings;
        AddChild(settingsPanel);
        unsubscribePause = runtime.Pause.Subscribe(change => ApplyPause(change.Current), emitCurrent: true);
        Initialized = true;
        SetPhysicsProcess(true);
        ApplyLayout();
    }

    public override void _PhysicsProcess(double delta)
    {
        _ = delta;
        if (!Initialized) return;
        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        if (snapshot.PhysicsTick == lastPhysicsTick) return;
        lastPhysicsTick = snapshot.PhysicsTick;
        if (runtime.Pause.MenuOpen)
        {
            if (snapshot.JustPressed.Contains("BACK"))
            {
                if (SettingsVisible) CloseSettings();
                else ClosePause();
            }
            return;
        }
        if (snapshot.JustPressed.Contains("PAUSE_MENU")) OpenPause();
    }

    public void OpenPause()
    {
        if (!runtime.Pause.MenuOpen) _ = runtime.Pause.OpenMenu(nameof(SessionModalController));
    }

    public void ClosePause()
    {
        settingsPanel.Visible = false;
        _ = runtime.Pause.CloseMenu(nameof(SessionModalController));
    }

    public void OpenSettings()
    {
        settingsPanel.ApplyCurrent();
        pausePanel.Visible = false;
        settingsPanel.Visible = true;
        settingsPanel.GrabInitialFocus();
        ApplyLayout();
    }

    public void CloseSettings()
    {
        settingsPanel.Visible = false;
        pausePanel.Visible = runtime.Pause.MenuOpen;
        openSettings.CallDeferred(Control.MethodName.GrabFocus);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        _ = unsubscribePause?.Invoke();
        unsubscribePause = null;
        playerInterface.SetModalActive("pause", false);
        settingsPanel.Shutdown();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildPause()
    {
        pausePanel = new PanelContainer
        {
            Name = "PauseMenu",
            ThemeTypeVariation = "GlassPanelStrong",
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            AccessibilityName = "Paused",
            AccessibilityDescription = "Resume, open settings, or return to Management",
        };
        var stack = new VBoxContainer();
        stack.AddChild(new Label { Text = "PAUSED", ThemeTypeVariation = "Title", HorizontalAlignment = HorizontalAlignment.Center });
        resume = AccessibilityFocus.Describe(new Button { Text = "Resume", ThemeTypeVariation = "AccentButton" }, "Resume", "Close the pause menu and resume the exact previous state");
        openSettings = AccessibilityFocus.Describe(new Button { Text = "Settings" }, "Settings", "Open all game and accessibility preferences");
        management = AccessibilityFocus.Describe(new Button { Text = "Return to Management" }, "Return to Management", "Release street control and return to city management");
        resume.Pressed += ClosePause;
        openSettings.Pressed += OpenSettings;
        management.Pressed += ReturnToManagement;
        stack.AddChild(resume);
        stack.AddChild(openSettings);
        stack.AddChild(management);
        pausePanel.AddChild(stack);
        AddChild(pausePanel);
        AccessibilityFocus.LinkVertical([resume, openSettings, management]);
    }

    private void ApplyPause(PauseSnapshot snapshot)
    {
        if (!snapshot.MenuOpen)
        {
            playerInterface.SetModalActive("pause", false);
            pausePanel.Visible = false;
            settingsPanel.Visible = false;
            return;
        }
        playerInterface.SetModalActive("pause", true);
        if (!settingsPanel.Visible) pausePanel.Visible = true;
        resume.CallDeferred(Control.MethodName.GrabFocus);
        playerInterface.Announce("Game paused. Pause menu opened.");
        ApplyLayout();
    }

    private void ReturnToManagement()
    {
        ClosePause();
        if (runtime.StateMachine.State != GameState.Management)
        {
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("phase9:pause-return-management", nameof(SessionModalController)));
        }
    }

    private void ApplyLayout()
    {
        UiLayoutSnapshot layout = playerInterface.CurrentLayout;
        pausePanel.SetAnchorsPreset(LayoutPreset.Center);
        pausePanel.OffsetLeft = -Math.Min(240, layout.ModalMaximumWidth / 2f);
        pausePanel.OffsetTop = -180;
        pausePanel.OffsetRight = Math.Min(240, layout.ModalMaximumWidth / 2f);
        pausePanel.OffsetBottom = 180;
        settingsPanel.SetAnchorsPreset(LayoutPreset.Center);
        float width = Math.Min(860, layout.ModalMaximumWidth);
        settingsPanel.OffsetLeft = -width / 2;
        settingsPanel.OffsetTop = -Math.Min(360, GetViewportRect().Size.Y * 0.44f);
        settingsPanel.OffsetRight = width / 2;
        settingsPanel.OffsetBottom = Math.Min(360, GetViewportRect().Size.Y * 0.44f);
    }
}

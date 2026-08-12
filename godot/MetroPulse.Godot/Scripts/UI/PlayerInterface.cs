using Godot;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.UI;

/// <summary>Shared responsive and accessible root for every player-facing session control.</summary>
public partial class PlayerInterface : Control
{
    private readonly HashSet<string> modalOwners = new(StringComparer.Ordinal);
    private SettingsStore? settings;
    private Func<bool>? unsubscribeSettings;
    private MarginContainer safeArea = null!;
    private Control chrome = null!;
    private Control modalLayer = null!;
    private Label liveRegion = null!;
    private ColorRect modalScrim = null!;

    public bool Initialized { get; private set; }

    public UiLayoutSnapshot CurrentLayout { get; private set; } = null!;

    public Control Chrome => chrome;

    public Control ModalLayer => modalLayer;

    public string LastAnnouncement => liveRegion.Text;

    public bool ModalScrimVisible => modalScrim.Visible;

    public GameplayPreferenceProjection CurrentPreferences { get; private set; } = null!;

    public void Initialize(SettingsStore settingsAuthority)
    {
        if (Initialized) throw new InvalidOperationException("The player interface is already initialized.");
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "MetroPulse player interface";
        AccessibilityDescription = "City management and street gameplay interface";
        BuildLayers();
        GetViewport().SizeChanged += OnViewportSizeChanged;
        unsubscribeSettings = settings.Subscribe(_ => ApplySettingsAndLayout(), emitCurrent: true);
        Initialized = true;
    }

    public void Announce(string message, bool assertive = false)
    {
        if (!Initialized) throw new InvalidOperationException("The player interface is not initialized.");
        if (string.IsNullOrWhiteSpace(message)) return;
        liveRegion.AccessibilityLive = assertive
            ? DisplayServer.AccessibilityLiveMode.Assertive
            : DisplayServer.AccessibilityLiveMode.Polite;
        liveRegion.Text = message;
        liveRegion.QueueAccessibilityUpdate();
    }

    public void SetModalActive(string owner, bool active)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);
        if (active) modalOwners.Add(owner);
        else modalOwners.Remove(owner);
        modalScrim.Visible = modalOwners.Count > 0;
        modalLayer.MouseFilter = modalOwners.Count > 0 ? MouseFilterEnum.Stop : MouseFilterEnum.Ignore;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unsubscribeSettings?.Invoke();
        unsubscribeSettings = null;
        if (IsInsideTree()) GetViewport().SizeChanged -= OnViewportSizeChanged;
        settings = null;
        modalOwners.Clear();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildLayers()
    {
        safeArea = new MarginContainer
        {
            Name = "SafeArea",
            MouseFilter = MouseFilterEnum.Ignore,
        };
        safeArea.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        chrome = new Control
        {
            Name = "Chrome",
            MouseFilter = MouseFilterEnum.Ignore,
            AccessibilityName = "Game interface",
            AccessibilityDescription = "Current city and gameplay controls",
        };
        chrome.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        safeArea.AddChild(chrome);
        AddChild(safeArea);

        modalLayer = new Control
        {
            Name = "ModalLayer",
            MouseFilter = MouseFilterEnum.Ignore,
            AccessibilityName = "Dialogs",
            AccessibilityDescription = "Modal dialogs and results",
        };
        modalLayer.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        AddChild(modalLayer);
        modalScrim = new ColorRect
        {
            Name = "ModalScrim",
            Color = new Color(0.01f, 0.025f, 0.06f, 0.58f),
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            AccessibilityName = "Modal background",
            AccessibilityDescription = "Background input is unavailable while a dialog is open",
        };
        modalScrim.SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        modalLayer.AddChild(modalScrim);

        liveRegion = new Label
        {
            Name = "LiveAnnouncements",
            Position = Vector2.Zero,
            Size = Vector2.One,
            ClipText = true,
            MouseFilter = MouseFilterEnum.Ignore,
            SelfModulate = new Color(1, 1, 1, 0),
            AccessibilityName = "MetroPulse announcements",
            AccessibilityDescription = "Important status and caption announcements",
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite,
        };
        AddChild(liveRegion);
    }

    private void OnViewportSizeChanged() => ApplySettingsAndLayout();

    private void ApplySettingsAndLayout()
    {
        SettingsPreferences preferences = settings?.GetSettings()
            ?? throw new InvalidOperationException("Settings are unavailable for the player interface.");
        Vector2 size = GetViewportRect().Size;
        int width = Math.Max(UiLayoutModel.MinimumWidth, (int)Math.Round(size.X));
        int height = Math.Max(UiLayoutModel.MinimumHeight, (int)Math.Round(size.Y));
        CurrentLayout = UiLayoutModel.Resolve(new UiLayoutRequest(width, height, preferences.TextScale));
        CurrentPreferences = GameplaySettingsModel.Project(preferences);
        AccessibilityDescription = CurrentPreferences.ColorSafePatterns
            ? "City management and street gameplay interface. Status uses text, icons, shapes, and color-safe patterns."
            : "City management and street gameplay interface. Status uses text and shapes in addition to color.";
        Theme = MetroPulseThemeFactory.Create(preferences, DisplayServer.AccessibilityShouldIncreaseContrast() == 1);
        safeArea.AddThemeConstantOverride("margin_left", CurrentLayout.HorizontalMargin);
        safeArea.AddThemeConstantOverride("margin_right", CurrentLayout.HorizontalMargin);
        safeArea.AddThemeConstantOverride("margin_top", CurrentLayout.VerticalMargin);
        safeArea.AddThemeConstantOverride("margin_bottom", CurrentLayout.VerticalMargin);
    }
}

using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.App;

public partial class BootStatusPresenter : CanvasLayer
{
    private Label? _status;
    private MarginContainer? _margin;
    private Label? _discovery;
    private BoxContainer? _actions;
    private Button? _newGame;
    private Button? _continue;
    private Button? _recover;
    private Button? _retry;
    private TaskCompletionSource<string>? _actionSelection;
    private SettingsPreferences _preferences = SettingsValidator.DefaultSettings;

    public bool ActionSelectionVisible => _actions?.Visible == true;

    public bool RetryAvailable => _retry?.Visible == true;

    public override void _Ready()
    {
        _margin = GetNode<MarginContainer>("Margin");
        _status = GetNode<Label>("Margin/Content/Status");
        _discovery = GetNode<Label>("Margin/Content/Discovery");
        _actions = GetNode<BoxContainer>("Margin/Content/Actions");
        _newGame = GetNode<Button>("Margin/Content/Actions/NewGame");
        _continue = GetNode<Button>("Margin/Content/Actions/Continue");
        _recover = GetNode<Button>("Margin/Content/Actions/Recover");
        _retry = GetNode<Button>("Margin/Content/Retry");
        _newGame.Pressed += () => Choose(BootActionIds.NewGame);
        _continue.Pressed += () => Choose(BootActionIds.Continue);
        _recover.Pressed += () => Choose(BootActionIds.Recover);
        _retry.Pressed += () => GetTree().ReloadCurrentScene();
        AccessibilityFocus.Describe(_status, "MetroPulse startup status", "Current startup progress or error");
        _status.AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite;
        AccessibilityFocus.Describe(_discovery, "Save discovery status", "Availability of current and recovery city saves");
        AccessibilityFocus.Describe(_newGame, "New Game", "Start a new empty MetroPulse city");
        AccessibilityFocus.Describe(_continue, "Continue", "Continue the latest valid city save");
        AccessibilityFocus.Describe(_recover, "Recover Previous Save", "Restore the rotating recovery city save");
        AccessibilityFocus.Describe(_retry, "Retry startup", "Run the startup checks again");
        GetViewport().SizeChanged += ApplyLayout;
        ApplyThemeAndLayout();
        HideChoices();
    }

    public void ApplySettings(SettingsPreferences preferences)
    {
        _preferences = preferences ?? throw new ArgumentNullException(nameof(preferences));
        if (IsInsideTree()) ApplyThemeAndLayout();
    }

    public void ShowReady()
    {
        EnsureStatus().Text = "METROPULSE 3D\nNative foundation ready";
        HideChoices();
        Visible = false;
    }

    public void ShowProgress(BootProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);
        EnsureStatus().Text = $"METROPULSE 3D\n{progress.Label}\n{progress.Completed} / {progress.Total}";
        HideChoices();
        Visible = true;
    }

    public void ShowFatal(string errorCode, string remedy)
    {
        Label status = EnsureStatus();
        status.Text = $"METROPULSE 3D could not start\n\nError: {errorCode}\n\n{remedy}";
        if (_discovery is not null) _discovery.Visible = false;
        if (_actions is not null) _actions.Visible = false;
        if (_retry is not null) _retry.Visible = true;
        if (_status is not null)
        {
            _status.AccessibilityLive = DisplayServer.AccessibilityLiveMode.Assertive;
            _status.QueueAccessibilityUpdate();
        }
        _retry?.CallDeferred(Control.MethodName.GrabFocus);
        Visible = true;
    }

    public async ValueTask<string> SelectActionAsync(
        GameSaveDiscoveryReport report,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(report);
        if (_actionSelection is not null) throw new InvalidOperationException("Boot action selection is already active.");
        Button newGame = _newGame ?? throw new InvalidOperationException("New Game action control is unavailable.");
        Button continueButton = _continue ?? throw new InvalidOperationException("Continue action control is unavailable.");
        Button recover = _recover ?? throw new InvalidOperationException("Recover action control is unavailable.");
        newGame.Disabled = !report.Actions[BootActionIds.NewGame];
        continueButton.Disabled = !report.Actions[BootActionIds.Continue];
        recover.Disabled = !report.Actions[BootActionIds.Recover];
        continueButton.Text = report.Current.Valid
            ? $"Continue\n{FormatDate(report.Current.SavedAt)}"
            : "Continue\nNo valid current save";
        recover.Text = report.Recovery.Valid
            ? $"Recover Previous Save\n{FormatDate(report.Recovery.SavedAt)}"
            : "Recover Previous Save\nNo valid recovery save";
        if (_discovery is not null)
        {
            string warning = report.Current.Present && !report.Current.Valid
                ? $"Current save unavailable: {report.Current.Reason}"
                : report.Recovery.Present && !report.Recovery.Valid
                    ? $"Recovery save unavailable: {report.Recovery.Reason}"
                    : "Choose how to enter MetroPulse.";
            _discovery.Text = warning;
            _discovery.Visible = true;
        }
        if (_actions is not null) _actions.Visible = true;
        if (_retry is not null) _retry.Visible = false;
        EnsureStatus().Text = "METROPULSE 3D\nSelect a city session";
        Visible = true;
        ConfigureActionFocus();
        Button? initial = new[] { continueButton, recover, newGame }.FirstOrDefault(button => !button.Disabled);
        initial?.CallDeferred(Control.MethodName.GrabFocus);
        var selection = new TaskCompletionSource<string>();
        _actionSelection = selection;
        using CancellationTokenRegistration registration = cancellationToken.Register(() => selection.TrySetCanceled(cancellationToken));
        try
        {
            return await selection.Task;
        }
        finally
        {
            _actionSelection = null;
            HideChoices();
        }
    }

    private void Choose(string action)
    {
        Button? button = action switch
        {
            BootActionIds.NewGame => _newGame,
            BootActionIds.Continue => _continue,
            BootActionIds.Recover => _recover,
            _ => null,
        };
        if (button?.Disabled == false) _actionSelection?.TrySetResult(action);
    }

    private void HideChoices()
    {
        if (_discovery is not null) _discovery.Visible = false;
        if (_actions is not null) _actions.Visible = false;
        if (_retry is not null) _retry.Visible = false;
    }

    private static string FormatDate(string? value) =>
        DateTimeOffset.TryParse(value, out DateTimeOffset date)
            ? date.ToLocalTime().ToString("g", System.Globalization.CultureInfo.CurrentCulture)
            : "Saved city available";

    private Label EnsureStatus() => _status ??= GetNode<Label>("Margin/Content/Status");

    public override void _ExitTree()
    {
        if (IsInsideTree()) GetViewport().SizeChanged -= ApplyLayout;
    }

    private void ApplyThemeAndLayout()
    {
        if (_margin is null) return;
        _margin.Theme = MetroPulseThemeFactory.Create(_preferences, DisplayServer.AccessibilityShouldIncreaseContrast() == 1);
        ApplyLayout();
    }

    private void ApplyLayout()
    {
        if (_margin is null || _actions is null) return;
        Vector2 viewport = GetViewport().GetVisibleRect().Size;
        UiLayoutSnapshot layout = UiLayoutModel.Resolve(new UiLayoutRequest(
            Math.Max(UiLayoutModel.MinimumWidth, (int)Math.Round(viewport.X)),
            Math.Max(UiLayoutModel.MinimumHeight, (int)Math.Round(viewport.Y)),
            _preferences.TextScale));
        _margin.AddThemeConstantOverride("margin_left", layout.HorizontalMargin * 2);
        _margin.AddThemeConstantOverride("margin_right", layout.HorizontalMargin * 2);
        _margin.AddThemeConstantOverride("margin_top", layout.VerticalMargin * 2);
        _margin.AddThemeConstantOverride("margin_bottom", layout.VerticalMargin * 2);
        _actions.Vertical = layout.Breakpoint == DesktopUiBreakpoint.Compact;
        foreach (Button button in new[] { _newGame, _continue, _recover }.OfType<Button>())
        {
            button.CustomMinimumSize = _actions.Vertical
                ? new Vector2(Math.Min(420, layout.ModalMaximumWidth), 56)
                : new Vector2(210, 64);
        }
        ConfigureActionFocus();
    }

    private void ConfigureActionFocus()
    {
        if (_actions is null) return;
        Control[] controls = new[] { _newGame, _continue, _recover }.OfType<Control>().ToArray();
        if (_actions.Vertical) AccessibilityFocus.LinkVertical(controls);
        else AccessibilityFocus.LinkHorizontal(controls);
    }
}

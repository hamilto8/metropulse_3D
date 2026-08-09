using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Persistence;

namespace MetroPulse.Godot.App;

public partial class BootStatusPresenter : CanvasLayer
{
    private Label? _status;
    private Label? _discovery;
    private Control? _actions;
    private Button? _newGame;
    private Button? _continue;
    private Button? _recover;
    private Button? _retry;
    private TaskCompletionSource<string>? _actionSelection;

    public bool ActionSelectionVisible => _actions?.Visible == true;

    public bool RetryAvailable => _retry?.Visible == true;

    public override void _Ready()
    {
        _status = GetNode<Label>("Margin/Content/Status");
        _discovery = GetNode<Label>("Margin/Content/Discovery");
        _actions = GetNode<Control>("Margin/Content/Actions");
        _newGame = GetNode<Button>("Margin/Content/Actions/NewGame");
        _continue = GetNode<Button>("Margin/Content/Actions/Continue");
        _recover = GetNode<Button>("Margin/Content/Actions/Recover");
        _retry = GetNode<Button>("Margin/Content/Retry");
        _newGame.Pressed += () => Choose(BootActionIds.NewGame);
        _continue.Pressed += () => Choose(BootActionIds.Continue);
        _recover.Pressed += () => Choose(BootActionIds.Recover);
        _retry.Pressed += () => GetTree().ReloadCurrentScene();
        HideChoices();
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
}

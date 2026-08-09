using Godot;
using MetroPulse.Domain.Boot;

namespace MetroPulse.Godot.App;

public partial class BootStatusPresenter : CanvasLayer
{
    private Label? _status;

    public override void _Ready()
    {
        _status = GetNode<Label>("Margin/Status");
    }

    public void ShowReady()
    {
        EnsureStatus().Text = "METROPULSE 3D\nNative foundation ready";
        Visible = false;
    }

    public void ShowProgress(BootProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);
        EnsureStatus().Text = $"METROPULSE 3D\n{progress.Label}\n{progress.Completed} / {progress.Total}";
        Visible = true;
    }

    public void ShowFatal(string errorCode, string remedy)
    {
        Label status = EnsureStatus();
        status.Text = $"METROPULSE 3D could not start\n\nError: {errorCode}\n\n{remedy}";
        Visible = true;
    }

    private Label EnsureStatus() => _status ??= GetNode<Label>("Margin/Status");
}

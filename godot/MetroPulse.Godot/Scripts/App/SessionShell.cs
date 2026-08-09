using Godot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.Diagnostics;

namespace MetroPulse.Godot.App;

public partial class SessionShell : Node
{
    public bool IsShutDown { get; private set; }

    public bool IsInteractiveReleased { get; private set; }

    public override void _Ready()
    {
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            LogSeverity.Information,
            "session.created",
            "An empty disposable session shell was created."));
    }

    public void Shutdown()
    {
        if (IsShutDown)
        {
            return;
        }

        IsShutDown = true;
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            LogSeverity.Information,
            "session.disposed",
            "The empty session shell released its owned resources."));
    }

    public void ReleaseInteractiveControl()
    {
        if (IsShutDown)
        {
            throw new InvalidOperationException("A disposed session cannot receive interactive control.");
        }

        if (!IsInsideTree()
            || GetNodeOrNull<Node3D>("WorldRoot") is null
            || GetNodeOrNull<Camera3D>("CameraRig/MainCamera") is null)
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

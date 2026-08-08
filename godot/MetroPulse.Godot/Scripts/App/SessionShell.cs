using Godot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.Diagnostics;

namespace MetroPulse.Godot.App;

public partial class SessionShell : Node
{
    public bool IsShutDown { get; private set; }

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

    public override void _ExitTree()
    {
        Shutdown();
    }
}

using Godot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.Diagnostics;

namespace MetroPulse.Godot.App;

public partial class CompositionRoot : Node
{
    [Export]
    public PackedScene? SessionScene { get; set; }

    public SessionShell? CurrentSession { get; private set; }

    public RuntimeConfiguration? Configuration { get; private set; }

    public override void _Ready()
    {
        CallDeferred(nameof(Initialize));
    }

    private void Initialize()
    {
        BootStatusPresenter boot = GetNode<BootStatusPresenter>("../BootLayer");
        DiagnosticsOverlay diagnostics = GetNode<DiagnosticsOverlay>("../DiagnosticsLayer");

        try
        {
            Configuration = RuntimeConfiguration.Parse(OS.GetCmdlineUserArgs(), OS.IsDebugBuild());
            Engine.PhysicsTicksPerSecond = Configuration.PhysicsTicksPerSecond;

            StartSession();
            diagnostics.Initialize(Configuration, CurrentSession is not null);
            boot.ShowReady();

            AppLog.Write(new StructuredLogEvent(
                LogCategory.Boot,
                LogSeverity.Information,
                "foundation.ready",
                "The empty native session shell is ready.",
                new Dictionary<string, string>
                {
                    ["physicsTicksPerSecond"] = Configuration.PhysicsTicksPerSecond.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["deterministicTestMode"] = Configuration.DeterministicTestMode.ToString(),
                }));

            if (Configuration.RunIntegrationTests)
            {
                IntegrationTestRunner runner = new();
                AddChild(runner);
                runner.Begin(this, diagnostics);
            }
            else if (Configuration.SmokeBoot)
            {
                GetTree().Quit(0);
            }
        }
        catch (Exception error)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Boot,
                LogSeverity.Fatal,
                "foundation.boot_failed",
                error.Message));
            diagnostics.SetFatalError("FOUNDATION_BOOT_FAILED");
            boot.ShowFatal(
                "FOUNDATION_BOOT_FAILED",
                "Verify the Godot 4.6 .NET runtime and project files, then restart. See the structured log for details.");

            if (OS.GetCmdlineUserArgs().Contains("--run-integration-tests", StringComparer.Ordinal))
            {
                GetTree().Quit(1);
            }
        }
    }

    public SessionShell StartSession()
    {
        if (CurrentSession is not null && GodotObject.IsInstanceValid(CurrentSession))
        {
            return CurrentSession;
        }

        PackedScene sessionScene = SessionScene ?? throw new InvalidOperationException("The session shell scene is not configured.");
        CurrentSession = sessionScene.Instantiate<SessionShell>();
        GetParent().AddChild(CurrentSession);
        return CurrentSession;
    }

    public void DisposeSession()
    {
        if (CurrentSession is null)
        {
            return;
        }

        CurrentSession.Shutdown();
        CurrentSession.QueueFree();
        CurrentSession = null;
    }

    public override void _ExitTree()
    {
        DisposeSession();
    }
}

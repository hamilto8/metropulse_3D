using Godot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.App;

namespace MetroPulse.Godot.Diagnostics;

public partial class Phase4ScreenshotCapture : Node
{
    private sealed record Scenario(string Id, double Hour, string Weather, string CameraPreset);

    private static readonly Scenario[] Scenarios =
    [
        new("management-day-clear", 13, "clear", "management"),
        new("management-dusk-rain", 18.5, "rain", "management"),
        new("management-night-clear", 23, "clear", "management"),
    ];

    private SessionShell? session;
    private DiagnosticsOverlay? diagnostics;
    private string? outputPath;

    public void Begin(SessionShell sessionShell, DiagnosticsOverlay diagnosticsOverlay, string absoluteOutputPath)
    {
        session = sessionShell ?? throw new ArgumentNullException(nameof(sessionShell));
        diagnostics = diagnosticsOverlay ?? throw new ArgumentNullException(nameof(diagnosticsOverlay));
        if (!Path.IsPathFullyQualified(absoluteOutputPath))
        {
            throw new ArgumentException("Screenshot output path must be absolute.", nameof(absoluteOutputPath));
        }
        outputPath = absoluteOutputPath;
        CallDeferred(MethodName.Capture);
    }

    private async void Capture()
    {
        try
        {
            SessionShell target = session ?? throw new InvalidOperationException("Screenshot capture was not initialized.");
            string directory = outputPath ?? throw new InvalidOperationException("Screenshot capture was not initialized.");
            Error createDirectory = DirAccess.MakeDirRecursiveAbsolute(directory);
            if (createDirectory != Error.Ok)
            {
                throw new IOException($"Could not create screenshot directory {directory}: {createDirectory}.");
            }
            diagnostics!.Visible = false;
            for (int frame = 0; frame < 4; frame++)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            }
            foreach (Scenario scenario in Scenarios)
            {
                target.Environment?.SetState(scenario.Hour, scenario.Weather, 320);
                target.Billboards?.ApplyStatus(scenario.Hour, scenario.Weather);
                if (target.CameraAdapter?.ApplyPreset(scenario.CameraPreset) != true)
                {
                    throw new InvalidOperationException($"Camera preset {scenario.CameraPreset} could not be applied.");
                }
                for (int frame = 0; frame < 4; frame++)
                {
                    await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
                }
                Image image = GetViewport().GetTexture().GetImage();
                if (image.IsEmpty() || image.GetWidth() < 1_280 || image.GetHeight() < 720)
                {
                    throw new InvalidOperationException($"Capture {scenario.Id} returned an invalid viewport image.");
                }
                string path = Path.Join(directory, $"godot-{scenario.Id}.png");
                Error save = image.SavePng(path);
                if (save != Error.Ok)
                {
                    throw new IOException($"Could not save {path}: {save}.");
                }
                AppLog.Write(new StructuredLogEvent(
                    LogCategory.Test,
                    LogSeverity.Information,
                    "phase4.screenshot.captured",
                    $"Captured fixed Phase 4 scenario {scenario.Id}.",
                    new Dictionary<string, string>
                    {
                        ["scenario"] = scenario.Id,
                        ["hour"] = scenario.Hour.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        ["weather"] = scenario.Weather,
                        ["width"] = image.GetWidth().ToString(System.Globalization.CultureInfo.InvariantCulture),
                        ["height"] = image.GetHeight().ToString(System.Globalization.CultureInfo.InvariantCulture),
                    }));
            }
            GetTree().Quit(0);
        }
        catch (Exception error)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Error,
                "phase4.screenshot.failed",
                error.Message));
            GetTree().Quit(1);
        }
    }
}

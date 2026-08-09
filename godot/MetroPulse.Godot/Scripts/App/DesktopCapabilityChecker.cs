using Godot;
using MetroPulse.Domain.Boot;

namespace MetroPulse.Godot.App;

public sealed class DesktopCapabilityChecker
{
    private const string ProbeContents = "metropulse-capability-probe-v1";

    private static readonly IReadOnlyDictionary<string, string> Guidance =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [DesktopCapabilityIds.UserData] = "Choose a writable operating-system profile directory, verify free disk space, then retry.",
            [DesktopCapabilityIds.GraphicsBackend] = "Update the graphics driver or launch with a Godot-supported desktop renderer, then retry.",
            [DesktopCapabilityIds.InputService] = "Reconnect the keyboard or controller and restart MetroPulse.",
            [DesktopCapabilityIds.ProjectResources] = "Repair or reinstall MetroPulse because a required packaged scene is missing.",
        };

    private readonly PackedScene? sessionScene;
    private readonly HashSet<string> forcedUnavailable;

    public DesktopCapabilityChecker(
        PackedScene? sessionScene,
        IEnumerable<string>? forceUnavailable = null)
    {
        this.sessionScene = sessionScene;
        forcedUnavailable = new HashSet<string>(forceUnavailable ?? [], StringComparer.Ordinal);
    }

    public DesktopCapabilityReport Check()
    {
        DesktopCapabilityResult[] checks =
        [
            CheckUserData(),
            CheckGraphicsBackend(),
            CheckInputService(),
            CheckProjectResources(),
        ];

        return new DesktopCapabilityReport(checks.Select(ApplyForcedFailure));
    }

    private DesktopCapabilityResult CheckUserData()
    {
        string probePath = $"user://.metropulse-capability-probe-{OS.GetProcessId()}.tmp";
        string absolutePath = ProjectSettings.GlobalizePath(probePath);
        try
        {
            Error directoryError = DirAccess.MakeDirRecursiveAbsolute(ProjectSettings.GlobalizePath("user://"));
            if (directoryError != Error.Ok)
            {
                return Failure(DesktopCapabilityIds.UserData, $"The user-data directory could not be created ({directoryError}).");
            }

            using (global::Godot.FileAccess? writer = global::Godot.FileAccess.Open(
                probePath,
                global::Godot.FileAccess.ModeFlags.Write))
            {
                if (writer is null)
                {
                    Error openError = global::Godot.FileAccess.GetOpenError();
                    return Failure(DesktopCapabilityIds.UserData, $"The user-data write probe could not be opened ({openError}).");
                }

                writer.StoreString(ProbeContents);
                writer.Flush();
            }

            using global::Godot.FileAccess? reader = global::Godot.FileAccess.Open(
                probePath,
                global::Godot.FileAccess.ModeFlags.Read);
            if (reader is null || !string.Equals(reader.GetAsText(), ProbeContents, StringComparison.Ordinal))
            {
                return Failure(DesktopCapabilityIds.UserData, "The user-data write probe could not be read back exactly.");
            }

            return Success(DesktopCapabilityIds.UserData, $"Persistent user data is writable at {ProjectSettings.GlobalizePath("user://")}.");
        }
        catch (Exception error)
        {
            return Failure(DesktopCapabilityIds.UserData, error.Message);
        }
        finally
        {
            if (System.IO.File.Exists(absolutePath))
            {
                _ = DirAccess.RemoveAbsolute(absolutePath);
            }
        }
    }

    private static DesktopCapabilityResult CheckGraphicsBackend()
    {
        string displayServer = DisplayServer.GetName();
        string driver = RenderingServer.GetCurrentRenderingDriverName();
        string method = ProjectSettings.GetSetting("rendering/renderer/rendering_method", "gl_compatibility").AsString();
        bool headless = string.Equals(displayServer, "headless", StringComparison.OrdinalIgnoreCase);
        if (!headless && string.IsNullOrWhiteSpace(driver))
        {
            return Failure(DesktopCapabilityIds.GraphicsBackend, "Godot did not report an active rendering driver.");
        }

        string detail = headless
            ? "The headless rendering backend is active for automated verification."
            : $"The {driver} rendering driver is active with the {method} method.";
        return Success(DesktopCapabilityIds.GraphicsBackend, detail);
    }

    private static DesktopCapabilityResult CheckInputService()
    {
        if (Input.Singleton is null)
        {
            return Failure(DesktopCapabilityIds.InputService, "Godot's input service is unavailable.");
        }

        return Success(
            DesktopCapabilityIds.InputService,
            "Godot's input service is available; contextual InputMap actions are validated by their owning adapter.");
    }

    private DesktopCapabilityResult CheckProjectResources()
    {
        if (sessionScene is null)
        {
            return Failure(DesktopCapabilityIds.ProjectResources, "The SessionRoot scene is not configured.");
        }

        if (!sessionScene.CanInstantiate())
        {
            return Failure(DesktopCapabilityIds.ProjectResources, "The configured SessionRoot scene cannot be instantiated.");
        }

        string path = sessionScene.ResourcePath;
        if (string.IsNullOrWhiteSpace(path) || !ResourceLoader.Exists(path, "PackedScene"))
        {
            return Failure(DesktopCapabilityIds.ProjectResources, "The configured SessionRoot scene is missing from packaged resources.");
        }

        return Success(DesktopCapabilityIds.ProjectResources, $"Required session resource {path} is available.");
    }

    private DesktopCapabilityResult ApplyForcedFailure(DesktopCapabilityResult check) =>
        forcedUnavailable.Contains(check.Id)
            ? Failure(check.Id, "Unavailable in this startup test profile.")
            : check;

    private static DesktopCapabilityResult Success(string id, string detail) =>
        new(id, true, detail);

    private static DesktopCapabilityResult Failure(string id, string detail) =>
        new(id, false, detail, Guidance[id]);
}

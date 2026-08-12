using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.App;

namespace MetroPulse.Godot.Diagnostics;

/// <summary>Captures deterministic Phase 9 primary-mode, responsive, modal, and weather evidence.</summary>
public partial class Phase9ScreenshotCapture : Node
{
    private SessionShell? session;
    private DiagnosticsOverlay? diagnostics;
    private SettingsStore? settings;
    private string? outputPath;

    public void Begin(
        SessionShell sessionShell,
        DiagnosticsOverlay diagnosticsOverlay,
        SettingsStore settingsAuthority,
        string absoluteOutputPath)
    {
        session = sessionShell ?? throw new ArgumentNullException(nameof(sessionShell));
        diagnostics = diagnosticsOverlay ?? throw new ArgumentNullException(nameof(diagnosticsOverlay));
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        if (!Path.IsPathFullyQualified(absoluteOutputPath))
            throw new ArgumentException("Screenshot output path must be absolute.", nameof(absoluteOutputPath));
        outputPath = absoluteOutputPath;
        CallDeferred(MethodName.Capture);
    }

    private async void Capture()
    {
        SettingsDocument? original = null;
        try
        {
            SessionShell target = session ?? throw new InvalidOperationException("Screenshot capture was not initialized.");
            SettingsStore settingsOwner = settings ?? throw new InvalidOperationException("Screenshot capture was not initialized.");
            string directory = outputPath ?? throw new InvalidOperationException("Screenshot capture was not initialized.");
            Error createDirectory = DirAccess.MakeDirRecursiveAbsolute(directory);
            if (createDirectory != Error.Ok) throw new IOException($"Could not create screenshot directory {directory}: {createDirectory}.");
            original = settingsOwner.Snapshot();
            diagnostics!.Visible = false;

            await SetLayout(settingsOwner, original, new Vector2I(1280, 720), 1);
            target.Environment?.SetState(13, "clear", 320);
            target.ManagementUi?.RefreshNow();
            await CaptureCurrent(directory, "management-day-clear");

            await SetLayout(settingsOwner, original, new Vector2I(1024, 576), 1.5);
            target.ManagementUi?.RefreshNow();
            await CaptureCurrent(directory, "management-compact-text-150");

            await SetLayout(settingsOwner, original, new Vector2I(1920, 1080), 1.5);
            target.RuntimeHost!.TransitionTo(GameState.Builder, new TransitionRequestOptions("phase9:screenshot", nameof(Phase9ScreenshotCapture)));
            target.ManagementUi?.RefreshNow();
            await CaptureCurrent(directory, "builder-wide-text-150");

            target.RuntimeHost.TransitionTo(GameState.Management, new TransitionRequestOptions("phase9:screenshot", nameof(Phase9ScreenshotCapture)));
            await WaitPhysicsFrames(2);
            target.ManagementUi?.RefreshNow();
            target.GameplayUi?.RefreshNow();
            target.MinimapUi?.RefreshNow();
            await SetLayout(settingsOwner, original, new Vector2I(1920, 800), 0.8);
            target.RuntimeHost.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("phase9:screenshot", nameof(Phase9ScreenshotCapture)));
            await WaitPhysicsFrames(2);
            target.ManagementUi?.RefreshNow();
            target.GameplayUi?.RefreshNow();
            target.MinimapUi?.RefreshNow();
            await CaptureCurrent(directory, "street-wide-text-080");

            await SetLayout(settingsOwner, original, new Vector2I(1280, 720), 1);
            target.Modals?.OpenPause();
            await CaptureCurrent(directory, "pause");
            target.Modals?.OpenSettings();
            await CaptureCurrent(directory, "settings");
            target.Modals?.CloseSettings();
            target.Modals?.ClosePause();

            target.Missions?.Presentation.ShowDialogue(DialogueFixture());
            await CaptureCurrent(directory, "dialogue");
            target.Missions?.Presentation.HideDialogue();
            target.Missions?.Presentation.ShowResult(ResultFixture());
            await CaptureCurrent(directory, "result");
            target.Missions?.Presentation.HideResult();

            target.RuntimeHost.TransitionTo(GameState.Management, new TransitionRequestOptions("phase9:screenshot", nameof(Phase9ScreenshotCapture)));
            await WaitPhysicsFrames(2);
            target.Environment?.SetState(18.5, "rain", 320);
            target.ManagementUi?.RefreshNow();
            target.GameplayUi?.RefreshNow();
            target.MinimapUi?.RefreshNow();
            await CaptureCurrent(directory, "management-dusk-rain");
            target.Environment?.SetState(23, "thunderstorm", 320);
            target.ManagementUi?.RefreshNow();
            await WaitFrames(4);
            target.Environment?.ClearLightningFlash();
            await CaptureCurrent(directory, "management-night-thunderstorm");

            _ = settingsOwner.Replace(original.Settings, original.Bindings, persist: false, source: "phase9-screenshot-restore");
            GetTree().Quit(0);
        }
        catch (Exception error)
        {
            if (original is not null && settings is not null)
            {
                _ = settings.Replace(original.Settings, original.Bindings, persist: false, source: "phase9-screenshot-error-restore");
            }
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Error,
                "phase9.screenshot.failed",
                error.Message));
            GetTree().Quit(1);
        }
    }

    private async Task SetLayout(SettingsStore settingsOwner, SettingsDocument baseline, Vector2I size, double textScale)
    {
        GetWindow().Size = size;
        _ = settingsOwner.Replace(
            baseline.Settings with { TextScale = textScale },
            baseline.Bindings,
            persist: false,
            source: "phase9-screenshot-layout");
        await WaitFrames(4);
    }

    private async Task CaptureCurrent(string directory, string id)
    {
        await WaitFrames(4);
        Image image = GetViewport().GetTexture().GetImage();
        if (image.IsEmpty() || image.GetWidth() < UiLayoutModel.MinimumWidth || image.GetHeight() < UiLayoutModel.MinimumHeight)
            throw new InvalidOperationException($"Capture {id} returned an invalid {image.GetWidth()}x{image.GetHeight()} viewport.");
        string path = Path.Join(directory, $"godot-{id}.png");
        Error save = image.SavePng(path);
        if (save != Error.Ok) throw new IOException($"Could not save {path}: {save}.");
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Test,
            LogSeverity.Information,
            "phase9.screenshot.captured",
            $"Captured Phase 9 scenario {id}.",
            new Dictionary<string, string>
            {
                ["scenario"] = id,
                ["width"] = image.GetWidth().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["height"] = image.GetHeight().ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["textScale"] = settings!.GetSettings().TextScale.ToString(System.Globalization.CultureInfo.InvariantCulture),
            }));
    }

    private async Task WaitFrames(int count)
    {
        for (int frame = 0; frame < count; frame++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
    }

    private async Task WaitPhysicsFrames(int count)
    {
        for (int frame = 0; frame < count; frame++) await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
    }

    private static MissionDialogueSnapshot DialogueFixture() => new(
        "phase9-visual-dialogue",
        "start",
        "Mara Voss",
        "Transit Director",
        "◆",
        9,
        "Deterministic ink portrait of Mara Voss",
        "The east bridge is backing up. Take the municipal taxi, keep the passenger comfortable, and report the delay.",
        null,
        Array.AsReadOnly([
            new MissionDialogueChoiceView("choice-safe", "Take the safer river route", "safe", 0),
            new MissionDialogueChoiceView("choice-fast", "Promise the fastest arrival", "fast", 1),
        ]),
        0,
        true,
        "DIALOGUE",
        false);

    private static MissionResultView ResultFixture() => new(
        "phase9-visual-result",
        1,
        MissionResultKinds.Success,
        "SUCCESS",
        "POSITIVE",
        "Executive Transit",
        "Passenger delivered",
        "The passenger arrived safely despite bridge congestion.",
        Array.AsReadOnly(["Comfort remained high", "The destination was reached before the adjusted timer"]),
        1,
        Array.AsReadOnly([
            new MissionResultSection(
                MissionResultSectionIds.Reward,
                "Reward",
                "No reward changes",
                Array.AsReadOnly([new MissionResultEffectItem("capital", "CREDIT", "Capital", "+1,250", "Base payout plus satisfaction bonus")])),
            new MissionResultSection(
                MissionResultSectionIds.City,
                "City",
                "No city changes",
                Array.AsReadOnly([new MissionResultEffectItem("satisfaction", "CITY", "Satisfaction", "+2", "Safe, comfortable service")])),
        ]),
        new MissionResultNextAction("Next", "Return to city management", false, "Retry mission", "Return to Management"),
        "Executive Transit completed. Capital increased by 1,250 and satisfaction increased by 2.");
}

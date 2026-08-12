using Godot;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.Missions;

/// <summary>Functional Phase 8 mission/dialogue/result controls; final visual styling belongs to Phase 9.</summary>
public partial class MissionPresentation : Control
{
    private PlayerInterface playerInterface = null!;
    private SettingsStore settings = null!;
    private Label interactionPrompt = null!;
    private PanelContainer missionHud = null!;
    private Label missionTitle = null!;
    private Label missionObjective = null!;
    private Label missionTimer = null!;
    private Label missionReward = null!;
    private PanelContainer dialoguePanel = null!;
    private Label dialogueSpeaker = null!;
    private Label dialogueRole = null!;
    private Label dialogueText = null!;
    private VBoxContainer dialogueChoices = null!;
    private PanelContainer resultPanel = null!;
    private Label resultTitle = null!;
    private Label resultDescription = null!;
    private Label resultChanges = null!;
    private Button retryButton = null!;
    private Button continueButton = null!;

    public bool Initialized { get; private set; }

    public bool DialogueVisible => dialoguePanel.Visible;

    public bool ResultVisible => resultPanel.Visible;

    public bool HudVisible => missionHud.Visible;

    public string InteractionText => interactionPrompt.Text;

    public int DialogueChoiceCount => dialogueChoices.GetChildCount();

    public bool SpeakerLabelsEnabled => settings.GetSettings().Subtitles.SpeakerLabels;

    public event Action<int>? DialogueChoiceRequested;

    public event Action? DialogueConfirmRequested;

    public event Action? RetryRequested;

    public event Action? ContinueRequested;

    public void Initialize(PlayerInterface interfaceOwner, SettingsStore settingsAuthority)
    {
        if (Initialized) throw new InvalidOperationException("Mission presentation is already initialized.");
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        AccessibilityName = "Mission interface";
        AccessibilityDescription = "Interaction prompt, active objective, dialogue, and mission result";
        BuildInteractionPrompt();
        BuildMissionHud();
        BuildDialogue();
        BuildResult();
        ApplyLayout();
        Initialized = true;
    }

    public void ApplyInteraction(InteractionSnapshot snapshot, string bindingLabel)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Primary is not { } primary || DialogueVisible || ResultVisible)
        {
            interactionPrompt.Visible = false;
            interactionPrompt.Text = string.Empty;
            return;
        }
        interactionPrompt.Visible = true;
        interactionPrompt.Text = primary.Eligibility.Allowed
            ? $"[{bindingLabel}] {primary.Prompt}"
            : $"Unavailable: {primary.FailureReason}";
    }

    public void ApplyMission(MissionExecutionState? execution, MissionDefinition? mission, MissionWorldPoint? target)
    {
        EnsureInitialized();
        missionHud.Visible = execution is not null;
        if (execution is null || mission is null) return;
        missionTitle.Text = mission.Title ?? mission.Id ?? "Mission";
        missionObjective.Text = execution.Objective == MissionObjectiveTypes.Survival
            ? "Survive until the timer expires"
            : target is null ? "Objective resolving" : $"Next: {target.Label ?? "mission target"}";
        missionTimer.Text = $"Time: {Math.Ceiling(execution.TimeRemaining):N0}s";
        missionReward.Text = execution.Objective == MissionObjectiveTypes.Race && execution.RaceLeaderName is not null
            ? $"Rival: {execution.RaceLeaderName} · {Math.Max(0, execution.RaceLeaderFinishTime!.Value - execution.RaceElapsed):F1}s"
            : $"Reward: {execution.Payout:N0} Capital";
    }

    public void ShowDialogue(MissionDialogueSnapshot snapshot)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(snapshot);
        dialoguePanel.Visible = true;
        playerInterface.SetModalActive("mission-dialogue", true);
        bool speakerLabels = settings.GetSettings().Subtitles.SpeakerLabels;
        dialogueSpeaker.Visible = speakerLabels;
        dialogueRole.Visible = speakerLabels;
        dialogueSpeaker.Text = speakerLabels ? $"{snapshot.Avatar} {snapshot.Speaker}".Trim() : string.Empty;
        dialogueRole.Text = speakerLabels ? snapshot.Role : string.Empty;
        dialogueText.Text = snapshot.Text;
        ClearChildren(dialogueChoices);
        if (snapshot.IsTerminal)
        {
            string label = snapshot.AuthoredAction == MissionDialogueActions.StartMission ? "Start mission" : "Close";
            Button terminal = ChoiceButton(label, 0, terminal: true);
            dialogueChoices.AddChild(terminal);
            AccessibilityFocus.LinkVertical([terminal]);
            terminal.CallDeferred(Control.MethodName.GrabFocus);
            playerInterface.Announce(speakerLabels ? $"{snapshot.Speaker}. {snapshot.Text}" : snapshot.Text);
            return;
        }
        var buttons = new List<Button>();
        foreach (MissionDialogueChoiceView choice in snapshot.Choices)
        {
            Button button = ChoiceButton(choice.Label, choice.Index, terminal: false);
            dialogueChoices.AddChild(button);
            buttons.Add(button);
        }
        AccessibilityFocus.LinkVertical(buttons);
        if (buttons.Count > 0)
        {
            buttons[Math.Clamp(snapshot.FocusIndex, 0, buttons.Count - 1)].CallDeferred(Control.MethodName.GrabFocus);
        }
        playerInterface.Announce(speakerLabels ? $"{snapshot.Speaker}. {snapshot.Text}" : snapshot.Text);
    }

    public void HideDialogue()
    {
        if (!Initialized) return;
        dialoguePanel.Visible = false;
        playerInterface.SetModalActive("mission-dialogue", false);
        ClearChildren(dialogueChoices);
    }

    public void ShowResult(MissionResultView view)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(view);
        resultPanel.Visible = true;
        playerInterface.SetModalActive("mission-result", true);
        missionHud.Visible = false;
        resultTitle.Text = $"{view.OutcomeLabel}: {view.MissionTitle}";
        resultDescription.Text = $"{view.Description}\n{string.Join("\n", view.Why)}";
        resultChanges.Text = string.Join("\n", view.Sections.Select(section =>
        {
            string values = section.Items.Count == 0
                ? section.Empty
                : string.Join("; ", section.Items.Select(item => $"{item.Label}: {item.Value}"));
            return $"{section.Title} — {values}";
        }));
        retryButton.Visible = view.NextAction.CanRetry;
        retryButton.Disabled = !view.NextAction.CanRetry;
        retryButton.Text = view.NextAction.RetryLabel;
        continueButton.Text = view.NextAction.ContinueLabel;
        (view.NextAction.CanRetry ? retryButton : continueButton).CallDeferred(Control.MethodName.GrabFocus);
        playerInterface.Announce(view.Announcement, true);
    }

    public void HideResult()
    {
        if (!Initialized) return;
        resultPanel.Visible = false;
        playerInterface.SetModalActive("mission-result", false);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        playerInterface.SetModalActive("mission-dialogue", false);
        playerInterface.SetModalActive("mission-result", false);
        DialogueChoiceRequested = null;
        DialogueConfirmRequested = null;
        RetryRequested = null;
        ContinueRequested = null;
        if (GodotObject.IsInstanceValid(dialoguePanel)) dialoguePanel.Free();
        if (GodotObject.IsInstanceValid(resultPanel)) resultPanel.Free();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildInteractionPrompt()
    {
        interactionPrompt = new Label
        {
            Name = "PrimaryInteractionPrompt",
            HorizontalAlignment = HorizontalAlignment.Center,
            AnchorLeft = 0.25f,
            AnchorRight = 0.75f,
            AnchorTop = 0.86f,
            AnchorBottom = 0.94f,
            Visible = false,
            ThemeTypeVariation = "Metric",
            AccessibilityName = "Primary interaction",
            AccessibilityDescription = "Current eligible or unavailable world interaction",
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite,
        };
        AddChild(interactionPrompt);
    }

    private void BuildMissionHud()
    {
        missionHud = new PanelContainer
        {
            Name = "MissionHud",
            ThemeTypeVariation = "GlassPanel",
            MouseFilter = MouseFilterEnum.Ignore,
            Visible = false,
            AccessibilityName = "Active mission",
            AccessibilityDescription = "Mission title, next objective, time remaining, and reward",
        };
        var stack = new VBoxContainer();
        missionTitle = new Label { ThemeTypeVariation = "Heading" };
        missionObjective = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        missionTimer = new Label { ThemeTypeVariation = "Metric" };
        missionReward = new Label { ThemeTypeVariation = "Muted" };
        stack.AddChild(missionTitle);
        stack.AddChild(missionObjective);
        stack.AddChild(missionTimer);
        stack.AddChild(missionReward);
        missionHud.AddChild(stack);
        AddChild(missionHud);
    }

    private void BuildDialogue()
    {
        dialoguePanel = new PanelContainer
        {
            Name = "MissionDialogue",
            ThemeTypeVariation = "GlassPanelStrong",
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            AccessibilityName = "Mission dialogue",
            AccessibilityDescription = "Mission briefing and response choices",
        };
        var stack = new VBoxContainer();
        dialogueSpeaker = new Label { ThemeTypeVariation = "Title" };
        dialogueRole = new Label { ThemeTypeVariation = "Muted" };
        dialogueText = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, SizeFlagsVertical = SizeFlags.ExpandFill };
        dialogueChoices = new VBoxContainer();
        stack.AddChild(dialogueSpeaker);
        stack.AddChild(dialogueRole);
        stack.AddChild(dialogueText);
        stack.AddChild(dialogueChoices);
        dialoguePanel.AddChild(stack);
        playerInterface.ModalLayer.AddChild(dialoguePanel);
    }

    private void BuildResult()
    {
        resultPanel = new PanelContainer
        {
            Name = "MissionResult",
            ThemeTypeVariation = "GlassPanelStrong",
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
            AccessibilityName = "Mission result",
            AccessibilityDescription = "Committed mission outcome, reasons, city changes, and next actions",
        };
        var stack = new VBoxContainer();
        resultTitle = new Label { ThemeTypeVariation = "Title" };
        resultDescription = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        resultChanges = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, SizeFlagsVertical = SizeFlags.ExpandFill };
        var actions = new HBoxContainer();
        retryButton = AccessibilityFocus.Describe(new Button { Text = "Retry mission", Visible = false }, "Retry mission", "Restart from the available committed checkpoint");
        continueButton = AccessibilityFocus.Describe(new Button { Text = "Return to Management", ThemeTypeVariation = "AccentButton" }, "Return to Management", "Acknowledge the result and return to city management");
        retryButton.Pressed += () => RetryRequested?.Invoke();
        continueButton.Pressed += () => ContinueRequested?.Invoke();
        actions.AddChild(retryButton);
        actions.AddChild(continueButton);
        stack.AddChild(resultTitle);
        stack.AddChild(resultDescription);
        stack.AddChild(resultChanges);
        stack.AddChild(actions);
        resultPanel.AddChild(stack);
        playerInterface.ModalLayer.AddChild(resultPanel);
        AccessibilityFocus.LinkHorizontal([retryButton, continueButton]);
    }

    private Button ChoiceButton(string label, int index, bool terminal)
    {
        var button = AccessibilityFocus.Describe(
            new Button { Text = label, FocusMode = FocusModeEnum.All },
            label,
            terminal ? "Confirm the current dialogue action" : $"Choose dialogue response {index + 1}");
        if (terminal) button.Pressed += () => DialogueConfirmRequested?.Invoke();
        else button.Pressed += () => DialogueChoiceRequested?.Invoke(index);
        return button;
    }

    private static void ClearChildren(Node node)
    {
        foreach (Node child in node.GetChildren()) child.Free();
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Mission presentation is not initialized.");
    }

    private void ApplyLayout()
    {
        UiLayoutSnapshot layout = playerInterface.CurrentLayout;
        missionHud.SetAnchorsPreset(LayoutPreset.TopLeft);
        missionHud.OffsetLeft = 16;
        missionHud.OffsetTop = 16;
        missionHud.OffsetRight = layout.ToolPanelWidth;
        missionHud.OffsetBottom = 176;
        dialoguePanel.SetAnchorsPreset(LayoutPreset.Center);
        float dialogueWidth = Math.Min(layout.ModalMaximumWidth, 760);
        dialoguePanel.OffsetLeft = -dialogueWidth / 2;
        dialoguePanel.OffsetTop = -240;
        dialoguePanel.OffsetRight = dialogueWidth / 2;
        dialoguePanel.OffsetBottom = 240;
        resultPanel.SetAnchorsPreset(LayoutPreset.Center);
        float resultWidth = Math.Min(layout.ModalMaximumWidth, 900);
        resultPanel.OffsetLeft = -resultWidth / 2;
        resultPanel.OffsetTop = -300;
        resultPanel.OffsetRight = resultWidth / 2;
        resultPanel.OffsetBottom = 300;
    }
}

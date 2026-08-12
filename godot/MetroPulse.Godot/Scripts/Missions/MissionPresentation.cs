using Godot;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Godot.Missions;

/// <summary>Functional Phase 8 mission/dialogue/result controls; final visual styling belongs to Phase 9.</summary>
public partial class MissionPresentation : Control
{
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

    public event Action<int>? DialogueChoiceRequested;

    public event Action? DialogueConfirmRequested;

    public event Action? RetryRequested;

    public event Action? ContinueRequested;

    public void Initialize()
    {
        if (Initialized) throw new InvalidOperationException("Mission presentation is already initialized.");
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
        BuildInteractionPrompt();
        BuildMissionHud();
        BuildDialogue();
        BuildResult();
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
        dialogueSpeaker.Text = $"{snapshot.Avatar} {snapshot.Speaker}".Trim();
        dialogueRole.Text = snapshot.Role;
        dialogueText.Text = snapshot.Text;
        ClearChildren(dialogueChoices);
        if (snapshot.IsTerminal)
        {
            string label = snapshot.AuthoredAction == MissionDialogueActions.StartMission ? "Start mission" : "Close";
            Button terminal = ChoiceButton(label, 0, terminal: true);
            dialogueChoices.AddChild(terminal);
            terminal.CallDeferred(Control.MethodName.GrabFocus);
            return;
        }
        var buttons = new List<Button>();
        foreach (MissionDialogueChoiceView choice in snapshot.Choices)
        {
            Button button = ChoiceButton(choice.Label, choice.Index, terminal: false);
            dialogueChoices.AddChild(button);
            buttons.Add(button);
        }
        for (int index = 0; index < buttons.Count; index++)
        {
            buttons[index].FocusNeighborTop = buttons[(index - 1 + buttons.Count) % buttons.Count].GetPath();
            buttons[index].FocusNeighborBottom = buttons[(index + 1) % buttons.Count].GetPath();
        }
        if (buttons.Count > 0)
        {
            buttons[Math.Clamp(snapshot.FocusIndex, 0, buttons.Count - 1)].CallDeferred(Control.MethodName.GrabFocus);
        }
    }

    public void HideDialogue()
    {
        if (!Initialized) return;
        dialoguePanel.Visible = false;
        ClearChildren(dialogueChoices);
    }

    public void ShowResult(MissionResultView view)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(view);
        resultPanel.Visible = true;
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
    }

    public void HideResult()
    {
        if (!Initialized) return;
        resultPanel.Visible = false;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        DialogueChoiceRequested = null;
        DialogueConfirmRequested = null;
        RetryRequested = null;
        ContinueRequested = null;
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
        };
        AddChild(interactionPrompt);
    }

    private void BuildMissionHud()
    {
        missionHud = new PanelContainer
        {
            Name = "MissionHud",
            AnchorLeft = 0.02f,
            AnchorRight = 0.34f,
            AnchorTop = 0.04f,
            AnchorBottom = 0.24f,
            MouseFilter = MouseFilterEnum.Ignore,
            Visible = false,
        };
        var stack = new VBoxContainer();
        missionTitle = new Label();
        missionObjective = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        missionTimer = new Label();
        missionReward = new Label();
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
            AnchorLeft = 0.22f,
            AnchorRight = 0.78f,
            AnchorTop = 0.2f,
            AnchorBottom = 0.8f,
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
        };
        var stack = new VBoxContainer();
        dialogueSpeaker = new Label();
        dialogueRole = new Label();
        dialogueText = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, SizeFlagsVertical = SizeFlags.ExpandFill };
        dialogueChoices = new VBoxContainer();
        stack.AddChild(dialogueSpeaker);
        stack.AddChild(dialogueRole);
        stack.AddChild(dialogueText);
        stack.AddChild(dialogueChoices);
        dialoguePanel.AddChild(stack);
        AddChild(dialoguePanel);
    }

    private void BuildResult()
    {
        resultPanel = new PanelContainer
        {
            Name = "MissionResult",
            AnchorLeft = 0.15f,
            AnchorRight = 0.85f,
            AnchorTop = 0.12f,
            AnchorBottom = 0.88f,
            MouseFilter = MouseFilterEnum.Stop,
            Visible = false,
        };
        var stack = new VBoxContainer();
        resultTitle = new Label();
        resultDescription = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        resultChanges = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, SizeFlagsVertical = SizeFlags.ExpandFill };
        var actions = new HBoxContainer();
        retryButton = new Button { Text = "Retry mission", Visible = false };
        continueButton = new Button { Text = "Return to Management" };
        retryButton.Pressed += () => RetryRequested?.Invoke();
        continueButton.Pressed += () => ContinueRequested?.Invoke();
        actions.AddChild(retryButton);
        actions.AddChild(continueButton);
        stack.AddChild(resultTitle);
        stack.AddChild(resultDescription);
        stack.AddChild(resultChanges);
        stack.AddChild(actions);
        resultPanel.AddChild(stack);
        AddChild(resultPanel);
    }

    private Button ChoiceButton(string label, int index, bool terminal)
    {
        var button = new Button { Text = label, FocusMode = FocusModeEnum.All };
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
}

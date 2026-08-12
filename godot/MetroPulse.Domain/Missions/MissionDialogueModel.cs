using System.Text;

namespace MetroPulse.Domain.Missions;

/// <summary>Pure stable-node dialogue, history, focus, and pause-intent projection.</summary>
public sealed class MissionDialogueModel
{
    private readonly MissionRegistry registry;
    private readonly MissionLifecycleController lifecycle;
    private MissionDialogueSnapshot? snapshot;

    public MissionDialogueModel(MissionRegistry missionRegistry, MissionLifecycleController lifecycleController)
    {
        registry = missionRegistry ?? throw new ArgumentNullException(nameof(missionRegistry));
        lifecycle = lifecycleController ?? throw new ArgumentNullException(nameof(lifecycleController));
    }

    public MissionDialogueSnapshot? Snapshot => snapshot;

    public MissionDialogueSnapshot Open(string missionId)
    {
        if (snapshot is not null) throw new InvalidOperationException("A mission dialogue is already open.");
        if (lifecycle.Phase != MissionPhases.Briefing || lifecycle.CurrentMission?.Id != missionId)
            throw new MissionLifecycleException("Dialogue requires the matching mission briefing.", "MISSION_DIALOGUE_UNAVAILABLE");
        snapshot = BuildSnapshot(registry.Get(missionId)!, "start", 0);
        return snapshot;
    }

    public MissionDialogueSnapshot MoveFocus(int direction)
    {
        MissionDialogueSnapshot current = RequireOpen();
        int count = Math.Max(1, current.Choices.Count);
        int normalizedDirection = Math.Sign(direction);
        int focus = ((current.FocusIndex + normalizedDirection) % count + count) % count;
        snapshot = current with { FocusIndex = focus };
        return snapshot;
    }

    public MissionDialogueDecision ChooseFocused() => Choose(RequireOpen().FocusIndex);

    public MissionDialogueDecision Choose(int index)
    {
        MissionDialogueSnapshot current = RequireOpen();
        if (current.IsTerminal) return Confirm();
        if (index < 0 || index >= current.Choices.Count) throw new ArgumentOutOfRangeException(nameof(index));
        MissionDialogueChoiceView choice = current.Choices[index];
        lifecycle.RecordDialogueChoice(current.MissionId, current.NodeId, choice.Label, choice.NextNodeId);
        snapshot = BuildSnapshot(registry.Get(current.MissionId)!, choice.NextNodeId, 0);
        return new MissionDialogueDecision(MissionDialogueActions.Navigated, snapshot);
    }

    public MissionDialogueDecision Confirm()
    {
        MissionDialogueSnapshot current = RequireOpen();
        if (current.AuthoredAction == MissionDialogueActions.StartMission)
        {
            MissionDefinition mission = registry.Get(current.MissionId)!;
            DialogueNode node = mission.DialogueTree![current.NodeId];
            return new MissionDialogueDecision(
                MissionDialogueActions.StartMission,
                current,
                new MissionAcceptanceChoice(
                    node.RushBonus ?? 0,
                    node.TimeLimitOverride,
                    current.NodeId));
        }
        if (current.AuthoredAction == "DECLINE")
        {
            return Close(declined: true);
        }
        return new MissionDialogueDecision(MissionDialogueActions.None, current);
    }

    public MissionDialogueDecision CompleteAccepted()
    {
        MissionDialogueSnapshot current = RequireOpen();
        if (current.AuthoredAction != MissionDialogueActions.StartMission)
            throw new MissionLifecycleException("Only an accepted terminal dialogue can close without abandoning briefing.", "MISSION_DIALOGUE_NOT_ACCEPTED");
        snapshot = null;
        return new MissionDialogueDecision(MissionDialogueActions.StartMission, null);
    }

    public MissionDialogueDecision Close(bool declined = false)
    {
        if (snapshot is null) return new MissionDialogueDecision(MissionDialogueActions.Closed, null);
        lifecycle.AbandonBriefing();
        snapshot = null;
        return new MissionDialogueDecision(declined ? MissionDialogueActions.Declined : MissionDialogueActions.Closed, null);
    }

    private MissionDialogueSnapshot RequireOpen() => snapshot ?? throw new InvalidOperationException("Mission dialogue is not open.");

    private static MissionDialogueSnapshot BuildSnapshot(MissionDefinition mission, string nodeId, int focusIndex)
    {
        if (mission.DialogueTree is null || !mission.DialogueTree.TryGetValue(nodeId, out DialogueNode? node))
            throw new InvalidDataException($"Mission {mission.Id} references missing dialogue node {nodeId}.");
        MissionDialogueChoiceView[] choices = (node.Choices ?? Array.Empty<DialogueChoice>())
            .Select((choice, index) => new MissionDialogueChoiceView(
                $"dialogue:{mission.Id}:{nodeId}:{index}:{choice.Next}",
                choice.Label!,
                choice.Next!,
                index))
            .ToArray();
        string speaker = mission.PassengerName ?? "Mission contact";
        string role = mission.PassengerRole ?? "Citizen";
        return new MissionDialogueSnapshot(
            mission.Id!,
            nodeId,
            speaker,
            role,
            mission.Avatar ?? string.Empty,
            HashPortrait($"{speaker}|{role}"),
            $"Deterministic ink portrait of {speaker}",
            node.Text!,
            node.Action,
            Array.AsReadOnly(choices),
            Math.Clamp(focusIndex, 0, Math.Max(0, choices.Length - 1)),
            PauseRequested: true,
            PauseReason: "DIALOGUE",
            IsTerminal: !string.IsNullOrWhiteSpace(node.Action));
    }

    private static uint HashPortrait(string value)
    {
        uint hash = 2166136261;
        foreach (Rune rune in value.EnumerateRunes())
        {
            hash ^= (uint)rune.Value;
            hash = unchecked(hash * 16777619);
        }
        return hash;
    }
}

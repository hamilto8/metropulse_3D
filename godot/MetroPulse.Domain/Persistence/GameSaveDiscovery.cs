namespace MetroPulse.Domain.Persistence;

public sealed class GameSaveDiscovery
{
    private readonly IGameSaveRepository repository;
    private readonly GameSaveDocumentValidator validator;

    public GameSaveDiscovery(IGameSaveRepository repository, GameSaveDocumentValidator validator)
    {
        this.repository = repository ?? throw new ArgumentNullException(nameof(repository));
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
    }

    public GameSaveDiscoveryReport Discover()
    {
        GameSaveSlots slots = repository.ReadSlots();
        GameSaveInspection current = validator.Inspect(slots.Current, GameSaveSlotIds.Current);
        GameSaveInspection recovery = validator.Inspect(slots.Recovery, GameSaveSlotIds.Recovery);
        return new GameSaveDiscoveryReport(
            current,
            recovery,
            GameSaveDiscoveryReport.FreezeActions(current.Valid, recovery.Valid));
    }

    public PreparedBootSave Prepare(string action, GameSaveDiscoveryReport discovery)
    {
        if (!BootActionIds.All.Contains(action, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(action), $"Unknown boot action: {action}.");
        }
        ArgumentNullException.ThrowIfNull(discovery);
        if (!discovery.Actions.GetValueOrDefault(action))
        {
            throw new InvalidOperationException($"Boot action {action} is not available for this profile.");
        }

        if (action == BootActionIds.NewGame)
        {
            repository.ClearCurrent(preserveAsRecovery: discovery.Current.Valid);
            return new PreparedBootSave(action, false, null, repository);
        }

        GameSaveInspection selected = action == BootActionIds.Continue
            ? discovery.Current
            : discovery.Recovery;
        if (selected.Document is null)
        {
            throw new InvalidOperationException($"Boot action {action} has no validated save document.");
        }
        if (action == BootActionIds.Recover)
        {
            repository.PromoteRecovery();
        }
        return new PreparedBootSave(action, true, selected.Document, repository);
    }
}

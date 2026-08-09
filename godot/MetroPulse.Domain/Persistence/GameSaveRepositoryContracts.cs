namespace MetroPulse.Domain.Persistence;

public interface IGameSaveDocumentValidator
{
    string ValidateAndNormalize(string document);
}

public sealed record GameSaveSlots(string? Current, string? Recovery);

public interface IGameSaveRepository
{
    GameSaveSlots ReadSlots();

    string CommitCurrent(string document);

    string PutRecovery(string document);

    string PromoteRecovery();

    bool ClearCurrent(bool preserveAsRecovery = true);
}

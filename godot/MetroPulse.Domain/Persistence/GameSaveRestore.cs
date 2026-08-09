using System.Collections.ObjectModel;
using System.Text.Json.Nodes;

namespace MetroPulse.Domain.Persistence;

public static class GameSaveDomainIds
{
    public const string Game = "game";
    public const string Economy = "economy";
    public const string World = "world";
    public const string Player = "player";
    public const string TimeWeather = "timeWeather";
    public const string Missions = "missions";
    public const string Factions = "factions";
    public const string Progression = "progression";
    public const string Heat = "heat";
    public const string Settings = "settings";
    public const string Bindings = "bindings";
    public const string Alerts = "alerts";
    public const string Mobility = "mobility";

    public static readonly IReadOnlyList<string> Static = Array.AsReadOnly(
    [
        Economy,
        TimeWeather,
        Missions,
        Factions,
        Progression,
        Settings,
        Bindings,
        Mobility,
    ]);

    public static readonly IReadOnlyList<string> Runtime = Array.AsReadOnly(
    [
        Game,
        World,
        Player,
        Missions,
        Heat,
        Alerts,
    ]);
}

public interface IPreparedGameSaveStaticRestore
{
    IReadOnlyList<string> DomainIds { get; }

    void Apply();

    void Rollback();
}

public interface IGameSaveStaticRestoreParticipant
{
    IReadOnlyList<string> DomainIds { get; }

    IPreparedGameSaveStaticRestore Prepare(JsonObject data);
}

public interface IGameSaveRuntimeRestoreAdapter
{
    void Apply(DeferredGameSaveDescriptor descriptor);
}

public sealed record DeferredGameSaveDescriptor(
    string SaveId,
    string DataJson,
    IReadOnlyList<string> DomainIds);

public sealed record GameSaveStaticRestoreReport(
    string SaveId,
    IReadOnlyList<string> AppliedDomains,
    DeferredGameSaveDescriptor DeferredStatic,
    DeferredGameSaveDescriptor PendingRuntime);

public sealed class GameSaveRestoreException : Exception
{
    public GameSaveRestoreException(
        string message,
        Exception innerException,
        IReadOnlyList<Exception>? rollbackErrors = null)
        : base(message, innerException)
    {
        RollbackErrors = rollbackErrors ?? Array.Empty<Exception>();
    }

    public IReadOnlyList<Exception> RollbackErrors { get; }
}

/// <summary>Validates first, applies prepared static owners atomically, and retains runtime descriptors.</summary>
public sealed class GameSaveRestoreCoordinator
{
    private readonly GameSaveDocumentValidator validator;
    private readonly ReadOnlyCollection<IGameSaveStaticRestoreParticipant> participants;

    public GameSaveRestoreCoordinator(
        GameSaveDocumentValidator validator,
        IEnumerable<IGameSaveStaticRestoreParticipant>? participants = null)
    {
        this.validator = validator ?? throw new ArgumentNullException(nameof(validator));
        IGameSaveStaticRestoreParticipant[] values = (participants ?? []).ToArray();
        var domains = new HashSet<string>(StringComparer.Ordinal);
        foreach (IGameSaveStaticRestoreParticipant participant in values)
        {
            ArgumentNullException.ThrowIfNull(participant);
            if (participant.DomainIds.Count == 0)
            {
                throw new ArgumentException("A static restore participant must own at least one domain.", nameof(participants));
            }
            foreach (string domain in participant.DomainIds)
            {
                if (!GameSaveDomainIds.Static.Contains(domain, StringComparer.Ordinal))
                {
                    throw new ArgumentException($"Static restore participant owns unsupported domain {domain}.", nameof(participants));
                }
                if (!domains.Add(domain))
                {
                    throw new ArgumentException($"Static restore domain {domain} has more than one participant.", nameof(participants));
                }
            }
        }
        this.participants = Array.AsReadOnly(values);
    }

    public GameSaveStaticRestoreReport? LastStaticRestore { get; private set; }

    public DeferredGameSaveDescriptor? PendingRuntime { get; private set; }

    public GameSaveStaticRestoreReport RestoreStatic(string document)
    {
        ValidatedGameSaveDocument validated = validator.Validate(document);
        JsonObject data = JsonNode.Parse(validated.DataJson)!.AsObject();
        IPreparedGameSaveStaticRestore[] prepared = participants
            .Select(participant => participant.Prepare(data.DeepClone().AsObject()))
            .ToArray();
        ValidatePreparedOwnership(prepared);

        var applied = new List<IPreparedGameSaveStaticRestore>();
        try
        {
            foreach (IPreparedGameSaveStaticRestore operation in prepared)
            {
                applied.Add(operation);
                operation.Apply();
            }
        }
        catch (Exception error)
        {
            var rollbackErrors = new List<Exception>();
            for (int index = applied.Count - 1; index >= 0; index--)
            {
                try
                {
                    applied[index].Rollback();
                }
                catch (Exception rollbackError)
                {
                    rollbackErrors.Add(rollbackError);
                }
            }
            throw new GameSaveRestoreException(
                "Static save restoration failed; every applied participant was rolled back.",
                error,
                Array.AsReadOnly(rollbackErrors.ToArray()));
        }

        string[] appliedDomains = prepared.SelectMany(value => value.DomainIds).Distinct(StringComparer.Ordinal).ToArray();
        string[] deferredStaticDomains = GameSaveDomainIds.Static
            .Where(domain => data.ContainsKey(domain) && !appliedDomains.Contains(domain, StringComparer.Ordinal))
            .ToArray();
        DeferredGameSaveDescriptor deferredStatic = Descriptor(validated.SaveId, data, deferredStaticDomains);
        DeferredGameSaveDescriptor runtime = Descriptor(
            validated.SaveId,
            data,
            GameSaveDomainIds.Runtime.Where(data.ContainsKey).ToArray());
        PendingRuntime = runtime;
        LastStaticRestore = new GameSaveStaticRestoreReport(
            validated.SaveId,
            Array.AsReadOnly(appliedDomains),
            deferredStatic,
            runtime);
        return LastStaticRestore;
    }

    public bool RestoreRuntime(IGameSaveRuntimeRestoreAdapter adapter)
    {
        ArgumentNullException.ThrowIfNull(adapter);
        DeferredGameSaveDescriptor? pending = PendingRuntime;
        if (pending is null) return false;
        adapter.Apply(pending);
        PendingRuntime = null;
        return true;
    }

    public void ClearPending()
    {
        PendingRuntime = null;
        LastStaticRestore = null;
    }

    private void ValidatePreparedOwnership(IEnumerable<IPreparedGameSaveStaticRestore> prepared)
    {
        var actual = new HashSet<string>(StringComparer.Ordinal);
        foreach (IPreparedGameSaveStaticRestore operation in prepared)
        {
            if (operation is null) throw new InvalidOperationException("A static restore participant returned no prepared operation.");
            if (operation.DomainIds.Count == 0) throw new InvalidOperationException("A prepared static restore owns no domains.");
            foreach (string domain in operation.DomainIds)
            {
                if (!actual.Add(domain)) throw new InvalidOperationException($"Prepared static restore duplicates domain {domain}.");
            }
        }
        string[] declared = participants.SelectMany(value => value.DomainIds).Order(StringComparer.Ordinal).ToArray();
        if (!declared.SequenceEqual(actual.Order(StringComparer.Ordinal), StringComparer.Ordinal))
        {
            throw new InvalidOperationException("Prepared static restore ownership does not match participant ownership.");
        }
    }

    private static DeferredGameSaveDescriptor Descriptor(
        string saveId,
        JsonObject data,
        IReadOnlyList<string> domains)
    {
        var selected = new JsonObject();
        foreach (string domain in domains)
        {
            selected[domain] = data[domain]?.DeepClone();
        }
        return new DeferredGameSaveDescriptor(
            saveId,
            selected.ToJsonString(),
            Array.AsReadOnly(domains.ToArray()));
    }
}

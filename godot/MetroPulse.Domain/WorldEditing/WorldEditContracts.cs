using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;

namespace MetroPulse.Domain.WorldEditing;

public static class WorldEditParticipantIds
{
    public const string Visual = "visual-node";
    public const string Collider = "collider";
    public const string RoadGraph = "road-graph";
    public const string Economy = "economy-record";
    public const string Occupancy = "occupancy";
    public const string Zoning = "zoning-metadata";
    public const string Service = "service-metadata";
    public const string Persistence = "persistence-record";

    public static readonly IReadOnlyList<string> RequiredOrder = Array.AsReadOnly([
        Visual,
        Collider,
        RoadGraph,
        Economy,
        Occupancy,
        Zoning,
        Service,
        Persistence,
    ]);
}

public sealed record WorldEditRecord
{
    public required string Id { get; init; }
    public required string SpecId { get; init; }
    public required string Name { get; init; }
    public required string Category { get; init; }
    public required string GeneratorType { get; init; }
    public required PlacementVector3 Position { get; init; }
    public required PlacementFootprint Footprint { get; init; }
    public required double RotationY { get; init; }
    public required double Height { get; init; }
    public required double Cost { get; init; }
    public required EconomyBuilding EconomyRecord { get; init; }
    public string? ZoneType { get; init; }
}

public sealed record WorldEditReceipt(
    string TransactionId,
    string Command,
    WorldEditRecord? Previous,
    WorldEditRecord? Current,
    double TreasuryDelta,
    IReadOnlyList<string> Participants);

public sealed record WorldEditPlot(
    double X,
    double Y,
    double Z,
    double Width,
    double Depth);

public sealed record WorldEditBuildingState(
    string EconomyId,
    string SpecId,
    WorldEditPlot Plot,
    double RotationY,
    string? ZoneType = null);

public sealed record WorldEditZoneState(
    string Key,
    double X,
    double Z,
    string ZoneType,
    double HappinessModifier,
    double LandValueModifier);

/// <summary>Browser-compatible versioned payload stored under save.data.world.</summary>
public sealed record CityEditorState
{
    public int Version { get; init; } = 1;

    public required IReadOnlyList<WorldEditBuildingState> Buildings { get; init; }

    public required IReadOnlyList<WorldEditZoneState> Zones { get; init; }
}

public interface IWorldEditParticipant
{
    string Id { get; }

    bool Attach(WorldEditRecord record);

    bool Detach(WorldEditRecord record);

    void FinalizeDetach(WorldEditRecord record) { }
}

public sealed class MemoryWorldEditParticipant : IWorldEditParticipant
{
    private readonly Dictionary<string, WorldEditRecord> records = new(StringComparer.Ordinal);
    private readonly Func<string, WorldEditRecord, bool>? beforeMutation;

    public MemoryWorldEditParticipant(
        string id,
        Func<string, WorldEditRecord, bool>? beforeMutation = null)
    {
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("A participant ID is required.", nameof(id));
        Id = id.Trim();
        this.beforeMutation = beforeMutation;
    }

    public string Id { get; }

    public IReadOnlyDictionary<string, WorldEditRecord> Records => records;

    public bool Attach(WorldEditRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        if (beforeMutation?.Invoke("ATTACH", record) == false) return false;
        return records.TryAdd(record.Id, record);
    }

    public bool Detach(WorldEditRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        if (beforeMutation?.Invoke("DETACH", record) == false) return false;
        return records.Remove(record.Id);
    }
}

public sealed class EconomyWorldEditParticipant : IWorldEditParticipant
{
    private readonly EconomyLedger economy;

    public EconomyWorldEditParticipant(EconomyLedger economy) =>
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));

    public string Id => WorldEditParticipantIds.Economy;

    public bool Attach(WorldEditRecord record)
    {
        if (economy.GetBuilding(record.Id) is not null) return false;
        economy.RegisterBuilding(record.EconomyRecord);
        return true;
    }

    public bool Detach(WorldEditRecord record) => economy.RemoveBuilding(record.Id) is not null;
}

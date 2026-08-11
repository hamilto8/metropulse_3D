using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;

namespace MetroPulse.Domain.WorldEditing;

/// <summary>Authoritative command coordinator for atomic placed-building lifecycle edits.</summary>
public sealed class WorldEditCoordinator
{
    private readonly GameContentRegistry content;
    private readonly EconomyLedger economy;
    private readonly IReadOnlyList<IWorldEditParticipant> participants;
    private readonly Dictionary<string, WorldEditRecord> records = new(StringComparer.Ordinal);
    private long transactionSerial;
    private int nextBuildingId = 1;

    public WorldEditCoordinator(
        GameContentRegistry content,
        EconomyLedger economy,
        IEnumerable<IWorldEditParticipant> participants)
    {
        this.content = content ?? throw new ArgumentNullException(nameof(content));
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));
        ArgumentNullException.ThrowIfNull(participants);
        IWorldEditParticipant[] ordered = participants.ToArray();
        string[] ids = ordered.Select(item => item.Id).ToArray();
        if (!ids.SequenceEqual(WorldEditParticipantIds.RequiredOrder))
        {
            throw new ArgumentException(
                $"World-edit participants must be supplied in canonical order: {string.Join(", ", WorldEditParticipantIds.RequiredOrder)}.",
                nameof(participants));
        }
        this.participants = Array.AsReadOnly(ordered);
    }

    public IReadOnlyList<WorldEditRecord> Records => Array.AsReadOnly(records.Values.OrderBy(item => item.Id, StringComparer.Ordinal).ToArray());

    public WorldEditRecord? Get(string id) => records.GetValueOrDefault(RequireId(id));

    public WorldEditReceipt Place(
        string specId,
        PlacementDecision decision,
        double rotationY = 0,
        string? zoneType = null)
    {
        BuildingDefinition spec = GetSpec(specId);
        EnsureValidDecision(decision);
        string id = $"USER_BUILDING_{nextBuildingId}";
        WorldEditRecord record = CreateRecord(id, spec, decision.Position!, rotationY, zoneType);
        string transactionId = NextTransactionId("PLACE");
        WorldEditReceipt receipt = WorldEditTransaction.Run(transactionId, transaction =>
        {
            transaction.Step(
                "debit treasury",
                () => economy.Spend(record.Cost, new SpendingContext
                {
                    Source = "building-placement",
                    ReferenceId = record.Id,
                    RecurringCostRate = record.EconomyRecord.OperatingCostRate,
                }),
                (_, _) => economy.Earn(record.Cost, "world-edit-rollback", record.Id));
            foreach (IWorldEditParticipant participant in participants)
            {
                transaction.Step(
                    $"attach {participant.Id}",
                    () => participant.Attach(record),
                    (_, _) => RequireCompensation(participant.Detach(record), participant.Id, "detach"));
            }
            return new WorldEditReceipt(
                transactionId,
                "PLACE",
                null,
                record,
                -record.Cost,
                WorldEditParticipantIds.RequiredOrder);
        });
        records.Add(record.Id, record);
        nextBuildingId++;
        return receipt;
    }

    public WorldEditReceipt Move(string id, PlacementDecision decision)
    {
        EnsureValidDecision(decision);
        WorldEditRecord previous = GetRequired(id);
        WorldEditRecord current = previous with
        {
            Position = decision.Position!,
            EconomyRecord = previous.EconomyRecord with
            {
                Position = new EconomyPoint(decision.Position!.X, decision.Position.Z),
            },
        };
        return Replace("MOVE", previous, current);
    }

    public WorldEditReceipt Rotate(string id, PlacementDecision decision, double rotationY)
    {
        EnsureValidDecision(decision);
        WorldEditRecord previous = GetRequired(id);
        BuildingDefinition spec = GetSpec(previous.SpecId);
        PlacementFootprint footprint = PlacementGeometry.GetOrientedFootprint(
            spec.Footprint!.Width,
            spec.Footprint.Depth,
            rotationY);
        WorldEditRecord current = previous with
        {
            Position = decision.Position!,
            RotationY = NormalizeRotation(rotationY),
            Footprint = footprint,
            EconomyRecord = previous.EconomyRecord with
            {
                Position = new EconomyPoint(decision.Position!.X, decision.Position.Z),
            },
        };
        return Replace("ROTATE", previous, current);
    }

    public WorldEditReceipt Demolish(string id)
    {
        WorldEditRecord previous = GetRequired(id);
        double salvageRate = content.EconomyBalance.Construction!.DefaultSalvageRate;
        double salvage = Math.Round(previous.Cost * salvageRate, MidpointRounding.AwayFromZero);
        string transactionId = NextTransactionId("DEMOLISH");
        WorldEditReceipt receipt = WorldEditTransaction.Run(transactionId, transaction =>
        {
            foreach (IWorldEditParticipant participant in participants)
            {
                transaction.Step(
                    $"detach {participant.Id}",
                    () => participant.Detach(previous),
                    (_, _) => RequireCompensation(participant.Attach(previous), participant.Id, "attach"));
            }
            transaction.Step(
                "credit salvage",
                () => economy.Earn(salvage, "building-salvage", previous.Id),
                (_, _) => RequireCompensation(
                    economy.Spend(salvage, new SpendingContext
                    {
                        Source = "incident-response",
                        ReferenceId = previous.Id,
                    }),
                    "treasury",
                    "remove salvage"));
            return new WorldEditReceipt(
                transactionId,
                "DEMOLISH",
                previous,
                null,
                salvage,
                WorldEditParticipantIds.RequiredOrder);
        });
        records.Remove(previous.Id);
        foreach (IWorldEditParticipant participant in participants) participant.FinalizeDetach(previous);
        return receipt;
    }

    private WorldEditReceipt Replace(string command, WorldEditRecord previous, WorldEditRecord current)
    {
        string transactionId = NextTransactionId(command);
        WorldEditReceipt receipt = WorldEditTransaction.Run(transactionId, transaction =>
        {
            foreach (IWorldEditParticipant participant in participants)
            {
                transaction.Step(
                    $"detach old {participant.Id}",
                    () => participant.Detach(previous),
                    (_, _) => RequireCompensation(participant.Attach(previous), participant.Id, "restore old"));
                transaction.Step(
                    $"attach new {participant.Id}",
                    () => participant.Attach(current),
                    (_, _) => RequireCompensation(participant.Detach(current), participant.Id, "remove new"));
            }
            return new WorldEditReceipt(
                transactionId,
                command,
                previous,
                current,
                0,
                WorldEditParticipantIds.RequiredOrder);
        });
        records[previous.Id] = current;
        return receipt;
    }

    private WorldEditRecord CreateRecord(
        string id,
        BuildingDefinition spec,
        PlacementVector3 position,
        double rotationY,
        string? zoneType)
    {
        PlacementFootprint footprint = PlacementGeometry.GetOrientedFootprint(
            spec.Footprint!.Width,
            spec.Footprint.Depth,
            rotationY);
        return new WorldEditRecord
        {
            Id = id,
            SpecId = spec.Id!,
            Name = spec.Name!,
            Category = spec.Category!,
            GeneratorType = spec.GeneratorType!,
            Position = position,
            Footprint = footprint,
            RotationY = NormalizeRotation(rotationY),
            Height = spec.Height,
            Cost = spec.Cost,
            EconomyRecord = BuildingEconomyAdapter.FromCatalog(
                spec,
                id,
                new EconomyPoint(position.X, position.Z)),
            ZoneType = zoneType,
        };
    }

    private BuildingDefinition GetSpec(string id) => content.GetBuilding(RequireId(id))
        ?? throw new KeyNotFoundException($"Unknown building spec: {id}");

    private WorldEditRecord GetRequired(string id) => records.GetValueOrDefault(RequireId(id))
        ?? throw new KeyNotFoundException($"Unknown placed building: {id}");

    private static void EnsureValidDecision(PlacementDecision decision)
    {
        ArgumentNullException.ThrowIfNull(decision);
        if (!decision.Valid || decision.Position is not { IsFinite: true })
        {
            throw new InvalidOperationException(
                decision.PrimaryBlocker is null
                    ? "The world edit requires a valid placement decision."
                    : $"{decision.PrimaryBlocker.Message} {decision.PrimaryBlocker.Remedy}");
        }
    }

    private string NextTransactionId(string command) =>
        $"world-edit-{++transactionSerial:D6}:{command}";

    private static string RequireId(string id) => string.IsNullOrWhiteSpace(id)
        ? throw new ArgumentException("A stable ID is required.", nameof(id))
        : id.Trim();

    private static double NormalizeRotation(double rotationY)
    {
        double value = double.IsFinite(rotationY) ? rotationY % (Math.PI * 2) : 0;
        return value < 0 ? value + (Math.PI * 2) : value;
    }

    private static void RequireCompensation(bool accepted, string participant, string operation)
    {
        if (!accepted) throw new InvalidOperationException($"{participant} could not {operation} during compensation.");
    }
}

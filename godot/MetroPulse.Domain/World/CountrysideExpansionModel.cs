using MetroPulse.Domain.Content;
using MetroPulse.Domain.Placement;

namespace MetroPulse.Domain.World;

public static class CountrysideSceneryKinds
{
    public const string House = "HOUSE";
    public const string Tree = "TREE";
}

public sealed record CountrysideSceneryPlacement(
    string Id,
    string Kind,
    double X,
    double Z,
    double Width,
    double Depth,
    double RotationY,
    PlacementRect Occupancy);

public sealed record CountrysideExpansionPlan(
    IReadOnlyList<PlacementRect> Reservations,
    IReadOnlyList<CountrysideSceneryPlacement> Houses,
    IReadOnlyList<CountrysideSceneryPlacement> Trees)
{
    public IReadOnlyList<CountrysideSceneryPlacement> Scenery => Houses.Concat(Trees).ToArray();

    public IReadOnlyList<CountrysideSceneryPlacement> GetConflicts(PlacementRect footprint) =>
        Scenery.Where(item => PlacementGeometry.Overlaps(footprint, item.Occupancy)).ToArray();
}

/// <summary>Deterministic source-aligned countryside parcels, reservations, and nature occupancy.</summary>
public static class CountrysideExpansionModel
{
    private const int NatureAttempts = 90;
    private const double TreeFootprint = 5;
    private const double TreeSetback = 1;

    public static CountrysideExpansionPlan Create(GameContentRegistry content, uint seed = 0x4D_50_43_53)
    {
        ArgumentNullException.ThrowIfNull(content);
        PlacementRect[] reservations = content.CountrysideReservations
            .Select(item => new PlacementRect(item.MinX, item.MaxX, item.MinZ, item.MaxZ))
            .ToArray();
        BuildingFootprint footprint = content.SuburbanHomeRules.Footprint
            ?? throw new InvalidOperationException("Suburban home footprint is unavailable.");
        var occupied = new List<PlacementRect>();
        var houses = new List<CountrysideSceneryPlacement>();
        foreach (SuburbanParcelDefinition parcel in content.SuburbanParcels)
        {
            PlacementRect reservedEnvelope = PlacementGeometry.CreateRect(
                parcel.X,
                parcel.Z,
                footprint.Width,
                footprint.Depth,
                parcel.RotationY,
                content.SuburbanHomeRules.RoadSetback);
            if (reservations.Any(item => PlacementGeometry.Overlaps(reservedEnvelope, item)))
            {
                throw new InvalidOperationException($"Canonical suburban parcel {parcel.Id} overlaps reserved land.");
            }
            PlacementRect occupancy = PlacementGeometry.CreateRect(
                parcel.X,
                parcel.Z,
                footprint.Width,
                footprint.Depth,
                parcel.RotationY,
                0);
            houses.Add(new CountrysideSceneryPlacement(
                parcel.Id!,
                CountrysideSceneryKinds.House,
                parcel.X,
                parcel.Z,
                footprint.Width,
                footprint.Depth,
                parcel.RotationY,
                occupancy));
            occupied.Add(occupancy);
        }

        PlanarExtentDefinition bounds = content.CountrysideGrid.BuildableBounds
            ?? throw new InvalidOperationException("Countryside buildable bounds are unavailable.");
        var random = new CountrysideRandom(seed);
        var trees = new List<CountrysideSceneryPlacement>();
        for (int attempt = 0; attempt < NatureAttempts; attempt++)
        {
            double x = bounds.MinX + random.Next() * (bounds.MaxX - bounds.MinX);
            double z = bounds.MinZ + random.Next() * (bounds.MaxZ - bounds.MinZ);
            PlacementRect envelope = PlacementGeometry.CreateRect(
                x,
                z,
                TreeFootprint,
                TreeFootprint,
                clearance: TreeSetback);
            if (envelope.MinX < bounds.MinX
                || envelope.MaxX > bounds.MaxX
                || envelope.MinZ < bounds.MinZ
                || envelope.MaxZ > bounds.MaxZ
                || reservations.Concat(occupied).Any(item => PlacementGeometry.Overlaps(envelope, item)))
            {
                continue;
            }
            string id = $"countryside-tree-{attempt:00}";
            trees.Add(new CountrysideSceneryPlacement(
                id,
                CountrysideSceneryKinds.Tree,
                x,
                z,
                TreeFootprint,
                TreeFootprint,
                0,
                envelope));
            occupied.Add(envelope);
        }
        return new CountrysideExpansionPlan(
            Array.AsReadOnly(reservations),
            Array.AsReadOnly(houses.ToArray()),
            Array.AsReadOnly(trees.ToArray()));
    }

    private sealed class CountrysideRandom(uint state)
    {
        private uint state = state;

        public double Next()
        {
            state = unchecked((state * 1_664_525) + 1_013_904_223);
            return state / ((double)uint.MaxValue + 1);
        }
    }
}

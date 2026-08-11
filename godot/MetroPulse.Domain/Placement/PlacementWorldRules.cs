using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.World;

namespace MetroPulse.Domain.Placement;

public sealed record ProtectedLandmarkEnvelope(string Name, PlacementRect Bounds);

public sealed record PlacementWorldOccupant(
    string Id,
    string Name,
    string Kind,
    PlacementRect Bounds,
    bool ConnectedRoad = false);

public sealed record PlacementZoneParcel(
    string Id,
    double X,
    double Z,
    string ZoneType,
    double HappinessModifier,
    double LandValueModifier)
{
    public const double Size = 30;

    public PlacementRect Bounds => new(X - Size / 2, X + Size / 2, Z - Size / 2, Z + Size / 2);
}

public sealed record PlacementWorldEvaluationInput
{
    public required PlacementSpec Spec { get; init; }
    public required PlacementVector3 Position { get; init; }
    public double RotationY { get; init; }
    public required CatalogAccess CatalogAccess { get; init; }
    public required EconomyLedger Economy { get; init; }
    public required WorldSurfaceModel Surface { get; init; }
    public IReadOnlyList<PlacementWorldOccupant> Occupants { get; init; } = Array.Empty<PlacementWorldOccupant>();
    public IReadOnlyList<PlacementZoneParcel> Zones { get; init; } = Array.Empty<PlacementZoneParcel>();
    public PlacementVector3? PlayerPosition { get; init; }
    public string? IgnoreOccupantId { get; init; }
    public bool IgnorePlayer { get; init; }
}

/// <summary>Canonical world-query adapter that feeds the single PlacementIntelligence authority.</summary>
public static class PlacementWorldRules
{
    public const double GridSnapSize = 10;

    public static readonly IReadOnlyList<ProtectedLandmarkEnvelope> ProtectedLandmarks = Array.AsReadOnly<ProtectedLandmarkEnvelope>([
        new("Central Park", new PlacementRect(-96, -54, -96, -54)),
        new("Suspension Bridge", new PlacementRect(105, 215, -16, 16)),
        new("Rocket Launch Complex", new PlacementRect(668, 742, -318, -238)),
        new("Mission Control", new PlacementRect(716, 760, -268, -224)),
        new("Space Billboard", new PlacementRect(598, 646, -182, -138)),
    ]);

    public static IReadOnlyList<PlacementRect> AuthoredRoads { get; } = CreateAuthoredRoads();

    public static PlacementVector3 SnapAim(double x, double z, WorldSurfaceModel surface, bool enabled = true)
    {
        ArgumentNullException.ThrowIfNull(surface);
        double targetX = enabled ? Math.Round(x / GridSnapSize, MidpointRounding.AwayFromZero) * GridSnapSize : x;
        double targetZ = enabled ? Math.Round(z / GridSnapSize, MidpointRounding.AwayFromZero) * GridSnapSize : z;
        return new PlacementVector3(targetX, surface.GetTerrainHeight(targetX, targetZ), targetZ);
    }

    public static PlacementDecision Evaluate(PlacementWorldEvaluationInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(input.Spec);
        ArgumentNullException.ThrowIfNull(input.Economy);
        ArgumentNullException.ThrowIfNull(input.Surface);
        PlacementSpec spec = input.Spec;
        PlacementFootprint footprint = spec.Footprint ?? new PlacementFootprint(1, 1);
        double clearance = spec.GeneratorType == "ROAD_SEGMENT" ? 0 : PlacementGeometry.DefaultClearance;
        PlacementRect placementRect = PlacementGeometry.CreateRect(
            input.Position.X,
            input.Position.Z,
            footprint.Width,
            footprint.Depth,
            input.RotationY,
            clearance);
        PlacementRect collisionRect = PlacementGeometry.CreateRect(
            input.Position.X,
            input.Position.Z,
            footprint.Width,
            footprint.Depth,
            input.RotationY,
            0);
        ProtectedLandmarkEnvelope? landmark = ProtectedLandmarks.FirstOrDefault(item =>
            PlacementGeometry.Overlaps(placementRect, item.Bounds));
        bool bridgeDeck = string.Equals(spec.RoadType, "BRIDGE", StringComparison.Ordinal);
        bool water = !bridgeDeck && PlacementGeometry.GetWaterSamplePoints(collisionRect, input.Position.Y)
            .Any(point => input.Surface.IsWater(point.X, point.Y, point.Z));
        var heights = new PlacementTerrainHeights(
            input.Surface.GetTerrainHeight(collisionRect.MinX, collisionRect.MinZ),
            input.Surface.GetTerrainHeight(collisionRect.MaxX, collisionRect.MinZ),
            input.Surface.GetTerrainHeight(collisionRect.MinX, collisionRect.MaxZ),
            input.Surface.GetTerrainHeight(collisionRect.MaxX, collisionRect.MaxZ));
        PlacementWorldOccupant? collision = input.Occupants
            .Where(item => item.Id != input.IgnoreOccupantId)
            .OrderBy(item => item.Id, StringComparer.Ordinal)
            .FirstOrDefault(item => PlacementGeometry.Overlaps(placementRect, item.Bounds));
        PlacementZoneParcel? zone = input.Zones
            .OrderBy(item => item.Id, StringComparer.Ordinal)
            .FirstOrDefault(item => PlacementGeometry.Overlaps(collisionRect, item.Bounds));
        List<PlacementRect> roads = AuthoredRoads.Concat(input.Occupants
            .Where(item => item.Id != input.IgnoreOccupantId && item.Kind == "ROAD" && item.ConnectedRoad)
            .Select(item => item.Bounds))
            .ToList();
        EconomyLedgerSnapshot economySnapshot = input.Economy.Snapshot();
        double recurringCost = PlacementIntelligence.CreatePreview(
            spec,
            PlacementEconomySnapshot.FromEconomy(economySnapshot),
            economySnapshot.Treasury).OperatingCost / 60;
        SpendingDecision spending = input.Economy.EvaluateSpending(spec.Cost, new SpendingContext
        {
            Source = "building-placement",
            ReferenceId = spec.Id,
            RecurringCostRate = recurringCost,
        });

        bool eastLocked = input.Position.X >= 185
            && input.Position.X <= 420
            && !input.Economy.IsDistrictUnlocked(EconomyDistrictIds.EastCyberMetropolis);
        return PlacementIntelligence.Evaluate(new PlacementEvaluationInput
        {
            Spec = spec,
            Position = input.Position,
            Access = new PlacementAccess(
                input.CatalogAccess.Unlocked,
                input.CatalogAccess.RequiredTier,
                input.CatalogAccess.Reason),
            District = eastLocked
                ? new PlacementDistrictAccess(
                    false,
                    EconomyDistrictIds.EastCyberMetropolis,
                    "East Cyber-Metropolis is locked.",
                    "Unlock East Cyber-Metropolis from City Tools or choose a West Core parcel.")
                : new PlacementDistrictAccess(),
            InBounds = PlacementGeometry.IsInside(
                placementRect,
                new PlanarBounds(
                    ContentDefinitions.WorldBounds.MinX,
                    ContentDefinitions.WorldBounds.MaxX,
                    ContentDefinitions.WorldBounds.MinZ,
                    ContentDefinitions.WorldBounds.MaxZ)),
            ProtectedLandmark = landmark?.Name,
            Water = water,
            SlopeDegrees = PlacementGeometry.GetSlopeDegrees(collisionRect, heights),
            MaxSlopeDegrees = spec.GeneratorType == "ROAD_SEGMENT" ? 12 : 8,
            PlayerOccupied = !input.IgnorePlayer
                && PlacementGeometry.IsPlayerOccupied(placementRect, input.PlayerPosition),
            RoadOverlap = AuthoredRoads.Any(road => PlacementGeometry.Overlaps(placementRect, road)),
            Collision = collision is null
                ? null
                : new PlacementCollision(collision.Kind, collision.Id, collision.Name),
            Zone = zone is null ? null : new PlacementZone(zone.ZoneType, GetZoneLabel(zone.ZoneType)),
            ZoneCompatible = zone is null || IsZoneCompatible(spec.Category, zone.ZoneType),
            HasRoadAccess = PlacementGeometry.HasRoadAccess(collisionRect, roads),
            EconomySnapshot = PlacementEconomySnapshot.FromEconomy(economySnapshot),
            AvailableCredits = economySnapshot.Treasury,
            SpendingDecision = spending,
        });
    }

    public static bool IsZoneCompatible(string? category, string? zoneType)
    {
        string? normalized = ConstructionVocabulary.NormalizeZoneId(zoneType);
        return category switch
        {
            null or ConstructionCategories.Infrastructure => true,
            ConstructionCategories.Residential => normalized == ConstructionCategories.Residential,
            ConstructionCategories.Commercial => normalized == ConstructionCategories.Commercial,
            ConstructionCategories.Operations => normalized == ConstructionCategories.Operations,
            ConstructionCategories.Facilities => normalized is
                ConstructionCategories.Residential
                or ConstructionCategories.Commercial
                or ConstructionCategories.Operations
                or "POWER_SERVICE"
                or "WATER_SERVICE"
                or "FIRE_SERVICE",
            _ => false,
        };
    }

    public static PlacementZoneParcel CreateZoneParcel(string zoneType, double x, double z)
    {
        string normalized = ConstructionVocabulary.NormalizeZoneId(zoneType)
            ?? throw new ArgumentOutOfRangeException(nameof(zoneType));
        ZoneDefinition definition = ContentDefinitions.Zones.Single(item => item.Id == normalized);
        if (!ConstructionVocabulary.IsMvpDevelopmentZone(normalized))
        {
            throw new InvalidOperationException($"{normalized} is not a player-facing development zone.");
        }
        double parcelX = Math.Round(x / PlacementZoneParcel.Size, MidpointRounding.AwayFromZero) * PlacementZoneParcel.Size;
        double parcelZ = Math.Round(z / PlacementZoneParcel.Size, MidpointRounding.AwayFromZero) * PlacementZoneParcel.Size;
        string id = $"{(int)Math.Round(parcelX / PlacementZoneParcel.Size)}:{(int)Math.Round(parcelZ / PlacementZoneParcel.Size)}";
        return new PlacementZoneParcel(id, parcelX, parcelZ, normalized, definition.Happiness, definition.LandValue);
    }

    private static string GetZoneLabel(string zoneType) =>
        ContentDefinitions.Zones.FirstOrDefault(item => item.Id == zoneType)?.Label ?? zoneType;

    private static IReadOnlyList<PlacementRect> CreateAuthoredRoads()
    {
        const double roadHalfWidth = 9;
        double[] roadX = [-100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750];
        double[] roadZ = [-100, -50, 0, 50, 100];
        var roads = new List<PlacementRect>();
        foreach (double z in roadZ) roads.Add(new PlacementRect(-160, 810, z - roadHalfWidth, z + roadHalfWidth));
        foreach (double x in roadX) roads.Add(new PlacementRect(x - roadHalfWidth, x + roadHalfWidth, -110, 110));
        roads.Add(new PlacementRect(691, 709, -290, -91));
        roads.Add(new PlacementRect(691, 760, -253, -237));
        return roads.AsReadOnly();
    }
}

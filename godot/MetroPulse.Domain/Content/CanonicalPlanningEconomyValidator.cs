using System.Collections.Frozen;

namespace MetroPulse.Domain.Content;

public static partial class CanonicalContentValidator
{
    private static readonly FrozenSet<string> ReservationKinds =
        new[] { "ROAD", "CIVIC" }.ToFrozenSet(StringComparer.Ordinal);

    public static void ValidateEconomyBalance(EconomyBalanceDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "economy-balance");
        ValidateTokenMap(document.FiscalStates, ["STABLE", "DEFICIT", "INSOLVENT", "RECOVERY"], "fiscal-states");
        ValidateTokenMap(document.SpendingCategories, ["ESSENTIAL", "RECOVERY", "DISCRETIONARY"], "spending-categories");
        EconomyBalanceDefinition balance = document.Balance
            ?? throw Error("must be an object.", "economy-balance", field: "balance");

        NonNegative(balance.StartingTreasury, "startingTreasury");
        NonNegative(balance.BaseRevenuePerSecond, "baseRevenuePerSecond");
        FiscalBalanceDefinition fiscal = balance.Fiscal
            ?? throw Error("must be an object.", "economy-balance", field: "balance.fiscal");
        NonNegative(fiscal.ReserveFloor, "fiscal.reserveFloor");
        NonNegative(fiscal.WarningRunwayMinutes, "fiscal.warningRunwayMinutes");
        NonNegative(fiscal.EmergencyGrant, "fiscal.emergencyGrant");

        ConstructionBalanceDefinition construction = balance.Construction
            ?? throw Error("must be an object.", "economy-balance", field: "balance.construction");
        NonNegative(construction.ZoningCost, "construction.zoningCost");
        RequireFinite(construction.DefaultSalvageRate, "economy-balance", null, "balance.construction.defaultSalvageRate", 0, 1);
        ValidateRange(construction.StarterPaybackMinutes, "construction.starterPaybackMinutes");

        MissionBalanceDefinition missions = balance.Missions
            ?? throw Error("must be an object.", "economy-balance", field: "balance.missions");
        RequireFinite(missions.RewardScale, "economy-balance", null, "balance.missions.rewardScale", 0.001);
        ValidateRange(missions.TargetRewardRange, "missions.targetRewardRange");

        IncidentBalanceDefinition incidents = balance.Incidents
            ?? throw Error("must be an object.", "economy-balance", field: "balance.incidents");
        NonNegative(incidents.CleanupCostPerSeverity, "incidents.cleanupCostPerSeverity");
        NonNegative(incidents.RepairCostPerSeverity, "incidents.repairCostPerSeverity");
        PolicyBalanceDefinition policies = balance.Policies
            ?? throw Error("must be an object.", "economy-balance", field: "balance.policies");
        NonNegative(policies.FreightPriorityCostPerSecond, "policies.freightPriorityCostPerSecond");
        FineBalanceDefinition fines = balance.Fines
            ?? throw Error("must be an object.", "economy-balance", field: "balance.fines");
        NonNegative(fines.Maximum, "fines.maximum");
        RequireFinite(fines.TreasuryShare, "economy-balance", null, "balance.fines.treasuryShare", 0, 1);
        ProgressionBalanceDefinition progression = balance.Progression
            ?? throw Error("must be an object.", "economy-balance", field: "balance.progression");
        NonNegative(progression.EastDistrictUnlockCost, "progression.eastDistrictUnlockCost");

        IReadOnlyDictionary<string, SessionTargetDefinition> targets =
            RequireMap(balance.SessionTargets, "economy-session-targets");
        string[] expectedDurations = ["15", "30", "60", "120"];
        if (!targets.Keys.OrderBy(int.Parse).SequenceEqual(expectedDurations, StringComparer.Ordinal))
        {
            throw Error("must contain the 15, 30, 60, and 120 minute targets.", "economy-session-targets", code: "INVALID_RECORD_SET");
        }
        foreach ((string minutes, SessionTargetDefinition target) in targets)
        {
            RequireString(target.Label, "economy-session-targets", minutes, "label");
            RequireFinite(target.MinimumTreasury, "economy-session-targets", minutes, "minimumTreasury", 0);
            RequireFinite(target.MinimumAssets, "economy-session-targets", minutes, "minimumAssets", 0);
        }

        void NonNegative(double value, string field) =>
            RequireFinite(value, "economy-balance", null, $"balance.{field}", 0);
    }

    public static void ValidateCountrysidePlan(CountrysidePlanDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "countryside-plan");
        CountrysideGridDefinition grid = document.Grid
            ?? throw Error("must be an object.", "countryside-plan", field: "grid");
        PlanarExtentDefinition bounds = ValidateExtent(grid.Bounds, "grid.bounds");
        PlanarExtentDefinition buildable = ValidateExtent(grid.BuildableBounds, "grid.buildableBounds");
        if (buildable.MinX < bounds.MinX || buildable.MaxX > bounds.MaxX
            || buildable.MinZ < bounds.MinZ || buildable.MaxZ > bounds.MaxZ)
        {
            throw Error("must remain inside countryside bounds.", "countryside-plan", field: "grid.buildableBounds", code: "INVALID_GEOMETRY");
        }
        RequireFinite(grid.RoadWidth, "countryside-plan", null, "grid.roadWidth", 0.001);
        IReadOnlyList<double> horizontalRoads = ValidateCoordinates(grid.HorizontalRoadCenters, "grid.horizontalRoadCenters");
        IReadOnlyList<double> verticalRoads = ValidateCoordinates(grid.VerticalRoadCenters, "grid.verticalRoadCenters");
        IReadOnlyList<double> columns = ValidateCoordinates(grid.ResidentialColumnCenters, "grid.residentialColumnCenters");
        IReadOnlyList<double> rows = ValidateCoordinates(grid.ResidentialRowCenters, "grid.residentialRowCenters");
        RequireFinite(grid.VerticalRoadMinZ, "countryside-plan", null, "grid.verticalRoadMinZ");
        RequireFinite(grid.VerticalRoadMaxZ, "countryside-plan", null, "grid.verticalRoadMaxZ");
        if (grid.VerticalRoadMinZ >= grid.VerticalRoadMaxZ)
        {
            throw Error("must define an increasing range.", "countryside-plan", field: "grid.verticalRoadMinZ", code: "INVALID_GEOMETRY");
        }
        ValidateVerticalRoad(grid.RocketAccessRoad, "grid.rocketAccessRoad");
        ValidateHorizontalRoad(grid.MissionControlSpur, "grid.missionControlSpur");

        SuburbanHomeRulesDefinition rules = document.HomeRules
            ?? throw Error("must be an object.", "countryside-plan", field: "homeRules");
        BuildingFootprint footprint = rules.Footprint
            ?? throw Error("must be an object.", "countryside-plan", field: "homeRules.footprint");
        RequireFinite(footprint.Width, "countryside-plan", null, "homeRules.footprint.width", 0.001);
        RequireFinite(footprint.Depth, "countryside-plan", null, "homeRules.footprint.depth", 0.001);
        RequireFinite(rules.RoadSetback, "countryside-plan", null, "homeRules.roadSetback", 0);
        RequireFinite(rules.OccupancyProbability, "countryside-plan", null, "homeRules.occupancyProbability", 0, 1);

        IReadOnlyList<PlanarReservationDefinition> reservations = RequireRecords(document.Reservations, "countryside-reservations");
        var reservationIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (PlanarReservationDefinition reservation in reservations)
        {
            string id = RequireString(reservation.Id, "countryside-reservations", reservation.Id ?? "<missing>", "id");
            if (!reservationIds.Add(id))
            {
                throw Error($"duplicates stable ID {id}.", "countryside-reservations", id, "id", "DUPLICATE_ID");
            }
            RequireEnum(reservation.Kind, ReservationKinds, "countryside-reservations", id, "kind");
            ValidateExtent(reservation, $"reservations[{id}]");
        }

        IReadOnlyList<SuburbanParcelDefinition> parcels = RequireRecords(document.Parcels, "countryside-parcels");
        var parcelIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (SuburbanParcelDefinition parcel in parcels)
        {
            string id = RequireString(parcel.Id, "countryside-parcels", parcel.Id ?? "<missing>", "id");
            if (!parcelIds.Add(id))
            {
                throw Error($"duplicates stable ID {id}.", "countryside-parcels", id, "id", "DUPLICATE_ID");
            }
            if (parcel.Zone != "SUBURBAN_RESIDENTIAL" || !columns.Contains(parcel.X) || !rows.Contains(parcel.Z))
            {
                throw Error("must reference the authored suburban grid and zone.", "countryside-parcels", id, code: "INVALID_REFERENCE");
            }
            if (Math.Abs(parcel.RotationY) > 1e-12 && Math.Abs(parcel.RotationY - Math.PI) > 1e-12)
            {
                throw Error("must face an authored road frontage.", "countryside-parcels", id, "rotationY", "INVALID_GEOMETRY");
            }
            double halfX = (footprint.Width / 2) + rules.RoadSetback;
            double halfZ = (footprint.Depth / 2) + rules.RoadSetback;
            var envelope = new PlanarExtentDefinition
            {
                MinX = parcel.X - halfX,
                MaxX = parcel.X + halfX,
                MinZ = parcel.Z - halfZ,
                MaxZ = parcel.Z + halfZ,
            };
            if (envelope.MinX < buildable.MinX || envelope.MaxX > buildable.MaxX
                || envelope.MinZ < buildable.MinZ || envelope.MaxZ > buildable.MaxZ
                || reservations.Any(reservation => Overlaps(envelope, reservation)))
            {
                throw Error("overlaps reserved or non-buildable land.", "countryside-parcels", id, code: "INVALID_GEOMETRY");
            }
        }

        _ = horizontalRoads;
        _ = verticalRoads;
    }

    public static void ValidateStreetFurniture(StreetFurnitureDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "street-furniture");
        RequireFinite(document.MinSpacing, "street-furniture", null, "minSpacing", 0.001);
        StreetRoadCoordinates roads = document.Roads
            ?? throw Error("must be an object.", "street-furniture", field: "roads");
        IReadOnlyList<double> xRoads = ValidateCoordinates(roads.X, "roads.x", "street-furniture");
        IReadOnlyList<double> zRoads = ValidateCoordinates(roads.Z, "roads.z", "street-furniture");
        IReadOnlyList<StreetLampPlacement> placements = RequireRecords(document.Placements, "street-lamp-placements");

        for (int index = 0; index < placements.Count; index++)
        {
            StreetLampPlacement placement = placements[index];
            RequireFinite(placement.X, "street-lamp-placements", index, "x");
            RequireFinite(placement.Z, "street-lamp-placements", index, "z");
            RequireFinite(placement.RoadCenter, "street-lamp-placements", index, "roadCenter");
            RequireFinite(placement.Rotation, "street-lamp-placements", index, "rot");
            double expectedRotation;
            if (placement.RoadAxis == "z" && xRoads.Contains(placement.RoadCenter))
            {
                expectedRotation = Math.Atan2(placement.RoadCenter - placement.X, 0);
            }
            else if (placement.RoadAxis == "x" && zRoads.Contains(placement.RoadCenter))
            {
                expectedRotation = Math.Atan2(0, placement.RoadCenter - placement.Z);
            }
            else
            {
                throw Error("references an unknown road axis or center.", "street-lamp-placements", index, "roadCenter", "INVALID_REFERENCE");
            }
            if (Math.Abs(expectedRotation - placement.Rotation) > 1e-12)
            {
                throw Error("must face its road centerline.", "street-lamp-placements", index, "rot", "INVALID_DERIVED_VALUE");
            }

            for (int otherIndex = 0; otherIndex < index; otherIndex++)
            {
                StreetLampPlacement other = placements[otherIndex];
                double deltaX = placement.X - other.X;
                double deltaZ = placement.Z - other.Z;
                if (Math.Sqrt((deltaX * deltaX) + (deltaZ * deltaZ)) < document.MinSpacing)
                {
                    throw Error("violates minimum spacing.", "street-lamp-placements", index, code: "INVALID_GEOMETRY");
                }
            }
        }
    }

    private static void ValidateTokenMap(IReadOnlyDictionary<string, string>? map, string[] tokens, string source)
    {
        IReadOnlyDictionary<string, string> records = RequireMap(map, source);
        if (records.Count != tokens.Length || tokens.Any(token => !records.TryGetValue(token, out string? value) || value != token))
        {
            throw Error("must preserve every canonical token exactly.", source, code: "INVALID_RECORD_SET");
        }
    }

    private static void ValidateRange(NumericRangeDefinition? range, string field)
    {
        if (range is null)
        {
            throw Error("must be an object.", "economy-balance", field: $"balance.{field}");
        }
        RequireFinite(range.Minimum, "economy-balance", null, $"balance.{field}.min", 0);
        RequireFinite(range.Maximum, "economy-balance", null, $"balance.{field}.max", range.Minimum);
    }

    private static PlanarExtentDefinition ValidateExtent(PlanarExtentDefinition? extent, string field)
    {
        if (extent is null)
        {
            throw Error("must be an object.", "countryside-plan", field: field);
        }
        RequireFinite(extent.MinX, "countryside-plan", null, $"{field}.minX");
        RequireFinite(extent.MaxX, "countryside-plan", null, $"{field}.maxX");
        RequireFinite(extent.MinZ, "countryside-plan", null, $"{field}.minZ");
        RequireFinite(extent.MaxZ, "countryside-plan", null, $"{field}.maxZ");
        if (extent.MinX >= extent.MaxX || extent.MinZ >= extent.MaxZ)
        {
            throw Error("must define increasing bounds.", "countryside-plan", field: field, code: "INVALID_GEOMETRY");
        }
        return extent;
    }

    private static IReadOnlyList<double> ValidateCoordinates(
        IReadOnlyList<double>? values,
        string field,
        string source = "countryside-plan")
    {
        IReadOnlyList<double> coordinates = RequireRecords(values, $"{source}.{field}");
        for (int index = 0; index < coordinates.Count; index++)
        {
            RequireFinite(coordinates[index], source, null, $"{field}[{index}]");
        }
        if (coordinates.Distinct().Count() != coordinates.Count)
        {
            throw Error("must not contain duplicates.", source, field: field, code: "DUPLICATE_ID");
        }
        return coordinates;
    }

    private static void ValidateVerticalRoad(VerticalRoadDefinition? road, string field)
    {
        if (road is null) throw Error("must be an object.", "countryside-plan", field: field);
        RequireFinite(road.CenterX, "countryside-plan", null, $"{field}.centerX");
        RequireFinite(road.MinZ, "countryside-plan", null, $"{field}.minZ");
        RequireFinite(road.MaxZ, "countryside-plan", null, $"{field}.maxZ", road.MinZ);
        RequireFinite(road.Width, "countryside-plan", null, $"{field}.width", 0.001);
    }

    private static void ValidateHorizontalRoad(HorizontalRoadDefinition? road, string field)
    {
        if (road is null) throw Error("must be an object.", "countryside-plan", field: field);
        RequireFinite(road.MinX, "countryside-plan", null, $"{field}.minX");
        RequireFinite(road.MaxX, "countryside-plan", null, $"{field}.maxX", road.MinX);
        RequireFinite(road.CenterZ, "countryside-plan", null, $"{field}.centerZ");
        RequireFinite(road.Width, "countryside-plan", null, $"{field}.width", 0.001);
    }

    private static bool Overlaps(PlanarExtentDefinition left, PlanarExtentDefinition right) =>
        left.MinX < right.MaxX && left.MaxX > right.MinX
        && left.MinZ < right.MaxZ && left.MaxZ > right.MinZ;
}

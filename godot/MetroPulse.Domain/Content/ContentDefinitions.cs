using System.Collections.Frozen;

namespace MetroPulse.Domain.Content;

public sealed record WorldBounds(double MinX, double MaxX, double MinY, double MaxY, double MinZ, double MaxZ)
{
    public bool Contains(double x, double z) => x >= MinX && x <= MaxX && z >= MinZ && z <= MaxZ;
}

public sealed record PlanarBounds(double MinX, double MaxX, double MinZ, double MaxZ);

public sealed record DistrictDefinition(string Id, string Label, PlanarBounds Bounds, string ReleaseScope);

public sealed record ZoneDefinition(
    string Id,
    string Label,
    IReadOnlyList<string> Aliases,
    int Color,
    double Happiness,
    double LandValue,
    string Kind,
    string ReleaseScope);

public sealed record FactionDefinition(string Id, string Label, double MinReputation, double MaxReputation);

public sealed record ProgressionDefinition(string Id, string Label, int Rank, IReadOnlyList<string> PrerequisiteIds);

public static class FeatureIds
{
    public const string Aircraft = "aircraft";
    public const string RocketLaunch = "rocketLaunch";
    public const string EastSideDevelopment = "eastSideDevelopment";
    public const string TemporaryMayhem = "temporaryMayhem";
    public const string MayhemVariants = "mayhemVariants";
    public const string PersistentMayhem = "persistentMayhem";
    public const string CountrysideExpansion = "countrysideExpansion";
}

public static class ContentDefinitions
{
    public static readonly WorldBounds WorldBounds = new(-190, 810, -100, 2_000, -390, 390);

    public static readonly IReadOnlyList<DistrictDefinition> Districts = Array.AsReadOnly<DistrictDefinition>([
        new("WEST_CORE", "West Core", new(-190, 105, -150, 150), "MVP"),
        new("CENTRAL_PARK", "Central Park", new(-105, -45, -105, -45), "MVP"),
        new("PRIMARY_BRIDGE_CORRIDOR", "Primary Bridge Corridor", new(105, 330, -150, 150), "MVP"),
        new("EAST_CYBER_METROPOLIS", "East Cyber Metropolis", new(330, 810, -390, 390), "POST_MVP"),
    ]);

    public static readonly IReadOnlyList<ZoneDefinition> Zones = Array.AsReadOnly([
        Zone("RESIDENTIAL", "Residential", ["RES"], 0x22c55e, 1.2, 1.5),
        Zone("COMMERCIAL", "Commercial", ["COM", "OFFICE"], 0xd946ef, 0.3, 2.2),
        Zone("OPERATIONS", "Operations", ["OPS", "IND", "INDUSTRIAL"], 0xf97316, -1.5, -1),
        Zone("POWER_SERVICE", "Legacy Power Parcel", ["POWER"], 0xfacc15, 0.2, 0.4, "SERVICE", "COMPATIBILITY"),
        Zone("WATER_SERVICE", "Legacy Water Parcel", ["WATER"], 0x06b6d4, 0.8, 0.7, "SERVICE", "COMPATIBILITY"),
        Zone("FIRE_SERVICE", "Legacy Fire Parcel", ["FIRE"], 0xef4444, 1.5, 1.2, "SERVICE", "COMPATIBILITY"),
        Zone("SUBURBAN_RESIDENTIAL", "Suburban Residential", [], 0x65a30d, 1.4, 1.1, "AUTHORED_WORLD", "POST_MVP"),
    ]);

    public static readonly IReadOnlyList<FactionDefinition> Factions = Array.AsReadOnly<FactionDefinition>([
        new("QUANTUM_DYNAMICS", "Quantum Dynamics", -100, 100),
        new("AETHER_SKYSPIRE", "Aether Skyspire", -100, 100),
        new("RESIDENTS", "Residents", -100, 100),
        new("OPERATIONS", "Operations", -100, 100),
    ]);

    public static readonly IReadOnlyList<ProgressionDefinition> Progression = Array.AsReadOnly<ProgressionDefinition>([
        new("OPERATOR", "Operator", 1, Array.AsReadOnly(Array.Empty<string>())),
        new("BROKER", "Broker", 2, Array.AsReadOnly(["OPERATOR"])),
        new("MAGNATE", "Magnate", 3, Array.AsReadOnly(["BROKER"])),
    ]);

    public static readonly IReadOnlyList<string> VehicleIds = Array.AsReadOnly([
        "SEDAN",
        "SPORTS",
        "SPORTS_CAR",
        "BUS",
        "TRUCK",
        "TAXI",
        "POLICE",
        "AMBULANCE",
        "ICECREAM",
        "DUMP_TRUCK",
        "MOTORBIKE",
    ]);

    public static readonly IReadOnlyList<string> MvpWorldFootprint = Array.AsReadOnly([
        "WEST_CORE",
        "CENTRAL_PARK",
        "PRIMARY_BRIDGE_CORRIDOR",
    ]);

    public static readonly IReadOnlyList<string> MvpActivityTemplates = Array.AsReadOnly([
        "TAXI",
        "COURIER",
        "DELIVERY",
        "RACE",
        "SABOTAGE",
        "SURVIVAL",
    ]);

    public static readonly IReadOnlyList<string> MvpMissionIds = Array.AsReadOnly([
        "mission_executive",
        "mission_scientist",
        "mission_police_robbery",
        "mission_police_park",
        "mission_sports_trial",
        "mission_sports_smuggle",
        "mission_bus_loop",
        "mission_truck_delivery",
        "mission_sedan_grocery",
        "mission_mayhem_escape",
    ]);

    public static readonly IReadOnlyDictionary<string, string> MvpZoneLabels =
        new Dictionary<string, string>
        {
            ["RESIDENTIAL"] = "Residential",
            ["COMMERCIAL"] = "Commercial",
            ["OPERATIONS"] = "Operations",
        }.ToFrozenDictionary(StringComparer.Ordinal);

    public static readonly IReadOnlyDictionary<string, bool> MvpFeatureFlags =
        new Dictionary<string, bool>
        {
            [FeatureIds.Aircraft] = false,
            [FeatureIds.RocketLaunch] = false,
            [FeatureIds.EastSideDevelopment] = false,
            [FeatureIds.TemporaryMayhem] = false,
            [FeatureIds.MayhemVariants] = false,
            [FeatureIds.PersistentMayhem] = false,
            [FeatureIds.CountrysideExpansion] = false,
        }.ToFrozenDictionary(StringComparer.Ordinal);

    public static readonly IReadOnlySet<string> DistrictIds = Districts.Select(item => item.Id).ToFrozenSet(StringComparer.Ordinal);

    public static readonly IReadOnlySet<string> VehicleIdSet = VehicleIds.ToFrozenSet(StringComparer.Ordinal);

    private static ZoneDefinition Zone(
        string id,
        string label,
        string[] aliases,
        int color,
        double happiness,
        double landValue,
        string kind = "DEVELOPMENT",
        string releaseScope = "MVP") =>
        new(id, label, Array.AsReadOnly(aliases), color, happiness, landValue, kind, releaseScope);
}

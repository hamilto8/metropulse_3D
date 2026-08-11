using MetroPulse.Domain.Content;
using MetroPulse.Domain.World;

namespace MetroPulse.Domain.Economy;

/// <summary>
/// The single mapping boundary from authored/catalog building data to the economy authority.
/// </summary>
public static class BuildingEconomyAdapter
{
    public static EconomyBuilding FromCatalog(
        BuildingDefinition spec,
        string id,
        EconomyPoint position,
        bool operational = true)
    {
        ArgumentNullException.ThrowIfNull(spec);
        if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("An economy building ID is required.", nameof(id));
        ArgumentNullException.ThrowIfNull(position);

        double authoredIncome = FiniteOrZero(spec.IncomePerMinute);
        double grossIncomeRate = Math.Max(0, authoredIncome) / 60;
        double operatingCostRate = Math.Max(0, -authoredIncome) / 60;
        int population = ToCount(spec.Residents);
        int employees = ToCount(spec.Employees);
        double amenityRadius = NonNegative(spec.AmenityRadius);
        double happiness = FiniteOrZero(spec.Happiness);

        return new EconomyBuilding(id.Trim(), grossIncomeRate, operatingCostRate, operational)
        {
            Name = spec.Name ?? id.Trim(),
            Kind = spec.Category ?? spec.GeneratorType ?? ConstructionCategories.Commercial,
            Value = NonNegative(spec.Value),
            Employees = employees,
            JobCapacity = employees,
            Population = population,
            HousingCapacity = population,
            Status = spec.Status ?? "Operational",
            PassiveIncomeRate = grossIncomeRate,
            HappinessModifier = happiness,
            LandValueModifier = happiness * 0.6 + (amenityRadius > 0 ? 3 : 0),
            Position = position,
            AmenityRadius = amenityRadius,
            Services = new EconomyBuildingServices
            {
                Power = new EconomyBuildingService(
                    NonNegative(spec.PowerSupply),
                    NonNegative(spec.PowerDemand),
                    ServiceReach(spec.PowerReach, spec.PowerSupply, 180)),
                Water = new EconomyBuildingService(
                    NonNegative(spec.WaterSupply),
                    NonNegative(spec.WaterDemand),
                    ServiceReach(spec.WaterReach, spec.WaterSupply, 160)),
                Fire = new EconomyBuildingService(
                    NonNegative(spec.FireCoverage),
                    Math.Ceiling((population + employees) / 180d),
                    ServiceReach(spec.FireReach, spec.FireCoverage, 140)),
            },
        };
    }

    public static EconomyBuilding FromAuthoredSkyline(WorldObjectDefinition definition, int ordinal)
    {
        ArgumentNullException.ThrowIfNull(definition);
        if (definition.ChunkId != "InitialSkyline" || definition.Kind != "building")
        {
            throw new ArgumentException("Only authored InitialSkyline building records can use the skyline adapter.", nameof(definition));
        }
        if (ordinal < 1) throw new ArgumentOutOfRangeException(nameof(ordinal));

        int employees = (int)Math.Round(definition.Size.Y * 8, MidpointRounding.AwayFromZero);
        double value = Math.Max(150_000, Math.Round((definition.Size.Y * 8_500) + (employees * 180)));
        return new EconomyBuilding($"existing-{ordinal}")
        {
            Name = definition.Id,
            Kind = ConstructionCategories.Commercial,
            Value = value,
            Employees = employees,
            JobCapacity = employees,
            Status = "Open",
            Position = new EconomyPoint(definition.Position.X, definition.Position.Z),
        };
    }

    public static IReadOnlyList<EconomyBuilding> AdaptAuthoredSkyline(MvpWorldLayout layout)
    {
        ArgumentNullException.ThrowIfNull(layout);
        EconomyBuilding[] records = layout.Objects
            .Where(item => item.ChunkId == "InitialSkyline" && item.Kind == "building")
            .Select((item, index) => FromAuthoredSkyline(item, index + 1))
            .ToArray();
        return Array.AsReadOnly(records);
    }

    private static int ToCount(double? value) =>
        (int)Math.Round(NonNegative(value), MidpointRounding.AwayFromZero);

    private static double FiniteOrZero(double? value) => value is double number && double.IsFinite(number) ? number : 0;

    private static double NonNegative(double? value) => Math.Max(0, FiniteOrZero(value));

    private static double ServiceReach(double? reach, double? capacity, double defaultReach)
    {
        double normalizedReach = NonNegative(reach);
        return normalizedReach > 0 || NonNegative(capacity) == 0 ? normalizedReach : defaultReach;
    }
}

using MetroPulse.Domain.Content;
using Xunit;

namespace MetroPulse.Domain.Tests.Content;

public sealed class ConstructionVocabularyTests
{
    [Fact]
    public void VocabularyHasExactlyThreeDevelopmentZonesAndCompatibilityAliases()
    {
        Assert.Equal("OPERATIONS", ConstructionVocabulary.NormalizeZoneId("IND"));
        Assert.Equal("OPERATIONS", ConstructionVocabulary.NormalizeZoneId("industrial"));
        Assert.Equal("COMMERCIAL", ConstructionVocabulary.NormalizeZoneId("OFFICE"));
        Assert.True(ConstructionVocabulary.IsMvpDevelopmentZone("RES"));
        Assert.False(ConstructionVocabulary.IsMvpDevelopmentZone("POWER"));
        Assert.Equal(
            ["RESIDENTIAL", "COMMERCIAL", "OPERATIONS", "FACILITIES", "INFRASTRUCTURE"],
            ConstructionCategories.All);
    }

    [Fact]
    public void DisclosureAndProgressionLocksMatchTheCanonicalCatalog()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        IReadOnlyList<BuildingDefinition> starter = ConstructionVocabulary.FilterCatalog(
            content.BuildingRecords,
            includeAdvanced: false,
            unlockedTiers: [ProgressionTiers.Operator],
            includeLocked: true);
        IReadOnlyList<BuildingDefinition> advancedOperator = ConstructionVocabulary.FilterCatalog(
            content.BuildingRecords,
            includeAdvanced: true,
            unlockedTiers: [ProgressionTiers.Operator],
            includeLocked: false);

        Assert.Equal(6, starter.Count);
        Assert.Equal(
            ["CYBERCAFE", "METRO_LOFTS", "ROAD_STRAIGHT", "SOLAR_GRID", "CYBER_FAB", "FIRE_STATION"],
            starter.Select(item => item.Id));
        Assert.Contains(advancedOperator, item => item.Id == "ROAD_INTERSECTION");
        Assert.DoesNotContain(advancedOperator, item => item.Id == "GALAXY_CINEMA");

        CatalogAccess locked = ConstructionVocabulary.GetCatalogAccess(
            content.GetBuilding("AETHER_LANDMARK")!,
            [ProgressionTiers.Operator]);
        Assert.False(locked.Unlocked);
        Assert.Equal(ProgressionTiers.Magnate, locked.RequiredTier);
        Assert.Equal("Unlocks at Magnate tier", locked.Reason);
    }
}

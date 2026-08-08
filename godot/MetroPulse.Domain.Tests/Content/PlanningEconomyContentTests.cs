using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using Xunit;

namespace MetroPulse.Domain.Tests.Content;

public sealed class PlanningEconomyContentTests
{
    private static readonly JsonSerializerOptions JsonOptions = new();

    [Fact]
    public void ProductionRegistryMatchesEveryPlanningAndEconomyArtifactScalar()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();

        JsonObject economy = ReadDomainJson("MetroPulse.Domain.Content.Data.economy-balance.json");
        AssertJsonEqual(economy["fiscalStates"], registry.FiscalStates);
        AssertJsonEqual(economy["spendingCategories"], registry.SpendingCategories);
        AssertJsonEqual(economy["balance"], registry.EconomyBalance);

        JsonObject countryside = ReadDomainJson("MetroPulse.Domain.Content.Data.countryside-plan.json");
        AssertJsonEqual(countryside["grid"], registry.CountrysideGrid);
        AssertJsonEqual(countryside["homeRules"], registry.SuburbanHomeRules);
        AssertJsonEqual(countryside["reservations"], registry.CountrysideReservations);
        AssertJsonEqual(countryside["parcels"], registry.SuburbanParcels);

        JsonObject street = ReadDomainJson("MetroPulse.Domain.Content.Data.street-furniture.json");
        AssertJsonEqual(street["minSpacing"], registry.StreetLampMinimumSpacing);
        AssertJsonEqual(street["roads"], registry.StreetLampRoads);
        AssertJsonEqual(street["placements"], registry.StreetLampPlacements);

        Assert.Equal(14, registry.CountrysideReservations.Count);
        Assert.Equal(17, registry.SuburbanParcels.Count);
        Assert.Equal(146, registry.StreetLampPlacements.Count);
    }

    [Fact]
    public void EconomyBalanceMatchesDirectFrozenFixtureEvidence()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("economy.json"));
        JsonElement data = fixture.RootElement.GetProperty("data");
        JsonElement initial = data.GetProperty("initial");
        EconomyBalanceDefinition balance = registry.EconomyBalance;

        Assert.Equal(initial.GetProperty("treasury").GetDouble(), balance.StartingTreasury);
        Assert.Equal(
            initial.GetProperty("budgetBreakdown").GetProperty("baseRevenueRate").GetDouble(),
            balance.BaseRevenuePerSecond);
        Assert.Equal(initial.GetProperty("fiscal").GetProperty("reserveFloor").GetDouble(), balance.Fiscal!.ReserveFloor);
        Assert.Equal(
            initial.GetProperty("fiscal").GetProperty("warningRunwayMinutes").GetDouble(),
            balance.Fiscal.WarningRunwayMinutes);
        Assert.Equal(initial.GetProperty("fiscal").GetProperty("emergencyGrant").GetDouble(), balance.Fiscal.EmergencyGrant);
        Assert.Equal(
            initial.GetProperty("districts").GetProperty("EAST_CYBER_METROPOLIS").GetProperty("unlockCost").GetDouble(),
            balance.Progression!.EastDistrictUnlockCost);

        foreach ((string minutes, SessionTargetDefinition target) in balance.SessionTargets!)
        {
            JsonElement scenario = data.GetProperty("scenarios").GetProperty(minutes);
            Assert.True(scenario.GetProperty("snapshot").GetProperty("treasury").GetDouble() >= target.MinimumTreasury);
            Assert.True(scenario.GetProperty("assetCount").GetInt32() >= target.MinimumAssets);
        }
    }

    [Fact]
    public void EconomyValidationRejectsUnsafeBalanceAndIncompleteTargets()
    {
        JsonObject unsafeBalance = ReadDomainJson("MetroPulse.Domain.Content.Data.economy-balance.json");
        unsafeBalance["balance"]!["fines"]!["treasuryShare"] = 1.1;
        ContentValidationException unsafeError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateEconomyBalance(
                CanonicalContentLoader.LoadEconomyBalance(unsafeBalance.ToJsonString())));
        Assert.Equal("economy-balance.balance.fines.treasuryShare", unsafeError.Path);

        JsonObject missingTarget = ReadDomainJson("MetroPulse.Domain.Content.Data.economy-balance.json");
        missingTarget["balance"]!["sessionTargets"]!.AsObject().Remove("30");
        ContentValidationException targetError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateEconomyBalance(
                CanonicalContentLoader.LoadEconomyBalance(missingTarget.ToJsonString())));
        Assert.Equal("INVALID_RECORD_SET", targetError.Code);
    }

    [Fact]
    public void PlanningValidationRejectsReservedParcelsAndMisdirectedLamps()
    {
        JsonObject countryside = ReadDomainJson("MetroPulse.Domain.Content.Data.countryside-plan.json");
        JsonNode parcel = countryside["parcels"]![0]!;
        parcel["id"] = "suburban-700--125";
        parcel["x"] = 700;
        parcel["z"] = -125;
        ContentValidationException parcelError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateCountrysidePlan(
                CanonicalContentLoader.LoadCountrysidePlan(countryside.ToJsonString())));
        Assert.Equal("INVALID_GEOMETRY", parcelError.Code);
        Assert.Equal("countryside-parcels[suburban-700--125]", parcelError.Path);

        JsonObject street = ReadDomainJson("MetroPulse.Domain.Content.Data.street-furniture.json");
        street["placements"]![0]!["rot"] = 0;
        ContentValidationException lampError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateStreetFurniture(
                CanonicalContentLoader.LoadStreetFurniture(street.ToJsonString())));
        Assert.Equal("INVALID_DERIVED_VALUE", lampError.Code);
        Assert.Equal("street-lamp-placements[0].rot", lampError.Path);
    }

    [Fact]
    public void PublishedPlanningAndEconomyCollectionsAreReadOnly()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();

        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, SessionTargetDefinition>)registry.EconomyBalance.SessionTargets!)
                .Add("240", new SessionTargetDefinition()));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<SuburbanParcelDefinition>)registry.SuburbanParcels).Add(new SuburbanParcelDefinition()));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<double>)registry.StreetLampRoads.X!).Add(999));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<StreetLampPlacement>)registry.StreetLampPlacements).Add(new StreetLampPlacement()));
    }

    private static void AssertJsonEqual(JsonNode? expected, object actual) =>
        Assert.True(JsonNode.DeepEquals(expected, JsonSerializer.SerializeToNode(actual, JsonOptions)));

    private static JsonObject ReadDomainJson(string resourceName)
    {
        Assembly assembly = typeof(GameContentRegistry).Assembly;
        using Stream stream = assembly.GetManifestResourceStream(resourceName)!;
        return JsonNode.Parse(stream)!.AsObject();
    }
}

using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using Xunit;

namespace MetroPulse.Domain.Tests.Economy;

public sealed class EastSideDevelopmentModelTests
{
    [Fact]
    public void FeatureScopeAndCapitalProduceExplicitUnlockStates()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger ledger = CreateLedger(content);

        EastSideDevelopmentSnapshot unavailable = EastSideDevelopmentModel.Capture(ledger, featureAvailable: false);
        EastSideDevelopmentSnapshot locked = EastSideDevelopmentModel.Capture(ledger, featureAvailable: true);

        Assert.Equal("UNAVAILABLE", unavailable.Status);
        Assert.False(unavailable.CanUnlock);
        Assert.Equal("LOCKED", locked.Status);
        Assert.Equal(1_000_000, locked.UnlockCost);
        Assert.False(locked.CanUnlock);

        ledger.Earn(locked.UnlockCost, "test-capital");
        EastSideDevelopmentSnapshot ready = EastSideDevelopmentModel.Capture(ledger, featureAvailable: true);
        Assert.Equal("READY", ready.Status);
        Assert.True(ready.CanUnlock);
    }

    [Fact]
    public void UnlockChargesExactlyOnceAndProjectsPersistentAccess()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        EconomyLedger ledger = CreateLedger(content);
        ledger.Earn(1_000_000, "test-capital");
        double before = ledger.Treasury;

        Assert.True(ledger.UnlockEastDistrict());
        Assert.False(ledger.UnlockEastDistrict());

        EastSideDevelopmentSnapshot result = EastSideDevelopmentModel.Capture(ledger, featureAvailable: true);
        Assert.True(result.Unlocked);
        Assert.Equal("UNLOCKED", result.Status);
        Assert.Equal(before - 1_000_000, result.Treasury);
    }

    private static EconomyLedger CreateLedger(GameContentRegistry content) => new(
        content.EconomyBalance,
        content.EconomyBalance.StartingTreasury,
        content.EconomyBalance.BaseRevenuePerSecond,
        population: 1_200,
        happiness: 70,
        landValue: 100,
        services: new EconomyBaseServices());
}

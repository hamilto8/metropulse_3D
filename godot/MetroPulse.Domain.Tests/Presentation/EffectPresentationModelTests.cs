using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class EffectPresentationModelTests
{
    [Fact]
    public void PoolsAreBoundedPresentationOnlyAndHaveCaptions()
    {
        Assert.Equal(48, EffectPresentationModel.TotalPooledNodes);
        Assert.All(EffectPresentationModel.Pools, pool =>
        {
            Assert.False(pool.CollisionEnabled);
            Assert.False(pool.MutatesRoadGraph);
            Assert.False(pool.MutatesEconomy);
            Assert.False(string.IsNullOrWhiteSpace(pool.Caption));
        });
    }

    [Fact]
    public void PoolReusesOldestSlotAndCleansExpiredLeases()
    {
        var pool = new EffectPoolModel(new EffectPoolSpec("TEST", 2, 1, false, false, false, false, "[test]"));
        EffectLease first = pool.Acquire(0, "a");
        EffectLease second = pool.Acquire(0.1, "b");
        EffectLease reused = pool.Acquire(0.2, "c");

        Assert.Equal(first.Slot, reused.Slot);
        Assert.NotEqual(first.Generation, reused.Generation);
        Assert.Equal(2, pool.ActiveCount);
        Assert.Equal(2, pool.Cleanup(2));
        Assert.Equal(0, pool.ActiveCount);
        Assert.NotEqual(first.Slot, second.Slot);
    }

    [Fact]
    public void PersistentFireDeduplicatesBySourceAndAccessibilityHonorsMotionSettings()
    {
        var fire = new EffectPoolModel(EffectPresentationModel.Pools.Single(pool => pool.Id == EffectIds.Fire));
        EffectLease first = fire.Acquire(0, "vehicle-1");
        EffectLease updated = fire.Acquire(3, "vehicle-1");
        SettingsPreferences reduced = SettingsValidator.DefaultSettings with
        {
            Motion = SettingsValidator.DefaultSettings.Motion with
            {
                ReducedMotion = SettingValues.ReduceMotion,
                FlashIntensity = SettingValues.OffEffect,
            },
        };
        EffectAccessibilityPolicy policy = EffectPresentationModel.Accessibility(reduced);

        Assert.Equal(first.Slot, updated.Slot);
        Assert.Equal(1, fire.ActiveCount);
        Assert.True(fire.ReleaseSource("vehicle-1"));
        Assert.Equal(0, policy.ShakeScale);
        Assert.Equal(0, policy.FlashScale);
        Assert.False(policy.SpawnComets);
    }
}

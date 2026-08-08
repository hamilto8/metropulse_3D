using System.Text.Json;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Randomness;
using Xunit;

namespace MetroPulse.Domain.Tests.Randomness;

public sealed class RandomStreamTests
{
    [Fact]
    public void NamedStreamGoldenVectorMatchesBrowserXmur3Mulberry32()
    {
        var registry = new RandomStreamRegistry("alpha");
        double[] expected =
        [
            0.015892629278823733,
            0.6097019072622061,
            0.33537824521772563,
            0.4588300420437008,
            0.7504369881935418,
        ];

        Assert.Equal(expected, expected.Select(_ => registry.WorldGeneration.NextDouble()));
        Assert.Equal(5UL, registry.WorldGeneration.DrawCount);
        Assert.All(expected, value => Assert.InRange(value, 0, 0.9999999999999999));
    }

    [Fact]
    public void EveryRequiredStreamIsStableSeedSensitiveAndIsolated()
    {
        var first = new RandomStreamRegistry("repeatable");
        var second = new RandomStreamRegistry("repeatable");
        var changed = new RandomStreamRegistry("different");
        Assert.Equal(RandomStreamNames.All, RandomStreamNames.All.Select(name => first.Get(name).Name));

        foreach (string name in RandomStreamNames.All)
        {
            double expected = first.Get(name).NextDouble();
            Assert.Equal(expected, second.Get(name).NextDouble());
            Assert.NotEqual(expected, changed.Get(name).NextDouble());
        }

        var isolated = new RandomStreamRegistry("isolation");
        var untouched = new RandomStreamRegistry("isolation");
        for (int draw = 0; draw < 100; draw += 1) isolated.Cosmetic.NextDouble();
        Assert.Equal(untouched.Mission.NextDouble(), isolated.Mission.NextDouble());
        Assert.Equal(untouched.PedestrianSpawn.NextDouble(), isolated.PedestrianSpawn.NextDouble());
        Assert.Throws<ArgumentOutOfRangeException>(() => isolated.Get("Anonymous"));
    }

    [Fact]
    public void IntegerRangeChanceAndDrawCountsUseOneOrderedSampleEach()
    {
        var registry = new RandomStreamRegistry("helpers");
        IRandomStream stream = registry.Mission;
        int integer = stream.NextInt(7);
        double range = stream.NextRange(-4, 9);
        bool chance = stream.Chance(0.5);

        Assert.InRange(integer, 0, 6);
        Assert.InRange(range, -4, 9);
        Assert.IsType<bool>(chance);
        Assert.Equal(3UL, stream.DrawCount);
        Assert.Throws<ArgumentOutOfRangeException>(() => stream.NextInt(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => stream.NextRange(2, 1));
        Assert.Equal(3UL, stream.DrawCount);
    }

    [Fact]
    public void GameplayStreamsRoundTripExactlyWhileCosmeticRestarts()
    {
        var registry = new RandomStreamRegistry("save-seed");
        foreach (string name in RandomStreamNames.Persistent)
        {
            int draws = name.Length % 5 + 1;
            for (int draw = 0; draw < draws; draw += 1) registry.Get(name).NextDouble();
        }
        for (int draw = 0; draw < 9; draw += 1) registry.Cosmetic.NextDouble();

        RandomStreamRegistryState state = registry.Snapshot();
        Assert.Equal(7, state.Streams.Count);
        Assert.DoesNotContain(RandomStreamNames.Cosmetic, state.Streams.Keys);
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, RandomStreamState>)state.Streams)
                .Add(RandomStreamNames.Cosmetic, new RandomStreamState()));

        string json = JsonSerializer.Serialize(state);
        RandomStreamRegistryState restoredDocument = JsonSerializer.Deserialize<RandomStreamRegistryState>(json)!;
        RandomStreamRegistry restored = RandomStreamRegistry.Restore(restoredDocument);
        foreach (string name in RandomStreamNames.Persistent)
        {
            Assert.Equal(registry.Get(name).NextDouble(), restored.Get(name).NextDouble());
            Assert.Equal(registry.Get(name).DrawCount, restored.Get(name).DrawCount);
        }

        var fresh = new RandomStreamRegistry("save-seed");
        Assert.Equal(fresh.Cosmetic.NextDouble(), restored.Cosmetic.NextDouble());
        Assert.NotEqual(registry.Cosmetic.NextDouble(), restored.Cosmetic.NextDouble());
    }

    [Fact]
    public void StateValidationRejectsSchemaSeedMissingAndCosmeticCorruption()
    {
        RandomStreamRegistryState valid = new RandomStreamRegistry("valid").Snapshot();
        var missing = valid.Streams
            .Where(entry => entry.Key != RandomStreamNames.Mission)
            .ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);
        var cosmetic = valid.Streams.ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);
        cosmetic[RandomStreamNames.Cosmetic] = new RandomStreamState();
        var nullSnapshot = valid.Streams.ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);
        nullSnapshot[RandomStreamNames.Mission] = null!;

        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { SchemaVersion = 99 }));
        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { Seed = string.Empty }));
        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { Streams = missing }));
        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { Streams = cosmetic }));
        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { Streams = nullSnapshot }));
        Assert.Throws<ArgumentException>(() => RandomStreamRegistry.Restore(valid with { Streams = null! }));
    }

    [Fact]
    public void PedestrianDescriptorsUseCanonicalSequenceAndExactSpawnSamples()
    {
        var registry = new RandomStreamRegistry("alpha");
        PedestrianDescriptor casual = PedestrianDescriptorModel.Create(0, registry.PedestrianSpawn);

        Assert.Equal("CASUAL", casual.Archetype);
        Assert.Equal(0xdb2777, casual.Color);
        Assert.Equal(0xc68642, casual.Appearance.SkinTone);
        Assert.Equal(0x17120f, casual.Appearance.HairColor);
        Assert.Equal("CURLY", casual.Appearance.HairStyle);
        Assert.Equal(0x111827, casual.Appearance.PantsColor);
        Assert.Equal(0.906064321952872, casual.Appearance.HeightScale, 12);
        Assert.Null(casual.Appearance.Accessory);
        Assert.Equal(6UL, registry.PedestrianSpawn.DrawCount);

        PedestrianDescriptor business = PedestrianDescriptorModel.Create(1, registry.PedestrianSpawn);
        Assert.Equal("BUSINESS", business.Archetype);
        Assert.Equal(0x334155, business.Color);
        Assert.Equal("SHORT", business.Appearance.HairStyle);
        Assert.Equal("BRIEFCASE", business.Appearance.Accessory);
        Assert.Equal(12UL, registry.PedestrianSpawn.DrawCount);
    }

    [Fact]
    public void PedestrianMixRemainsExactAndDescriptorsRejectWrongStream()
    {
        var registry = new RandomStreamRegistry("population");
        Dictionary<string, int> counts = Enumerable.Range(0, 20)
            .Select(serial => PedestrianDescriptorModel.Create(serial, registry.PedestrianSpawn).Archetype)
            .GroupBy(archetype => archetype, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);

        Assert.Equal(6, counts["CASUAL"]);
        Assert.Equal(4, counts["BUSINESS"]);
        Assert.Equal(3, counts["JOGGER"]);
        Assert.Equal(3, counts["TOURIST"]);
        Assert.Equal(2, counts["CAFE_READER"]);
        Assert.Equal(2, counts["CRIMINAL"]);
        Assert.Equal(120UL, registry.PedestrianSpawn.DrawCount);
        Assert.Equal("CASUAL", PedestrianDescriptorModel.Create(-10, registry.PedestrianSpawn).Archetype);
        Assert.Throws<ArgumentException>(() => PedestrianDescriptorModel.Create(0, registry.Cosmetic));
    }

    [Fact]
    public void NamedBehaviorStreamDrivesNpcTimingAndKnockdownInOrder()
    {
        var registry = new RandomStreamRegistry("alpha");
        NpcBehaviorState tourist = NpcBehaviorModel.CreateState("TOURIST", registry.PedestrianBehavior);
        NpcBehaviorState criminal = NpcBehaviorModel.CreateState("CRIMINAL", registry.PedestrianBehavior);
        Assert.Equal(8.811329409945756, tourist.Timer, 12);
        Assert.Equal(11.898169710300863, criminal.Timer, 12);

        tourist = NpcBehaviorModel.AdvanceTourist(
            tourist with { Timer = 0 },
            0.1,
            registry.PedestrianBehavior);
        Assert.Equal(NpcBehaviorModes.TakingPhoto, tourist.Mode);
        Assert.Equal(2.1751420977525413, tourist.Timer, 12);

        AggressionTransition finished = NpcBehaviorModel.FinishAggression(
            "criminal",
            criminal with { TargetId = "citizen" },
            "criminal",
            registry.PedestrianBehavior);
        Assert.Equal(14.323140969965607, finished.State.Timer, 12);

        PedestrianKnockdownState knockdown = PedestrianKnockdownModel.Start(
            PedestrianVector3.Zero,
            new PedestrianVector3(0, 0, 1),
            registry.PedestrianBehavior,
            impactSpeed: 20);
        Assert.Equal(1.42, knockdown.RestRoll);
        Assert.Equal(3.5990699543617666, knockdown.TumbleRate, 12);
        Assert.Equal(6UL, registry.PedestrianBehavior.DrawCount);
        Assert.Throws<ArgumentException>(() =>
            NpcBehaviorModel.CreateState("TOURIST", registry.PedestrianSpawn));
    }

    [Fact]
    public void TrafficDispositionConsumesOnlyTrafficBehaviorStream()
    {
        var registry = new RandomStreamRegistry("alpha");
        PedestrianTrafficEncounter first = PedestrianTrafficModel.CreateEncounter(registry.TrafficBehavior);
        PedestrianTrafficEncounter second = PedestrianTrafficModel.CreateEncounter(registry.TrafficBehavior);
        Assert.False(first.Impatient);
        Assert.False(second.Impatient);
        Assert.Equal(2UL, registry.TrafficBehavior.DrawCount);
        Assert.Equal(0UL, registry.PedestrianBehavior.DrawCount);
        Assert.Throws<ArgumentException>(() =>
            PedestrianTrafficModel.CreateEncounter(registry.PedestrianBehavior));
    }
}

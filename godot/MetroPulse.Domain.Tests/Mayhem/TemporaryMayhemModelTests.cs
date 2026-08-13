using MetroPulse.Domain.Mayhem;
using MetroPulse.Domain.Randomness;
using Xunit;

namespace MetroPulse.Domain.Tests.Mayhem;

public sealed class TemporaryMayhemModelTests
{
    [Fact]
    public void StartRequiresExplicitWarningAndStopErasesTemporaryState()
    {
        var model = CreateModel();

        Assert.Throws<InvalidOperationException>(() => model.Start(false));
        Assert.False(model.Snapshot().Active);

        model.Start(true);
        Assert.True(model.Snapshot().WarningAcknowledged);
        Assert.Single(model.Advance(2));
        Assert.NotEmpty(model.Snapshot().Comets);

        TemporaryMayhemSnapshot stopped = model.StopAndReset();
        Assert.False(stopped.Active);
        Assert.False(stopped.WarningAcknowledged);
        Assert.Empty(stopped.Comets);
        Assert.Empty(stopped.DestroyedTargetIds);
        Assert.Equal(0, stopped.Sequence);
    }

    [Fact]
    public void IdenticalSeedsProduceIdenticalBoundedCometAndImpactEvents()
    {
        TemporaryMayhemModel first = CreateModel("same");
        TemporaryMayhemModel second = CreateModel("same");
        first.Start(true);
        second.Start(true);

        var firstEvents = new List<MayhemEvent>();
        var secondEvents = new List<MayhemEvent>();
        for (int index = 0; index < 200; index++)
        {
            firstEvents.AddRange(first.Advance(0.25));
            secondEvents.AddRange(second.Advance(0.25));
            Assert.InRange(first.Snapshot().Comets.Count, 0, TemporaryMayhemPolicy.MaximumActiveComets);
            Assert.InRange(first.Snapshot().DestroyedTargetIds.Count, 0, TemporaryMayhemPolicy.MaximumDestroyedTargets);
        }

        Assert.Equal(firstEvents, secondEvents);
        Assert.Equal(TemporaryMayhemPolicy.MaximumDestroyedTargets, first.Snapshot().DestroyedTargetIds.Count);
        TemporaryMayhemSnapshot firstSnapshot = first.Snapshot();
        TemporaryMayhemSnapshot secondSnapshot = second.Snapshot();
        Assert.Equal(firstSnapshot.Active, secondSnapshot.Active);
        Assert.Equal(firstSnapshot.WarningAcknowledged, secondSnapshot.WarningAcknowledged);
        Assert.Equal(firstSnapshot.Sequence, secondSnapshot.Sequence);
        Assert.Equal(firstSnapshot.SpawnCountdown, secondSnapshot.SpawnCountdown);
        Assert.Equal(firstSnapshot.Comets, secondSnapshot.Comets);
        Assert.Equal(firstSnapshot.DestroyedTargetIds, secondSnapshot.DestroyedTargetIds);
    }

    [Fact]
    public void InactiveAndZeroDeltaAdvancesDoNotConsumeRandomness()
    {
        var randoms = new RandomStreamRegistry("idle");
        var model = new TemporaryMayhemModel(Targets(), randoms.Cosmetic);

        Assert.Empty(model.Advance(10));
        model.Start(true);
        Assert.Empty(model.Advance(0));
        Assert.Equal(0ul, randoms.Cosmetic.DrawCount);
    }

    private static TemporaryMayhemModel CreateModel(string seed = "mayhem") =>
        new(Targets(), new RandomStreamRegistry(seed).Cosmetic);

    private static MayhemTarget[] Targets() => Enumerable.Range(1, 10)
        .Select(index => new MayhemTarget($"building-{index}", index * 10, 12, index * -5))
        .ToArray();
}

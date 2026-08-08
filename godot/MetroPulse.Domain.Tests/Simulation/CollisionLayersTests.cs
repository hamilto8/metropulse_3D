using MetroPulse.Domain.Simulation;
using Xunit;

namespace MetroPulse.Domain.Tests.Simulation;

public sealed class CollisionLayersTests
{
    [Fact]
    public void NamedLayersOccupyNineUniqueBits()
    {
        CollisionLayer[] layers = Enum.GetValues<CollisionLayer>()
            .Where(layer => layer != CollisionLayer.None)
            .ToArray();

        Assert.Equal(9, layers.Length);
        Assert.Equal(9, layers.Distinct().Count());
        Assert.All(layers, layer => Assert.True(uint.IsPow2((uint)layer)));
        Assert.Equal((1U << 9) - 1U, layers.Aggregate(0U, (bits, layer) => bits | (uint)layer));
    }

    [Fact]
    public void QueryOnlyLayersCannotCreateUndeclaredPhysicalResponses()
    {
        Assert.Equal(CollisionLayer.None, CollisionMasks.Effect);
        Assert.Equal(
            CollisionLayer.Surface | CollisionLayer.StaticObstacle,
            CollisionMasks.CameraQuery);
        Assert.Equal(
            CollisionLayer.Traffic | CollisionLayer.Player | CollisionLayer.Pedestrian,
            CollisionMasks.Interaction);
        Assert.Equal(CollisionMasks.Interaction, CollisionMasks.MissionTrigger);
    }
}

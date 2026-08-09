using MetroPulse.Domain.Content;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.World;

public sealed class MvpWorldLayoutTests
{
    [Fact]
    public void ProductionLayoutHasStableChunksUniqueOwnersAndCanonicalFurniture()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(content);

        Assert.Equal(
            ["WestCore", "RiverCorridor", "PrimaryBridge", "CentralPark", "BuildingPlots", "StreetFurniture", "InitialSkyline"],
            layout.ChunkIds);
        Assert.Equal(layout.Objects.Count, layout.Objects.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(layout.Objects, item => Assert.Contains(item.ChunkId, layout.ChunkIds));
        Assert.Equal(146, layout.Objects.Count(item => item.Kind == "street-lamp"));
        Assert.Equal(23, layout.Objects.Count(item => item.Kind == "building"));
        Assert.Equal(6, layout.Objects.Count(item => item.Kind == "cafe-chair"));
        Assert.Equal(6, layout.Objects.Count(item => item.Kind == "cafe-table"));
        Assert.Equal(800, layout.InstanceGroups.Single(item => item.Id == "crosswalks").Instances.Count);
        Assert.Equal(146, layout.InstanceGroups.Single(item => item.Id == "street-lamp-poles").Instances.Count);
    }

    [Fact]
    public void EveryColliderUsesThePinnedPhaseOneContractAndMatchesItsVisualDefinition()
    {
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(GameContentRegistry.LoadProduction());
        WorldObjectDefinition[] colliders = layout.Objects.Where(item => item.Role != WorldObjectRole.Decoration).ToArray();

        Assert.NotEmpty(colliders);
        Assert.All(colliders, item =>
        {
            Assert.True(item.Size.X > 0 && item.Size.Y > 0 && item.Size.Z > 0);
            Assert.True(item.Layer is CollisionLayer.Surface or CollisionLayer.StaticObstacle);
            Assert.Equal(
                item.Layer == CollisionLayer.Surface ? CollisionMasks.Surface : CollisionMasks.StaticObstacle,
                item.Mask);
        });
        Assert.Contains(colliders, item => item.Id == "grand-suspension-deck" && item.Role == WorldObjectRole.Surface);
        Assert.Equal(2, colliders.Count(item => item.Kind == "bridge-barrier"));
        Assert.All(colliders.Where(item => item.Kind == "bridge-barrier"), item => Assert.False(item.Rendered));
    }

    [Fact]
    public void SuspensionGeometryIsSymmetricContinuousAndIntersectsEveryHanger()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        SuspensionBridgeLayout bridge = content.SuspensionBridgeLayout;
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(content);
        WorldSegmentDefinition[] cables = layout.SegmentGroups.Single(item => item.Id == "main-cables").Segments.ToArray();
        WorldSegmentDefinition[] hangers = layout.SegmentGroups.Single(item => item.Id == "vertical-hangers").Segments.ToArray();

        Assert.Equal(200, cables.Length);
        Assert.True(hangers.Length >= 30);
        for (double offset = 0; offset <= 50; offset += 2.5)
        {
            Assert.InRange(Math.Abs(
                MvpWorldLayout.CableHeight(bridge.CenterX - offset, bridge)
                - MvpWorldLayout.CableHeight(bridge.CenterX + offset, bridge)), 0, 1e-9);
        }
        Assert.All(hangers, hanger =>
        {
            Assert.Equal(bridge.HangerDeckY, hanger.Start.Y);
            Assert.InRange(Math.Abs(hanger.End.Y - MvpWorldLayout.CableHeight(hanger.End.X, bridge)), 0, 1e-9);
        });
    }
}

using MetroPulse.Domain.Presentation;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class QualityProfilePolicyTests
{
    [Theory]
    [InlineData("HIGH", 2000, 12, 1.0)]
    [InlineData("MEDIUM", 1200, 8, 0.75)]
    [InlineData("LOW", 600, 6, 0.5)]
    public void Resolve_PreservesSimulationWhileScalingPresentation(
        string id,
        int rainParticles,
        int audioVoices,
        double effectScale)
    {
        QualityProfilePolicy policy = QualityProfilePolicy.Resolve(id);

        Assert.Equal(id, policy.Id);
        Assert.Equal(rainParticles, policy.RainParticles);
        Assert.Equal(audioVoices, policy.SpatialAudioVoices);
        Assert.Equal(effectScale, policy.EffectBudgetScale);
        Assert.True(policy.TrafficProxyDistance >= policy.TrafficHighDetailDistance);
        Assert.True(policy.PedestrianProxyDistance >= policy.PedestrianHighDetailDistance);
    }

    [Fact]
    public void Resolve_UnknownOrMissingProfileFailsSafeToHigh()
    {
        Assert.Equal(QualityProfileIds.High, QualityProfilePolicy.Resolve(null).Id);
        Assert.Equal(QualityProfileIds.High, QualityProfilePolicy.Resolve("unknown").Id);
    }
}

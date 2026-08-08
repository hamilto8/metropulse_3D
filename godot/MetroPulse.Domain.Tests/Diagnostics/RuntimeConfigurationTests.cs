using MetroPulse.Domain.Diagnostics;
using Xunit;

namespace MetroPulse.Domain.Tests.Diagnostics;

public sealed class RuntimeConfigurationTests
{
    [Fact]
    public void Parse_UsesFoundationDefaults()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse([], isDebugBuild: true);

        Assert.False(configuration.RunIntegrationTests);
        Assert.False(configuration.SmokeBoot);
        Assert.False(configuration.DeterministicTestMode);
        Assert.Null(configuration.ScenarioSeed);
        Assert.Equal(120, configuration.PhysicsTicksPerSecond);
    }

    [Fact]
    public void Parse_IntegrationRunIsDeterministicAndSeeded()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            ["--run-integration-tests", "--low-tick"],
            isDebugBuild: true);

        Assert.True(configuration.RunIntegrationTests);
        Assert.True(configuration.DeterministicTestMode);
        Assert.Equal(1UL, configuration.ScenarioSeed);
        Assert.Equal(30, configuration.PhysicsTicksPerSecond);
    }

    [Fact]
    public void Parse_RejectsDebugHooksInReleaseBuilds()
    {
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Parse(["--deterministic-test", "--seed=42"], isDebugBuild: false));

        Assert.Contains("disabled in release builds", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsSeedWithoutDeterministicMode()
    {
        Assert.Throws<ArgumentException>(() =>
            RuntimeConfiguration.Parse(["--seed=42"], isDebugBuild: true));
    }

    [Fact]
    public void Parse_RejectsMalformedSeed()
    {
        Assert.Throws<ArgumentException>(() =>
            RuntimeConfiguration.Parse(["--deterministic-test", "--seed=not-a-number"], isDebugBuild: true));
    }

    [Fact]
    public void Parse_AllowsNonInteractiveSmokeBootInReleaseBuilds()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(["--smoke-boot"], isDebugBuild: false);

        Assert.True(configuration.SmokeBoot);
        Assert.False(configuration.DeterministicTestMode);
        Assert.Equal(120, configuration.PhysicsTicksPerSecond);
    }
}

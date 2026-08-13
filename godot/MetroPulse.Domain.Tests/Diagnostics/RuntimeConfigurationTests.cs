using MetroPulse.Domain.Content;
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
        Assert.Null(configuration.ImportSavePath);
        Assert.False(configuration.ConfirmImport);
        Assert.Null(configuration.BootAction);
        Assert.Equal("HIGH", configuration.QualityProfile);
        Assert.Null(configuration.PerformanceCapturePath);
        Assert.Equal(5, configuration.PerformanceWarmupSeconds);
        Assert.Equal(20, configuration.PerformanceDurationSeconds);
        Assert.All(configuration.Features.Snapshot(), pair => Assert.False(pair.Value));
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

    [Theory]
    [InlineData(60)]
    [InlineData(90)]
    [InlineData(120)]
    public void Parse_AcceptsBoundedPhysicsTelemetryCadence(int ticks)
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            [$"--physics-ticks={ticks}"],
            isDebugBuild: true);

        Assert.Equal(ticks, configuration.PhysicsTicksPerSecond);
    }

    [Theory]
    [InlineData("--physics-ticks=30")]
    [InlineData("--physics-ticks=144")]
    [InlineData("--physics-ticks=fast")]
    [InlineData("--low-tick", "--physics-ticks=60")]
    public void Parse_RejectsUnsupportedOrConflictingPhysicsTelemetryCadence(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => RuntimeConfiguration.Parse(arguments, isDebugBuild: true));
    }

    [Fact]
    public void Parse_RejectsDebugHooksInReleaseBuilds()
    {
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Parse(["--deterministic-test", "--seed=42"], isDebugBuild: false));

        Assert.Contains("disabled in release builds", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_RejectsPhysicsTelemetryCadenceInReleaseBuilds()
    {
        Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Parse(["--physics-ticks=60"], isDebugBuild: false));
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

    [Fact]
    public void Parse_AcceptsExplicitSaveImportAndConfirmation()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            ["--import-save=/tmp/metropulse-city.json", "--confirm-import"],
            isDebugBuild: false);

        Assert.Equal("/tmp/metropulse-city.json", configuration.ImportSavePath);
        Assert.True(configuration.ConfirmImport);
    }

    [Theory]
    [InlineData("new_game", "NEW_GAME")]
    [InlineData("continue", "CONTINUE")]
    [InlineData("RECOVER", "RECOVER")]
    public void Parse_AcceptsExplicitBootActions(string input, string expected)
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            [$"--boot-action={input}"],
            isDebugBuild: false);

        Assert.Equal(expected, configuration.BootAction);
    }

    [Theory]
    [InlineData("--import-save=relative.json")]
    [InlineData("--confirm-import")]
    public void Parse_RejectsAmbiguousImportRequests(string argument)
    {
        Assert.Throws<ArgumentException>(() => RuntimeConfiguration.Parse([argument], isDebugBuild: true));
    }

    [Fact]
    public void Parse_RejectsUnknownBootAction()
    {
        Assert.Throws<ArgumentException>(() =>
            RuntimeConfiguration.Parse(["--boot-action=LOAD_WHATEVER"], isDebugBuild: false));
    }

    [Fact]
    public void Parse_AcceptsValidatedDebugFeatureOverrides()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            ["--features=aircraft,temporaryMayhem"],
            isDebugBuild: true);

        Assert.True(configuration.Features.IsEnabled(FeatureIds.Aircraft));
        Assert.True(configuration.Features.IsEnabled(FeatureIds.TemporaryMayhem));
        Assert.False(configuration.Features.IsEnabled(FeatureIds.RocketLaunch));
    }

    [Theory]
    [InlineData("--features=unknown")]
    [InlineData("--features=")]
    public void Parse_RejectsInvalidFeatureOverrides(string argument)
    {
        Assert.ThrowsAny<ArgumentException>(() =>
            RuntimeConfiguration.Parse([argument], isDebugBuild: true));
    }

    [Fact]
    public void Parse_RejectsFeatureOverridesInReleaseBuilds()
    {
        Assert.Throws<InvalidOperationException>(() =>
            RuntimeConfiguration.Parse(["--features=aircraft"], isDebugBuild: false));
    }

    [Fact]
    public void Parse_AcceptsReleaseSafePerformanceCapture()
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse(
            [
                "--performance-capture=/tmp/metropulse-performance.json",
                "--performance-warmup=2.5",
                "--performance-duration=30",
            ],
            isDebugBuild: false);

        Assert.Equal("/tmp/metropulse-performance.json", configuration.PerformanceCapturePath);
        Assert.Equal(2.5, configuration.PerformanceWarmupSeconds);
        Assert.Equal(30, configuration.PerformanceDurationSeconds);
    }

    [Theory]
    [InlineData("--performance-capture=relative.json")]
    [InlineData("--performance-warmup=-1")]
    [InlineData("--performance-duration=0")]
    [InlineData("--performance-duration=7201")]
    public void Parse_RejectsAmbiguousPerformanceCapture(string argument)
    {
        Assert.Throws<ArgumentException>(() => RuntimeConfiguration.Parse([argument], isDebugBuild: true));
    }

    [Fact]
    public void Parse_RejectsPerformanceCaptureCombinedWithOtherExitOwners()
    {
        Assert.Throws<ArgumentException>(() => RuntimeConfiguration.Parse(
            ["--performance-capture=/tmp/result.json", "--smoke-boot"],
            isDebugBuild: true));
    }

    [Theory]
    [InlineData("high", "HIGH")]
    [InlineData("MEDIUM", "MEDIUM")]
    [InlineData("Low", "LOW")]
    public void Parse_AcceptsReleaseSafeQualityProfile(string input, string expected)
    {
        RuntimeConfiguration configuration = RuntimeConfiguration.Parse([$"--quality={input}"], isDebugBuild: false);

        Assert.Equal(expected, configuration.QualityProfile);
    }

    [Fact]
    public void Parse_RejectsUnknownQualityProfile()
    {
        Assert.Throws<ArgumentException>(() => RuntimeConfiguration.Parse(["--quality=ULTRA"], isDebugBuild: true));
    }
}

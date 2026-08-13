using MetroPulse.Domain.Content;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Domain.Diagnostics;

public sealed record RuntimeConfiguration(
    bool RunIntegrationTests,
    bool SmokeBoot,
    bool DeterministicTestMode,
    ulong? ScenarioSeed,
    int PhysicsTicksPerSecond,
    string? ImportSavePath,
    bool ConfirmImport,
    string? BootAction,
    string QualityProfile,
    string? PerformanceCapturePath,
    double PerformanceWarmupSeconds,
    double PerformanceDurationSeconds,
    FeatureFlagSet Features)
{
    public const int DefaultPhysicsTicksPerSecond = 120;
    public const int LowTickPhysicsTicksPerSecond = 30;
    public static readonly IReadOnlyList<int> PerformancePhysicsTicks = [60, 90, 120];
    public const double DefaultPerformanceWarmupSeconds = 5;
    public const double DefaultPerformanceDurationSeconds = 20;

    public static RuntimeConfiguration Parse(IEnumerable<string> arguments, bool isDebugBuild)
    {
        ArgumentNullException.ThrowIfNull(arguments);

        bool runIntegrationTests = false;
        bool smokeBoot = false;
        bool deterministicTestMode = false;
        bool lowTickProfile = false;
        int? physicsTicksOverride = null;
        ulong? seed = null;
        string? importSavePath = null;
        bool confirmImport = false;
        string? bootAction = null;
        string qualityProfile = QualityProfileIds.High;
        string? performanceCapturePath = null;
        double performanceWarmupSeconds = DefaultPerformanceWarmupSeconds;
        double performanceDurationSeconds = DefaultPerformanceDurationSeconds;
        bool customPerformanceTiming = false;
        var featureOverrides = new Dictionary<string, bool>(StringComparer.Ordinal);

        foreach (string argument in arguments)
        {
            switch (argument)
            {
                case "--run-integration-tests":
                    runIntegrationTests = true;
                    break;
                case "--smoke-boot":
                    smokeBoot = true;
                    break;
                case "--deterministic-test":
                    deterministicTestMode = true;
                    break;
                case "--low-tick":
                    lowTickProfile = true;
                    break;
                case "--confirm-import":
                    confirmImport = true;
                    break;
                default:
                    if (argument.StartsWith("--seed=", StringComparison.Ordinal))
                    {
                        string value = argument["--seed=".Length..];
                        if (!ulong.TryParse(value, out ulong parsedSeed))
                        {
                            throw new ArgumentException("The deterministic scenario seed must be an unsigned integer.", nameof(arguments));
                        }

                        seed = parsedSeed;
                    }
                    else if (argument.StartsWith("--import-save=", StringComparison.Ordinal))
                    {
                        string value = argument["--import-save=".Length..];
                        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
                        {
                            throw new ArgumentException("The import save path must be an absolute file path.", nameof(arguments));
                        }
                        importSavePath = value;
                    }
                    else if (argument.StartsWith("--boot-action=", StringComparison.Ordinal))
                    {
                        string value = argument["--boot-action=".Length..].ToUpperInvariant();
                        if (!BootActionIds.All.Contains(value, StringComparer.Ordinal))
                        {
                            throw new ArgumentException($"Unknown boot action: {value}.", nameof(arguments));
                        }
                        bootAction = value;
                    }
                    else if (argument.StartsWith("--features=", StringComparison.Ordinal))
                    {
                        string value = argument["--features=".Length..];
                        if (string.IsNullOrWhiteSpace(value))
                        {
                            throw new ArgumentException("Feature overrides require at least one stable feature ID.", nameof(arguments));
                        }
                        foreach (string featureId in value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                        {
                            featureOverrides[featureId] = true;
                        }
                    }
                    else if (argument.StartsWith("--performance-capture=", StringComparison.Ordinal))
                    {
                        string value = argument["--performance-capture=".Length..];
                        if (string.IsNullOrWhiteSpace(value) || !Path.IsPathFullyQualified(value))
                        {
                            throw new ArgumentException("The performance capture path must be an absolute file path.", nameof(arguments));
                        }
                        performanceCapturePath = value;
                    }
                    else if (argument.StartsWith("--physics-ticks=", StringComparison.Ordinal))
                    {
                        string value = argument["--physics-ticks=".Length..];
                        if (!int.TryParse(value, out int parsedTicks)
                            || !PerformancePhysicsTicks.Contains(parsedTicks))
                        {
                            throw new ArgumentException("Physics telemetry cadence must be 60, 90, or 120 Hz.", nameof(arguments));
                        }
                        physicsTicksOverride = parsedTicks;
                    }
                    else if (argument.StartsWith("--quality=", StringComparison.Ordinal))
                    {
                        string value = argument["--quality=".Length..].ToUpperInvariant();
                        if (!QualityProfileIds.All.Contains(value, StringComparer.Ordinal))
                        {
                            throw new ArgumentException($"Unknown quality profile: {value}.", nameof(arguments));
                        }
                        qualityProfile = value;
                    }
                    else if (argument.StartsWith("--performance-warmup=", StringComparison.Ordinal))
                    {
                        performanceWarmupSeconds = ParseSeconds(
                            argument["--performance-warmup=".Length..],
                            minimum: 0,
                            maximum: 300,
                            "performance warmup");
                        customPerformanceTiming = true;
                    }
                    else if (argument.StartsWith("--performance-duration=", StringComparison.Ordinal))
                    {
                        performanceDurationSeconds = ParseSeconds(
                            argument["--performance-duration=".Length..],
                            minimum: 1,
                            maximum: 7_200,
                            "performance duration");
                        customPerformanceTiming = true;
                    }

                    break;
            }
        }

        if (lowTickProfile && physicsTicksOverride.HasValue)
        {
            throw new ArgumentException("--low-tick cannot be combined with --physics-ticks.", nameof(arguments));
        }

        bool debugOnlyOptionRequested = runIntegrationTests || deterministicTestMode || lowTickProfile
            || physicsTicksOverride.HasValue
            || seed.HasValue || featureOverrides.Count > 0;
        if (debugOnlyOptionRequested && !isDebugBuild)
        {
            throw new InvalidOperationException("Test and low-tick runtime options are disabled in release builds.");
        }

        if (seed.HasValue && !deterministicTestMode)
        {
            throw new ArgumentException("A scenario seed requires --deterministic-test.", nameof(arguments));
        }

        if (runIntegrationTests)
        {
            deterministicTestMode = true;
            seed ??= 1UL;
        }

        if (confirmImport && importSavePath is null)
        {
            throw new ArgumentException("--confirm-import requires --import-save=<absolute-path>.", nameof(arguments));
        }

        if (customPerformanceTiming && performanceCapturePath is null)
        {
            throw new ArgumentException("Performance timing options require --performance-capture=<absolute-path>.", nameof(arguments));
        }

        if (performanceCapturePath is not null && (runIntegrationTests || smokeBoot))
        {
            throw new ArgumentException("Performance capture cannot be combined with integration tests or smoke boot.", nameof(arguments));
        }

        return new RuntimeConfiguration(
            runIntegrationTests,
            smokeBoot,
            deterministicTestMode,
            seed,
            lowTickProfile
                ? LowTickPhysicsTicksPerSecond
                : physicsTicksOverride ?? DefaultPhysicsTicksPerSecond,
            importSavePath,
            confirmImport,
            bootAction,
            qualityProfile,
            performanceCapturePath,
            performanceWarmupSeconds,
            performanceDurationSeconds,
            new FeatureFlagSet(featureOverrides));
    }

    private static double ParseSeconds(string value, double minimum, double maximum, string label)
    {
        if (!double.TryParse(
                value,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out double parsed)
            || !double.IsFinite(parsed)
            || parsed < minimum
            || parsed > maximum)
        {
            throw new ArgumentException(
                $"The {label} must be a finite number from {minimum} through {maximum} seconds.",
                nameof(value));
        }
        return parsed;
    }
}

using MetroPulse.Domain.Persistence;

namespace MetroPulse.Domain.Diagnostics;

public sealed record RuntimeConfiguration(
    bool RunIntegrationTests,
    bool SmokeBoot,
    bool DeterministicTestMode,
    ulong? ScenarioSeed,
    int PhysicsTicksPerSecond,
    string? ImportSavePath,
    bool ConfirmImport,
    string? BootAction)
{
    public const int DefaultPhysicsTicksPerSecond = 120;
    public const int LowTickPhysicsTicksPerSecond = 30;

    public static RuntimeConfiguration Parse(IEnumerable<string> arguments, bool isDebugBuild)
    {
        ArgumentNullException.ThrowIfNull(arguments);

        bool runIntegrationTests = false;
        bool smokeBoot = false;
        bool deterministicTestMode = false;
        bool lowTickProfile = false;
        ulong? seed = null;
        string? importSavePath = null;
        bool confirmImport = false;
        string? bootAction = null;

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

                    break;
            }
        }

        bool debugOnlyOptionRequested = runIntegrationTests || deterministicTestMode || lowTickProfile || seed.HasValue;
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

        return new RuntimeConfiguration(
            runIntegrationTests,
            smokeBoot,
            deterministicTestMode,
            seed,
            lowTickProfile ? LowTickPhysicsTicksPerSecond : DefaultPhysicsTicksPerSecond,
            importSavePath,
            confirmImport,
            bootAction);
    }
}

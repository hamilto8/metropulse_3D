namespace MetroPulse.Domain.Diagnostics;

public sealed record RuntimeConfiguration(
    bool RunIntegrationTests,
    bool SmokeBoot,
    bool DeterministicTestMode,
    ulong? ScenarioSeed,
    int PhysicsTicksPerSecond)
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

        return new RuntimeConfiguration(
            runIntegrationTests,
            smokeBoot,
            deterministicTestMode,
            seed,
            lowTickProfile ? LowTickPhysicsTicksPerSecond : DefaultPhysicsTicksPerSecond);
    }
}

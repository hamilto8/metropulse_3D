using System.Collections.Frozen;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Randomness;

public static class RandomStreamNames
{
    public const string WorldGeneration = "WorldGeneration";
    public const string TrafficSpawn = "TrafficSpawn";
    public const string TrafficBehavior = "TrafficBehavior";
    public const string PedestrianSpawn = "PedestrianSpawn";
    public const string PedestrianBehavior = "PedestrianBehavior";
    public const string Weather = "Weather";
    public const string Mission = "Mission";
    public const string Cosmetic = "Cosmetic";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly(
    [
        WorldGeneration,
        TrafficSpawn,
        TrafficBehavior,
        PedestrianSpawn,
        PedestrianBehavior,
        Weather,
        Mission,
        Cosmetic,
    ]);

    public static readonly IReadOnlySet<string> Persistent = new HashSet<string>(
    [
        WorldGeneration,
        TrafficSpawn,
        TrafficBehavior,
        PedestrianSpawn,
        PedestrianBehavior,
        Weather,
        Mission,
    ], StringComparer.Ordinal).ToFrozenSet(StringComparer.Ordinal);
}

public interface IRandomStream
{
    string Name { get; }

    ulong DrawCount { get; }

    uint NextUInt32();

    double NextDouble();

    int NextInt(int maximumExclusive);

    double NextRange(double minimum, double maximum);

    bool Chance(double probability);
}

public sealed record RandomStreamState
{
    [JsonPropertyName("state")]
    public uint State { get; init; }

    [JsonPropertyName("drawCount")]
    public ulong DrawCount { get; init; }
}

public sealed record RandomStreamRegistryState
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; } = RandomStreamRegistry.StateSchemaVersion;

    [JsonPropertyName("seed")]
    public required string Seed { get; init; }

    [JsonPropertyName("streams")]
    public required IReadOnlyDictionary<string, RandomStreamState> Streams { get; init; }
}

/// <summary>xmur3-seeded mulberry32 stream with browser-reference bit semantics.</summary>
public sealed class DeterministicRandomStream : IRandomStream
{
    private uint state;

    internal DeterministicRandomStream(string name, string seedMaterial)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(seedMaterial);
        Name = name;
        state = HashSeed(seedMaterial);
    }

    public string Name { get; }

    public ulong DrawCount { get; private set; }

    public uint NextUInt32()
    {
        uint output;
        unchecked
        {
            state += 0x6D2B79F5u;
            output = state;
            output = Multiply(output ^ (output >> 15), output | 1u);
            output ^= output + Multiply(output ^ (output >> 7), output | 61u);
            output ^= output >> 14;
        }
        DrawCount += 1;
        return output;
    }

    public double NextDouble() => NextUInt32() / 4_294_967_296d;

    public int NextInt(int maximumExclusive)
    {
        if (maximumExclusive <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumExclusive),
                maximumExclusive,
                "The exclusive upper bound must be positive.");
        }
        return (int)Math.Floor(NextDouble() * maximumExclusive);
    }

    public double NextRange(double minimum, double maximum)
    {
        if (!double.IsFinite(minimum) || !double.IsFinite(maximum) || maximum < minimum)
        {
            throw new ArgumentOutOfRangeException(nameof(maximum), "Random range bounds must be finite and ordered.");
        }
        return minimum + (maximum - minimum) * NextDouble();
    }

    public bool Chance(double probability)
    {
        double threshold = double.IsFinite(probability) ? Math.Clamp(probability, 0, 1) : 0;
        return NextDouble() < threshold;
    }

    internal RandomStreamState Snapshot() => new() { State = state, DrawCount = DrawCount };

    internal void Restore(RandomStreamState snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        state = snapshot.State;
        DrawCount = snapshot.DrawCount;
    }

    private static uint HashSeed(string seed)
    {
        uint hash = 1_779_033_703u ^ (uint)seed.Length;
        unchecked
        {
            foreach (char character in seed)
            {
                hash = Multiply(hash ^ character, 3_432_918_353u);
                hash = (hash << 13) | (hash >> 19);
            }
            hash = Multiply(hash ^ (hash >> 16), 2_246_822_507u);
            hash = Multiply(hash ^ (hash >> 13), 3_266_489_909u);
            hash ^= hash >> 16;
        }
        return hash;
    }

    private static uint Multiply(uint left, uint right) => unchecked(left * right);
}

/// <summary>Owns the only supported named deterministic random streams for pure domain code.</summary>
public sealed class RandomStreamRegistry
{
    public const int StateSchemaVersion = 1;

    public const string DefaultSeed = "metropulse-phase-0";

    private const char SeedSeparator = '\u001f';

    private readonly FrozenDictionary<string, DeterministicRandomStream> streams;

    public RandomStreamRegistry(string? seed = null)
    {
        Seed = string.IsNullOrEmpty(seed) ? DefaultSeed : seed;
        streams = RandomStreamNames.All.ToFrozenDictionary(
            name => name,
            name => new DeterministicRandomStream(name, $"{Seed}{SeedSeparator}{name}"),
            StringComparer.Ordinal);
    }

    public string Seed { get; }

    public IRandomStream WorldGeneration => streams[RandomStreamNames.WorldGeneration];

    public IRandomStream TrafficSpawn => streams[RandomStreamNames.TrafficSpawn];

    public IRandomStream TrafficBehavior => streams[RandomStreamNames.TrafficBehavior];

    public IRandomStream PedestrianSpawn => streams[RandomStreamNames.PedestrianSpawn];

    public IRandomStream PedestrianBehavior => streams[RandomStreamNames.PedestrianBehavior];

    public IRandomStream Weather => streams[RandomStreamNames.Weather];

    public IRandomStream Mission => streams[RandomStreamNames.Mission];

    public IRandomStream Cosmetic => streams[RandomStreamNames.Cosmetic];

    public IRandomStream Get(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return streams.TryGetValue(name, out DeterministicRandomStream? stream)
            ? stream
            : throw new ArgumentOutOfRangeException(nameof(name), name, "Unknown deterministic random stream.");
    }

    public RandomStreamRegistryState Snapshot()
    {
        IReadOnlyDictionary<string, RandomStreamState> state = streams
            .Where(entry => RandomStreamNames.Persistent.Contains(entry.Key))
            .ToFrozenDictionary(
                entry => entry.Key,
                entry => entry.Value.Snapshot(),
                StringComparer.Ordinal);
        return new RandomStreamRegistryState
        {
            Seed = Seed,
            Streams = state,
        };
    }

    public static RandomStreamRegistry Restore(RandomStreamRegistryState state)
    {
        ValidateState(state);
        var registry = new RandomStreamRegistry(state.Seed);
        foreach ((string name, RandomStreamState snapshot) in state.Streams)
        {
            registry.streams[name].Restore(snapshot);
        }
        return registry;
    }

    public static void ValidateState(RandomStreamRegistryState? state)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (state.SchemaVersion != StateSchemaVersion)
        {
            throw new ArgumentException(
                $"Unsupported random-stream state schema {state.SchemaVersion}.",
                nameof(state));
        }
        if (string.IsNullOrEmpty(state.Seed))
        {
            throw new ArgumentException("Random-stream state requires a seed.", nameof(state));
        }
        if (state.Streams is null)
        {
            throw new ArgumentException("Random-stream state requires stream snapshots.", nameof(state));
        }
        string[] actualNames = state.Streams.Keys.Order(StringComparer.Ordinal).ToArray();
        string[] expectedNames = RandomStreamNames.Persistent.Order(StringComparer.Ordinal).ToArray();
        if (!actualNames.SequenceEqual(expectedNames, StringComparer.Ordinal))
        {
            throw new ArgumentException(
                "Random-stream state must contain every gameplay stream and no cosmetic stream.",
                nameof(state));
        }
        if (state.Streams.Values.Any(snapshot => snapshot is null))
        {
            throw new ArgumentException("Random-stream snapshots cannot be null.", nameof(state));
        }
    }
}

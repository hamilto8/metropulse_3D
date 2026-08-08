using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.TimeWeather;

public sealed record WeatherCycleState(string Mode, double RemainingSeconds, int Transitions);

/// <summary>Renderer-independent weather sequence and overflow-safe cycle clock.</summary>
public sealed class WeatherCycleModel
{
    private readonly IReadOnlyDictionary<string, WeatherDefinition> definitions;
    private readonly IReadOnlyList<string> sequence;
    private readonly double totalCycleDuration;

    public WeatherCycleModel(
        IReadOnlyList<WeatherDefinition> definitions,
        IReadOnlyList<string> sequence,
        string defaultMode)
    {
        ArgumentNullException.ThrowIfNull(definitions);
        ArgumentNullException.ThrowIfNull(sequence);
        if (definitions.Count == 0 || sequence.Count == 0)
        {
            throw new ArgumentException("Weather definitions and sequence cannot be empty.");
        }

        var byId = new Dictionary<string, WeatherDefinition>(StringComparer.Ordinal);
        foreach (WeatherDefinition definition in definitions)
        {
            string id = RequireText(definition.Id, "weather.id");
            if (!double.IsFinite(definition.DurationSeconds) || definition.DurationSeconds <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(definitions), $"Weather duration must be positive for {id}.");
            }
            if (!byId.TryAdd(id, definition)) throw new ArgumentException($"Duplicate weather ID: {id}.", nameof(definitions));
        }

        string[] ordered = sequence.Select(id => RequireText(id, "weather sequence ID")).ToArray();
        if (ordered.Distinct(StringComparer.Ordinal).Count() != ordered.Length)
        {
            throw new ArgumentException("Weather sequence IDs must be unique.", nameof(sequence));
        }
        string? unknown = ordered.FirstOrDefault(id => !byId.ContainsKey(id));
        if (unknown is not null) throw new ArgumentException($"Weather sequence references unknown mode {unknown}.", nameof(sequence));
        string? unsequenced = byId.Keys.FirstOrDefault(id => !ordered.Contains(id, StringComparer.Ordinal));
        if (unsequenced is not null) throw new ArgumentException($"Weather definition {unsequenced} is missing from the sequence.", nameof(sequence));
        if (!byId.ContainsKey(defaultMode)) throw new ArgumentException($"Unknown default weather mode: {defaultMode}.", nameof(defaultMode));

        this.definitions = new ReadOnlyDictionary<string, WeatherDefinition>(byId);
        this.sequence = Array.AsReadOnly(ordered);
        DefaultMode = defaultMode;
        totalCycleDuration = ordered.Sum(id => byId[id].DurationSeconds);
    }

    public string DefaultMode { get; }

    public IReadOnlyList<string> Sequence => sequence;

    public static WeatherCycleModel LoadProduction()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        return new WeatherCycleModel(content.WeatherRecords, content.WeatherSequence, content.DefaultWeatherMode);
    }

    public string NormalizeMode(string? mode) => mode is not null && definitions.ContainsKey(mode) ? mode : DefaultMode;

    public WeatherDefinition GetDefinition(string? mode) => definitions[NormalizeMode(mode)];

    public string GetNextMode(string? mode)
    {
        string current = NormalizeMode(mode);
        int index = 0;
        while (sequence[index] != current) index += 1;
        return sequence[(index + 1) % sequence.Count];
    }

    public WeatherCycleState Step(
        string? mode,
        double remainingSeconds,
        double deltaSeconds,
        bool enabled = true)
    {
        string currentMode = NormalizeMode(mode);
        double remaining = double.IsFinite(remainingSeconds) && remainingSeconds > 0
            ? remainingSeconds
            : GetDefinition(currentMode).DurationSeconds;

        if (!enabled) return new WeatherCycleState(currentMode, 0, 0);

        double elapsed = double.IsFinite(deltaSeconds) ? Math.Max(0, deltaSeconds) : 0;
        if (elapsed < remaining) return new WeatherCycleState(currentMode, remaining - elapsed, 0);

        elapsed -= remaining;
        currentMode = GetNextMode(currentMode);
        remaining = GetDefinition(currentMode).DurationSeconds;
        int transitions = 1;

        if (elapsed >= totalCycleDuration)
        {
            int completeCycles = checked((int)Math.Floor(elapsed / totalCycleDuration));
            elapsed %= totalCycleDuration;
            transitions = checked(transitions + (completeCycles * sequence.Count));
        }

        while (elapsed >= remaining)
        {
            elapsed -= remaining;
            currentMode = GetNextMode(currentMode);
            remaining = GetDefinition(currentMode).DurationSeconds;
            transitions += 1;
        }

        return new WeatherCycleState(currentMode, remaining - elapsed, transitions);
    }

    private static string RequireText(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} must be a non-empty string.", name);
        return value.Trim();
    }
}

using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Camera;

/// <summary>Immutable runtime view over the validated canonical camera-preset catalog.</summary>
public sealed class CameraPresetModel
{
    private readonly IReadOnlyDictionary<string, CameraPose> presets;

    public CameraPresetModel(IReadOnlyDictionary<string, CameraPresetDefinition> definitions)
    {
        ArgumentNullException.ThrowIfNull(definitions);
        presets = new ReadOnlyDictionary<string, CameraPose>(definitions.ToDictionary(
            entry => entry.Key,
            entry => ToPose(entry.Key, entry.Value),
            StringComparer.Ordinal));
    }

    public IReadOnlyDictionary<string, CameraPose> Presets => presets;

    public CameraPose? Get(string? id) => id is null ? null : presets.GetValueOrDefault(id);

    public static CameraPresetModel LoadProduction() => new(GameContentRegistry.LoadProduction().CameraPresets);

    private static CameraPose ToPose(string id, CameraPresetDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        return new CameraPose(
            ToVector(definition.Position, $"camera preset {id} position"),
            ToVector(definition.Target, $"camera preset {id} target"));
    }

    private static CameraVector3 ToVector(IReadOnlyList<double>? values, string label)
    {
        if (values is null || values.Count != 3 || values.Any(value => !double.IsFinite(value)))
        {
            throw new ArgumentException($"{label} must contain three finite coordinates.", nameof(values));
        }
        return new CameraVector3(values[0], values[1], values[2]);
    }
}

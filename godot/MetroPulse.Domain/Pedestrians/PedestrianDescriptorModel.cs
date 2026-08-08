using MetroPulse.Domain.Content;
using MetroPulse.Domain.Randomness;

namespace MetroPulse.Domain.Pedestrians;

public sealed record PedestrianAppearance(
    int SkinTone,
    int HairColor,
    string HairStyle,
    int PantsColor,
    double HeightScale,
    string? Accessory);

public sealed record PedestrianDescriptor(
    string Archetype,
    PedestrianArchetypeDefinition Profile,
    int Color,
    PedestrianAppearance Appearance);

/// <summary>Creates canonical pedestrian descriptors only from the named spawn stream.</summary>
public static class PedestrianDescriptorModel
{
    private static readonly IReadOnlyList<int> SkinTones = Array.AsReadOnly(
        [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3317]);

    private static readonly IReadOnlyList<int> HairColors = Array.AsReadOnly(
        [0x17120f, 0x3b2416, 0x6b4423, 0xb56b2d, 0xd6c3a5, 0x442713]);

    private static readonly IReadOnlyList<int> PantsColors = Array.AsReadOnly(
        [0x111827, 0x292524, 0x1e3a5f, 0x3f3f46]);

    public static PedestrianDescriptor Create(
        long serial,
        IRandomStream stream,
        GameContentRegistry? content = null)
    {
        ArgumentNullException.ThrowIfNull(stream);
        if (stream.Name != RandomStreamNames.PedestrianSpawn)
        {
            throw new ArgumentException(
                $"Pedestrian descriptors require the {RandomStreamNames.PedestrianSpawn} stream.",
                nameof(stream));
        }
        content ??= GameContentRegistry.LoadProduction();
        long safeSerial = Math.Max(0, serial);
        string archetype = content.PedestrianArchetypeSequence[(int)(safeSerial % content.PedestrianArchetypeSequence.Count)];
        PedestrianArchetypeDefinition profile = content.GetPedestrianArchetype(archetype)
            ?? throw new InvalidOperationException($"Missing canonical pedestrian archetype {archetype}.");
        IReadOnlyList<int> colors = profile.Colors
            ?? throw new InvalidOperationException($"Pedestrian archetype {archetype} has no colors.");
        IReadOnlyList<string> hair = profile.Hair
            ?? throw new InvalidOperationException($"Pedestrian archetype {archetype} has no hair styles.");

        return new PedestrianDescriptor(
            archetype,
            profile,
            Choose(colors, stream),
            new PedestrianAppearance(
                Choose(SkinTones, stream),
                Choose(HairColors, stream),
                Choose(hair, stream),
                Choose(PantsColors, stream),
                0.86 + SafeSample(stream) * 0.1,
                profile.Accessory));
    }

    private static T Choose<T>(IReadOnlyList<T> values, IRandomStream stream)
    {
        if (values.Count == 0) throw new ArgumentException("Descriptor choice list cannot be empty.", nameof(values));
        return values[(int)Math.Floor(SafeSample(stream) * values.Count)];
    }

    private static double SafeSample(IRandomStream stream)
    {
        try
        {
            double value = stream.NextDouble();
            return double.IsFinite(value) ? Math.Clamp(value, 0, 0.999999) : 0.5;
        }
        catch
        {
            return 0.5;
        }
    }
}

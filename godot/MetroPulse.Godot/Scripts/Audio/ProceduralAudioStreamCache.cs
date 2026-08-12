using Godot;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Godot.Audio;

public static class ProceduralAudioStreamCache
{
    private const int MixRate = 22_050;
    private static readonly Dictionary<string, AudioStreamWav> Streams = new(StringComparer.Ordinal);

    public static int Count => Streams.Count;

    public static AudioStreamWav Get(string id)
    {
        if (Streams.TryGetValue(id, out AudioStreamWav? stream)) return stream;
        ProceduralSoundSpec spec = AudioPresentationModel.Sounds.SingleOrDefault(sound => sound.Id == id)
            ?? throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown procedural sound.");
        int sampleCount = Math.Max(64, (int)Math.Round(MixRate * spec.DurationSeconds));
        byte[] data = new byte[sampleCount * 2];
        for (int index = 0; index < sampleCount; index++)
        {
            double time = index / (double)MixRate;
            double envelope = spec.Loop ? 1 : Math.Pow(1 - index / (double)sampleCount, 1.7);
            double fundamental = Math.Sin(Math.Tau * spec.Frequency * time);
            double harmonic = Math.Sin(Math.Tau * spec.Frequency * 2.01 * time) * 0.28;
            short sample = (short)Math.Clamp((fundamental + harmonic) * envelope * spec.Gain * short.MaxValue, short.MinValue, short.MaxValue);
            data[index * 2] = (byte)(sample & 0xff);
            data[index * 2 + 1] = (byte)((sample >> 8) & 0xff);
        }
        stream = new AudioStreamWav
        {
            Data = data,
            Format = AudioStreamWav.FormatEnum.Format16Bits,
            MixRate = MixRate,
            Stereo = false,
            LoopMode = spec.Loop ? AudioStreamWav.LoopModeEnum.Forward : AudioStreamWav.LoopModeEnum.Disabled,
            LoopBegin = 0,
            LoopEnd = sampleCount,
        };
        Streams.Add(id, stream);
        return stream;
    }

    public static void Clear() => Streams.Clear();
}

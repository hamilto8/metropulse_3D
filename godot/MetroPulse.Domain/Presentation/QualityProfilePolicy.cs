namespace MetroPulse.Domain.Presentation;

public static class QualityProfileIds
{
    public const string High = "HIGH";
    public const string Medium = "MEDIUM";
    public const string Low = "LOW";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([High, Medium, Low]);
}

/// <summary>Presentation-only budgets. Simulation populations and gameplay contacts are never reduced.</summary>
public sealed record QualityProfilePolicy(
    string Id,
    bool DirectionalShadows,
    double DirectionalShadowDistance,
    bool MultiMeshShadows,
    bool VolumetricFog,
    bool Bloom,
    int RainParticles,
    double TrafficHighDetailDistance,
    double TrafficProxyDistance,
    bool TrafficShadows,
    double PedestrianHighDetailDistance,
    double PedestrianProxyDistance,
    bool PedestrianShadows,
    double EffectBudgetScale,
    int SpatialAudioVoices,
    double MinimapRefreshSeconds)
{
    public static QualityProfilePolicy Resolve(string? id) => id?.ToUpperInvariant() switch
    {
        QualityProfileIds.Low => new(
            QualityProfileIds.Low,
            DirectionalShadows: false,
            DirectionalShadowDistance: 0,
            MultiMeshShadows: false,
            VolumetricFog: false,
            Bloom: false,
            RainParticles: 600,
            TrafficHighDetailDistance: 80,
            TrafficProxyDistance: 220,
            TrafficShadows: false,
            PedestrianHighDetailDistance: 60,
            PedestrianProxyDistance: 180,
            PedestrianShadows: false,
            EffectBudgetScale: 0.5,
            SpatialAudioVoices: 6,
            MinimapRefreshSeconds: 0.4),
        QualityProfileIds.Medium => new(
            QualityProfileIds.Medium,
            DirectionalShadows: true,
            DirectionalShadowDistance: 260,
            MultiMeshShadows: false,
            VolumetricFog: false,
            Bloom: true,
            RainParticles: 1_200,
            TrafficHighDetailDistance: 120,
            TrafficProxyDistance: 300,
            TrafficShadows: true,
            PedestrianHighDetailDistance: 90,
            PedestrianProxyDistance: 240,
            PedestrianShadows: false,
            EffectBudgetScale: 0.75,
            SpatialAudioVoices: 8,
            MinimapRefreshSeconds: 0.3),
        _ => new(
            QualityProfileIds.High,
            DirectionalShadows: true,
            DirectionalShadowDistance: 500,
            MultiMeshShadows: true,
            VolumetricFog: true,
            Bloom: true,
            RainParticles: 2_000,
            TrafficHighDetailDistance: 160,
            TrafficProxyDistance: 400,
            TrafficShadows: true,
            PedestrianHighDetailDistance: 120,
            PedestrianProxyDistance: 320,
            PedestrianShadows: true,
            EffectBudgetScale: 1,
            SpatialAudioVoices: 12,
            MinimapRefreshSeconds: 0.2),
    };
}

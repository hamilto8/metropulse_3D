using Godot;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Godot.Effects;

/// <summary>A reusable, collision-free visual root owned by a fixed session pool.</summary>
public partial class PooledWorldEffect : Node3D
{
    private EffectPoolSpec spec = null!;
    private double remaining;
    private double initialLifetime;
    private MeshInstance3D visual = null!;

    public string EffectId => spec.Id;

    public int Slot { get; private set; }

    public long Generation { get; private set; }

    public string? SourceId { get; private set; }

    public bool Active { get; private set; }

    public double Remaining => remaining;

    public void Initialize(EffectPoolSpec poolSpec, int slot)
    {
        spec = poolSpec ?? throw new ArgumentNullException(nameof(poolSpec));
        Slot = slot;
        Name = $"{spec.Id}_{slot:00}";
        visual = BuildVisual(spec.Id);
        AddChild(visual);
        if (spec.Id is EffectIds.Explosion or EffectIds.Fire)
        {
            AddChild(new OmniLight3D
            {
                Name = "Glow",
                LightColor = spec.Id == EffectIds.Explosion ? new Color("ffd166") : new Color("fb6a2a"),
                LightEnergy = spec.Id == EffectIds.Explosion ? 2.8f : 1.2f,
                OmniRange = spec.Id == EffectIds.Explosion ? 18 : 8,
                ShadowEnabled = false,
            });
        }
        Deactivate();
    }

    public void Activate(Vector3 position, double lifetime, long generation, string? sourceId)
    {
        GlobalPosition = position;
        initialLifetime = Math.Max(0.01, lifetime);
        remaining = spec.Persistent ? double.PositiveInfinity : initialLifetime;
        Generation = generation;
        SourceId = sourceId;
        Active = true;
        Visible = true;
        Scale = Vector3.One;
        Rotation = Vector3.Zero;
    }

    public bool Advance(double delta)
    {
        if (!Active) return false;
        double safeDelta = double.IsFinite(delta) ? Math.Max(0, delta) : 0;
        if (!spec.Persistent) remaining -= safeDelta;
        double age = spec.Persistent ? 0 : Math.Clamp(1 - remaining / initialLifetime, 0, 1);
        switch (spec.Id)
        {
            case EffectIds.Explosion:
                Scale = Vector3.One * (float)(0.35 + Math.Sin(Math.PI * age) * 2.6);
                break;
            case EffectIds.Fire:
                Scale = new Vector3(1, (float)(0.9 + Math.Sin(Time.GetTicksMsec() * 0.012) * 0.12), 1);
                break;
            case EffectIds.Rubble:
                RotateY((float)(safeDelta * 0.9));
                break;
            case EffectIds.Comet:
                Position += new Vector3((float)(safeDelta * 32), (float)(safeDelta * -5), (float)(safeDelta * -18));
                break;
        }
        if (remaining > 0) return false;
        Deactivate();
        return true;
    }

    public void Deactivate()
    {
        Active = false;
        Visible = false;
        SourceId = null;
        remaining = 0;
    }

    private static MeshInstance3D BuildVisual(string effectId)
    {
        Mesh mesh = effectId switch
        {
            EffectIds.Explosion => new SphereMesh { Radius = 2.5f, Height = 5 },
            EffectIds.Fire => new CylinderMesh { TopRadius = 0.25f, BottomRadius = 1.15f, Height = 3.8f },
            EffectIds.Rubble => new BoxMesh { Size = new Vector3(2.4f, 0.8f, 1.7f) },
            EffectIds.Comet => new SphereMesh { Radius = 0.7f, Height = 1.4f },
            _ => throw new ArgumentOutOfRangeException(nameof(effectId)),
        };
        Color color = effectId switch
        {
            EffectIds.Explosion => new Color("ffb000"),
            EffectIds.Fire => new Color("fb4f14"),
            EffectIds.Rubble => new Color("6b625b"),
            EffectIds.Comet => new Color("b8e8ff"),
            _ => Colors.White,
        };
        var material = new StandardMaterial3D
        {
            AlbedoColor = color,
            Roughness = effectId == EffectIds.Rubble ? 0.9f : 0.35f,
            EmissionEnabled = effectId != EffectIds.Rubble,
            Emission = color,
            EmissionEnergyMultiplier = effectId == EffectIds.Explosion ? 4 : 1.8f,
        };
        return new MeshInstance3D { Name = "Visual", Mesh = mesh, MaterialOverride = material };
    }
}

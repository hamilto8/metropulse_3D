using Godot;

namespace MetroPulse.Godot.World;

public partial class CachedBillboardSystem : Node
{
    private sealed record Entry(SubViewport Viewport, ColorRect Background, Label Label, ViewportTexture Texture, string Content);

    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);

    public int TextureCount => entries.Count;

    public int RedrawCount { get; private set; }

    public void Initialize(MvpWorldGenerator world)
    {
        ArgumentNullException.ThrowIfNull(world);
        Node3D skyline = world.GetNode<Node3D>("InitialSkyline");
        AddBillboard(skyline, "neotech", "NEOTECH\nQUANTUM AI", new Vector3(-75, 61, -10.8f), new Vector2(20, 10));
        AddBillboard(skyline, "metro-news", "METRO NEWS LIVE\n12:00  •  CLEAR", new Vector3(-25, 32, 39.2f), new Vector2(24, 10));
        AddBillboard(skyline, "cinema", "GALAXY CINEMA\nNOW SHOWING", new Vector3(-25, 27, -10.8f), new Vector2(22, 10));
    }

    public Texture2D GetOrCreateTexture(string stableId, string content)
    {
        if (entries.TryGetValue(stableId, out Entry? existing))
        {
            UpdateContent(stableId, content);
            return existing.Texture;
        }
        Entry entry = CreateEntry(stableId, content);
        entries.Add(stableId, entry);
        RedrawCount++;
        return entry.Texture;
    }

    public bool UpdateContent(string stableId, string content)
    {
        if (!entries.TryGetValue(stableId, out Entry? entry))
        {
            GetOrCreateTexture(stableId, content);
            return true;
        }
        if (string.Equals(entry.Content, content, StringComparison.Ordinal))
        {
            return false;
        }
        entry.Label.Text = content;
        entry.Viewport.RenderTargetUpdateMode = SubViewport.UpdateMode.Once;
        entries[stableId] = entry with { Content = content };
        RedrawCount++;
        return true;
    }

    public void ApplyStatus(double time, string weather)
    {
        double hour = ((time % 24) + 24) % 24;
        int hours = (int)Math.Floor(hour);
        int minutes = (int)Math.Floor((hour - hours) * 60);
        UpdateContent("metro-news", $"METRO NEWS LIVE\n{hours:D2}:{minutes:D2}  •  {weather.ToUpperInvariant()}");
    }

    public void Shutdown()
    {
        entries.Clear();
    }

    private void AddBillboard(Node3D parent, string stableId, string content, Vector3 position, Vector2 size)
    {
        Texture2D texture = GetOrCreateTexture(stableId, content);
        var material = new StandardMaterial3D
        {
            AlbedoTexture = texture,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            EmissionEnabled = true,
            EmissionTexture = texture,
            EmissionEnergyMultiplier = 1.4f,
        };
        MeshInstance3D mesh = new()
        {
            Name = $"billboard-{stableId}",
            Position = position,
            Mesh = new QuadMesh { Size = size },
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        parent.AddChild(mesh);
    }

    private Entry CreateEntry(string stableId, string content)
    {
        SubViewport viewport = new()
        {
            Name = $"viewport-{stableId}",
            Size = new Vector2I(512, 256),
            RenderTargetUpdateMode = SubViewport.UpdateMode.Once,
        };
        ColorRect background = new()
        {
            Name = "Background",
            Color = new Color(0.025f, 0.047f, 0.12f),
            OffsetRight = 512,
            OffsetBottom = 256,
        };
        Label label = new()
        {
            Name = "Text",
            Text = content,
            OffsetLeft = 18,
            OffsetTop = 18,
            OffsetRight = 494,
            OffsetBottom = 238,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        label.AddThemeFontSizeOverride("font_size", 38);
        label.AddThemeColorOverride("font_color", new Color(0.1f, 0.95f, 1));
        viewport.AddChild(background);
        viewport.AddChild(label);
        AddChild(viewport);
        return new Entry(viewport, background, label, viewport.GetTexture(), content);
    }
}

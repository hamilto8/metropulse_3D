using Godot;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Services;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Services;

/// <summary>Derived world markers for persisted incident work orders.</summary>
public partial class CityServiceMarkerPresenter : Node3D
{
    private readonly Dictionary<string, Node3D> markers = new(StringComparer.Ordinal);
    private Func<bool>? unsubscribe;
    private MvpWorldGenerator? world;

    public bool Initialized { get; private set; }

    public int MarkerCount => markers.Count;

    public long AppliedRevision { get; private set; }

    public void Initialize(CityServiceModel model, MvpWorldGenerator worldOwner)
    {
        if (Initialized) throw new InvalidOperationException("Service marker presentation is already initialized.");
        ArgumentNullException.ThrowIfNull(model);
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        unsubscribe = model.Subscribe(serviceEvent => Apply(serviceEvent.Current), emitCurrent: true);
        Initialized = true;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unsubscribe?.Invoke();
        unsubscribe = null;
        foreach (Node3D marker in markers.Values)
        {
            if (GodotObject.IsInstanceValid(marker)) marker.Free();
        }
        markers.Clear();
        world = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Apply(CityServiceSnapshot snapshot)
    {
        KeyValuePair<string, OutcomeRepairState>[] visible = snapshot.OpenWorkOrders
            .Where(pair => pair.Value.Position is not null)
            .ToArray();
        var visibleIds = visible.Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        foreach (string removed in markers.Keys.Where(id => !visibleIds.Contains(id)).ToArray())
        {
            markers[removed].Free();
            markers.Remove(removed);
        }
        foreach ((string id, OutcomeRepairState order) in visible)
        {
            if (!markers.TryGetValue(id, out Node3D? marker))
            {
                marker = BuildMarker(id, order.WorkType);
                AddChild(marker);
                markers.Add(id, marker);
            }
            OutcomePosition position = order.Position!;
            float y = (float)world!.Surface.GetTerrainHeight(position.X, position.Z) + 1.5f;
            marker.Position = new Vector3((float)position.X, y, (float)position.Z);
            marker.Visible = true;
            marker.Scale = order.Status is RepairStatuses.Scheduled or RepairStatuses.InProgress
                ? Vector3.One
                : Vector3.One * 0.72f;
        }
        AppliedRevision = snapshot.Revision;
    }

    private static Node3D BuildMarker(string id, string workType)
    {
        Color color = workType == WorkOrderTypes.Cleanup
            ? new Color(1, 0.55f, 0.08f)
            : new Color(0.1f, 0.85f, 1);
        var material = new StandardMaterial3D
        {
            AlbedoColor = color,
            EmissionEnabled = true,
            Emission = color,
            EmissionEnergyMultiplier = 2.2f,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        };
        var root = new Node3D { Name = $"ServiceWork_{Sanitize(id)}" };
        root.AddChild(new MeshInstance3D
        {
            Name = "Beacon",
            Mesh = new CylinderMesh { TopRadius = 0.25f, BottomRadius = 0.55f, Height = 2.5f },
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        });
        var ring = new MeshInstance3D
        {
            Name = "Ring",
            Position = new Vector3(0, -1.15f, 0),
            Mesh = new TorusMesh { InnerRadius = 0.75f, OuterRadius = 1.05f },
            MaterialOverride = material,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        root.AddChild(ring);
        return root;
    }

    private static string Sanitize(string value) => value
        .Replace(':', '_')
        .Replace('/', '_');
}

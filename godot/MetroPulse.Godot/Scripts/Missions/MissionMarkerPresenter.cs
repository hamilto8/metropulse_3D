using Godot;
using MetroPulse.Domain.Missions;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Missions;

/// <summary>Bounded visual owner for mission pickup and current navigation markers.</summary>
public partial class MissionMarkerPresenter : Node3D
{
    private readonly Dictionary<string, Node3D> offers = new(StringComparer.Ordinal);
    private readonly CylinderMesh pickupDisk = new() { TopRadius = 4.2f, BottomRadius = 4.2f, Height = 0.25f, RadialSegments = 24 };
    private readonly CylinderMesh pickupColumn = new() { TopRadius = 0.55f, BottomRadius = 0.55f, Height = 10, RadialSegments = 12 };
    private readonly CylinderMesh objectiveDisk = new() { TopRadius = 5.5f, BottomRadius = 5.5f, Height = 0.25f, RadialSegments = 24 };
    private readonly CylinderMesh objectiveColumn = new() { TopRadius = 1.2f, BottomRadius = 1.2f, Height = 32, RadialSegments = 16 };
    private readonly StandardMaterial3D offerMaterial = Material(new Color("00f0ff"), 0.7f);
    private readonly StandardMaterial3D objectiveMaterial = Material(new Color("44ff88"), 0.55f);
    private MvpWorldGenerator? world;
    private Node3D? objective;

    public bool Initialized { get; private set; }

    public int OfferMarkerCount => offers.Count;

    public int ObjectiveMarkerCount => objective is null ? 0 : 1;

    public string? ObjectiveMissionId { get; private set; }

    public void Initialize(MvpWorldGenerator worldOwner)
    {
        if (Initialized) throw new InvalidOperationException("Mission marker presenter is already initialized.");
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        Initialized = true;
    }

    public void ApplyOffers(IReadOnlyList<MissionOfferMarker> markers)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(markers);
        var active = markers.Select(marker => marker.MissionId).ToHashSet(StringComparer.Ordinal);
        foreach (string removed in offers.Keys.Where(id => !active.Contains(id)).ToArray())
        {
            offers[removed].Free();
            offers.Remove(removed);
        }
        foreach (MissionOfferMarker marker in markers)
        {
            if (!offers.TryGetValue(marker.MissionId, out Node3D? node))
            {
                node = CreateMarker($"Offer_{Sanitize(marker.MissionId)}", pickupDisk, pickupColumn, offerMaterial, 5);
                AddChild(node);
                offers.Add(marker.MissionId, node);
            }
            node.GlobalPosition = WorldPosition(marker.Position, 0.2f);
            node.SetMeta("mission_id", marker.MissionId);
            node.SetMeta("eligible", marker.Eligible);
            node.SetMeta("reason", marker.IneligibleReason ?? string.Empty);
        }
    }

    public void ApplyObjective(string? missionId, MissionWorldPoint? target)
    {
        EnsureInitialized();
        if (missionId is null || target is null)
        {
            ClearObjective();
            return;
        }
        objective ??= CreateObjective();
        objective.GlobalPosition = WorldPosition(target, 0.25f);
        ObjectiveMissionId = missionId;
        objective.SetMeta("mission_id", missionId);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        foreach (Node3D marker in offers.Values) marker.Free();
        offers.Clear();
        ClearObjective();
        world = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private Node3D CreateObjective()
    {
        Node3D marker = CreateMarker("MissionObjective", objectiveDisk, objectiveColumn, objectiveMaterial, 16);
        AddChild(marker);
        return marker;
    }

    private static Node3D CreateMarker(
        string name,
        Mesh disk,
        Mesh column,
        Material material,
        float columnHeight)
    {
        var root = new Node3D { Name = name };
        root.AddChild(new MeshInstance3D { Name = "Ground", Mesh = disk, MaterialOverride = material });
        root.AddChild(new MeshInstance3D
        {
            Name = "Column",
            Mesh = column,
            MaterialOverride = material,
            Position = new Vector3(0, columnHeight, 0),
        });
        return root;
    }

    private Vector3 WorldPosition(MissionWorldPoint point, float offset) => new(
        (float)point.X,
        (float)world!.Surface.GetTerrainHeight(point.X, point.Z) + offset,
        (float)point.Z);

    private void ClearObjective()
    {
        if (objective is not null && GodotObject.IsInstanceValid(objective)) objective.Free();
        objective = null;
        ObjectiveMissionId = null;
    }

    private static StandardMaterial3D Material(Color color, float alpha)
    {
        color.A = alpha;
        return new StandardMaterial3D
        {
            AlbedoColor = color,
            EmissionEnabled = true,
            Emission = new Color(color.R, color.G, color.B),
            EmissionEnergyMultiplier = 1.4f,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        };
    }

    private static string Sanitize(string value) => value.Replace('-', '_').Replace(':', '_');

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("Mission marker presenter is not initialized.");
    }
}

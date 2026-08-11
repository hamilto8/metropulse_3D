using Godot;
using MetroPulse.Domain.Traffic;

namespace MetroPulse.Godot.Traffic;

/// <summary>Render-only bridge policy/outage markings driven by the aggregate traffic snapshot.</summary>
public partial class TrafficProductivityPresenter : Node3D
{
    private Func<bool>? unsubscribe;
    private Node3D priorityMarkings = null!;
    private Node3D disruptionBeacons = null!;

    public bool Initialized { get; private set; }

    public bool PriorityVisible => priorityMarkings.Visible;

    public bool DisruptionVisible => disruptionBeacons.Visible;

    public long AppliedRevision { get; private set; }

    public void Initialize(TrafficProductivityModel model)
    {
        if (Initialized) throw new InvalidOperationException("Traffic productivity presentation is already initialized.");
        ArgumentNullException.ThrowIfNull(model);
        priorityMarkings = new Node3D { Name = "FreightPriorityChevrons" };
        disruptionBeacons = new Node3D { Name = "BridgeDisruptionBeacons" };
        AddChild(priorityMarkings);
        AddChild(disruptionBeacons);
        BuildPriorityMarkings();
        BuildDisruptionBeacons();
        unsubscribe = model.Subscribe(trafficEvent => Apply(trafficEvent.Current), emitCurrent: true);
        Initialized = true;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unsubscribe?.Invoke();
        unsubscribe = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Apply(TrafficProductivitySnapshot snapshot)
    {
        priorityMarkings.Visible = snapshot.Policy.Id == BridgePolicies.FreightPriority;
        disruptionBeacons.Visible = snapshot.Bridge.OutageActive || snapshot.Bridge.Access != TrafficAccess.Open;
        AppliedRevision = snapshot.Revision;
    }

    private void BuildPriorityMarkings()
    {
        var material = new StandardMaterial3D
        {
            AlbedoColor = new Color(0.05f, 0.95f, 1, 0.72f),
            EmissionEnabled = true,
            Emission = new Color(0.05f, 0.75f, 1),
            EmissionEnergyMultiplier = 1.8f,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        };
        for (int index = 0; index < 5; index++)
        {
            float x = 120 + index * 20;
            foreach (float z in new[] { -3.5f, 3.5f })
            {
                var marking = new MeshInstance3D
                {
                    Name = $"Chevron-{index}-{z}",
                    Position = new Vector3(x, 0.08f, z),
                    Rotation = new Vector3(0, MathF.PI / 4, 0),
                    Mesh = new BoxMesh { Size = new Vector3(4.5f, 0.04f, 0.55f) },
                    MaterialOverride = material,
                    CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                };
                priorityMarkings.AddChild(marking);
            }
        }
    }

    private void BuildDisruptionBeacons()
    {
        var material = new StandardMaterial3D
        {
            AlbedoColor = new Color(1, 0.18f, 0.08f),
            EmissionEnabled = true,
            Emission = new Color(1, 0.08f, 0.02f),
            EmissionEnergyMultiplier = 2.5f,
        };
        foreach (float x in new[] { 112f, 208f })
        {
            foreach (float z in new[] { -8f, 8f })
            {
                var beacon = new MeshInstance3D
                {
                    Name = $"Beacon-{x}-{z}",
                    Position = new Vector3(x, 1.1f, z),
                    Mesh = new SphereMesh { Radius = 0.42f, Height = 0.84f },
                    MaterialOverride = material,
                    CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
                };
                disruptionBeacons.AddChild(beacon);
            }
        }
    }
}

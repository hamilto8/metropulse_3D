using Godot;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Traffic;

/// <summary>Physical post collider and simple signal/stop presentation.</summary>
public partial class TrafficControlPostActor : StaticBody3D
{
    private StandardMaterial3D indicatorMaterial = null!;

    public string ControlId { get; private set; } = string.Empty;

    public string Axis { get; private set; } = string.Empty;

    public void Initialize(TrafficControlPost post, TrafficControl control, MvpWorldGenerator world)
    {
        ArgumentNullException.ThrowIfNull(post);
        ArgumentNullException.ThrowIfNull(control);
        ArgumentNullException.ThrowIfNull(world);
        ControlId = post.ControlId;
        Axis = post.FacingDirection is "N" or "S" ? "NS" : "EW";
        double terrain = world.Surface.GetTerrainHeight(post.Position.X, post.Position.Z);
        GlobalPosition = new Vector3((float)post.Position.X, (float)terrain, (float)post.Position.Z);
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.StaticObstacle;
        CollisionMask = (uint)(MetroPulse.Domain.Simulation.CollisionLayer.Player
            | MetroPulse.Domain.Simulation.CollisionLayer.Traffic
            | MetroPulse.Domain.Simulation.CollisionLayer.Pedestrian);
        AddChild(new CollisionShape3D
        {
            Name = "PostCollision",
            Position = new Vector3(0, 1.5f, 0),
            Shape = new CylinderShape3D { Radius = 0.14f, Height = 3 },
        });
        AddChild(new MeshInstance3D
        {
            Name = "Post",
            Position = new Vector3(0, 1.5f, 0),
            Mesh = new CylinderMesh { TopRadius = 0.12f, BottomRadius = 0.14f, Height = 3 },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = Color.FromHtml("475569"), Roughness = 0.72f },
        });
        indicatorMaterial = new StandardMaterial3D
        {
            AlbedoColor = control.Type == TrafficControlTypes.Stop ? Color.FromHtml("dc2626") : Color.FromHtml("22c55e"),
            EmissionEnabled = control.Type == TrafficControlTypes.Signal,
            Emission = control.Type == TrafficControlTypes.Signal ? Color.FromHtml("22c55e") : Colors.Black,
            EmissionEnergyMultiplier = 0.8f,
        };
        AddChild(new MeshInstance3D
        {
            Name = "Indicator",
            Position = new Vector3(0, 3.05f, 0),
            Mesh = control.Type == TrafficControlTypes.Stop
                ? new BoxMesh { Size = new Vector3(0.8f, 0.8f, 0.12f) }
                : new SphereMesh { Radius = 0.28f, Height = 0.56f },
            MaterialOverride = indicatorMaterial,
        });
    }

    public void ApplySignalState(string state)
    {
        Color color = state switch
        {
            TrafficSignalStates.Green => Color.FromHtml("22c55e"),
            TrafficSignalStates.Yellow => Color.FromHtml("facc15"),
            _ => Color.FromHtml("ef4444"),
        };
        indicatorMaterial.AlbedoColor = color;
        indicatorMaterial.Emission = color;
    }
}

using Godot;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Godot.World;

public partial class WorldDebugTraversalCapsule : CharacterBody3D
{
    private static readonly Vector3[] Waypoints =
    [
        new(-100, 2, 100),
        new(0, 2, 100),
        new(100, 2, 100),
        new(115, 2, 0),
        new(160, 2, 0),
        new(205, 2, 0),
        new(310, 2, 0),
        new(-75, 2, -75),
    ];

    public IReadOnlyList<Vector3> TraversalWaypoints => Array.AsReadOnly(Waypoints);

    public void Initialize()
    {
        Name = "DebugTraversalCapsule";
        CollisionLayer = (uint)MetroPulse.Domain.Simulation.CollisionLayer.Player;
        CollisionMask = (uint)CollisionMasks.Player;
        ProcessMode = ProcessModeEnum.Disabled;
        Position = Waypoints[0];
        CollisionShape3D shape = new()
        {
            Name = "Shape",
            Shape = new CapsuleShape3D { Radius = 0.45f, Height = 1.8f },
        };
        AddChild(shape);
    }
}

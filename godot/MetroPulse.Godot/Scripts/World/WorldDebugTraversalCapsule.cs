using Godot;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Godot.World;

public partial class WorldDebugTraversalCapsule : CharacterBody3D
{
    private static readonly Vector3[] Waypoints =
    [
        new(-100, 2, 100),
        new(100, 2, 100),
        new(100, 2, 0),
        new(110, 2, 0),
        new(160, 2, 0),
        new(210, 2, 0),
        new(310, 2, 0),
        new(210, 2, 0),
        new(160, 2, 0),
        new(110, 2, 0),
        new(100, 2, 0),
        new(100, 2, -50),
        new(-50, 2, -50),
        new(-60, 2, -60),
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

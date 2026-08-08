namespace MetroPulse.Domain.Simulation;

[Flags]
public enum CollisionLayer : uint
{
    None = 0,
    Surface = 1U << 0,
    StaticObstacle = 1U << 1,
    Traffic = 1U << 2,
    Player = 1U << 3,
    Pedestrian = 1U << 4,
    Interaction = 1U << 5,
    MissionTrigger = 1U << 6,
    Effect = 1U << 7,
    CameraQuery = 1U << 8,
}

public static class CollisionMasks
{
    public const CollisionLayer Surface = CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Pedestrian
        | CollisionLayer.CameraQuery;

    public const CollisionLayer StaticObstacle = CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Pedestrian
        | CollisionLayer.CameraQuery;

    public const CollisionLayer Traffic = CollisionLayer.Surface
        | CollisionLayer.StaticObstacle
        | CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Pedestrian
        | CollisionLayer.Interaction
        | CollisionLayer.MissionTrigger;

    public const CollisionLayer Player = CollisionLayer.Surface
        | CollisionLayer.StaticObstacle
        | CollisionLayer.Traffic
        | CollisionLayer.Pedestrian
        | CollisionLayer.Interaction
        | CollisionLayer.MissionTrigger;

    public const CollisionLayer Pedestrian = CollisionLayer.Surface
        | CollisionLayer.StaticObstacle
        | CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Interaction
        | CollisionLayer.MissionTrigger;

    public const CollisionLayer Interaction = CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Pedestrian;

    public const CollisionLayer MissionTrigger = CollisionLayer.Traffic
        | CollisionLayer.Player
        | CollisionLayer.Pedestrian;

    public const CollisionLayer Effect = CollisionLayer.None;

    public const CollisionLayer CameraQuery = CollisionLayer.Surface
        | CollisionLayer.StaticObstacle;
}

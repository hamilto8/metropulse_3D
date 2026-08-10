using Godot;

namespace MetroPulse.Godot.Camera;

public enum GameplayCameraMode
{
    OrbitMacro,
    PresetTransition,
    StreetLook,
    SwoopToStreet,
    ChaseMicro,
}

public sealed record GameplayCameraTargetSnapshot(
    string StableId,
    string Type,
    Vector3 Position,
    double PlanarHeading,
    double SpeedMetersPerSecond,
    bool HasPhysicsVehicle,
    bool UserControlled);

public interface IGameplayCameraTarget
{
    GameplayCameraTargetSnapshot CaptureCameraTarget();
}

public sealed record GameplayCameraSnapshot(
    GameplayCameraMode Mode,
    Transform3D CameraTransform,
    Vector3 LookAt,
    float FieldOfView,
    string? ActivePresetId,
    IGameplayCameraTarget? FollowTarget,
    double ChaseYaw,
    double ChasePitch);

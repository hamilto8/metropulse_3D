using Godot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Simulation;

namespace MetroPulse.Godot.World;

public sealed record WorldColliderMetadata(
    string StableId,
    string ChunkId,
    string Kind,
    CollisionLayer Layer,
    CollisionLayer Mask,
    Vector3 Position,
    Vector3 Size,
    double RotationY,
    StaticBody3D Body);

public sealed class WorldCollisionRegistry
{
    private readonly Dictionary<string, WorldColliderMetadata> colliders = new(StringComparer.Ordinal);

    public int Count => colliders.Count;

    public IReadOnlyCollection<WorldColliderMetadata> Snapshot => Array.AsReadOnly(colliders.Values.ToArray());

    public void Register(WorldColliderMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        if (!colliders.TryAdd(metadata.StableId, metadata))
        {
            throw new InvalidOperationException($"World collider ID {metadata.StableId} is already registered.");
        }
    }

    public bool TryGet(string stableId, out WorldColliderMetadata? metadata) => colliders.TryGetValue(stableId, out metadata);

    public bool Unregister(string stableId) => colliders.Remove(stableId);

    public IReadOnlyList<CameraObstacle> CameraObstacles() => colliders.Values
        .Where(item => item.Layer == CollisionLayer.StaticObstacle)
        .Select(item => new CameraObstacle(
            item.StableId,
            new CameraVector3(item.Position.X, item.Position.Y, item.Position.Z),
            new CameraVector3(item.Size.X, item.Size.Y, item.Size.Z)))
        .ToArray();

    public void Clear() => colliders.Clear();
}

using Godot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;

namespace MetroPulse.Godot.World;

public partial class GodotCameraWorldAdapter : Node3D
{
    private static readonly IReadOnlyList<string> ProductionPresetIds = Array.AsReadOnly(
        new[] { "management", "ground", "street", "birdseye", "park", "downtown", "bridge", "free" });
    private Camera3D? camera;
    private MvpWorldGenerator? world;
    private CameraPresetModel? presets;
    private CameraClearanceQuery? clearance;

    public bool Initialized { get; private set; }

    public string? ActivePresetId { get; private set; }

    public IReadOnlyList<string> AvailablePresetIds => ProductionPresetIds;

    public CameraClearanceInspection? CurrentInspection { get; private set; }

    public Vector3 CurrentTarget { get; private set; }

    public void Initialize(MvpWorldGenerator world, GameContentRegistry content)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(content);
        if (Initialized)
        {
            throw new InvalidOperationException("Camera world adapter is already initialized.");
        }
        this.world = world;
        camera = GetNode<Camera3D>("MainCamera");
        camera.Far = (float)MetroPulse.Domain.TimeWeather.CelestialOrbitModel.DefaultConfig.CameraFarPlane;
        camera.Fov = 60;
        presets = new CameraPresetModel(content.CameraPresets);
        clearance = new CameraClearanceQuery(
            world.Surface.GetTerrainHeight,
            position => world.Surface.IsWater(position.X, position.Y, position.Z),
            world.Colliders.CameraObstacles);
        Initialized = true;
        if (!ApplyPreset("management"))
        {
            throw new InvalidOperationException("The Management camera preset could not be applied.");
        }
    }

    public bool ApplyPreset(string? id)
    {
        if (!Initialized || camera is null || presets is null || clearance is null || id is null
            || !ProductionPresetIds.Contains(id, StringComparer.Ordinal))
        {
            return false;
        }
        string canonicalId = id == "management" ? "birdseye" : id;
        CameraPose? pose = presets.Get(canonicalId);
        if (pose is null)
        {
            return false;
        }
        CameraVector3 position;
        CameraClearanceOptions options = new()
        {
            Radius = canonicalId is "ground" or "street" ? 0.45 : 0.8,
            TerrainClearance = canonicalId is "ground" or "street" ? 0.75 : 0.8,
            MaximumSearchRadius = 40,
        };
        try
        {
            position = clearance.Resolve(pose.Position, options);
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        camera.GlobalPosition = ToVector(position);
        CurrentTarget = ToVector(pose.LookAt);
        camera.LookAt(CurrentTarget, Vector3.Up);
        ActivePresetId = id;
        CurrentInspection = clearance.Inspect(position, options);
        return CurrentInspection.Clear;
    }

    public CameraClearanceInspection Inspect(Vector3 position)
    {
        CameraClearanceQuery query = clearance ?? throw new InvalidOperationException("Camera world adapter is not initialized.");
        return query.Inspect(new CameraVector3(position.X, position.Y, position.Z));
    }

    public double GetSurfaceHeight(double x, double z)
    {
        MvpWorldGenerator owner = world ?? throw new InvalidOperationException("Camera world adapter is not initialized.");
        return Math.Max(0, owner.Surface.GetTerrainHeight(x, z));
    }

    public bool TryResolve(
        Vector3 desired,
        CameraClearanceOptions? options,
        out Vector3 resolved)
    {
        CameraClearanceQuery query = clearance ?? throw new InvalidOperationException("Camera world adapter is not initialized.");
        try
        {
            resolved = ToVector(query.Resolve(new CameraVector3(desired.X, desired.Y, desired.Z), options));
            CurrentInspection = query.Inspect(new CameraVector3(resolved.X, resolved.Y, resolved.Z), options);
            return CurrentInspection.Clear;
        }
        catch (InvalidOperationException)
        {
            resolved = desired;
            return false;
        }
    }

    private static Vector3 ToVector(CameraVector3 value) => new((float)value.X, (float)value.Y, (float)value.Z);
}

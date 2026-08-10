using Godot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Camera;

/// <summary>
/// Sole live owner of macro orbit, street look, player chase, preset motion,
/// clearance, FOV, and render-only shake for the session camera.
/// </summary>
public partial class GameplayCameraRig : Node
{
    public const double DefaultTransitionDuration = 1.25;
    private const double PointerYawScale = 0.004;
    private const double PointerPitchScale = 0.003;
    private const double StickYawSpeed = 2.5;
    private const double StickPitchSpeed = 1.5;
    private const double MacroPanSpeed = 50;
    private const double MacroFastPanSpeed = 120;
    private const double MinimumOrbitPitch = 5 * Math.PI / 180;
    private const double MaximumOrbitPitch = 88 * Math.PI / 180;

    private RuntimeInputHost? input;
    private SettingsStore? settings;
    private GodotCameraWorldAdapter? worldCamera;
    private Camera3D? camera;
    private IGameplayCameraTarget? followTarget;
    private CameraPose? transitionStart;
    private CameraPose? transitionDestination;
    private double transitionElapsed;
    private double transitionDuration;
    private Vector3 lookAt;
    private Vector3 appliedShakeOffset;
    private double shakeIntensity;
    private double chaseYaw;
    private double chasePitch;
    private ulong shakeSample;

    public bool Initialized { get; private set; }

    public GameplayCameraMode Mode { get; private set; } = GameplayCameraMode.OrbitMacro;

    public string? ActivePresetId { get; private set; }

    public IGameplayCameraTarget? FollowTarget => followTarget;

    public Vector3 LookAt => lookAt;

    public Vector3 AppliedShakeOffset => appliedShakeOffset;

    public double ChaseYaw => chaseYaw;

    public double ChasePitch => chasePitch;

    public int FollowStartCount { get; private set; }

    public int FollowReleaseCount { get; private set; }

    public void Initialize(
        RuntimeInputHost inputHost,
        SettingsStore settingsStore,
        GodotCameraWorldAdapter cameraAdapter)
    {
        if (Initialized)
        {
            throw new InvalidOperationException("The gameplay camera rig is already initialized.");
        }
        input = inputHost ?? throw new ArgumentNullException(nameof(inputHost));
        settings = settingsStore ?? throw new ArgumentNullException(nameof(settingsStore));
        worldCamera = cameraAdapter ?? throw new ArgumentNullException(nameof(cameraAdapter));
        camera = cameraAdapter.GetNode<Camera3D>("MainCamera");
        lookAt = cameraAdapter.CurrentTarget;
        ActivePresetId = cameraAdapter.ActivePresetId;
        Mode = GameplayCameraMode.OrbitMacro;
        Initialized = true;
    }

    public bool ApplyTransitionState(GameState state, IGameplayCameraTarget? controlledTarget)
    {
        EnsureInitialized();
        return state switch
        {
            GameState.Management => ApplyPresetImmediate("management"),
            GameState.Builder => ApplyPresetImmediate("birdseye"),
            GameState.Load or GameState.Menu => ApplyPresetImmediate("management"),
            GameState.StreetOnFoot or GameState.StreetVehicle => controlledTarget is not null
                && StartFollow(controlledTarget, DefaultTransitionDuration),
            _ => true,
        };
    }

    public bool ApplyPresetImmediate(string id)
    {
        EnsureInitialized();
        GameplayCameraSnapshot source = CaptureSnapshot();
        RemoveAppliedShake();
        if (worldCamera?.ApplyPreset(id) != true)
        {
            RestoreSnapshot(source);
            return false;
        }
        ReleaseFollowInternal(countRelease: followTarget is not null);
        lookAt = worldCamera.CurrentTarget;
        ActivePresetId = id;
        Mode = IsStreetPreset(id) ? GameplayCameraMode.StreetLook : GameplayCameraMode.OrbitMacro;
        camera!.Fov = (float)ChaseCameraModel.DefaultFieldOfView;
        return true;
    }

    public bool TransitionToPreset(string id, double duration = 0.8)
    {
        EnsureInitialized();
        if (!double.IsFinite(duration) || duration <= 0)
        {
            return ApplyPresetImmediate(id);
        }

        RemoveAppliedShake();
        CameraPose start = CurrentPose();
        if (worldCamera?.ApplyPreset(id) != true)
        {
            return false;
        }
        CameraPose destination = CurrentPose(worldCamera.CurrentTarget);
        ApplyPose(start);
        ReleaseFollowInternal(countRelease: followTarget is not null);
        transitionStart = start;
        transitionDestination = destination;
        transitionElapsed = 0;
        transitionDuration = duration;
        ActivePresetId = id;
        Mode = GameplayCameraMode.PresetTransition;
        return true;
    }

    public bool StartFollow(IGameplayCameraTarget target, double duration = DefaultTransitionDuration)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(target);
        GameplayCameraTargetSnapshot snapshot;
        try
        {
            snapshot = target.CaptureCameraTarget();
            ValidateTarget(snapshot);
            _ = ResolveChasePose(snapshot);
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        RemoveAppliedShake();
        followTarget = target;
        chaseYaw = 0;
        chasePitch = 0;
        transitionStart = CurrentPose();
        transitionDestination = null;
        transitionElapsed = 0;
        transitionDuration = double.IsFinite(duration) && duration > 0 ? duration : DefaultTransitionDuration;
        ActivePresetId = null;
        Mode = GameplayCameraMode.SwoopToStreet;
        FollowStartCount++;
        return true;
    }

    public bool ReleaseFollow()
    {
        EnsureInitialized();
        if (followTarget is null && Mode is not GameplayCameraMode.ChaseMicro and not GameplayCameraMode.SwoopToStreet)
        {
            return false;
        }
        RemoveAppliedShake();
        ReleaseFollowInternal(countRelease: true);
        return true;
    }

    public GameplayCameraSnapshot CaptureSnapshot()
    {
        EnsureInitialized();
        RemoveAppliedShake();
        return new GameplayCameraSnapshot(
            Mode,
            camera!.GlobalTransform,
            lookAt,
            camera.Fov,
            ActivePresetId,
            followTarget,
            chaseYaw,
            chasePitch);
    }

    public void RestoreSnapshot(GameplayCameraSnapshot snapshot)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(snapshot);
        RemoveAppliedShake();
        camera!.GlobalTransform = snapshot.CameraTransform;
        camera.Fov = snapshot.FieldOfView;
        lookAt = snapshot.LookAt;
        ActivePresetId = snapshot.ActivePresetId;
        followTarget = snapshot.FollowTarget;
        chaseYaw = snapshot.ChaseYaw;
        chasePitch = snapshot.ChasePitch;
        Mode = snapshot.Mode;
        transitionStart = null;
        transitionDestination = null;
        transitionElapsed = 0;
        shakeIntensity = 0;
        appliedShakeOffset = Vector3.Zero;
        camera.ResetPhysicsInterpolation();
    }

    public void ApplyLookInput(double yawDelta, double pitchDelta)
    {
        EnsureInitialized();
        if (!double.IsFinite(yawDelta)) yawDelta = 0;
        if (!double.IsFinite(pitchDelta)) pitchDelta = 0;
        if (Mode is GameplayCameraMode.SwoopToStreet or GameplayCameraMode.ChaseMicro)
        {
            chaseYaw += yawDelta;
            chasePitch = Math.Clamp(chasePitch + pitchDelta, -0.3, 0.55);
            return;
        }
        if (Mode == GameplayCameraMode.StreetLook)
        {
            CameraVector3 direction = StreetCameraModel.RotateLookDirection(
                ToCamera(lookAt - camera!.GlobalPosition),
                yawDelta,
                pitchDelta);
            lookAt = camera.GlobalPosition + ToGodot(direction.Scale(StreetCameraModel.PivotDistance));
            camera.LookAt(lookAt, Vector3.Up);
            return;
        }
        if (Mode == GameplayCameraMode.OrbitMacro)
        {
            Orbit(yawDelta, pitchDelta);
        }
    }

    public void Pan(Vector3 localDirection, double delta, bool fast = false)
    {
        EnsureInitialized();
        if (Mode != GameplayCameraMode.OrbitMacro || localDirection.IsZeroApprox()) return;
        Vector3 forward = (lookAt - camera!.GlobalPosition) with { Y = 0 };
        forward = forward.IsZeroApprox() ? Vector3.Forward : forward.Normalized();
        Vector3 right = forward.Cross(Vector3.Up).Normalized();
        Vector3 move = (forward * localDirection.Z) + (right * localDirection.X) + (Vector3.Up * localDirection.Y);
        if (move.IsZeroApprox()) return;
        float distance = (float)((fast ? MacroFastPanSpeed : MacroPanSpeed) * Math.Max(0, delta));
        Vector3 translation = move.Normalized() * distance;
        Vector3 desiredPosition = camera.GlobalPosition + translation;
        Vector3 desiredLookAt = lookAt + translation;
        if (!worldCamera!.TryResolve(desiredPosition, new CameraClearanceOptions
        {
            PreferredDirection = ToCamera(translation),
            MaximumSearchRadius = 40,
        }, out Vector3 resolved))
        {
            return;
        }
        camera.GlobalPosition = resolved;
        lookAt = desiredLookAt;
        ConstrainBasePose(levelTarget: false);
    }

    public void TriggerShake(double intensity = 0.35)
    {
        EnsureInitialized();
        double scale = settings?.Get("motion.cameraShake", 1d) ?? 1;
        double requested = double.IsFinite(intensity) ? Math.Max(0, intensity) : 0;
        shakeIntensity = Math.Max(shakeIntensity, requested * Math.Clamp(scale, 0, 1));
    }

    public void Advance(double delta, bool consumeInput = true)
    {
        if (!Initialized) return;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.1) : 0;
        RemoveAppliedShake();
        if (consumeInput)
        {
            ConsumeInput(safeDelta);
        }

        switch (Mode)
        {
            case GameplayCameraMode.PresetTransition:
                AdvancePresetTransition(safeDelta);
                break;
            case GameplayCameraMode.SwoopToStreet:
                AdvanceSwoop(safeDelta);
                break;
            case GameplayCameraMode.ChaseMicro:
                AdvanceChase(safeDelta);
                break;
            case GameplayCameraMode.StreetLook:
                ConstrainBasePose(levelTarget: true);
                break;
            case GameplayCameraMode.OrbitMacro:
                ConstrainBasePose(levelTarget: false);
                break;
        }

        AdvanceShake(safeDelta);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        if (camera?.IsInsideTree() == true)
        {
            RemoveAppliedShake();
        }
        else
        {
            appliedShakeOffset = Vector3.Zero;
        }
        shakeIntensity = 0;
        followTarget = null;
        input = null;
        settings = null;
        worldCamera = null;
        camera = null;
        Initialized = false;
    }

    private void ConsumeInput(double delta)
    {
        RuntimeInputSnapshot snapshot = input!.LatestSnapshot;
        if (snapshot.Suspended) return;
        double sensitivity = settings?.Get("mouseSensitivity", 1d) ?? 1;
        bool chase = Mode is GameplayCameraMode.SwoopToStreet or GameplayCameraMode.ChaseMicro;
        string lookAction = chase ? "CAMERA" : "ORBIT";
        bool pointerLooking = snapshot.Actions.GetValueOrDefault(lookAction) >= RuntimeInputState.PressedThreshold;
        double yaw = -snapshot.RightStick.X * delta * StickYawSpeed;
        double pitch = -snapshot.RightStick.Y * delta * StickPitchSpeed;
        if (pointerLooking)
        {
            yaw -= snapshot.PointerDelta.X * PointerYawScale * sensitivity;
            pitch -= snapshot.PointerDelta.Y * PointerPitchScale * sensitivity;
        }
        if (Math.Abs(yaw) + Math.Abs(pitch) > 1e-8)
        {
            ApplyLookInput(yaw, pitch);
        }

        if (Mode == GameplayCameraMode.OrbitMacro && snapshot.Context == ControlContexts.Management)
        {
            double forward = Slot(snapshot, "PAN", 0) - Slot(snapshot, "PAN", 1);
            double horizontal = Slot(snapshot, "PAN", 3) - Slot(snapshot, "PAN", 2);
            double vertical = Slot(snapshot, "PAN", 5) - Slot(snapshot, "PAN", 4);
            bool fast = Slot(snapshot, "PAN", 6) >= RuntimeInputState.PressedThreshold;
            Pan(new Vector3((float)horizontal, (float)vertical, (float)forward), delta, fast);
        }
    }

    private void AdvancePresetTransition(double delta)
    {
        if (transitionStart is null || transitionDestination is null)
        {
            Mode = GameplayCameraMode.OrbitMacro;
            return;
        }
        transitionElapsed += delta;
        double progress = Math.Min(1, transitionElapsed / transitionDuration);
        ApplyPose(ChaseCameraModel.InterpolatePose(transitionStart, transitionDestination, progress));
        if (progress >= 1)
        {
            Mode = IsStreetPreset(ActivePresetId) ? GameplayCameraMode.StreetLook : GameplayCameraMode.OrbitMacro;
            transitionStart = null;
            transitionDestination = null;
        }
    }

    private void AdvanceSwoop(double delta)
    {
        if (!TryGetDesiredChasePose(out CameraPose? destination) || destination is null) return;
        transitionStart ??= CurrentPose();
        transitionElapsed += delta;
        double progress = Math.Min(1, transitionElapsed / transitionDuration);
        ApplyPose(ChaseCameraModel.InterpolatePose(transitionStart, destination, progress));
        if (progress >= 1)
        {
            Mode = GameplayCameraMode.ChaseMicro;
        }
    }

    private void AdvanceChase(double delta)
    {
        if (!TryGetDesiredChasePose(out CameraPose? desired) || desired is null) return;
        double cameraWeight = Math.Min(1, delta * 9.5);
        double targetWeight = Math.Min(1, cameraWeight * 1.25);
        var smoothed = new CameraPose(
            CameraVector3.Lerp(ToCamera(camera!.GlobalPosition), desired.Position, cameraWeight),
            CameraVector3.Lerp(ToCamera(lookAt), desired.LookAt, targetWeight));
        ApplyPose(smoothed);
        GameplayCameraTargetSnapshot target = CurrentTarget();
        double targetFov = ChaseCameraModel.GetTargetFieldOfView(
            target.SpeedMetersPerSecond,
            target.Type == CameraTargetTypes.Aircraft);
        camera.Fov = (float)ChaseCameraModel.SmoothFieldOfView(camera.Fov, targetFov, delta);
    }

    private bool TryGetDesiredChasePose(out CameraPose? pose)
    {
        try
        {
            pose = ResolveChasePose(CurrentTarget());
            return true;
        }
        catch (ArgumentException)
        {
            pose = null;
            return false;
        }
        catch (InvalidOperationException)
        {
            pose = null;
            return false;
        }
    }

    private CameraPose ResolveChasePose(GameplayCameraTargetSnapshot target)
    {
        CameraPose desired = ChaseCameraModel.GetDesiredPose(new ChaseCameraRequest
        {
            TargetPosition = ToCamera(target.Position),
            Type = target.Type,
            Speed = target.SpeedMetersPerSecond,
            MeshHeading = target.PlanarHeading,
            HasPhysicsVehicle = target.HasPhysicsVehicle,
            UserControlled = target.UserControlled,
            ChaseYaw = chaseYaw,
            ChasePitch = chasePitch,
        });
        Vector3 desiredPosition = ToGodot(desired.Position);
        Vector3 away = desiredPosition - target.Position;
        away.Y = 0;
        if (!away.IsZeroApprox()) away = away.Normalized();
        if (!worldCamera!.TryResolve(
            desiredPosition,
            new CameraClearanceOptions
            {
                PreferredDirection = ToCamera(away),
                Radius = 0.8,
                TerrainClearance = 0.8,
                MaximumSearchRadius = Math.Max(18, desiredPosition.DistanceTo(target.Position) * 1.5),
                IgnoredIds = new HashSet<string>([target.StableId], StringComparer.Ordinal),
            },
            out Vector3 resolved))
        {
            throw new InvalidOperationException("No safe chase-camera origin is available.");
        }
        return desired with { Position = ToCamera(resolved) };
    }

    private void Orbit(double yawDelta, double pitchDelta)
    {
        Vector3 offset = camera!.GlobalPosition - lookAt;
        double distance = Math.Clamp(offset.Length(), 5, 350);
        double yaw = Math.Atan2(offset.X, offset.Z) + yawDelta;
        double pitch = Math.Asin(Math.Clamp(offset.Y / distance, -1, 1));
        pitch = Math.Clamp(pitch + pitchDelta, MinimumOrbitPitch, MaximumOrbitPitch);
        double horizontal = distance * Math.Cos(pitch);
        Vector3 desired = lookAt + new Vector3(
            (float)(Math.Sin(yaw) * horizontal),
            (float)(Math.Sin(pitch) * distance),
            (float)(Math.Cos(yaw) * horizontal));
        if (worldCamera!.TryResolve(desired, new CameraClearanceOptions
        {
            PreferredDirection = ToCamera(desired - lookAt),
            MaximumSearchRadius = 40,
        }, out Vector3 resolved))
        {
            camera.GlobalPosition = resolved;
            camera.LookAt(lookAt, Vector3.Up);
        }
        ActivePresetId = null;
    }

    private void ConstrainBasePose(bool levelTarget)
    {
        double terrain = worldCamera!.GetSurfaceHeight(camera!.GlobalPosition.X, camera.GlobalPosition.Z);
        CameraGroundConstraintResult constrained = CameraGroundConstraintModel.Constrain(
            ToCamera(camera.GlobalPosition),
            ToCamera(lookAt),
            terrain,
            levelTarget: levelTarget,
            fallbackForward: ToCamera(-camera.GlobalBasis.Z));
        camera.GlobalPosition = ToGodot(constrained.Position);
        lookAt = ToGodot(constrained.Target);
        camera.LookAt(lookAt, Vector3.Up);
    }

    private void AdvanceShake(double delta)
    {
        if (shakeIntensity <= 0)
        {
            appliedShakeOffset = Vector3.Zero;
            return;
        }
        shakeSample++;
        float scale = (float)(shakeIntensity * 0.75);
        appliedShakeOffset = new Vector3(
            SampleShake(shakeSample, 0) * scale,
            SampleShake(shakeSample, 1) * scale,
            SampleShake(shakeSample, 2) * scale);
        double minimumY = worldCamera!.GetSurfaceHeight(
            camera!.GlobalPosition.X + appliedShakeOffset.X,
            camera.GlobalPosition.Z + appliedShakeOffset.Z) + CameraGroundConstraintModel.GroundClearance;
        if (camera.GlobalPosition.Y + appliedShakeOffset.Y < minimumY)
        {
            appliedShakeOffset.Y = (float)(minimumY - camera.GlobalPosition.Y);
        }
        camera.GlobalPosition += appliedShakeOffset;
        shakeIntensity *= Math.Pow(0.1, delta);
        if (shakeIntensity < 0.01) shakeIntensity = 0;
    }

    private void RemoveAppliedShake()
    {
        if (camera is null || !camera.IsInsideTree() || appliedShakeOffset.IsZeroApprox()) return;
        camera.GlobalPosition -= appliedShakeOffset;
        appliedShakeOffset = Vector3.Zero;
    }

    private void ReleaseFollowInternal(bool countRelease)
    {
        followTarget = null;
        transitionStart = null;
        transitionDestination = null;
        transitionElapsed = 0;
        chaseYaw = 0;
        chasePitch = 0;
        Mode = GameplayCameraMode.OrbitMacro;
        ActivePresetId = null;
        camera!.Fov = (float)ChaseCameraModel.DefaultFieldOfView;
        if (countRelease) FollowReleaseCount++;
    }

    private GameplayCameraTargetSnapshot CurrentTarget()
    {
        GameplayCameraTargetSnapshot snapshot = followTarget?.CaptureCameraTarget()
            ?? throw new InvalidOperationException("Chase camera has no follow target.");
        ValidateTarget(snapshot);
        return snapshot;
    }

    private CameraPose CurrentPose(Vector3? target = null) =>
        new(ToCamera(camera!.GlobalPosition), ToCamera(target ?? lookAt));

    private void ApplyPose(CameraPose pose)
    {
        camera!.GlobalPosition = ToGodot(pose.Position);
        lookAt = ToGodot(pose.LookAt);
        camera.LookAt(lookAt, Vector3.Up);
    }

    private static void ValidateTarget(GameplayCameraTargetSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (string.IsNullOrWhiteSpace(snapshot.StableId)
            || snapshot.Type is not CameraTargetTypes.Pedestrian and not CameraTargetTypes.Vehicle and not CameraTargetTypes.Aircraft
            || !snapshot.Position.IsFinite()
            || !double.IsFinite(snapshot.PlanarHeading)
            || !double.IsFinite(snapshot.SpeedMetersPerSecond))
        {
            throw new ArgumentException("Camera target snapshot is invalid.", nameof(snapshot));
        }
    }

    private static double Slot(RuntimeInputSnapshot snapshot, string action, int index) =>
        snapshot.Actions.GetValueOrDefault(RuntimeInputActionIds.Slot(action, index));

    private static bool IsStreetPreset(string? id) => id is "ground" or "street";

    private static float SampleShake(ulong sample, uint axis)
    {
        ulong value = sample * 0x9e3779b97f4a7c15UL + (axis + 1) * 0xbf58476d1ce4e5b9UL;
        value ^= value >> 30;
        value *= 0xbf58476d1ce4e5b9UL;
        value ^= value >> 27;
        value *= 0x94d049bb133111ebUL;
        value ^= value >> 31;
        return (float)((value >> 40) / (double)(1UL << 24) * 2 - 1);
    }

    private static CameraVector3 ToCamera(Vector3 value) => new(value.X, value.Y, value.Z);

    private static Vector3 ToGodot(CameraVector3 value) => new((float)value.X, (float)value.Y, (float)value.Z);

    private void EnsureInitialized()
    {
        if (!Initialized)
        {
            throw new InvalidOperationException("The gameplay camera rig is not initialized.");
        }
    }
}

using Godot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Player;

public sealed record PlayerPedestrianSnapshot(
    Vector3 Position,
    Vector3 Velocity,
    float Heading,
    Vector3 LastSupportedPosition,
    PedestrianAnimationState AnimationState,
    bool Controlled,
    PedestrianKnockdownState? KnockdownState,
    int KnockdownCount);

/// <summary>Session-owned player avatar. Velocity remains meters/second and MoveAndSlide owns integration.</summary>
public partial class PlayerPedestrianController : CharacterBody3D, IGameplayCameraTarget
{
    public const int PedestrianPhysicsPriority = -900;
    public const string StablePedestrianId = "player-pedestrian";
    private const float CapsuleRadius = 0.38f;
    private const float CapsuleHeight = 1.8f;
    private const float SupportedPoseClearance = 0.95f;

    private RuntimeInputHost? input;
    private MvpWorldGenerator? world;
    private Node3D? cameraOrigin;
    private CollisionShape3D? collisionShape;
    private Node3D? visualRoot;
    private AnimationPlayer? animationPlayer;
    private Vector3 lastSupportedPosition;
    private float heading;
    private PedestrianKnockdownState? knockdownState;

    public bool Initialized { get; private set; }

    public bool Controlled { get; private set; }

    public PedestrianAnimationState AnimationState { get; private set; } = PedestrianAnimationState.Idle;

    public long PhysicsMoveCount { get; private set; }

    public int RecoveryCount { get; private set; }

    public int KnockdownCount { get; private set; }

    public bool KnockedDown => knockdownState?.Active == true;

    public Vector3 LastSupportedPosition => lastSupportedPosition;

    public float MaximumStepHeight => (float)PedestrianLocomotionModel.DefaultConfig.MaximumStepHeight;

    public AnimationPlayer AnimationAuthority => animationPlayer
        ?? throw new InvalidOperationException("Pedestrian animations are not initialized.");

    public void Initialize(RuntimeInputHost inputHost, MvpWorldGenerator worldOwner, Node3D cameraControlOrigin)
    {
        if (Initialized) throw new InvalidOperationException("Player pedestrian is already initialized.");
        input = inputHost ?? throw new ArgumentNullException(nameof(inputHost));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        cameraOrigin = cameraControlOrigin ?? throw new ArgumentNullException(nameof(cameraControlOrigin));

        MotionMode = MotionModeEnum.Grounded;
        UpDirection = Vector3.Up;
        FloorMaxAngle = Mathf.DegToRad((float)PedestrianLocomotionModel.DefaultConfig.MaximumSlopeDegrees);
        FloorSnapLength = MaximumStepHeight;
        FloorStopOnSlope = true;
        FloorConstantSpeed = false;
        MaxSlides = 8;
        SafeMargin = 0.02f;
        CollisionLayer = (uint)(MetroPulse.Domain.Simulation.CollisionLayer.Player
            | MetroPulse.Domain.Simulation.CollisionLayer.Pedestrian);
        CollisionMask = (uint)CollisionMasks.Pedestrian;
        ProcessPhysicsPriority = PedestrianPhysicsPriority;

        BuildBody();
        SetPhysicsProcess(true);
        Initialized = true;
        SetControlled(false);
    }

    public void SpawnAt(Vector3 desiredPosition, float desiredHeading = 0)
    {
        EnsureInitialized();
        MvpWorldGenerator worldOwner = world!;
        double surface = worldOwner.Surface.GetTerrainHeight(desiredPosition.X, desiredPosition.Z);
        Vector3 safe = new(desiredPosition.X, (float)surface + SupportedPoseClearance, desiredPosition.Z);
        GlobalPosition = safe;
        lastSupportedPosition = safe;
        heading = float.IsFinite(desiredHeading) ? desiredHeading : 0;
        visualRoot!.Rotation = new Vector3(0, heading, 0);
        Velocity = Vector3.Zero;
        knockdownState = null;
        visualRoot!.Rotation = new Vector3(0, heading, 0);
        ResetPhysicsInterpolation();
    }

    public void SetControlled(bool controlled)
    {
        EnsureInitialized(allowInitializing: true);
        Controlled = controlled;
        Visible = controlled;
        if (collisionShape is not null) collisionShape.Disabled = !controlled;
        if (!controlled)
        {
            Velocity = Vector3.Zero;
            SetAnimation(PedestrianAnimationState.Idle);
        }
    }

    public PlayerPedestrianSnapshot CaptureState() => new(
        GlobalPosition,
        Velocity,
        heading,
        lastSupportedPosition,
        AnimationState,
        Controlled,
        knockdownState,
        KnockdownCount);

    public void RestoreState(PlayerPedestrianSnapshot snapshot)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(snapshot);
        GlobalPosition = snapshot.Position;
        Velocity = snapshot.Velocity;
        heading = snapshot.Heading;
        lastSupportedPosition = snapshot.LastSupportedPosition;
        knockdownState = snapshot.KnockdownState;
        KnockdownCount = snapshot.KnockdownCount;
        visualRoot!.Rotation = new Vector3(0, heading, 0);
        SetControlled(snapshot.Controlled);
        SetAnimation(snapshot.AnimationState);
        ResetPhysicsInterpolation();
    }

    public void ApplyVehicleImpact(Vector3 direction, double impactSpeed)
    {
        EnsureInitialized();
        knockdownState = PedestrianKnockdownModel.Start(
            ToPedestrianVector(GlobalPosition),
            ToPedestrianVector(direction),
            impactSpeed,
            fallSideSample: 0.25,
            tumbleSample: 0.5);
        KnockdownCount++;
        Velocity = Vector3.Zero;
        SetAnimation(PedestrianAnimationState.Fall);
    }

    public GameplayCameraTargetSnapshot CaptureCameraTarget()
    {
        EnsureInitialized();
        return new GameplayCameraTargetSnapshot(
            StablePedestrianId,
            CameraTargetTypes.Pedestrian,
            GlobalPosition,
            heading,
            new Vector2(Velocity.X, Velocity.Z).Length(),
            HasPhysicsVehicle: false,
            UserControlled: Controlled);
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized || !Controlled || input is null || world is null) return;
        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        if (snapshot.Suspended || snapshot.Context != ControlContexts.Pedestrian) return;
        if (knockdownState?.Active == true)
        {
            AdvanceKnockdown(delta);
            return;
        }

        bool groundedBeforeMove = IsOnFloor();
        Vector2 inputVector = ReadMovement(snapshot);
        Vector3 worldDirection = CameraRelativeDirection(inputVector);
        bool sprint = snapshot.Actions.GetValueOrDefault("SPRINT") > RuntimeInputState.PressedThreshold;
        bool jump = snapshot.JustPressed.Contains("JUMP");
        PedestrianPlanarVelocity planar = PedestrianLocomotionModel.AdvancePlanarVelocity(
            new PedestrianPlanarVelocity(Velocity.X, Velocity.Z),
            new PedestrianPlanarVelocity(worldDirection.X, worldDirection.Z),
            sprint,
            groundedBeforeMove,
            delta);
        double vertical = PedestrianLocomotionModel.AdvanceVerticalVelocity(
            Velocity.Y,
            groundedBeforeMove,
            jump,
            delta);

        // CharacterBody3D expects meters/second here. MoveAndSlide performs the physics integration.
        Velocity = new Vector3((float)planar.X, (float)vertical, (float)planar.Z);
        ApplyStepAssist(delta);
        MoveAndSlide();
        PhysicsMoveCount++;

        if (planar.Length > 0.15)
        {
            heading = Mathf.Atan2((float)planar.X, (float)planar.Z);
            visualRoot!.Rotation = new Vector3(0, heading, 0);
        }
        SetAnimation(PedestrianLocomotionModel.ClassifyAnimation(
            planar.Length,
            Velocity.Y,
            IsOnFloor(),
            sprint));
        UpdateSupportedPose();
        _ = RecoverIfUnsafe();
    }

    public bool RecoverIfUnsafe()
    {
        EnsureInitialized();
        Vector3 position = GlobalPosition;
        bool unsafePose = PedestrianLocomotionModel.RequiresRecovery(
            new PedestrianVector3(position.X, position.Y - SupportedPoseClearance, position.Z),
            world!.Surface.IsWithinWorldBounds,
            world.Surface.IsWater);
        if (!unsafePose) return false;
        GlobalPosition = lastSupportedPosition;
        Velocity = Vector3.Zero;
        RecoveryCount++;
        SetAnimation(PedestrianAnimationState.Idle);
        ResetPhysicsInterpolation();
        return true;
    }

    public override void _ExitTree()
    {
        SetPhysicsProcess(false);
        input = null;
        world = null;
        cameraOrigin = null;
        Initialized = false;
    }

    private void BuildBody()
    {
        collisionShape = new CollisionShape3D
        {
            Name = "Collision",
            Shape = new CapsuleShape3D { Radius = CapsuleRadius, Height = CapsuleHeight },
        };
        AddChild(collisionShape);

        visualRoot = new Node3D { Name = "VisualRoot" };
        AddChild(visualRoot);
        var mesh = new MeshInstance3D
        {
            Name = "Body",
            Mesh = new CapsuleMesh { Radius = CapsuleRadius, Height = CapsuleHeight },
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = Color.FromHtml("3cb6ff"),
                Roughness = 0.72f,
            },
        };
        visualRoot.AddChild(mesh);
        animationPlayer = new AnimationPlayer { Name = "AnimationPlayer" };
        AddChild(animationPlayer);
        animationPlayer.AddAnimationLibrary(string.Empty, CreateAnimationLibrary());
    }

    private static AnimationLibrary CreateAnimationLibrary()
    {
        var library = new AnimationLibrary();
        library.AddAnimation("idle", BobAnimation(0.02f, 1.4f));
        library.AddAnimation("walk", BobAnimation(0.06f, 0.55f));
        library.AddAnimation("sprint", BobAnimation(0.1f, 0.32f));
        library.AddAnimation("jump", TiltAnimation(-0.12f));
        library.AddAnimation("fall", TiltAnimation(0.12f));
        return library;
    }

    private static Animation BobAnimation(float height, float length)
    {
        var animation = new Animation { Length = length, LoopMode = Animation.LoopModeEnum.Linear };
        int track = animation.AddTrack(Animation.TrackType.Value);
        animation.TrackSetPath(track, new NodePath("VisualRoot:position:y"));
        animation.TrackInsertKey(track, 0, 0f);
        animation.TrackInsertKey(track, length * 0.5, height);
        animation.TrackInsertKey(track, length, 0f);
        return animation;
    }

    private static Animation TiltAnimation(float angle)
    {
        var animation = new Animation { Length = 0.2f };
        int track = animation.AddTrack(Animation.TrackType.Value);
        animation.TrackSetPath(track, new NodePath("VisualRoot:rotation:x"));
        animation.TrackInsertKey(track, 0, angle);
        return animation;
    }

    private void SetAnimation(PedestrianAnimationState state)
    {
        if (animationPlayer is null) return;
        AnimationState = state;
        string name = state.ToString().ToLowerInvariant();
        if (animationPlayer.CurrentAnimation != name) animationPlayer.Play(name);
    }

    private Vector2 ReadMovement(RuntimeInputSnapshot snapshot)
    {
        double forward = Slot(snapshot, 0) - Slot(snapshot, 1) + Slot(snapshot, 4) - Slot(snapshot, 5);
        double right = Slot(snapshot, 3) - Slot(snapshot, 2) + Slot(snapshot, 7) - Slot(snapshot, 6);
        Vector2 keyboard = new((float)right, (float)forward);
        Vector2 gamepad = new((float)snapshot.LeftStick.X, (float)-snapshot.LeftStick.Y);
        Vector2 result = keyboard.LengthSquared() >= gamepad.LengthSquared() ? keyboard : gamepad;
        return result.LimitLength(1);
    }

    private Vector3 CameraRelativeDirection(Vector2 movement)
    {
        Basis basis = cameraOrigin!.GlobalBasis;
        Vector3 forward = -basis.Z;
        forward.Y = 0;
        forward = forward.Normalized();
        Vector3 right = basis.X;
        right.Y = 0;
        right = right.Normalized();
        return ((forward * movement.Y) + (right * movement.X)).Normalized();
    }

    private void ApplyStepAssist(double delta)
    {
        if (!IsOnFloor()) return;
        Vector3 planarMotion = new(Velocity.X * (float)delta, 0, Velocity.Z * (float)delta);
        if (planarMotion.LengthSquared() < 0.000001f || !TestMove(GlobalTransform, planarMotion)) return;
        Vector3 step = Vector3.Up * MaximumStepHeight;
        Transform3D raised = GlobalTransform;
        raised.Origin += step;
        if (TestMove(GlobalTransform, step) || TestMove(raised, planarMotion)) return;
        GlobalPosition += step;
    }

    private void UpdateSupportedPose()
    {
        if (!IsOnFloor()) return;
        Vector3 position = GlobalPosition;
        if (!world!.Surface.IsWithinWorldBounds(position.X, position.Z)
            || world.Surface.IsWater(position.X, position.Y - SupportedPoseClearance, position.Z)) return;
        lastSupportedPosition = position;
    }

    private void AdvanceKnockdown(double delta)
    {
        PedestrianKnockdownState state = PedestrianKnockdownModel.Update(
            knockdownState!,
            delta,
            (x, z) => world!.Surface.GetTerrainHeight(x, z) + SupportedPoseClearance);
        knockdownState = state;
        GlobalPosition = ToGodotVector(state.Position);
        Velocity = ToGodotVector(state.Velocity);
        visualRoot!.Rotation = new Vector3((float)state.RotationX, heading, (float)state.RotationZ);
        PhysicsMoveCount++;
        if (state.Active) return;
        Velocity = Vector3.Zero;
        visualRoot.Rotation = new Vector3(0, heading, 0);
        lastSupportedPosition = GlobalPosition;
        SetAnimation(PedestrianAnimationState.Idle);
        ResetPhysicsInterpolation();
    }

    private static PedestrianVector3 ToPedestrianVector(Vector3 value) => new(value.X, value.Y, value.Z);

    private static Vector3 ToGodotVector(PedestrianVector3 value) => new((float)value.X, (float)value.Y, (float)value.Z);

    private static double Slot(RuntimeInputSnapshot snapshot, int index) =>
        snapshot.Actions.GetValueOrDefault(RuntimeInputActionIds.Slot("MOVE", index));

    private void EnsureInitialized(bool allowInitializing = false)
    {
        if (!Initialized && !(allowInitializing && input is not null))
        {
            throw new InvalidOperationException("Player pedestrian is not initialized.");
        }
    }
}

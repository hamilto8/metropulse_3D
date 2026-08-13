using Godot;
using MetroPulse.Domain.Aircraft;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Aircraft;

/// <summary>Owns the independently gated airfield, aircraft, interaction, and cleanup lifecycle.</summary>
public partial class AircraftRuntime : Node
{
    private readonly List<string> colliderIds = [];
    private MvpWorldGenerator world = null!;
    private PlayerControlRuntime player = null!;
    private GodotSessionRuntimeHost runtime = null!;
    private RuntimeInputHost input = null!;
    private PlayerInterface playerInterface = null!;
    private Node3D featureRoot = null!;
    private bool interactHeld;
    private bool resetHeld;

    public bool Initialized { get; private set; }
    public AircraftActor Aircraft { get; private set; } = null!;
    public int BaselineColliderCount { get; private set; }
    public int OwnedNodeCount => featureRoot.GetChildCount() + 1;

    public void Initialize(
        MvpWorldGenerator worldOwner,
        GameContentRegistry content,
        PlayerControlRuntime playerOwner,
        GodotSessionRuntimeHost runtimeOwner,
        RuntimeInputHost inputOwner,
        SessionAudioRuntime audio,
        PlayerInterface interfaceOwner,
        Node3D agentRoot)
    {
        if (Initialized) throw new InvalidOperationException("The aircraft runtime is already initialized.");
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        player = playerOwner ?? throw new ArgumentNullException(nameof(playerOwner));
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        input = inputOwner ?? throw new ArgumentNullException(nameof(inputOwner));
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        BaselineColliderCount = world.Colliders.Count;
        featureRoot = new Node3D { Name = "NorthwindMunicipalAirfield" };
        AddChild(featureRoot);
        BuildAirfield();
        Aircraft = new AircraftActor { Name = "NorthwindSparrow" };
        agentRoot.AddChild(Aircraft);
        Aircraft.Initialize(world, content, input, audio, playerInterface);
        player.AttachAircraft(Aircraft);
        ProcessPhysicsPriority = -800;
        Initialized = true;
        SetPhysicsProcess(true);
    }

    public override void _PhysicsProcess(double delta)
    {
        if (!Initialized) return;
        bool live = runtime.StateMachine.State == GameState.StreetVehicle
            && player.ControlledKind == ControlKind.Aircraft;
        Aircraft.Advance(live ? delta : 0);
        RuntimeInputSnapshot snapshot = input.LatestSnapshot;
        bool interact = snapshot.Actions.GetValueOrDefault("INTERACT") >= RuntimeInputState.PressedThreshold;
        bool reset = snapshot.Actions.GetValueOrDefault("AIR_RESET") >= RuntimeInputState.PressedThreshold;
        if (interact && !interactHeld)
        {
            if (player.ControlledKind == ControlKind.Pedestrian) _ = TryBoard();
            else if (player.ControlledKind == ControlKind.Aircraft) _ = TryExit();
        }
        if (reset && !resetHeld && player.ControlledKind == ControlKind.Aircraft) Aircraft.ResetToRunway();
        interactHeld = interact;
        resetHeld = reset;
    }

    public bool TryBoard()
    {
        if (!Initialized || !player.PrepareAircraftEntry()) return false;
        try
        {
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("aircraft:board", Name));
            playerInterface.Announce("Pilot boarded Northwind Sparrow. Cleared for runway 36.");
            return player.ControlledKind == ControlKind.Aircraft;
        }
        catch
        {
            return false;
        }
    }

    public bool TryExit()
    {
        VehicleExitRequestResult exit = player.RequestAircraftExit();
        if (!exit.Allowed)
        {
            playerInterface.Announce("Land and stop the aircraft before leaving the cockpit.", true);
            return false;
        }
        try
        {
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("aircraft:exit", Name));
            playerInterface.Announce("Pilot exited the Northwind Sparrow and resumed walk control.");
            return player.ControlledKind == ControlKind.Pedestrian;
        }
        catch
        {
            return false;
        }
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetPhysicsProcess(false);
        Aircraft.Shutdown();
        if (GodotObject.IsInstanceValid(Aircraft)) Aircraft.QueueFree();
        foreach (string id in colliderIds) world.Colliders.Unregister(id);
        colliderIds.Clear();
        if (GodotObject.IsInstanceValid(featureRoot)) featureRoot.QueueFree();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void BuildAirfield()
    {
        AirfieldLayout layout = AircraftLandingSurfaceModel.DefaultAirfieldLayout;
        AddBox("airfield-ground", new Vector3(-107, -0.04f, -260), new Vector3(178, 0.08f, 244), new Color("29483d"), surface: true);
        AddBox("airfield-runway", new Vector3((float)layout.CenterX, 0.12f, (float)layout.CenterZ), new Vector3((float)layout.RunwayWidth, 0.24f, (float)layout.RunwayLength), new Color("171c26"), surface: true);
        AddBox("airfield-apron", new Vector3(-160, 0.08f, -270), new Vector3(60, 0.16f, 80), new Color("46566a"), surface: true);
        AddBox("airfield-hangar", new Vector3(-165, 6.05f, -277), new Vector3(38, 12, 28), new Color("33465e"), obstacle: true);
        AddBox("airfield-tower", new Vector3(-48, 11.5f, -300), new Vector3(14, 23, 14), new Color("56677d"), obstacle: true);
        AddBox("airfield-fuel-depot", new Vector3(-48, 3.6f, -350), new Vector3(14, 7, 5), new Color("cbd5e1"), obstacle: true);
        for (int index = 0; index < 9; index++)
        {
            AddBox($"airfield-centerline-{index}", new Vector3(-105, 0.255f, -340 + index * 20), new Vector3(0.8f, 0.03f, 8), new Color("f8fafc"));
        }
    }

    private void AddBox(string id, Vector3 position, Vector3 size, Color color, bool surface = false, bool obstacle = false)
    {
        var owner = new Node3D { Name = id, Position = position };
        var mesh = new MeshInstance3D
        {
            Name = "Visual",
            Mesh = new BoxMesh { Size = size },
            MaterialOverride = new StandardMaterial3D { AlbedoColor = color, Roughness = 0.82f },
        };
        owner.AddChild(mesh);
        featureRoot.AddChild(owner);
        if (!surface && !obstacle) return;
        CollisionLayer layer = obstacle ? CollisionLayer.StaticObstacle : CollisionLayer.Surface;
        CollisionLayer mask = obstacle ? CollisionMasks.StaticObstacle : CollisionMasks.Surface;
        var body = new StaticBody3D { Name = "Collision", CollisionLayer = (uint)layer, CollisionMask = (uint)mask };
        body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size } });
        owner.AddChild(body);
        world.Colliders.Register(new WorldColliderMetadata(id, "Aircraft", obstacle ? "airfield-obstacle" : "airfield-surface", layer, mask, position, size, 0, body));
        colliderIds.Add(id);
    }
}

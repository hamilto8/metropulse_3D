using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Content;

public abstract record CanonicalDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("sourceRevision")]
    public string? SourceRevision { get; init; }
}

public sealed record VehicleProfileDocument : CanonicalDocument
{
    [JsonPropertyName("contentIds")]
    public IReadOnlyList<string>? ContentIds { get; init; }

    [JsonPropertyName("records")]
    public IReadOnlyDictionary<string, VehicleProfileRecord>? Records { get; init; }
}

public sealed record VehicleProfileRecord
{
    [JsonPropertyName("profile")]
    public VehicleProfile? Profile { get; init; }

    [JsonPropertyName("physicsLayout")]
    public VehiclePhysicsLayout? PhysicsLayout { get; init; }
}

public sealed record VehicleProfile
{
    [JsonPropertyName("mass")]
    public double Mass { get; init; } = double.NaN;

    [JsonPropertyName("width")]
    public double Width { get; init; } = double.NaN;

    [JsonPropertyName("height")]
    public double Height { get; init; } = double.NaN;

    [JsonPropertyName("length")]
    public double Length { get; init; } = double.NaN;

    [JsonPropertyName("wheelCount")]
    public int WheelCount { get; init; }

    [JsonPropertyName("wheelRadius")]
    public double WheelRadius { get; init; } = double.NaN;

    [JsonPropertyName("suspensionRestLength")]
    public double SuspensionRestLength { get; init; } = double.NaN;

    [JsonPropertyName("suspensionStiffness")]
    public double SuspensionStiffness { get; init; } = double.NaN;

    [JsonPropertyName("maxSuspensionForce")]
    public double MaxSuspensionForce { get; init; } = double.NaN;

    [JsonPropertyName("drive")]
    public VehicleDriveProfile? Drive { get; init; }

    [JsonPropertyName("playerDynamics")]
    public PlayerVehicleDynamics? PlayerDynamics { get; init; }
}

public sealed record VehicleDriveProfile
{
    [JsonPropertyName("forwardEngineForce")]
    public double ForwardEngineForce { get; init; } = double.NaN;

    [JsonPropertyName("reverseEngineForce")]
    public double ReverseEngineForce { get; init; } = double.NaN;

    [JsonPropertyName("maxBrakeForce")]
    public double MaxBrakeForce { get; init; } = double.NaN;

    [JsonPropertyName("maxSteering")]
    public double MaxSteering { get; init; } = double.NaN;

    [JsonPropertyName("maxForwardSpeed")]
    public double MaxForwardSpeed { get; init; } = double.NaN;

    [JsonPropertyName("maxReverseSpeed")]
    public double MaxReverseSpeed { get; init; } = double.NaN;
}

public sealed record PlayerVehicleDynamics
{
    [JsonPropertyName("drivenAxle")]
    public string? DrivenAxle { get; init; }

    [JsonPropertyName("downforceFactor")]
    public double DownforceFactor { get; init; } = double.NaN;

    [JsonPropertyName("lateralGripFactor")]
    public double LateralGripFactor { get; init; } = double.NaN;

    [JsonPropertyName("angularDamping")]
    public double AngularDamping { get; init; } = double.NaN;

    [JsonPropertyName("angularFactor")]
    public Vector3Definition? AngularFactor { get; init; }

    [JsonPropertyName("rollInfluence")]
    public double RollInfluence { get; init; } = double.NaN;

    [JsonPropertyName("wheelTrackFactor")]
    public double WheelTrackFactor { get; init; } = double.NaN;

    [JsonPropertyName("visualLeanFactor")]
    public double VisualLeanFactor { get; init; } = double.NaN;
}

public sealed record VehiclePhysicsLayout
{
    [JsonPropertyName("wheelCount")]
    public int WheelCount { get; init; }

    [JsonPropertyName("wheelConnectionY")]
    public double WheelConnectionY { get; init; } = double.NaN;

    [JsonPropertyName("settledRideHeight")]
    public double SettledRideHeight { get; init; } = double.NaN;

    [JsonPropertyName("chassisShapeOffsetY")]
    public double ChassisShapeOffsetY { get; init; } = double.NaN;

    [JsonPropertyName("chassisGroundClearance")]
    public double ChassisGroundClearance { get; init; } = double.NaN;
}

public sealed record PedestrianArchetypeDocument : CanonicalDocument
{
    [JsonPropertyName("sequence")]
    public IReadOnlyList<string>? Sequence { get; init; }

    [JsonPropertyName("records")]
    public IReadOnlyDictionary<string, PedestrianArchetypeDefinition>? Records { get; init; }
}

public sealed record PedestrianArchetypeDefinition
{
    [JsonPropertyName("label")]
    public string? Label { get; init; }

    [JsonPropertyName("maxSpeed")]
    public double MaxSpeed { get; init; } = double.NaN;

    [JsonPropertyName("activity")]
    public string? Activity { get; init; }

    [JsonPropertyName("mood")]
    public string? Mood { get; init; }

    [JsonPropertyName("colors")]
    public IReadOnlyList<int>? Colors { get; init; }

    [JsonPropertyName("hair")]
    public IReadOnlyList<string>? Hair { get; init; }

    [JsonPropertyName("accessory")]
    public string? Accessory { get; init; }
}

public sealed record CameraPresetDocument : CanonicalDocument
{
    [JsonPropertyName("records")]
    public IReadOnlyDictionary<string, CameraPresetDefinition>? Records { get; init; }
}

public sealed record CameraPresetDefinition
{
    [JsonPropertyName("pos")]
    public IReadOnlyList<double>? Position { get; init; }

    [JsonPropertyName("target")]
    public IReadOnlyList<double>? Target { get; init; }
}

public sealed record SuspensionBridgeDocument : CanonicalDocument
{
    [JsonPropertyName("layout")]
    public SuspensionBridgeLayout? Layout { get; init; }

    [JsonPropertyName("cableSamples")]
    public IReadOnlyList<BridgeCableSample>? CableSamples { get; init; }
}

public sealed record SuspensionBridgeLayout
{
    [JsonPropertyName("deckStartX")]
    public double DeckStartX { get; init; } = double.NaN;

    [JsonPropertyName("deckEndX")]
    public double DeckEndX { get; init; } = double.NaN;

    [JsonPropertyName("centerX")]
    public double CenterX { get; init; } = double.NaN;

    [JsonPropertyName("deckWidth")]
    public double DeckWidth { get; init; } = double.NaN;

    [JsonPropertyName("cableZ")]
    public double CableZ { get; init; } = double.NaN;

    [JsonPropertyName("westTowerX")]
    public double WestTowerX { get; init; } = double.NaN;

    [JsonPropertyName("eastTowerX")]
    public double EastTowerX { get; init; } = double.NaN;

    [JsonPropertyName("towerCableY")]
    public double TowerCableY { get; init; } = double.NaN;

    [JsonPropertyName("centerCableY")]
    public double CenterCableY { get; init; } = double.NaN;

    [JsonPropertyName("anchorCableY")]
    public double AnchorCableY { get; init; } = double.NaN;

    [JsonPropertyName("sideSpanSag")]
    public double SideSpanSag { get; init; } = double.NaN;

    [JsonPropertyName("hangerDeckY")]
    public double HangerDeckY { get; init; } = double.NaN;

    [JsonPropertyName("hangerSpacing")]
    public double HangerSpacing { get; init; } = double.NaN;
}

public sealed record BridgeCableSample
{
    [JsonPropertyName("x")]
    public double X { get; init; } = double.NaN;

    [JsonPropertyName("height")]
    public double Height { get; init; } = double.NaN;
}

public sealed record Vector3Definition
{
    [JsonPropertyName("x")]
    public double X { get; init; } = double.NaN;

    [JsonPropertyName("y")]
    public double Y { get; init; } = double.NaN;

    [JsonPropertyName("z")]
    public double Z { get; init; } = double.NaN;
}

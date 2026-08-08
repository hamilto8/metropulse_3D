using System.Collections.Frozen;

namespace MetroPulse.Domain.Content;

public static partial class CanonicalContentValidator
{
    private static readonly FrozenSet<string> DrivenAxles =
        new[] { "all", "rear" }.ToFrozenSet(StringComparer.Ordinal);

    public static void ValidateVehicleProfiles(VehicleProfileDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "vehicle-profiles");
        IReadOnlyList<string> contentIds = RequireRecords(document.ContentIds, "vehicle-content-ids");
        IReadOnlyDictionary<string, VehicleProfileRecord> records = RequireMap(document.Records, "vehicle-profiles");

        if (!contentIds.SequenceEqual(ContentDefinitions.VehicleIds, StringComparer.Ordinal))
        {
            throw Error(
                "must preserve the canonical vehicle ID order.",
                "vehicle-content-ids",
                code: "INVALID_SEQUENCE");
        }
        if (records.Count != contentIds.Count || records.Keys.Any(id => !ContentDefinitions.VehicleIdSet.Contains(id)))
        {
            throw Error(
                "must contain exactly one profile for every vehicle content ID.",
                "vehicle-profiles",
                code: "INVALID_RECORD_SET");
        }

        foreach (string id in contentIds)
        {
            if (!records.TryGetValue(id, out VehicleProfileRecord? record))
            {
                throw Error($"is missing vehicle profile {id}.", "vehicle-profiles", id, code: "MISSING_REFERENCE");
            }
            if (record.Profile is null)
            {
                throw Error("must be an object.", "vehicle-profiles", id, "profile");
            }
            if (record.PhysicsLayout is null)
            {
                throw Error("must be an object.", "vehicle-profiles", id, "physicsLayout");
            }

            ValidateVehicleProfile(id, record.Profile);
            ValidateVehiclePhysicsLayout(id, record.Profile, record.PhysicsLayout);
        }
    }

    public static void ValidatePedestrianArchetypes(PedestrianArchetypeDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "pedestrian-archetypes");
        IReadOnlyDictionary<string, PedestrianArchetypeDefinition> records =
            RequireMap(document.Records, "pedestrian-archetypes");
        IReadOnlyList<string> sequence = RequireRecords(document.Sequence, "pedestrian-archetype-sequence");

        foreach ((string id, PedestrianArchetypeDefinition record) in records)
        {
            RequireStableId(id, "pedestrian-archetypes", id, "id");
            RequireString(record.Label, "pedestrian-archetypes", id, "label");
            RequireFinite(record.MaxSpeed, "pedestrian-archetypes", id, "maxSpeed", 0.001);
            RequireString(record.Activity, "pedestrian-archetypes", id, "activity");
            RequireString(record.Mood, "pedestrian-archetypes", id, "mood");
            IReadOnlyList<int> colors = RequireRecords(record.Colors, $"pedestrian-archetypes[{id}].colors");
            for (int index = 0; index < colors.Count; index++)
            {
                RequireFinite(colors[index], "pedestrian-archetypes", id, $"colors[{index}]", 0, 0xffffff);
            }
            IReadOnlyList<string> hair = RequireRecords(record.Hair, $"pedestrian-archetypes[{id}].hair");
            for (int index = 0; index < hair.Count; index++)
            {
                RequireStableId(hair[index], "pedestrian-archetypes", id, $"hair[{index}]");
            }
            if (record.Accessory is not null)
            {
                RequireStableId(record.Accessory, "pedestrian-archetypes", id, "accessory");
            }
        }

        for (int index = 0; index < sequence.Count; index++)
        {
            string id = sequence[index];
            if (!records.ContainsKey(id))
            {
                throw Error(
                    $"references missing pedestrian archetype {id}.",
                    "pedestrian-archetype-sequence",
                    field: $"[{index}]",
                    code: "MISSING_REFERENCE");
            }
        }
        if (records.Keys.Any(id => !sequence.Contains(id, StringComparer.Ordinal)))
        {
            throw Error(
                "must exercise every pedestrian archetype.",
                "pedestrian-archetype-sequence",
                code: "INVALID_SEQUENCE");
        }
    }

    public static void ValidateCameraPresets(CameraPresetDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "camera-presets");
        IReadOnlyDictionary<string, CameraPresetDefinition> records = RequireMap(document.Records, "camera-presets");
        foreach ((string id, CameraPresetDefinition record) in records)
        {
            RequireStableId(id, "camera-presets", id, "id");
            IReadOnlyList<double> position = RequireVector(record.Position, "camera-presets", id, "pos");
            IReadOnlyList<double> target = RequireVector(record.Target, "camera-presets", id, "target");
            if (position.SequenceEqual(target))
            {
                throw Error("must not equal the camera position.", "camera-presets", id, "target");
            }
        }
    }

    public static void ValidateSuspensionBridge(SuspensionBridgeDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "suspension-bridge");
        SuspensionBridgeLayout layout = document.Layout
            ?? throw Error("must be an object.", "suspension-bridge", field: "layout");
        IReadOnlyList<BridgeCableSample> samples =
            RequireRecords(document.CableSamples, "suspension-bridge-cable-samples");

        RequireFinite(layout.DeckStartX, "suspension-bridge", null, "layout.deckStartX");
        RequireFinite(layout.DeckEndX, "suspension-bridge", null, "layout.deckEndX");
        RequireFinite(layout.CenterX, "suspension-bridge", null, "layout.centerX");
        RequireFinite(layout.WestTowerX, "suspension-bridge", null, "layout.westTowerX");
        RequireFinite(layout.EastTowerX, "suspension-bridge", null, "layout.eastTowerX");
        RequireFinite(layout.DeckWidth, "suspension-bridge", null, "layout.deckWidth", 0.001);
        RequireFinite(layout.CableZ, "suspension-bridge", null, "layout.cableZ", 0.001);
        RequireFinite(layout.TowerCableY, "suspension-bridge", null, "layout.towerCableY", 0.001);
        RequireFinite(layout.CenterCableY, "suspension-bridge", null, "layout.centerCableY", 0.001);
        RequireFinite(layout.AnchorCableY, "suspension-bridge", null, "layout.anchorCableY", 0);
        RequireFinite(layout.SideSpanSag, "suspension-bridge", null, "layout.sideSpanSag", 0);
        RequireFinite(layout.HangerDeckY, "suspension-bridge", null, "layout.hangerDeckY");
        RequireFinite(layout.HangerSpacing, "suspension-bridge", null, "layout.hangerSpacing", 0.001);

        if (!(layout.DeckStartX < layout.WestTowerX
            && layout.WestTowerX < layout.CenterX
            && layout.CenterX < layout.EastTowerX
            && layout.EastTowerX < layout.DeckEndX))
        {
            throw Error(
                "must order deck, tower, and center coordinates from west to east.",
                "suspension-bridge",
                field: "layout",
                code: "INVALID_GEOMETRY");
        }

        double previousX = double.NegativeInfinity;
        for (int index = 0; index < samples.Count; index++)
        {
            BridgeCableSample sample = samples[index];
            RequireFinite(sample.X, "suspension-bridge-cable-samples", index, "x", layout.DeckStartX, layout.DeckEndX);
            RequireFinite(sample.Height, "suspension-bridge-cable-samples", index, "height", layout.HangerDeckY);
            if (sample.X <= previousX)
            {
                throw Error(
                    "must be ordered by increasing x coordinate.",
                    "suspension-bridge-cable-samples",
                    index,
                    "x",
                    "INVALID_SEQUENCE");
            }

            double expectedHeight = CalculateCableHeight(sample.X, layout);
            if (Math.Abs(sample.Height - expectedHeight) > 1e-9)
            {
                throw Error(
                    "does not match the canonical suspension curve.",
                    "suspension-bridge-cable-samples",
                    index,
                    "height",
                    "INVALID_DERIVED_VALUE");
            }
            previousX = sample.X;
        }
    }

    private static void ValidateVehicleProfile(string id, VehicleProfile profile)
    {
        RequireFinite(profile.Mass, "vehicle-profiles", id, "profile.mass", 0.001);
        RequireFinite(profile.Width, "vehicle-profiles", id, "profile.width", 0.001);
        RequireFinite(profile.Height, "vehicle-profiles", id, "profile.height", 0.001);
        RequireFinite(profile.Length, "vehicle-profiles", id, "profile.length", 0.001);
        RequireFinite(profile.WheelCount, "vehicle-profiles", id, "profile.wheelCount", 1);
        RequireFinite(profile.WheelRadius, "vehicle-profiles", id, "profile.wheelRadius", 0.001);
        RequireFinite(profile.SuspensionRestLength, "vehicle-profiles", id, "profile.suspensionRestLength", 0.001);
        RequireFinite(profile.SuspensionStiffness, "vehicle-profiles", id, "profile.suspensionStiffness", 0.001);
        RequireFinite(profile.MaxSuspensionForce, "vehicle-profiles", id, "profile.maxSuspensionForce", 0.001);

        VehicleDriveProfile drive = profile.Drive
            ?? throw Error("must be an object.", "vehicle-profiles", id, "profile.drive");
        RequireFinite(drive.ForwardEngineForce, "vehicle-profiles", id, "profile.drive.forwardEngineForce", 0);
        RequireFinite(drive.ReverseEngineForce, "vehicle-profiles", id, "profile.drive.reverseEngineForce", 0);
        RequireFinite(drive.MaxBrakeForce, "vehicle-profiles", id, "profile.drive.maxBrakeForce", 0);
        RequireFinite(drive.MaxSteering, "vehicle-profiles", id, "profile.drive.maxSteering", 0);
        RequireFinite(drive.MaxForwardSpeed, "vehicle-profiles", id, "profile.drive.maxForwardSpeed", 0);
        RequireFinite(drive.MaxReverseSpeed, "vehicle-profiles", id, "profile.drive.maxReverseSpeed", 0);

        PlayerVehicleDynamics dynamics = profile.PlayerDynamics
            ?? throw Error("must be an object.", "vehicle-profiles", id, "profile.playerDynamics");
        RequireEnum(dynamics.DrivenAxle, DrivenAxles, "vehicle-profiles", id, "profile.playerDynamics.drivenAxle");
        RequireFinite(dynamics.DownforceFactor, "vehicle-profiles", id, "profile.playerDynamics.downforceFactor", 0);
        RequireFinite(dynamics.LateralGripFactor, "vehicle-profiles", id, "profile.playerDynamics.lateralGripFactor", 0);
        RequireFinite(dynamics.AngularDamping, "vehicle-profiles", id, "profile.playerDynamics.angularDamping", 0, 1);
        RequireFinite(dynamics.RollInfluence, "vehicle-profiles", id, "profile.playerDynamics.rollInfluence", 0);
        RequireFinite(dynamics.WheelTrackFactor, "vehicle-profiles", id, "profile.playerDynamics.wheelTrackFactor", 0);
        RequireFinite(dynamics.VisualLeanFactor, "vehicle-profiles", id, "profile.playerDynamics.visualLeanFactor", 0);
        Vector3Definition angularFactor = dynamics.AngularFactor
            ?? throw Error("must be an object.", "vehicle-profiles", id, "profile.playerDynamics.angularFactor");
        RequireFinite(angularFactor.X, "vehicle-profiles", id, "profile.playerDynamics.angularFactor.x", 0, 1);
        RequireFinite(angularFactor.Y, "vehicle-profiles", id, "profile.playerDynamics.angularFactor.y", 0, 1);
        RequireFinite(angularFactor.Z, "vehicle-profiles", id, "profile.playerDynamics.angularFactor.z", 0, 1);
    }

    private static void ValidateVehiclePhysicsLayout(
        string id,
        VehicleProfile profile,
        VehiclePhysicsLayout layout)
    {
        RequireFinite(layout.WheelCount, "vehicle-profiles", id, "physicsLayout.wheelCount", 1);
        RequireFinite(layout.WheelConnectionY, "vehicle-profiles", id, "physicsLayout.wheelConnectionY");
        RequireFinite(layout.SettledRideHeight, "vehicle-profiles", id, "physicsLayout.settledRideHeight", 0.001);
        RequireFinite(layout.ChassisShapeOffsetY, "vehicle-profiles", id, "physicsLayout.chassisShapeOffsetY");
        RequireFinite(layout.ChassisGroundClearance, "vehicle-profiles", id, "physicsLayout.chassisGroundClearance", 0);
        if (layout.WheelCount != Math.Max(1, profile.WheelCount)
            || Math.Abs(layout.ChassisGroundClearance - profile.WheelRadius) > 1e-9)
        {
            throw Error(
                "must agree with the authored wheel profile.",
                "vehicle-profiles",
                id,
                "physicsLayout",
                "INVALID_DERIVED_VALUE");
        }
    }

    private static IReadOnlyList<double> RequireVector(
        IReadOnlyList<double>? values,
        string source,
        string id,
        string field)
    {
        if (values is null || values.Count != 3)
        {
            throw Error("must contain exactly three coordinates.", source, id, field);
        }
        for (int index = 0; index < values.Count; index++)
        {
            RequireFinite(values[index], source, id, $"{field}[{index}]");
        }
        return values;
    }

    private static double CalculateCableHeight(double x, SuspensionBridgeLayout layout)
    {
        double safeX = Math.Clamp(x, layout.DeckStartX, layout.DeckEndX);
        if (safeX <= layout.WestTowerX)
        {
            double t = (safeX - layout.DeckStartX) / (layout.WestTowerX - layout.DeckStartX);
            double chord = layout.AnchorCableY + ((layout.TowerCableY - layout.AnchorCableY) * t);
            return chord - (layout.SideSpanSag * 4 * t * (1 - t));
        }
        if (safeX >= layout.EastTowerX)
        {
            double t = (safeX - layout.EastTowerX) / (layout.DeckEndX - layout.EastTowerX);
            double chord = layout.TowerCableY + ((layout.AnchorCableY - layout.TowerCableY) * t);
            return chord - (layout.SideSpanSag * 4 * t * (1 - t));
        }

        double centerT = (safeX - layout.WestTowerX) / (layout.EastTowerX - layout.WestTowerX);
        double centered = (centerT * 2) - 1;
        return layout.CenterCableY
            + ((layout.TowerCableY - layout.CenterCableY) * centered * centered);
    }
}

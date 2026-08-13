using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.WorldEditing;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Construction;

public enum CityEditorTool
{
    Place,
    Zone,
    Select,
    Move,
    Rotate,
    Demolish,
}

public interface IFeatureSceneryOwner
{
    int RemoveOverlapping(PlacementRect footprint);
}

/// <summary>Session-owned Godot adapter for the authoritative Phase 7 world-edit command path.</summary>
public partial class CityEditorRuntime : Node
{
    private readonly HashSet<string> unlockedTiers = new(StringComparer.Ordinal) { ProgressionTiers.Operator };
    private readonly Dictionary<string, PlacementZoneParcel> zones = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MeshInstance3D> zoneVisuals = new(StringComparer.Ordinal);
    private GameContentRegistry content = null!;
    private CityEconomyRuntime economy = null!;
    private MvpWorldGenerator world = null!;
    private PlayerControlRuntime playerControl = null!;
    private LivingTrafficRuntime traffic = null!;
    private Node3D userWorld = null!;
    private Node3D presentation = null!;
    private MeshInstance3D ghost = null!;
    private MeshInstance3D reticle = null!;
    private StandardMaterial3D ghostMaterial = null!;
    private GodotVisualWorldEditParticipant visualParticipant = null!;
    private GodotColliderWorldEditParticipant colliderParticipant = null!;
    private OccupancyWorldEditParticipant occupancyParticipant = null!;
    private TrafficRoadWorldEditParticipant roadParticipant = null!;
    private MemoryWorldEditParticipant zoningParticipant = null!;
    private MemoryWorldEditParticipant serviceParticipant = null!;
    private MemoryWorldEditParticipant persistenceParticipant = null!;
    private WorldEditCoordinator coordinator = null!;
    private BuildingDefinition selectedSpec = null!;
    private PlacementVector3 aim = new(0, 0, 0);
    private double rotationY;
    private long zoneTransactionSerial;
    private bool eastSideDevelopmentAvailable;
    private bool countrysideExpansionAvailable;
    private IFeatureSceneryOwner? featureSceneryOwner;

    public bool Initialized { get; private set; }

    public bool Active { get; private set; }

    public bool GridSnapEnabled { get; private set; } = true;

    public CityEditorTool Tool { get; private set; } = CityEditorTool.Place;

    public string? SelectedRecordId { get; private set; }

    public BuildingDefinition SelectedSpec => selectedSpec;

    public PlacementVector3 Aim => aim;

    public double RotationY => rotationY;

    public PlacementDecision CurrentDecision { get; private set; } = null!;

    public IReadOnlyList<WorldEditRecord> Records => coordinator.Records;

    public IReadOnlyList<PlacementZoneParcel> Zones => Array.AsReadOnly(zones.Values.OrderBy(item => item.Id, StringComparer.Ordinal).ToArray());

    public int VisualCount => visualParticipant.Count;

    public int ColliderCount => colliderParticipant.Count;

    public int PersistenceCount => persistenceParticipant.Records.Count;

    public int RoadMetadataCount => roadParticipant.Records.Count;

    public int ConnectedRoadCount => roadParticipant.NetworkSnapshot.Segments.Count(segment => segment.Connected);

    public int OccupancyCount => occupancyParticipant.Records.Count;

    public int ZoningMetadataCount => zoningParticipant.Records.Count;

    public int ServiceMetadataCount => serviceParticipant.Records.Count;

    public CityEditorState CaptureState()
    {
        EnsureInitialized();
        return new CityEditorState
        {
            Buildings = coordinator.Serialize(),
            Zones = Array.AsReadOnly(zones.Values
                .OrderBy(item => item.Id, StringComparer.Ordinal)
                .Select(parcel => new WorldEditZoneState(
                    parcel.Id,
                    parcel.X,
                    parcel.Z,
                    parcel.ZoneType,
                    parcel.HappinessModifier,
                    parcel.LandValueModifier))
                .ToArray()),
        };
    }

    public CityEditorState RestoreState(CityEditorState state)
    {
        EnsureInitialized();
        ArgumentNullException.ThrowIfNull(state);
        if (state.Version != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(state), $"Unsupported city editor state version: {state.Version}");
        }
        if (Records.Count > 0 || zones.Count > 0)
        {
            throw new InvalidOperationException("City editor state can only restore into an empty runtime.");
        }
        ArgumentNullException.ThrowIfNull(state.Buildings);
        ArgumentNullException.ThrowIfNull(state.Zones);
        PlacementZoneParcel[] restoredZones = state.Zones.Select((saved, index) =>
        {
            ArgumentNullException.ThrowIfNull(saved);
            PlacementZoneParcel expected = PlacementWorldRules.CreateZoneParcel(saved.ZoneType, saved.X, saved.Z);
            if (expected.Id != saved.Key
                || Math.Abs(expected.HappinessModifier - saved.HappinessModifier) > 0.001
                || Math.Abs(expected.LandValueModifier - saved.LandValueModifier) > 0.001)
            {
                throw new InvalidOperationException($"Restored zone {index} does not match canonical parcel {saved.Key}.");
            }
            return expected;
        }).ToArray();
        if (restoredZones.Select(parcel => parcel.Id).Distinct(StringComparer.Ordinal).Count() != restoredZones.Length)
        {
            throw new InvalidOperationException("Restored city editor state contains duplicate zone parcels.");
        }

        if (featureSceneryOwner is not null)
        {
            foreach (WorldEditBuildingState saved in state.Buildings)
            {
                _ = featureSceneryOwner.RemoveOverlapping(PlacementGeometry.CreateRect(
                    saved.Plot.X,
                    saved.Plot.Z,
                    saved.Plot.Width,
                    saved.Plot.Depth,
                    saved.RotationY,
                    0));
            }
        }
        _ = coordinator.Restore(state.Buildings);
        foreach (PlacementZoneParcel parcel in restoredZones)
        {
            EconomyZoneEffect expected = new(
                $"USER_ZONE_{parcel.Id}",
                parcel.ZoneType,
                parcel.HappinessModifier,
                parcel.LandValueModifier,
                new EconomyPoint(parcel.X, parcel.Z));
            EconomyZoneEffect? existing = economy.Ledger.GetZoneEffect(expected.Id);
            if (existing is not null && existing != expected)
            {
                throw new InvalidOperationException($"Restored economy zone conflicts with parcel {parcel.Id}.");
            }
            MeshInstance3D overlay = CreateZoneVisual(parcel);
            if (!AttachZoneVisual(parcel.Id, overlay))
            {
                overlay.Free();
                throw new InvalidOperationException($"Could not restore zone parcel {parcel.Id}.");
            }
            if (!zones.TryAdd(parcel.Id, parcel))
            {
                _ = DetachZoneVisual(parcel.Id);
                throw new InvalidOperationException($"Could not restore zone parcel {parcel.Id}.");
            }
            if (existing is null) economy.Ledger.SetZoneEffect(expected);
        }
        _ = traffic.RefreshProductivity("WORLD_EDIT_RESTORED");
        RefreshPreview();
        return CaptureState();
    }

    public void Initialize(
        GameContentRegistry contentRegistry,
        CityEconomyRuntime economyRuntime,
        MvpWorldGenerator worldOwner,
        PlayerControlRuntime playerControlRuntime,
        LivingTrafficRuntime trafficRuntime,
        Node3D userWorldOwner,
        bool eastSideDevelopmentEnabled = true,
        bool countrysideExpansionEnabled = true)
    {
        if (Initialized) throw new InvalidOperationException("The city editor runtime is already initialized.");
        content = contentRegistry ?? throw new ArgumentNullException(nameof(contentRegistry));
        economy = economyRuntime ?? throw new ArgumentNullException(nameof(economyRuntime));
        world = worldOwner ?? throw new ArgumentNullException(nameof(worldOwner));
        playerControl = playerControlRuntime ?? throw new ArgumentNullException(nameof(playerControlRuntime));
        traffic = trafficRuntime ?? throw new ArgumentNullException(nameof(trafficRuntime));
        userWorld = userWorldOwner ?? throw new ArgumentNullException(nameof(userWorldOwner));
        eastSideDevelopmentAvailable = eastSideDevelopmentEnabled;
        countrysideExpansionAvailable = countrysideExpansionEnabled;

        presentation = new Node3D { Name = "EditorPresentation" };
        userWorld.AddChild(presentation);
        CreatePreviewNodes();

        visualParticipant = new GodotVisualWorldEditParticipant(userWorld);
        colliderParticipant = new GodotColliderWorldEditParticipant(userWorld, world.Colliders);
        roadParticipant = new TrafficRoadWorldEditParticipant(
            trafficRuntime.RoadGraph,
            world.Surface,
            userWorld,
            () => trafficRuntime.RefreshProductivity());
        occupancyParticipant = new OccupancyWorldEditParticipant();
        zoningParticipant = new MemoryWorldEditParticipant(WorldEditParticipantIds.Zoning);
        serviceParticipant = new MemoryWorldEditParticipant(WorldEditParticipantIds.Service);
        persistenceParticipant = new MemoryWorldEditParticipant(WorldEditParticipantIds.Persistence);
        coordinator = new WorldEditCoordinator(content, economy.Ledger, [
            visualParticipant,
            colliderParticipant,
            roadParticipant,
            new EconomyWorldEditParticipant(economy.Ledger),
            occupancyParticipant,
            zoningParticipant,
            serviceParticipant,
            persistenceParticipant,
        ]);

        selectedSpec = content.GetBuilding("ROAD_STRAIGHT")
            ?? throw new InvalidOperationException("The canonical starter road is missing.");
        aim = PlacementWorldRules.SnapAim(0, 150, world.Surface);
        Initialized = true;
        SetActive(false);
        RefreshPreview();
    }

    public IReadOnlyList<BuildingDefinition> GetCatalog(
        string? category = null,
        bool includeAdvanced = false,
        bool includeLocked = true) =>
        ConstructionVocabulary.FilterCatalog(content.BuildingRecords, category, includeAdvanced, unlockedTiers, includeLocked);

    public void UnlockTier(string tier)
    {
        if (tier is not (ProgressionTiers.Operator or ProgressionTiers.Broker or ProgressionTiers.Magnate))
        {
            throw new ArgumentOutOfRangeException(nameof(tier));
        }
        unlockedTiers.Add(tier);
        RefreshPreview();
    }

    public void AttachFeatureSceneryOwner(IFeatureSceneryOwner owner)
    {
        EnsureInitialized();
        featureSceneryOwner = owner ?? throw new ArgumentNullException(nameof(owner));
    }

    public void DetachFeatureSceneryOwner(IFeatureSceneryOwner owner)
    {
        if (ReferenceEquals(featureSceneryOwner, owner)) featureSceneryOwner = null;
    }

    public void SetActive(bool active)
    {
        EnsureInitializedOrInitializing();
        Active = active;
        if (IsInstanceValid(presentation)) presentation.Visible = active;
    }

    public void SetTool(CityEditorTool tool)
    {
        EnsureInitialized();
        Tool = tool;
        RefreshPreview();
    }

    public void SelectCatalog(string specId)
    {
        EnsureInitialized();
        selectedSpec = content.GetBuilding(RequireId(specId))
            ?? throw new KeyNotFoundException($"Unknown catalog item: {specId}");
        SelectedRecordId = null;
        Tool = CityEditorTool.Place;
        rotationY = 0;
        aim = ConformAim(aim.X, aim.Z);
        RefreshPreview();
    }

    public PlacementDecision SetAim(double x, double z)
    {
        EnsureInitialized();
        aim = ConformAim(x, z);
        RefreshPreview();
        return CurrentDecision;
    }

    public PlacementDecision ControllerNavigate(double horizontal, double vertical, double deltaSeconds = 1)
    {
        EnsureInitialized();
        double speed = GridSnapEnabled ? PlacementWorldRules.GridSnapSize : 24;
        return SetAim(aim.X + horizontal * speed * deltaSeconds, aim.Z + vertical * speed * deltaSeconds);
    }

    public void ToggleGridSnap()
    {
        EnsureInitialized();
        GridSnapEnabled = !GridSnapEnabled;
        _ = SetAim(aim.X, aim.Z);
    }

    public PlacementDecision RotateBlueprint(int quarterTurns = 1)
    {
        EnsureInitialized();
        rotationY = NormalizeRotation(rotationY + quarterTurns * Math.PI / 2);
        RefreshPreview();
        return CurrentDecision;
    }

    public WorldEditReceipt Place()
    {
        EnsureInitialized();
        WorldEditReceipt receipt = coordinator.Place(selectedSpec.Id!, CurrentDecision, rotationY, ZoneAt(aim)?.ZoneType);
        _ = traffic.RefreshProductivity("WORLD_EDIT_COMMITTED");
        SelectedRecordId = receipt.Current!.Id;
        RefreshPreview();
        return receipt;
    }

    public WorldEditRecord? SelectAtAim()
    {
        EnsureInitialized();
        WorldEditRecord? selected = coordinator.Records
            .Where(record => PlacementGeometry.CreateRect(
                record.Position.X,
                record.Position.Z,
                record.Footprint.Width,
                record.Footprint.Depth,
                record.RotationY,
                0).Contains(aim.X, aim.Z))
            .OrderBy(record => DistanceSquared(record.Position, aim))
            .FirstOrDefault();
        SelectedRecordId = selected?.Id;
        if (selected is not null)
        {
            selectedSpec = content.GetBuilding(selected.SpecId)!;
            rotationY = selected.RotationY;
        }
        RefreshPreview();
        return selected;
    }

    public WorldEditReceipt MoveSelected()
    {
        EnsureInitialized();
        string id = RequireSelection();
        WorldEditReceipt receipt = coordinator.Move(id, Evaluate(selectedSpec, id));
        _ = traffic.RefreshProductivity("WORLD_EDIT_COMMITTED");
        RefreshPreview();
        return receipt;
    }

    public WorldEditReceipt RotateSelected(int quarterTurns = 1)
    {
        EnsureInitialized();
        string id = RequireSelection();
        rotationY = NormalizeRotation(rotationY + quarterTurns * Math.PI / 2);
        PlacementDecision decision = Evaluate(selectedSpec, id);
        WorldEditReceipt receipt = coordinator.Rotate(id, decision, rotationY);
        _ = traffic.RefreshProductivity("WORLD_EDIT_COMMITTED");
        RefreshPreview();
        return receipt;
    }

    public WorldEditReceipt DemolishSelected()
    {
        EnsureInitialized();
        WorldEditReceipt receipt = coordinator.Demolish(RequireSelection());
        _ = traffic.RefreshProductivity("WORLD_EDIT_COMMITTED");
        SelectedRecordId = null;
        RefreshPreview();
        return receipt;
    }

    public PlacementZoneParcel ApplyZone(string zoneType)
    {
        EnsureInitialized();
        PlacementZoneParcel parcel = PlacementWorldRules.CreateZoneParcel(zoneType, aim.X, aim.Z);
        if (zones.ContainsKey(parcel.Id)) throw new InvalidOperationException($"Parcel {parcel.Id} is already zoned.");
        ValidateZonePlacement(parcel);
        double zoningCost = content.EconomyBalance.Construction!.ZoningCost;
        MeshInstance3D overlay = CreateZoneVisual(parcel);
        EconomyZoneEffect effect = new(
            $"USER_ZONE_{parcel.Id}",
            parcel.ZoneType,
            parcel.HappinessModifier,
            parcel.LandValueModifier,
            new EconomyPoint(parcel.X, parcel.Z));
        try
        {
            _ = WorldEditTransaction.Run($"zone-{++zoneTransactionSerial:D6}", transaction =>
            {
                transaction.Step(
                    "debit zoning cost",
                    () => economy.Ledger.Spend(zoningCost, new SpendingContext
                    {
                        Source = "zoning",
                        ReferenceId = effect.Id,
                    }),
                    (_, _) => economy.Ledger.Earn(zoningCost, "world-edit-rollback", effect.Id));
                transaction.Step(
                    "attach zone visual",
                    () => AttachZoneVisual(parcel.Id, overlay),
                    (_, _) => DetachZoneVisual(parcel.Id));
                transaction.Step(
                    "attach zone economy",
                    () => economy.Ledger.SetZoneEffect(effect),
                    (_, _) => economy.Ledger.RemoveZoneEffect(effect.Id));
                transaction.Step(
                    "attach zone persistence",
                    () => zones.TryAdd(parcel.Id, parcel),
                    (_, _) => zones.Remove(parcel.Id));
                return parcel;
            });
        }
        catch
        {
            if (overlay.GetParent() is null) overlay.Free();
            throw;
        }
        RefreshPreview();
        return parcel;
    }

    public void Cancel()
    {
        EnsureInitialized();
        SelectedRecordId = null;
        rotationY = 0;
        Tool = CityEditorTool.Place;
        RefreshPreview();
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        foreach (string id in zones.Keys.ToArray())
        {
            _ = economy.Ledger.RemoveZoneEffect($"USER_ZONE_{id}");
            _ = DetachZoneVisual(id);
        }
        zones.Clear();
        roadParticipant.Shutdown();
        visualParticipant.Shutdown();
        colliderParticipant.Shutdown();
        if (presentation.GetParent() is Node parent) parent.RemoveChild(presentation);
        presentation.QueueFree();
        Initialized = false;
        Active = false;
        featureSceneryOwner = null;
    }

    public override void _ExitTree() => Shutdown();

    private PlacementDecision Evaluate(BuildingDefinition spec, string? ignoreOccupantId = null)
    {
        GameplayCameraTargetSnapshot? target = playerControl.ControlledCameraTarget?.CaptureCameraTarget();
        PlacementWorldOccupant[] authored = world.Colliders.Snapshot
            .Where(item => item.Layer == CollisionLayer.StaticObstacle
                && !item.Kind.Contains("ROAD", StringComparison.OrdinalIgnoreCase))
            .Select(item => new PlacementWorldOccupant(
                item.StableId,
                item.Kind,
                item.Kind,
                PlacementGeometry.CreateRect(
                    item.Position.X,
                    item.Position.Z,
                    item.Size.X,
                    item.Size.Z,
                    item.RotationY,
                    0)))
            .ToArray();
        return PlacementWorldRules.Evaluate(new PlacementWorldEvaluationInput
        {
            Spec = PlacementSpec.FromBuilding(spec),
            Position = aim,
            RotationY = rotationY,
            CatalogAccess = ConstructionVocabulary.GetCatalogAccess(spec, unlockedTiers),
            Economy = economy.Ledger,
            Surface = world.Surface,
            Occupants = authored.Concat(occupancyParticipant.Snapshot()).ToArray(),
            Zones = Zones,
            PlayerPosition = target is null
                ? null
                : new PlacementVector3(target.Position.X, target.Position.Y, target.Position.Z),
            IgnoreOccupantId = ignoreOccupantId,
            EastSideDevelopmentAvailable = eastSideDevelopmentAvailable,
            CountrysideExpansionAvailable = countrysideExpansionAvailable,
        });
    }

    private PlacementVector3 ConformAim(double x, double z)
    {
        PlacementVector3 snapped = PlacementWorldRules.SnapAim(x, z, world.Surface, GridSnapEnabled);
        return selectedSpec?.RoadType == "BRIDGE" && world.Surface.IsWater(snapped.X, 0, snapped.Z)
            ? snapped with { Y = 0 }
            : snapped;
    }

    private void RefreshPreview()
    {
        if (!Initialized) return;
        CurrentDecision = Evaluate(selectedSpec, SelectedRecordId);
        PlacementFootprint oriented = PlacementGeometry.GetOrientedFootprint(
            selectedSpec.Footprint!.Width,
            selectedSpec.Footprint.Depth,
            rotationY);
        float height = (float)Math.Max(selectedSpec.Height, selectedSpec.GeneratorType == "ROAD_SEGMENT" ? 0.35 : 1);
        ghost.Position = new Vector3((float)aim.X, (float)aim.Y + height / 2, (float)aim.Z);
        ghost.Rotation = new Vector3(0, (float)rotationY, 0);
        ghost.Mesh = new BoxMesh { Size = new Vector3((float)oriented.Width, height, (float)oriented.Depth) };
        ghostMaterial.AlbedoColor = CurrentDecision.Valid
            ? new Color(0.2f, 1, 0.55f, 0.38f)
            : new Color(1, 0.2f, 0.28f, 0.42f);
        reticle.Position = new Vector3((float)aim.X, (float)aim.Y + 0.06f, (float)aim.Z);
        reticle.Mesh = new BoxMesh { Size = new Vector3((float)oriented.Width, 0.08f, (float)oriented.Depth) };
    }

    private void CreatePreviewNodes()
    {
        ghostMaterial = new StandardMaterial3D
        {
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        };
        ghost = new MeshInstance3D
        {
            Name = "PlacementGhost",
            MaterialOverride = ghostMaterial,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        reticle = new MeshInstance3D
        {
            Name = "PlacementReticle",
            MaterialOverride = new StandardMaterial3D
            {
                AlbedoColor = new Color(0.25f, 0.9f, 1, 0.82f),
                Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            },
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        presentation.AddChild(reticle);
        presentation.AddChild(ghost);
    }

    private void ValidateZonePlacement(PlacementZoneParcel parcel)
    {
        if (PlacementWorldRules.IsCountrysideExpansionPosition(parcel.X) && !countrysideExpansionAvailable)
        {
            throw new InvalidOperationException("Countryside expansion is unavailable in this session.");
        }
        if (PlacementWorldRules.IsEastSideDevelopmentPosition(parcel.X)
            && (!eastSideDevelopmentAvailable
                || !economy.Ledger.IsDistrictUnlocked(EconomyDistrictIds.EastCyberMetropolis)))
        {
            throw new InvalidOperationException(eastSideDevelopmentAvailable
                ? "East Cyber-Metropolis is locked."
                : "East-side development is unavailable in this session.");
        }
        PlacementRect bounds = parcel.Bounds;
        PlanarBounds worldBounds = new(
            ContentDefinitions.WorldBounds.MinX,
            ContentDefinitions.WorldBounds.MaxX,
            ContentDefinitions.WorldBounds.MinZ,
            ContentDefinitions.WorldBounds.MaxZ);
        if (!PlacementGeometry.IsInside(bounds, worldBounds)) throw new InvalidOperationException("Zone parcel is outside the playable city bounds.");
        if (PlacementWorldRules.ProtectedLandmarks.Any(item => PlacementGeometry.Overlaps(bounds, item.Bounds)))
        {
            throw new InvalidOperationException("Zone parcel overlaps a protected landmark.");
        }
        double y = world.Surface.GetTerrainHeight(parcel.X, parcel.Z);
        if (PlacementGeometry.GetWaterSamplePoints(bounds, y).Any(point => world.Surface.IsWater(point.X, point.Y, point.Z)))
        {
            throw new InvalidOperationException("Zone parcel overlaps water.");
        }
        if (occupancyParticipant.Snapshot().Any(item => PlacementGeometry.Overlaps(bounds, item.Bounds)))
        {
            throw new InvalidOperationException("Zone parcel overlaps player construction.");
        }
        SpendingDecision spending = economy.Ledger.EvaluateSpending(
            content.EconomyBalance.Construction!.ZoningCost,
            new SpendingContext { Source = "zoning", ReferenceId = parcel.Id });
        if (!spending.Allowed) throw new InvalidOperationException(spending.Reason);
    }

    private MeshInstance3D CreateZoneVisual(PlacementZoneParcel parcel) => new()
    {
        Name = $"Zone-{parcel.Id}",
        Position = new Vector3((float)parcel.X, (float)world.Surface.GetTerrainHeight(parcel.X, parcel.Z) + 0.04f, (float)parcel.Z),
        Mesh = new BoxMesh { Size = new Vector3((float)PlacementZoneParcel.Size, 0.06f, (float)PlacementZoneParcel.Size) },
        MaterialOverride = new StandardMaterial3D
        {
            AlbedoColor = parcel.ZoneType switch
            {
                ConstructionCategories.Residential => new Color(0.18f, 0.92f, 0.48f, 0.32f),
                ConstructionCategories.Commercial => new Color(0.18f, 0.65f, 1, 0.32f),
                _ => new Color(1, 0.62f, 0.18f, 0.32f),
            },
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
        },
        CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
    };

    private bool AttachZoneVisual(string id, MeshInstance3D overlay)
    {
        if (zoneVisuals.ContainsKey(id)) return false;
        userWorld.AddChild(overlay);
        zoneVisuals.Add(id, overlay);
        return true;
    }

    private bool DetachZoneVisual(string id)
    {
        if (!zoneVisuals.Remove(id, out MeshInstance3D? overlay)) return false;
        if (overlay.GetParent() is Node parent) parent.RemoveChild(overlay);
        overlay.QueueFree();
        return true;
    }

    private PlacementZoneParcel? ZoneAt(PlacementVector3 point) => zones.Values
        .OrderBy(item => item.Id, StringComparer.Ordinal)
        .FirstOrDefault(item => item.Bounds.Contains(point.X, point.Z));

    private string RequireSelection() => SelectedRecordId
        ?? throw new InvalidOperationException("Select a placed building before using this command.");

    private static string RequireId(string id) => string.IsNullOrWhiteSpace(id)
        ? throw new ArgumentException("A stable ID is required.", nameof(id))
        : id.Trim();

    private static double DistanceSquared(PlacementVector3 left, PlacementVector3 right) =>
        Math.Pow(left.X - right.X, 2) + Math.Pow(left.Z - right.Z, 2);

    private static double NormalizeRotation(double value)
    {
        double normalized = value % (Math.PI * 2);
        return normalized < 0 ? normalized + Math.PI * 2 : normalized;
    }

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("The city editor runtime is not initialized.");
    }

    private void EnsureInitializedOrInitializing()
    {
        if (!Initialized && presentation is null) throw new InvalidOperationException("The city editor runtime is not initialized.");
    }
}

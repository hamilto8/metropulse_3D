using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using MetroPulse.Domain.Aircraft;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Persistence;
using MetroPulse.Godot.Aircraft;
using MetroPulse.Godot.App;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;

namespace MetroPulse.Godot.Missions;

/// <summary>Applies validated runtime save domains in dependency order: outcomes, entity control, mission, state.</summary>
public sealed class SessionGameSaveRuntimeRestoreAdapter : IGameSaveRuntimeRestoreAdapter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SessionShell session;

    public SessionGameSaveRuntimeRestoreAdapter(SessionShell sessionOwner) =>
        session = sessionOwner ?? throw new ArgumentNullException(nameof(sessionOwner));

    public void Apply(DeferredGameSaveDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        JsonObject data = JsonNode.Parse(descriptor.DataJson)?.AsObject()
            ?? throw new InvalidDataException("Runtime save data is unavailable.");
        MissionRuntime missions = session.Missions
            ?? throw new InvalidOperationException("Mission runtime is unavailable during save restore.");
        CityServicesRuntime services = session.Services
            ?? throw new InvalidOperationException("City services are unavailable during save restore.");
        PlayerControlRuntime player = session.PlayerControl
            ?? throw new InvalidOperationException("Player control is unavailable during save restore.");
        GodotSessionRuntimeHost runtime = session.RuntimeHost
            ?? throw new InvalidOperationException("Session runtime is unavailable during save restore.");

        JsonObject? missionData = data[GameSaveDomainIds.Missions] as JsonObject;
        MissionRuntimeState? missionState = missionData?["runtime"] is JsonObject runtimeStateNode
            ? JsonSerializer.Deserialize<MissionRuntimeState>(runtimeStateNode.ToJsonString(), JsonOptions)
                ?? throw new InvalidDataException("Mission runtime save state is empty.")
            : null;
        if (missionState is not null) MissionRuntimeState.Validate(missionState, missions.Registry);

        CityServicesRuntimeState serviceRollback = services.CaptureState();
        MissionOutcomeStateDocument outcomes = missionData?["contracts"] is JsonObject contracts
            ? JsonSerializer.Deserialize<MissionOutcomeStateDocument>(contracts.ToJsonString(), JsonOptions)
                ?? throw new InvalidDataException("Mission outcome save state is empty.")
            : serviceRollback.Outcomes;
        AlertStateDocument alerts = data[GameSaveDomainIds.Alerts] is JsonObject alertData
            ? JsonSerializer.Deserialize<AlertStateDocument>(alertData.ToJsonString(), JsonOptions)
                ?? throw new InvalidDataException("Alert save state is empty.")
            : serviceRollback.Alerts;
        var servicesState = new CityServicesRuntimeState { Outcomes = outcomes, Alerts = alerts };

        SavedControlledEntity? savedEntity = ReadSavedEntity(data[GameSaveDomainIds.Player] as JsonObject);
        GameState savedGameState = ReadGameState(data[GameSaveDomainIds.Game] as JsonObject);
        ValidateCrossDomain(missionState, savedEntity, savedGameState, outcomes);

        bool vehicleExisted = savedEntity?.Kind == ControlKind.Vehicle
            && player.Vehicles.Any(vehicle => vehicle.StableId == savedEntity.StableId);
        bool entityPrepared = false;
        bool entityControlled = false;
        try
        {
            _ = services.RestoreState(servicesState);
            if (savedGameState == GameState.StreetVehicle)
            {
                SavedControlledEntity entity = savedEntity!;
                if (entity.Kind == ControlKind.Aircraft && session.Aircraft is null)
                {
                    // A default-off post-MVP package never makes the save invalid. It degrades to
                    // safe Management ownership until an authorized build enables the package.
                    savedGameState = GameState.Management;
                }
                else
                {
                    if (entity.Kind == ControlKind.Aircraft)
                    {
                        double terrain = session.World!.Surface.GetTerrainHeight(entity.Position.X, entity.Position.Z);
                        bool grounded = entity.Position.Y <= terrain + AircraftFlightModel.DefaultConfig.GearHeight + 0.5;
                        var state = new AircraftActorSnapshot(
                            AircraftFlightModel.CreateState(new AircraftFlightState
                            {
                                Position = new AircraftVector3(entity.Position.X, entity.Position.Y, entity.Position.Z),
                                Heading = entity.Yaw,
                                Speed = entity.Speed,
                                Grounded = grounded,
                                Mode = grounded ? AircraftModes.Taxi : AircraftModes.Airborne,
                            }),
                            false, false, 0, 0, 0, 0, 0);
                        if (!player.PrepareRestoredAircraftControl(state))
                            throw new InvalidDataException("Saved aircraft control could not be prepared.");
                    }
                    else
                    {
                        player.PrepareRestoredVehicleControl(entity.StableId, entity.TypeId, entity.Position, entity.Yaw);
                    }
                    entityPrepared = true;
                    runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("save-restore:controlled-entity", nameof(SessionGameSaveRuntimeRestoreAdapter)));
                    entityControlled = true;
                }
            }
            if (missionState is not null) _ = missions.RestoreState(missionState);
            if (missionState?.Lifecycle.Phase == MissionPhases.Result)
            {
                runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("save-restore:result-handoff", nameof(SessionGameSaveRuntimeRestoreAdapter)));
                runtime.TransitionTo(GameState.Result, new TransitionRequestOptions("save-restore:result", nameof(SessionGameSaveRuntimeRestoreAdapter)));
            }
        }
        catch
        {
            if (entityControlled && runtime.StateMachine.State == GameState.StreetVehicle && missions.Lifecycle.Phase == MissionPhases.Idle)
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("save-restore:rollback", nameof(SessionGameSaveRuntimeRestoreAdapter)));
            else if (entityPrepared && savedEntity?.Kind == ControlKind.Vehicle)
                _ = player.CancelPreparedVehicleControl(savedEntity.StableId, removeVehicle: !vehicleExisted);
            if (!vehicleExisted && savedEntity?.Kind == ControlKind.Vehicle && player.ControlledKind == ControlKind.None)
                _ = player.RemoveVehicle(savedEntity.StableId);
            _ = services.RestoreState(serviceRollback);
            throw;
        }
    }

    private static void ValidateCrossDomain(
        MissionRuntimeState? mission,
        SavedControlledEntity? entity,
        GameState gameState,
        MissionOutcomeStateDocument outcomes)
    {
        if (gameState == GameState.StreetVehicle && entity is null)
            throw new InvalidDataException("STREET_VEHICLE restore requires a saved controlled vehicle or aircraft record.");
        if (mission is null) return;
        if (mission.Lifecycle.Phase is MissionPhases.Active or MissionPhases.Checkpoint)
        {
            MissionExecutionState execution = mission.Execution!;
            if (gameState != GameState.StreetVehicle
                || entity?.Kind != ControlKind.Vehicle
                || entity.StableId != execution.VehicleId
                || entity.TypeId != execution.VehicleType)
            {
                throw new InvalidDataException("Active mission restore requires the matching saved STREET_VEHICLE control record.");
            }
        }
        if (mission.Lifecycle.Phase == MissionPhases.Result)
        {
            if (gameState != GameState.Result
                || !outcomes.Transactions.Any(receipt => receipt.TransactionId == mission.ResultTransactionId))
            {
                throw new InvalidDataException("RESULT restore requires its matching saved game state and committed outcome receipt.");
            }
        }
    }

    private static SavedControlledEntity? ReadSavedEntity(JsonObject? player)
    {
        if (player?["controlled"] is not JsonObject controlled) return null;
        string? kindToken = controlled["kind"]?.GetValue<string>();
        ControlKind kind = kindToken switch
        {
            "VEHICLE" => ControlKind.Vehicle,
            "AIRCRAFT" => ControlKind.Aircraft,
            _ => ControlKind.None,
        };
        if (kind == ControlKind.None) return null;
        JsonArray position = controlled["position"]?.AsArray()
            ?? throw new InvalidDataException("Saved controlled vehicle position is unavailable.");
        JsonArray rotation = controlled["rotation"]?.AsArray()
            ?? throw new InvalidDataException("Saved controlled vehicle rotation is unavailable.");
        return new SavedControlledEntity(
            kind,
            controlled["contentId"]?.GetValue<string>()
                ?? throw new InvalidDataException("Saved controlled vehicle ID is unavailable."),
            controlled["typeId"]?.GetValue<string>()
                ?? throw new InvalidDataException("Saved controlled vehicle type is unavailable."),
            new Vector3(
                position[0]!.GetValue<float>(),
                position[1]!.GetValue<float>(),
                position[2]!.GetValue<float>()),
            rotation[1]!.GetValue<float>(),
            controlled["speed"]?.GetValue<double>() ?? 0);
    }

    private static GameState ReadGameState(JsonObject? game)
    {
        string? token = game?["state"]?.GetValue<string>();
        return StableTokens.TryParseGameState(token, out GameState state) ? state : GameState.Management;
    }

    private sealed record SavedControlledEntity(
        ControlKind Kind,
        string StableId,
        string TypeId,
        Vector3 Position,
        float Yaw,
        double Speed);
}

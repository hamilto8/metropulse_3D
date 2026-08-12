using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Persistence;
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

        SavedControlledVehicle? savedVehicle = ReadSavedVehicle(data[GameSaveDomainIds.Player] as JsonObject);
        GameState savedGameState = ReadGameState(data[GameSaveDomainIds.Game] as JsonObject);
        ValidateCrossDomain(missionState, savedVehicle, savedGameState, outcomes);

        bool vehicleExisted = savedVehicle is not null
            && player.Vehicles.Any(vehicle => vehicle.StableId == savedVehicle.StableId);
        bool vehiclePrepared = false;
        bool vehicleControlled = false;
        try
        {
            _ = services.RestoreState(servicesState);
            if (savedGameState == GameState.StreetVehicle)
            {
                SavedControlledVehicle vehicle = savedVehicle!;
                player.PrepareRestoredVehicleControl(vehicle.StableId, vehicle.TypeId, vehicle.Position, vehicle.Yaw);
                vehiclePrepared = true;
                runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("save-restore:vehicle", nameof(SessionGameSaveRuntimeRestoreAdapter)));
                vehicleControlled = true;
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
            if (vehicleControlled && runtime.StateMachine.State == GameState.StreetVehicle && missions.Lifecycle.Phase == MissionPhases.Idle)
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("save-restore:rollback", nameof(SessionGameSaveRuntimeRestoreAdapter)));
            else if (vehiclePrepared && savedVehicle is not null)
                _ = player.CancelPreparedVehicleControl(savedVehicle.StableId, removeVehicle: !vehicleExisted);
            if (!vehicleExisted && savedVehicle is not null && player.ControlledKind == ControlKind.None)
                _ = player.RemoveVehicle(savedVehicle.StableId);
            _ = services.RestoreState(serviceRollback);
            throw;
        }
    }

    private static void ValidateCrossDomain(
        MissionRuntimeState? mission,
        SavedControlledVehicle? vehicle,
        GameState gameState,
        MissionOutcomeStateDocument outcomes)
    {
        if (gameState == GameState.StreetVehicle && vehicle is null)
            throw new InvalidDataException("STREET_VEHICLE restore requires a saved controlled vehicle record.");
        if (mission is null) return;
        if (mission.Lifecycle.Phase is MissionPhases.Active or MissionPhases.Checkpoint)
        {
            MissionExecutionState execution = mission.Execution!;
            if (gameState != GameState.StreetVehicle
                || vehicle is null
                || vehicle.StableId != execution.VehicleId
                || vehicle.TypeId != execution.VehicleType)
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

    private static SavedControlledVehicle? ReadSavedVehicle(JsonObject? player)
    {
        if (player?["controlled"] is not JsonObject controlled) return null;
        if (controlled["kind"]?.GetValue<string>() != ControlKind.Vehicle.ToToken()) return null;
        JsonArray position = controlled["position"]?.AsArray()
            ?? throw new InvalidDataException("Saved controlled vehicle position is unavailable.");
        JsonArray rotation = controlled["rotation"]?.AsArray()
            ?? throw new InvalidDataException("Saved controlled vehicle rotation is unavailable.");
        return new SavedControlledVehicle(
            controlled["contentId"]?.GetValue<string>()
                ?? throw new InvalidDataException("Saved controlled vehicle ID is unavailable."),
            controlled["typeId"]?.GetValue<string>()
                ?? throw new InvalidDataException("Saved controlled vehicle type is unavailable."),
            new Vector3(
                position[0]!.GetValue<float>(),
                position[1]!.GetValue<float>(),
                position[2]!.GetValue<float>()),
            rotation[1]!.GetValue<float>());
    }

    private static GameState ReadGameState(JsonObject? game)
    {
        string? token = game?["state"]?.GetValue<string>();
        return StableTokens.TryParseGameState(token, out GameState state) ? state : GameState.Management;
    }

    private sealed record SavedControlledVehicle(string StableId, string TypeId, Vector3 Position, float Yaw);
}

using System.Collections.Frozen;

namespace MetroPulse.Domain.Core;

public sealed record GameStatePolicy(
    MissionPolicy Mission,
    HeatPolicy Heat,
    ControlPolicy Control,
    CameraPolicy Camera,
    ClockPolicy Clock);

public sealed record PolicyChange<T>(T From, T To);

public sealed record TransitionEffects(
    PolicyChange<MissionPolicy> Mission,
    PolicyChange<HeatPolicy> Heat,
    PolicyChange<ControlPolicy> ControlledEntity,
    PolicyChange<CameraPolicy> Camera,
    PolicyChange<ClockPolicy> SimulationClock);

public static class GameStateCatalog
{
    private static readonly FrozenDictionary<GameState, GameStatePolicy> StatePolicies =
        new Dictionary<GameState, GameStatePolicy>
        {
            [GameState.Boot] = new(MissionPolicy.RequireNone, HeatPolicy.PreserveFrozen, ControlPolicy.RequireNone, CameraPolicy.None, ClockPolicy.Stopped),
            [GameState.Load] = new(MissionPolicy.RequireNone, HeatPolicy.PreserveFrozen, ControlPolicy.RequireNone, CameraPolicy.Loading, ClockPolicy.Stopped),
            [GameState.Management] = new(MissionPolicy.RequireResolved, HeatPolicy.PreserveFrozen, ControlPolicy.RequireNone, CameraPolicy.Management, ClockPolicy.City),
            [GameState.Builder] = new(MissionPolicy.RequireResolved, HeatPolicy.PreserveFrozen, ControlPolicy.RequireNone, CameraPolicy.Builder, ClockPolicy.Builder),
            [GameState.Transition] = new(MissionPolicy.Preserve, HeatPolicy.PreserveFrozen, ControlPolicy.Handoff, CameraPolicy.Handoff, ClockPolicy.Handoff),
            [GameState.StreetOnFoot] = new(MissionPolicy.Preserve, HeatPolicy.PreserveRunning, ControlPolicy.RequirePedestrian, CameraPolicy.StreetOnFoot, ClockPolicy.Street),
            [GameState.StreetVehicle] = new(MissionPolicy.Preserve, HeatPolicy.PreserveRunning, ControlPolicy.RequireVehicle, CameraPolicy.StreetVehicle, ClockPolicy.Street),
            [GameState.Result] = new(MissionPolicy.PreserveUntilResultCommit, HeatPolicy.PreserveFrozen, ControlPolicy.RequireNone, CameraPolicy.Result, ClockPolicy.Result),
            [GameState.Paused] = new(MissionPolicy.Suspend, HeatPolicy.PreserveFrozen, ControlPolicy.Suspend, CameraPolicy.Preserve, ClockPolicy.Paused),
            [GameState.Menu] = new(MissionPolicy.Suspend, HeatPolicy.PreserveFrozen, ControlPolicy.Suspend, CameraPolicy.Menu, ClockPolicy.Menu),
        }.ToFrozenDictionary();

    private static readonly FrozenDictionary<GameState, IReadOnlyList<GameState>> RequestedTransitions =
        new Dictionary<GameState, IReadOnlyList<GameState>>
        {
            [GameState.Boot] = ReadOnly(GameState.Load, GameState.Menu),
            [GameState.Load] = ReadOnly(GameState.Management, GameState.Menu),
            [GameState.Management] = ReadOnly(GameState.Builder, GameState.StreetOnFoot, GameState.StreetVehicle, GameState.Paused, GameState.Menu),
            [GameState.Builder] = ReadOnly(GameState.Management, GameState.Paused, GameState.Menu),
            [GameState.Transition] = ReadOnly(),
            [GameState.StreetOnFoot] = ReadOnly(GameState.StreetVehicle, GameState.Management, GameState.Result, GameState.Paused, GameState.Menu),
            [GameState.StreetVehicle] = ReadOnly(GameState.StreetOnFoot, GameState.Management, GameState.Result, GameState.Paused, GameState.Menu),
            [GameState.Result] = ReadOnly(GameState.Management, GameState.StreetOnFoot, GameState.StreetVehicle, GameState.Paused, GameState.Menu),
            [GameState.Paused] = ReadOnly(GameState.Menu),
            [GameState.Menu] = ReadOnly(GameState.Load, GameState.Management),
        }.ToFrozenDictionary();

    public static IReadOnlyDictionary<GameState, GameStatePolicy> Policies => StatePolicies;

    public static IReadOnlyDictionary<GameState, IReadOnlyList<GameState>> Transitions => RequestedTransitions;

    public static bool IsStreetState(GameState state) =>
        state is GameState.StreetOnFoot or GameState.StreetVehicle;

    public static TransitionEffects GetTransitionEffects(GameState from, GameState to)
    {
        GameStatePolicy source = StatePolicies[from];
        GameStatePolicy destination = StatePolicies[to];
        return new TransitionEffects(
            new(source.Mission, destination.Mission),
            new(source.Heat, destination.Heat),
            new(source.Control, destination.Control),
            new(source.Camera, destination.Camera),
            new(source.Clock, destination.Clock));
    }

    private static IReadOnlyList<GameState> ReadOnly(params GameState[] states) =>
        Array.AsReadOnly(states);
}

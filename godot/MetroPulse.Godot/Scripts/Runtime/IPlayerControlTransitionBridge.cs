using MetroPulse.Domain.Core;
using MetroPulse.Godot.Camera;

namespace MetroPulse.Godot.Runtime;

/// <summary>
/// Narrow adapter implemented by the Phase 5 entity owner. The session
/// transaction remains usable for control-free states before entities exist.
/// </summary>
public interface IPlayerControlTransitionBridge
{
    IGameplayCameraTarget? ControlledCameraTarget { get; }

    TransitionContext SnapshotContext();

    object? CaptureSourceState();

    TransitionPhaseResult Handoff(TransitionRuntimeContext context);

    void RestoreSourceState(object? sourceState);
}

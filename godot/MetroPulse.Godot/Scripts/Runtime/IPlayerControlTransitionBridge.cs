using MetroPulse.Domain.Core;

namespace MetroPulse.Godot.Runtime;

/// <summary>
/// Narrow adapter implemented by the Phase 5 entity owner. The session
/// transaction remains usable for control-free states before entities exist.
/// </summary>
public interface IPlayerControlTransitionBridge
{
    TransitionContext SnapshotContext();

    object? CaptureSourceState();

    TransitionPhaseResult Handoff(TransitionRuntimeContext context);

    void RestoreSourceState(object? sourceState);
}

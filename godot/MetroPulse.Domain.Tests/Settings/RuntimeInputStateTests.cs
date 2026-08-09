using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Settings;

public sealed class RuntimeInputStateTests
{
    [Fact]
    public void ContextResolutionPreservesModalAndControlPriority()
    {
        Assert.Equal(ControlContexts.Management, ControlContextResolver.Resolve(new()));
        Assert.Equal(ControlContexts.Pedestrian, ControlContextResolver.Resolve(new(PedestrianControlled: true)));
        Assert.Equal(ControlContexts.Aircraft, ControlContextResolver.Resolve(new(AircraftControlled: true, PedestrianControlled: true)));
        Assert.Equal(ControlContexts.Vehicle, ControlContextResolver.Resolve(new(VehicleControlled: true, AircraftControlled: true)));
        Assert.Equal(ControlContexts.Builder, ControlContextResolver.Resolve(new(BuilderActive: true, VehicleControlled: true)));
        Assert.Equal(ControlContexts.Dialogue, ControlContextResolver.Resolve(new(DialogueOpen: true, BuilderActive: true)));
        Assert.Equal(ControlContexts.Pause, ControlContextResolver.Resolve(new(PauseOpen: true, DialogueOpen: true)));
    }

    [Fact]
    public void DeadzoneMatchesBrowserNormalization()
    {
        Assert.Equal(0, RuntimeInputState.ApplyDeadzone(0.12));
        Assert.Equal(0, RuntimeInputState.ApplyDeadzone(-0.15));
        Assert.Equal((0.5 - 0.15) / 0.85, RuntimeInputState.ApplyDeadzone(0.5), 12);
        Assert.Equal((-0.5 + 0.15) / 0.85, RuntimeInputState.ApplyDeadzone(-0.5), 12);
        Assert.Equal(1, RuntimeInputState.ApplyDeadzone(4));
        Assert.Throws<ArgumentOutOfRangeException>(() => RuntimeInputState.ApplyDeadzone(double.NaN));
    }

    [Fact]
    public void GamepadSwitchQuarantinesTheInitiatingInputUntilNeutral()
    {
        var state = new RuntimeInputState();
        Assert.True(state.ObserveActivity(RuntimeInputInterface.Gamepad));

        RuntimeInputSnapshot held = state.FreezePhysicsTick(Sample(
            gamepadConnected: true,
            gamepadHeld: true,
            actions: new Dictionary<string, double> { ["INTERACT"] = 1 }));
        Assert.True(held.Quarantined);
        Assert.Empty(held.Actions);

        RuntimeInputSnapshot neutral = state.FreezePhysicsTick(Sample(gamepadConnected: true));
        Assert.False(neutral.Quarantined);
        Assert.Empty(neutral.Actions);

        RuntimeInputSnapshot accepted = state.FreezePhysicsTick(Sample(
            gamepadConnected: true,
            gamepadHeld: true,
            actions: new Dictionary<string, double> { ["INTERACT"] = 1 }));
        Assert.Contains("INTERACT", accepted.JustPressed);
    }

    [Fact]
    public void KeyboardSwitchAllowsInitiatingKeyButQuarantinesEarlierHeldKeys()
    {
        var state = new RuntimeInputState();
        state.ObserveActivity(RuntimeInputInterface.Gamepad);
        state.FreezePhysicsTick(Sample(gamepadConnected: true));

        Assert.True(state.ObserveActivity(RuntimeInputInterface.Keyboard, ["KeyW"]));
        RuntimeInputSnapshot blocked = state.FreezePhysicsTick(Sample(
            heldKeyboard: ["KeyW", "KeyE"],
            actions: new Dictionary<string, double> { ["THROTTLE"] = 1, ["INTERACT"] = 1 }));
        Assert.True(blocked.Quarantined);

        RuntimeInputSnapshot released = state.FreezePhysicsTick(Sample(heldKeyboard: ["KeyE"]));
        Assert.False(released.Quarantined);
        RuntimeInputSnapshot initiatingKey = state.FreezePhysicsTick(Sample(
            heldKeyboard: ["KeyE"],
            actions: new Dictionary<string, double> { ["INTERACT"] = 1 }));
        Assert.Contains("INTERACT", initiatingKey.JustPressed);
    }

    [Fact]
    public void EdgeStateClearsOnFocusLossAndOrdinaryReleaseRemainsObservable()
    {
        var state = new RuntimeInputState();
        RuntimeInputSnapshot pressed = state.FreezePhysicsTick(Sample(
            heldKeyboard: ["KeyE"],
            actions: new Dictionary<string, double> { ["INTERACT"] = 1 }));
        Assert.Contains("INTERACT", pressed.JustPressed);

        RuntimeInputSnapshot released = state.FreezePhysicsTick(Sample());
        Assert.Contains("INTERACT", released.JustReleased);

        state.FreezePhysicsTick(Sample(
            heldKeyboard: ["Space"],
            actions: new Dictionary<string, double> { ["JUMP"] = 1 }));
        state.ClearAndQuarantine(["Space"]);
        RuntimeInputSnapshot blurred = state.FreezePhysicsTick(Sample(
            heldKeyboard: ["Space"],
            actions: new Dictionary<string, double> { ["JUMP"] = 1 }));
        Assert.Empty(blurred.Actions);
        Assert.Empty(blurred.JustPressed);
        Assert.Empty(blurred.JustReleased);
    }

    [Fact]
    public void ContextChangesAndSuspensionsCannotLeakHeldActions()
    {
        var state = new RuntimeInputState();
        state.FreezePhysicsTick(Sample(
            heldKeyboard: ["KeyW"],
            actions: new Dictionary<string, double> { ["PAN"] = 1 }));

        RuntimeInputSnapshot changed = state.FreezePhysicsTick(Sample(
            context: ControlContexts.Vehicle,
            heldKeyboard: ["KeyW"],
            actions: new Dictionary<string, double> { ["THROTTLE"] = 1 }));
        Assert.True(changed.Quarantined);
        Assert.Empty(changed.Actions);

        InputSuspensionToken token = state.Suspend("transition", ["KeyW"]);
        RuntimeInputSnapshot suspended = state.FreezePhysicsTick(Sample(context: ControlContexts.Vehicle));
        Assert.True(suspended.Suspended);
        Assert.Empty(suspended.Actions);
        Assert.True(state.Resume(token));
        Assert.False(state.Resume(token));
        Assert.False(state.FreezePhysicsTick(Sample(context: ControlContexts.Vehicle)).Suspended);
    }

    [Fact]
    public void PromptSnapshotsFollowContextDeviceAndBindingOverrides()
    {
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> overrides =
            new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>
            {
                [ControlContexts.Vehicle] = new Dictionary<string, IReadOnlyList<string>>
                {
                    ["INTERACT"] = new[] { "KeyG" },
                },
            };
        var state = new RuntimeInputState((context, action, inputInterface) =>
            ControlPromptCatalog.GetInputLabel(context, action, inputInterface, overrides));

        RuntimeInputSnapshot keyboard = state.FreezePhysicsTick(Sample(context: ControlContexts.Vehicle));
        Assert.Equal("G", keyboard.Prompts["INTERACT"]);

        state.ObserveActivity(RuntimeInputInterface.Gamepad);
        state.FreezePhysicsTick(Sample(context: ControlContexts.Vehicle, gamepadConnected: true));
        RuntimeInputSnapshot gamepad = state.FreezePhysicsTick(Sample(context: ControlContexts.Vehicle, gamepadConnected: true));
        Assert.Equal(InputInterfaces.Gamepad, gamepad.ActiveInterface);
        Assert.Equal("Y", gamepad.Prompts["INTERACT"]);
        Assert.Equal("LS ↔", ControlPromptCatalog.GetInputLabel(
            ControlContexts.Aircraft,
            "AIR_ROLL",
            RuntimeInputInterface.Gamepad));
    }

    [Fact]
    public void PublishedSnapshotsAreReadOnlyAndGamepadAxesAreNormalized()
    {
        var state = new RuntimeInputState();
        state.ObserveActivity(RuntimeInputInterface.Gamepad);
        state.FreezePhysicsTick(Sample(gamepadConnected: true));
        RuntimeInputSnapshot snapshot = state.FreezePhysicsTick(Sample(
            gamepadConnected: true,
            leftStick: new InputVector(0.5, -0.5),
            rightTrigger: 0.5));

        Assert.Equal(RuntimeInputState.ApplyDeadzone(0.5), snapshot.LeftStick.X, 12);
        Assert.Equal(RuntimeInputState.ApplyDeadzone(-0.5), snapshot.LeftStick.Y, 12);
        Assert.Equal(RuntimeInputState.ApplyDeadzone(0.5), snapshot.RightTrigger, 12);
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, string>)snapshot.Prompts).Add("unsafe", "unsafe"));
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, double>)snapshot.Actions).Add("unsafe", 1));
        Assert.Throws<NotSupportedException>(() =>
            ((ISet<string>)snapshot.JustPressed).Add("unsafe"));
    }

    [Fact]
    public void DirectionalBindingSlotsHaveStableInputSnapshotIds()
    {
        Assert.Equal("MOVE#SLOT_3", RuntimeInputActionIds.Slot("MOVE", 3));
        Assert.Throws<ArgumentOutOfRangeException>(() => RuntimeInputActionIds.Slot("MOVE", 8));
    }

    private static RuntimeInputSample Sample(
        string context = ControlContexts.Management,
        bool gamepadConnected = false,
        bool gamepadHeld = false,
        IReadOnlyCollection<string>? heldKeyboard = null,
        IReadOnlyDictionary<string, double>? actions = null,
        InputVector? leftStick = null,
        double rightTrigger = 0) => new()
        {
            Context = context,
            GamepadConnected = gamepadConnected,
            GamepadHeld = gamepadHeld,
            HeldKeyboardInputs = heldKeyboard ?? Array.Empty<string>(),
            Actions = actions ?? new Dictionary<string, double>(),
            LeftStick = leftStick ?? InputVector.Zero,
            RightTrigger = rightTrigger,
        };
}

using Godot;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Adapters;

namespace MetroPulse.Godot.Runtime;

/// <summary>Samples engine input once per physics tick and publishes the canonical runtime snapshot.</summary>
public partial class RuntimeInputHost : Node
{
    public const int InputPhysicsPriority = -1000;
    public const float PointerActivityThreshold = 3;

    private readonly HashSet<string> heldKeyboardMouse = new(StringComparer.Ordinal);
    private readonly HashSet<JoyButton> heldGamepadButtons = [];
    private readonly Dictionary<JoyAxis, float> gamepadAxes = [];
    private SettingsStore? settings;
    private RuntimeInputState? state;
    private Func<bool>? unsubscribeSettings;
    private ControlContextSignals contextSignals = new();
    private Vector2 pendingPointerDelta;
    private int gamepadDevice = -1;

    public bool Initialized => state is not null;

    public long PhysicsSnapshotCount { get; private set; }

    public RuntimeInputSnapshot LatestSnapshot => state?.LatestSnapshot
        ?? throw new InvalidOperationException("Runtime input has not been initialized.");

    public void Initialize(SettingsStore settingsAuthority)
    {
        if (Initialized)
        {
            throw new InvalidOperationException("Runtime input has already been initialized.");
        }

        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        state = new RuntimeInputState((context, action, inputInterface) =>
            ControlPromptCatalog.GetInputLabel(
                context,
                action,
                inputInterface,
                settings.GetBindingOverrides()));
        unsubscribeSettings = settings.Subscribe(_ => ClearAndQuarantine());
        ProcessPhysicsPriority = InputPhysicsPriority;
        SetProcessInput(true);
        SetPhysicsProcess(true);
    }

    public void SetContextSignals(ControlContextSignals signals)
    {
        contextSignals = signals ?? throw new ArgumentNullException(nameof(signals));
    }

    public InputSuspensionToken Suspend(string reason) =>
        GetState().Suspend(reason, heldKeyboardMouse.ToArray());

    public bool Resume(InputSuspensionToken token)
    {
        bool resumed = GetState().Resume(token);
        if (resumed) ClearAndQuarantine();
        return resumed;
    }

    public void ClearAndQuarantine()
    {
        if (state is null) return;
        state.ClearAndQuarantine(heldKeyboardMouse.ToArray());
        pendingPointerDelta = Vector2.Zero;
    }

    public void Shutdown()
    {
        _ = unsubscribeSettings?.Invoke();
        unsubscribeSettings = null;
        SetProcessInput(false);
        SetPhysicsProcess(false);
        settings = null;
        state = null;
        heldKeyboardMouse.Clear();
        heldGamepadButtons.Clear();
        gamepadAxes.Clear();
        pendingPointerDelta = Vector2.Zero;
    }

    public override void _Input(InputEvent inputEvent)
    {
        if (state is null) return;

        switch (inputEvent)
        {
            case InputEventKey key when GodotInputMapAdapter.TryGetKeyboardMouseToken(key, out string keyToken):
                if (key.Pressed)
                {
                    state.ObserveActivity(RuntimeInputInterface.Keyboard, heldKeyboardMouse.ToArray());
                    if (!key.Echo)
                    {
                        heldKeyboardMouse.Add(keyToken);
                    }
                }
                else
                {
                    heldKeyboardMouse.Remove(keyToken);
                }
                break;
            case InputEventMouseButton mouse:
                if (mouse.Pressed)
                {
                    state.ObserveActivity(RuntimeInputInterface.Keyboard, heldKeyboardMouse.ToArray());
                }
                if (GodotInputMapAdapter.TryGetKeyboardMouseToken(mouse, out string mouseToken))
                {
                    if (mouse.Pressed) heldKeyboardMouse.Add(mouseToken);
                    else heldKeyboardMouse.Remove(mouseToken);
                }
                break;
            case InputEventMouseMotion motion:
                if (Math.Abs(motion.Relative.X) + Math.Abs(motion.Relative.Y) >= PointerActivityThreshold)
                {
                    state.ObserveActivity(RuntimeInputInterface.Keyboard, heldKeyboardMouse.ToArray());
                }
                pendingPointerDelta += motion.Relative;
                break;
            case InputEventJoypadButton button:
                gamepadDevice = button.Device;
                if (button.Pressed)
                {
                    heldGamepadButtons.Add(button.ButtonIndex);
                    state.ObserveActivity(RuntimeInputInterface.Gamepad, heldKeyboardMouse.ToArray());
                }
                else
                {
                    heldGamepadButtons.Remove(button.ButtonIndex);
                }
                break;
            case InputEventJoypadMotion motion:
                gamepadDevice = motion.Device;
                gamepadAxes[motion.Axis] = motion.AxisValue;
                if (IsAxisActive(motion.Axis, motion.AxisValue))
                {
                    state.ObserveActivity(RuntimeInputInterface.Gamepad, heldKeyboardMouse.ToArray());
                }
                break;
        }
    }

    public override void _PhysicsProcess(double delta)
    {
        _ = delta;
        if (state is null || settings is null) return;

        global::Godot.Collections.Array<int> connectedDevices = global::Godot.Input.GetConnectedJoypads();
        if (connectedDevices.Count == 0)
        {
            gamepadDevice = -1;
            heldGamepadButtons.Clear();
            gamepadAxes.Clear();
        }
        else if (!connectedDevices.Contains(gamepadDevice))
        {
            gamepadDevice = connectedDevices[0];
        }

        string context = ControlContextResolver.Resolve(contextSignals);
        RuntimeInputInterface activeInterface = state.ActiveInterface;
        var actions = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (string action in ControlBindingCatalog.DefaultBindings[context].Keys)
        {
            if (activeInterface == RuntimeInputInterface.Gamepad)
            {
                actions[action] = GodotInputMapAdapter.GetGamepadActionStrength(action, gamepadDevice);
                continue;
            }

            IReadOnlyList<string> bindings = settings.GetBindings(context, action);
            double aggregate = 0;
            for (int index = 0; index < bindings.Count; index++)
            {
                double strength = bindings[index] == KeyboardMouseInputs.PointerMove
                    ? (pendingPointerDelta.IsZeroApprox() ? 0 : 1)
                    : (heldKeyboardMouse.Contains(bindings[index]) ? 1 : 0);
                actions[RuntimeInputActionIds.Slot(action, index)] = strength;
                aggregate = Math.Max(aggregate, strength);
            }
            actions[action] = aggregate;
        }

        bool gamepadConnected = gamepadDevice >= 0;
        bool gamepadHeld = heldGamepadButtons.Count > 0
            || gamepadAxes.Any(pair => IsAxisActive(pair.Key, pair.Value));
        InputVector leftStick = gamepadConnected
            ? ReadStick(JoyAxis.LeftX, JoyAxis.LeftY)
            : InputVector.Zero;
        InputVector rightStick = gamepadConnected
            ? ReadStick(JoyAxis.RightX, JoyAxis.RightY)
            : InputVector.Zero;

        state.FreezePhysicsTick(new RuntimeInputSample
        {
            Context = context,
            GamepadConnected = gamepadConnected,
            GamepadHeld = gamepadHeld,
            HeldKeyboardInputs = heldKeyboardMouse.ToArray(),
            Actions = actions,
            PointerDelta = new InputVector(pendingPointerDelta.X, pendingPointerDelta.Y),
            LeftStick = leftStick,
            RightStick = rightStick,
            LeftTrigger = ReadTrigger(JoyAxis.TriggerLeft),
            RightTrigger = ReadTrigger(JoyAxis.TriggerRight),
        });
        PhysicsSnapshotCount++;
        pendingPointerDelta = Vector2.Zero;
    }

    public override void _Notification(int what)
    {
        if (what == (int)MainLoop.NotificationApplicationFocusOut
            || what == (int)MainLoop.NotificationApplicationPaused)
        {
            ClearAndQuarantine();
        }
    }

    public override void _ExitTree()
    {
        Shutdown();
    }

    private RuntimeInputState GetState() => state
        ?? throw new InvalidOperationException("Runtime input has not been initialized.");

    private InputVector ReadStick(JoyAxis xAxis, JoyAxis yAxis) =>
        new(global::Godot.Input.GetJoyAxis(gamepadDevice, xAxis), global::Godot.Input.GetJoyAxis(gamepadDevice, yAxis));

    private double ReadTrigger(JoyAxis axis) => gamepadDevice < 0
        ? 0
        : Math.Max(0, global::Godot.Input.GetJoyAxis(gamepadDevice, axis));

    private static bool IsAxisActive(JoyAxis axis, float value) =>
        axis is JoyAxis.TriggerLeft or JoyAxis.TriggerRight
            ? value >= RuntimeInputState.GamepadActivityThreshold
            : Math.Abs(value) >= RuntimeInputState.GamepadActivityThreshold;
}

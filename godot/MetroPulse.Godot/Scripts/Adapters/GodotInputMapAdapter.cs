using Godot;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.Adapters;

/// <summary>Projects the validated contextual binding document into namespaced Godot InputMap actions.</summary>
public sealed class GodotInputMapAdapter : IDisposable
{
    public const string ActionPrefix = "metropulse_";
    public const float DefaultDeadzone = 0.15f;

    private readonly SettingsStore store;
    private Func<bool>? unsubscribe;
    private bool disposed;

    public GodotInputMapAdapter(SettingsStore store)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
    }

    public bool Started => unsubscribe is not null;

    public int OwnedActionCount => InputMap.GetActions().Count(action => IsOwned(action));

    public void Start()
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        if (Started)
        {
            return;
        }

        Apply(store.Snapshot());
        unsubscribe = store.Subscribe(settingsEvent => Apply(settingsEvent.Current));
    }

    public void Apply(SettingsDocument document)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        ArgumentNullException.ThrowIfNull(document);
        SettingsDocument validated = SettingsValidator.Validate(document);
        ClearOwnedActions();

        foreach (string context in ControlContexts.All)
        {
            foreach (string action in ControlBindingCatalog.DefaultBindings[context].Keys)
            {
                StringName aggregateName = GetActionName(context, action);
                AddAction(aggregateName);

                IReadOnlyList<string> bindings = ControlBindingCatalog.GetBindings(
                    context,
                    action,
                    validated.Bindings);
                for (int index = 0; index < bindings.Count; index++)
                {
                    StringName slotName = GetSlotActionName(context, action, index);
                    AddAction(slotName);
                    InputEvent? keyboardEvent = CreateKeyboardMouseEvent(bindings[index]);
                    if (keyboardEvent is null)
                    {
                        continue;
                    }

                    InputMap.ActionAddEvent(aggregateName, keyboardEvent);
                    InputMap.ActionAddEvent(slotName, keyboardEvent);
                }

                foreach (InputEvent gamepadEvent in CreateGamepadEvents(action))
                {
                    InputMap.ActionAddEvent(aggregateName, gamepadEvent);
                }
            }
        }
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        _ = unsubscribe?.Invoke();
        unsubscribe = null;
        ClearOwnedActions();
    }

    public static StringName GetActionName(string context, string action)
    {
        ValidateContextAction(context, action);
        return new StringName($"{ActionPrefix}{context.ToLowerInvariant()}_{action.ToLowerInvariant()}");
    }

    public static StringName GetSlotActionName(string context, string action, int index)
    {
        ValidateContextAction(context, action);
        if (index is < 0 or >= 8)
        {
            throw new ArgumentOutOfRangeException(nameof(index), "Binding slot indices must be between 0 and 7.");
        }

        return new StringName($"{ActionPrefix}{context.ToLowerInvariant()}_{action.ToLowerInvariant()}_slot_{index}");
    }

    private static void ValidateContextAction(string context, string action)
    {
        if (!ControlBindingCatalog.IsKnownAction(context, action))
        {
            throw new ArgumentException($"Unknown contextual action: {context}.{action}.");
        }
    }

    private static void AddAction(StringName actionName)
    {
        InputMap.AddAction(actionName, DefaultDeadzone);
    }

    private static void ClearOwnedActions()
    {
        foreach (StringName action in InputMap.GetActions())
        {
            if (IsOwned(action))
            {
                InputMap.EraseAction(action);
            }
        }
    }

    private static bool IsOwned(StringName action) =>
        action.ToString().StartsWith(ActionPrefix, StringComparison.Ordinal);

    private static InputEvent? CreateKeyboardMouseEvent(string input)
    {
        if (string.Equals(input, KeyboardMouseInputs.PointerMove, StringComparison.Ordinal))
        {
            // Mouse motion is sampled as an analog source; Godot does not permit it as an InputMap action event.
            return null;
        }

        if (input.StartsWith("Mouse", StringComparison.Ordinal))
        {
            MouseButton button = input switch
            {
                "Mouse0" => MouseButton.Left,
                "Mouse1" => MouseButton.Middle,
                "Mouse2" => MouseButton.Right,
                _ => throw new ArgumentOutOfRangeException(nameof(input), $"Unknown mouse input: {input}."),
            };
            return new InputEventMouseButton { ButtonIndex = button };
        }

        (Key key, KeyLocation location) = ParseKey(input);
        return new InputEventKey
        {
            PhysicalKeycode = key,
            Location = location,
        };
    }

    private static (Key Key, KeyLocation Location) ParseKey(string input)
    {
        if (input.Length == 4 && input.StartsWith("Key", StringComparison.Ordinal))
        {
            return ((Key)Enum.Parse(typeof(Key), input[3..], ignoreCase: false), KeyLocation.Unspecified);
        }

        if (input.Length == 6 && input.StartsWith("Digit", StringComparison.Ordinal))
        {
            return ((Key)Enum.Parse(typeof(Key), $"Key{input[5]}", ignoreCase: false), KeyLocation.Unspecified);
        }

        if (input.StartsWith('F') && int.TryParse(input[1..], out int functionNumber))
        {
            return ((Key)Enum.Parse(typeof(Key), $"F{functionNumber}", ignoreCase: false), KeyLocation.Unspecified);
        }

        return input switch
        {
            "Tab" => (Key.Tab, KeyLocation.Unspecified),
            "Enter" => (Key.Enter, KeyLocation.Unspecified),
            "Escape" => (Key.Escape, KeyLocation.Unspecified),
            "Space" => (Key.Space, KeyLocation.Unspecified),
            "Delete" => (Key.Delete, KeyLocation.Unspecified),
            "Backspace" => (Key.Backspace, KeyLocation.Unspecified),
            "ShiftLeft" => (Key.Shift, KeyLocation.Left),
            "ShiftRight" => (Key.Shift, KeyLocation.Right),
            "ControlLeft" => (Key.Ctrl, KeyLocation.Left),
            "ControlRight" => (Key.Ctrl, KeyLocation.Right),
            "AltLeft" => (Key.Alt, KeyLocation.Left),
            "AltRight" => (Key.Alt, KeyLocation.Right),
            "ArrowUp" => (Key.Up, KeyLocation.Unspecified),
            "ArrowDown" => (Key.Down, KeyLocation.Unspecified),
            "ArrowLeft" => (Key.Left, KeyLocation.Unspecified),
            "ArrowRight" => (Key.Right, KeyLocation.Unspecified),
            _ => throw new ArgumentOutOfRangeException(nameof(input), $"Unknown keyboard input: {input}."),
        };
    }

    private static IEnumerable<InputEvent> CreateGamepadEvents(string action) => action switch
    {
        "NAVIGATE" => Buttons(JoyButton.DpadUp, JoyButton.DpadDown, JoyButton.DpadLeft, JoyButton.DpadRight),
        "SELECT" or "PLACE" or "HANDBRAKE" or "AIR_BRAKE" or "JUMP" or "CONFIRM" => Buttons(JoyButton.A),
        "ORBIT" or "CAMERA" => Axes(JoyAxis.RightX, JoyAxis.RightY),
        "PAN" or "AIM" or "MOVE" => Axes(JoyAxis.LeftX, JoyAxis.LeftY),
        "BUILD" or "VEHICLE_RESET" => Buttons(JoyButton.Back),
        "MODE" or "PAUSE_MENU" => Buttons(JoyButton.Start),
        "ROTATE" or "INTERACT" => Buttons(JoyButton.Y),
        "DELETE" or "AIR_RESET" or "ATTACK" => Buttons(JoyButton.X),
        "BACK" => Buttons(JoyButton.B),
        "DRIVE" or "AIR_ROLL" => Axes(JoyAxis.LeftX),
        "AIR_PITCH" => Axes(JoyAxis.LeftY),
        "THROTTLE" => Axis(JoyAxis.TriggerRight, 1),
        "BRAKE" => Axis(JoyAxis.TriggerLeft, 1),
        "AIR_THROTTLE" => [AxisEvent(JoyAxis.TriggerRight, 1), AxisEvent(JoyAxis.TriggerLeft, 1)],
        "HORN" => Buttons(JoyButton.LeftShoulder),
        "SPRINT" => Buttons(JoyButton.LeftStick),
        _ => [],
    };

    private static InputEvent[] Buttons(params JoyButton[] buttons) =>
        buttons.Select(button => (InputEvent)new InputEventJoypadButton { ButtonIndex = button }).ToArray();

    private static InputEvent[] Axes(params JoyAxis[] axes) =>
        axes.SelectMany(axis => new[] { AxisEvent(axis, -1), AxisEvent(axis, 1) }).ToArray();

    private static InputEvent[] Axis(JoyAxis axis, float direction) => [AxisEvent(axis, direction)];

    private static InputEventJoypadMotion AxisEvent(JoyAxis axis, float direction) =>
        new() { Axis = axis, AxisValue = direction };
}

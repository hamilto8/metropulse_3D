using System.Collections.ObjectModel;
using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.Adapters;

/// <summary>Projects the validated contextual binding document into namespaced Godot InputMap actions.</summary>
public sealed class GodotInputMapAdapter : IDisposable
{
    public const string ActionPrefix = "metropulse_";
    public const float DefaultDeadzone = 0.15f;

    private static readonly IReadOnlyDictionary<string, GamepadBinding[]> GamepadBindings =
        CreateGamepadBindings();

    private readonly SettingsStore store;
    private readonly FeatureFlagSet features;
    private Func<bool>? unsubscribe;
    private bool disposed;

    public GodotInputMapAdapter(SettingsStore store, FeatureFlagSet? featureFlags = null)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        features = featureFlags ?? new FeatureFlagSet();
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
            if (context == ControlContexts.Aircraft && !features.IsEnabled(FeatureIds.Aircraft)) continue;
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
                    using InputEvent? keyboardEvent = CreateKeyboardMouseEvent(bindings[index]);
                    if (keyboardEvent is null)
                    {
                        continue;
                    }

                    InputMap.ActionAddEvent(aggregateName, keyboardEvent);
                    InputMap.ActionAddEvent(slotName, keyboardEvent);
                }

                foreach (InputEvent gamepadEvent in CreateGamepadEvents(action))
                {
                    using (gamepadEvent)
                    {
                        InputMap.ActionAddEvent(aggregateName, gamepadEvent);
                    }
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

    public static bool TryGetKeyboardMouseToken(InputEvent inputEvent, out string token)
    {
        ArgumentNullException.ThrowIfNull(inputEvent);
        switch (inputEvent)
        {
            case InputEventMouseButton mouse:
                token = mouse.ButtonIndex switch
                {
                    MouseButton.Left => "Mouse0",
                    MouseButton.Middle => "Mouse1",
                    MouseButton.Right => "Mouse2",
                    _ => string.Empty,
                };
                return token.Length > 0;
            case InputEventKey key:
                token = FormatPhysicalKey(key.PhysicalKeycode, key.Location);
                return token.Length > 0;
            default:
                token = string.Empty;
                return false;
        }
    }

    public static float GetGamepadActionStrength(string action, int device)
    {
        if (device < 0 || !GamepadBindings.TryGetValue(action, out GamepadBinding[]? bindings)) return 0;
        float strength = 0;
        foreach (GamepadBinding binding in bindings)
        {
            float candidate = binding.IsButton
                ? (Input.IsJoyButtonPressed(device, binding.Button) ? 1 : 0)
                : Math.Max(0, Input.GetJoyAxis(device, binding.Axis) * binding.Direction);
            strength = Math.Max(strength, candidate);
        }
        return strength;
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

    private static string FormatPhysicalKey(Key key, KeyLocation location)
    {
        if (key is >= Key.A and <= Key.Z)
        {
            return $"Key{(char)key}";
        }
        if (key is >= Key.Key0 and <= Key.Key9)
        {
            return $"Digit{(char)key}";
        }
        string name = key.ToString();
        if (name.Length is 2 or 3 && name[0] == 'F' && int.TryParse(name[1..], out int functionNumber))
        {
            return functionNumber is >= 1 and <= 12 ? name : string.Empty;
        }
        return (key, location) switch
        {
            (Key.Tab, _) => "Tab",
            (Key.Enter, _) => "Enter",
            (Key.Escape, _) => "Escape",
            (Key.Space, _) => "Space",
            (Key.Delete, _) => "Delete",
            (Key.Backspace, _) => "Backspace",
            (Key.Shift, KeyLocation.Right) => "ShiftRight",
            (Key.Shift, _) => "ShiftLeft",
            (Key.Ctrl, KeyLocation.Right) => "ControlRight",
            (Key.Ctrl, _) => "ControlLeft",
            (Key.Alt, KeyLocation.Right) => "AltRight",
            (Key.Alt, _) => "AltLeft",
            (Key.Up, _) => "ArrowUp",
            (Key.Down, _) => "ArrowDown",
            (Key.Left, _) => "ArrowLeft",
            (Key.Right, _) => "ArrowRight",
            _ => string.Empty,
        };
    }

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

    private static IEnumerable<InputEvent> CreateGamepadEvents(string action)
    {
        if (!GamepadBindings.TryGetValue(action, out GamepadBinding[]? bindings)) return [];
        return bindings.Select(binding => binding.IsButton
            ? (InputEvent)new InputEventJoypadButton { ButtonIndex = binding.Button }
            : AxisEvent(binding.Axis, binding.Direction));
    }

    private static IReadOnlyDictionary<string, GamepadBinding[]> CreateGamepadBindings()
    {
        var bindings = new Dictionary<string, GamepadBinding[]>(StringComparer.Ordinal);
        Add([Button(JoyButton.DpadUp), Button(JoyButton.DpadDown), Button(JoyButton.DpadLeft), Button(JoyButton.DpadRight)], "NAVIGATE");
        Add([Button(JoyButton.A)], "SELECT", "PLACE", "HANDBRAKE", "AIR_BRAKE", "JUMP", "CONFIRM");
        Add(Axes(JoyAxis.RightX, JoyAxis.RightY), "ORBIT", "CAMERA");
        Add(Axes(JoyAxis.LeftX, JoyAxis.LeftY), "PAN", "AIM", "MOVE");
        Add([Button(JoyButton.Back)], "BUILD", "VEHICLE_RESET");
        Add([Button(JoyButton.Start)], "MODE", "PAUSE_MENU");
        Add([Button(JoyButton.Y)], "ROTATE", "INTERACT");
        Add([Button(JoyButton.X)], "DELETE", "AIR_RESET", "ATTACK");
        Add([Button(JoyButton.B)], "BACK");
        Add(Axes(JoyAxis.LeftX), "DRIVE", "AIR_ROLL");
        Add(Axes(JoyAxis.LeftY), "AIR_PITCH");
        Add([Axis(JoyAxis.TriggerRight, 1)], "THROTTLE");
        Add([Axis(JoyAxis.TriggerLeft, 1)], "BRAKE");
        Add([Axis(JoyAxis.TriggerRight, 1), Axis(JoyAxis.TriggerLeft, 1)], "AIR_THROTTLE");
        Add([Button(JoyButton.LeftShoulder)], "HORN");
        Add([Button(JoyButton.LeftStick)], "SPRINT");
        return new ReadOnlyDictionary<string, GamepadBinding[]>(bindings);

        void Add(GamepadBinding[] gamepadBindings, params string[] actions)
        {
            foreach (string action in actions) bindings.Add(action, gamepadBindings);
        }
    }

    private static GamepadBinding[] Axes(params JoyAxis[] axes) =>
        axes.SelectMany(axis => new[] { Axis(axis, -1), Axis(axis, 1) }).ToArray();

    private static GamepadBinding Button(JoyButton button) =>
        new(true, button, default, 0);

    private static GamepadBinding Axis(JoyAxis axis, float direction) =>
        new(false, default, axis, direction);

    private static InputEventJoypadMotion AxisEvent(JoyAxis axis, float direction) =>
        new() { Axis = axis, AxisValue = direction };

    private readonly record struct GamepadBinding(
        bool IsButton,
        JoyButton Button,
        JoyAxis Axis,
        float Direction);
}

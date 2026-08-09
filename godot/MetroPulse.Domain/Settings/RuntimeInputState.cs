using System.Collections.Frozen;
using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Settings;

public enum RuntimeInputInterface
{
    Keyboard,
    Gamepad,
}

public static class RuntimeInputInterfaceExtensions
{
    public static string ToToken(this RuntimeInputInterface inputInterface) => inputInterface switch
    {
        RuntimeInputInterface.Keyboard => InputInterfaces.Keyboard,
        RuntimeInputInterface.Gamepad => InputInterfaces.Gamepad,
        _ => throw new ArgumentOutOfRangeException(nameof(inputInterface), inputInterface, null),
    };
}

public sealed record ControlContextSignals(
    bool PauseOpen = false,
    bool DialogueOpen = false,
    bool BuilderActive = false,
    bool VehicleControlled = false,
    bool AircraftControlled = false,
    bool PedestrianControlled = false);

public static class ControlContextResolver
{
    public static string Resolve(ControlContextSignals signals)
    {
        ArgumentNullException.ThrowIfNull(signals);
        if (signals.PauseOpen) return ControlContexts.Pause;
        if (signals.DialogueOpen) return ControlContexts.Dialogue;
        if (signals.BuilderActive) return ControlContexts.Builder;
        if (signals.VehicleControlled) return ControlContexts.Vehicle;
        if (signals.AircraftControlled) return ControlContexts.Aircraft;
        if (signals.PedestrianControlled) return ControlContexts.Pedestrian;
        return ControlContexts.Management;
    }
}

public static class ControlPromptCatalog
{
    private static readonly IReadOnlyDictionary<string, string> GamepadLabels =
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["NAVIGATE"] = "D-Pad",
            ["SELECT"] = "A",
            ["ORBIT"] = "RS",
            ["PAN"] = "LS",
            ["BUILD"] = "View",
            ["MODE"] = "Menu",
            ["MOVE"] = "LS",
            ["AIM"] = "LS",
            ["PLACE"] = "A",
            ["ROTATE"] = "Y",
            ["DELETE"] = "X",
            ["BACK"] = "B",
            ["PAUSE_MENU"] = "Menu",
            ["DRIVE"] = "LS",
            ["THROTTLE"] = "RT",
            ["BRAKE"] = "LT",
            ["HANDBRAKE"] = "A",
            ["VEHICLE_RESET"] = "View",
            ["INTERACT"] = "Y",
            ["HORN"] = "LB",
            ["CAMERA"] = "RS",
            ["AIR_ROLL"] = "LS ↔",
            ["AIR_PITCH"] = "LS ↕",
            ["AIR_THROTTLE"] = "RT / LT",
            ["AIR_BRAKE"] = "A",
            ["AIR_RESET"] = "X",
            ["JUMP"] = "A",
            ["SPRINT"] = "LS",
            ["ATTACK"] = "X",
            ["CONFIRM"] = "A",
        });

    public static string GetInputLabel(
        string context,
        string action,
        RuntimeInputInterface inputInterface,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides = null)
    {
        if (!ControlBindingCatalog.IsKnownAction(context, action))
        {
            throw new ArgumentException($"Unknown contextual action: {context}.{action}.");
        }

        return inputInterface == RuntimeInputInterface.Gamepad
            ? GamepadLabels.GetValueOrDefault(action) ?? string.Empty
            : ControlBindingCatalog.GetActionLabel(context, action, overrides);
    }
}

public static class RuntimeInputActionIds
{
    public static string Slot(string action, int index)
    {
        if (string.IsNullOrWhiteSpace(action))
        {
            throw new ArgumentException("An action ID is required.", nameof(action));
        }
        if (index is < 0 or >= 8)
        {
            throw new ArgumentOutOfRangeException(nameof(index), "Binding slot indices must be between 0 and 7.");
        }
        return $"{action}#SLOT_{index}";
    }
}

public sealed record InputVector(double X, double Y)
{
    public static readonly InputVector Zero = new(0, 0);
}

public sealed record RuntimeInputSample
{
    public required string Context { get; init; }

    public required bool GamepadConnected { get; init; }

    public required IReadOnlyDictionary<string, double> Actions { get; init; }

    public IReadOnlyCollection<string> HeldKeyboardInputs { get; init; } = Array.Empty<string>();

    public bool GamepadHeld { get; init; }

    public InputVector PointerDelta { get; init; } = InputVector.Zero;

    public InputVector LeftStick { get; init; } = InputVector.Zero;

    public InputVector RightStick { get; init; } = InputVector.Zero;

    public double LeftTrigger { get; init; }

    public double RightTrigger { get; init; }
}

public sealed record RuntimeInputSnapshot
{
    public required long PhysicsTick { get; init; }

    public required string Context { get; init; }

    public required string ActiveInterface { get; init; }

    public required bool GamepadConnected { get; init; }

    public required bool Quarantined { get; init; }

    public required bool Suspended { get; init; }

    public required IReadOnlyDictionary<string, double> Actions { get; init; }

    public required IReadOnlySet<string> JustPressed { get; init; }

    public required IReadOnlySet<string> JustReleased { get; init; }

    public required InputVector PointerDelta { get; init; }

    public required InputVector LeftStick { get; init; }

    public required InputVector RightStick { get; init; }

    public required double LeftTrigger { get; init; }

    public required double RightTrigger { get; init; }

    public required IReadOnlyDictionary<string, string> Prompts { get; init; }
}

public sealed record InputSuspensionToken(long Id, string Reason);

/// <summary>Renderer-independent owner of device, context, edge, quarantine, and physics-tick input snapshots.</summary>
public sealed class RuntimeInputState
{
    public const double DefaultDeadzone = 0.15;
    public const double GamepadActivityThreshold = 0.32;
    public const double PressedThreshold = 0.5;

    private readonly Func<string, string, RuntimeInputInterface, string> getPromptLabel;
    private readonly HashSet<string> quarantinedKeyboardInputs = new(StringComparer.Ordinal);
    private readonly Dictionary<long, InputSuspensionToken> suspensions = [];
    private IReadOnlyDictionary<string, double> previousActions = EmptyActions();
    private long suspensionSerial;
    private bool gamepadQuarantined;

    public RuntimeInputState(
        Func<string, string, RuntimeInputInterface, string>? getPromptLabel = null)
    {
        this.getPromptLabel = getPromptLabel
            ?? ((context, action, inputInterface) =>
                ControlPromptCatalog.GetInputLabel(context, action, inputInterface));
    }

    public RuntimeInputInterface ActiveInterface { get; private set; } = RuntimeInputInterface.Keyboard;

    public string Context { get; private set; } = ControlContexts.Management;

    public bool GamepadConnected { get; private set; }

    public long PhysicsTick { get; private set; }

    public RuntimeInputSnapshot LatestSnapshot { get; private set; } = EmptySnapshot();

    public bool ObserveActivity(
        RuntimeInputInterface inputInterface,
        IReadOnlyCollection<string>? currentlyHeldKeyboardInputs = null)
    {
        if (!Enum.IsDefined(inputInterface))
        {
            throw new ArgumentOutOfRangeException(nameof(inputInterface));
        }
        if (ActiveInterface == inputInterface)
        {
            return false;
        }

        ClearAndQuarantine(currentlyHeldKeyboardInputs ?? Array.Empty<string>());
        ActiveInterface = inputInterface;
        return true;
    }

    public void ClearAndQuarantine(IReadOnlyCollection<string>? currentlyHeldKeyboardInputs = null)
    {
        foreach (string input in currentlyHeldKeyboardInputs ?? Array.Empty<string>())
        {
            if (!string.IsNullOrWhiteSpace(input)) quarantinedKeyboardInputs.Add(input);
        }
        gamepadQuarantined = true;
        previousActions = EmptyActions();
    }

    public InputSuspensionToken Suspend(
        string reason,
        IReadOnlyCollection<string>? currentlyHeldKeyboardInputs = null)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("An input suspension reason is required.", nameof(reason));
        }
        var token = new InputSuspensionToken(++suspensionSerial, reason);
        suspensions.Add(token.Id, token);
        ClearAndQuarantine(currentlyHeldKeyboardInputs);
        return token;
    }

    public bool Resume(InputSuspensionToken token)
    {
        ArgumentNullException.ThrowIfNull(token);
        return suspensions.Remove(token.Id);
    }

    public RuntimeInputSnapshot FreezePhysicsTick(RuntimeInputSample sample)
    {
        ArgumentNullException.ThrowIfNull(sample);
        if (!ControlBindingCatalog.IsKnownContext(sample.Context))
        {
            throw new ArgumentException($"Unknown binding context: {sample.Context}.", nameof(sample));
        }
        ArgumentNullException.ThrowIfNull(sample.Actions);
        ValidateVector(sample.PointerDelta, nameof(sample.PointerDelta));
        ValidateVector(sample.LeftStick, nameof(sample.LeftStick));
        ValidateVector(sample.RightStick, nameof(sample.RightStick));

        PhysicsTick++;
        if (!string.Equals(Context, sample.Context, StringComparison.Ordinal))
        {
            Context = sample.Context;
            ClearAndQuarantine(sample.HeldKeyboardInputs);
        }

        GamepadConnected = sample.GamepadConnected;
        if (!GamepadConnected && ActiveInterface == RuntimeInputInterface.Gamepad)
        {
            ObserveActivity(RuntimeInputInterface.Keyboard, sample.HeldKeyboardInputs);
        }

        quarantinedKeyboardInputs.IntersectWith(sample.HeldKeyboardInputs);
        if (gamepadQuarantined && !sample.GamepadHeld)
        {
            gamepadQuarantined = false;
        }

        bool activeDeviceQuarantined = ActiveInterface switch
        {
            RuntimeInputInterface.Keyboard => quarantinedKeyboardInputs.Count > 0,
            RuntimeInputInterface.Gamepad => gamepadQuarantined,
            _ => true,
        };
        bool suspended = suspensions.Count > 0;
        bool blocked = activeDeviceQuarantined || suspended;
        IReadOnlyDictionary<string, double> actions = blocked
            ? EmptyActions()
            : NormalizeActions(sample.Actions);
        IReadOnlySet<string> justPressed = blocked
            ? EmptySet()
            : actions.Where(pair => IsPressed(pair.Value) && !WasPressed(pair.Key))
                .Select(pair => pair.Key)
                .ToHashSet(StringComparer.Ordinal);
        IReadOnlySet<string> justReleased = blocked
            ? EmptySet()
            : previousActions.Where(pair => IsPressed(pair.Value) && !IsPressed(actions.GetValueOrDefault(pair.Key)))
                .Select(pair => pair.Key)
                .ToHashSet(StringComparer.Ordinal);
        previousActions = actions;

        InputVector pointer = !blocked && ActiveInterface == RuntimeInputInterface.Keyboard
            ? sample.PointerDelta
            : InputVector.Zero;
        InputVector leftStick = !blocked && ActiveInterface == RuntimeInputInterface.Gamepad
            ? ApplyDeadzone(sample.LeftStick)
            : InputVector.Zero;
        InputVector rightStick = !blocked && ActiveInterface == RuntimeInputInterface.Gamepad
            ? ApplyDeadzone(sample.RightStick)
            : InputVector.Zero;
        double leftTrigger = !blocked && ActiveInterface == RuntimeInputInterface.Gamepad
            ? ApplyDeadzone(ClampUnit(sample.LeftTrigger))
            : 0;
        double rightTrigger = !blocked && ActiveInterface == RuntimeInputInterface.Gamepad
            ? ApplyDeadzone(ClampUnit(sample.RightTrigger))
            : 0;

        var prompts = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (string action in ControlBindingCatalog.DefaultBindings[Context].Keys)
        {
            prompts[action] = getPromptLabel(Context, action, ActiveInterface);
        }

        LatestSnapshot = new RuntimeInputSnapshot
        {
            PhysicsTick = PhysicsTick,
            Context = Context,
            ActiveInterface = ActiveInterface.ToToken(),
            GamepadConnected = GamepadConnected,
            Quarantined = activeDeviceQuarantined,
            Suspended = suspended,
            Actions = actions,
            JustPressed = FreezeSet(justPressed),
            JustReleased = FreezeSet(justReleased),
            PointerDelta = pointer,
            LeftStick = leftStick,
            RightStick = rightStick,
            LeftTrigger = leftTrigger,
            RightTrigger = rightTrigger,
            Prompts = new ReadOnlyDictionary<string, string>(prompts),
        };
        return LatestSnapshot;
    }

    public static double ApplyDeadzone(double value, double deadzone = DefaultDeadzone)
    {
        if (!double.IsFinite(value) || !double.IsFinite(deadzone) || deadzone is < 0 or >= 1)
        {
            throw new ArgumentOutOfRangeException(nameof(value), "Input values and dead zones must be finite and the dead zone must be in [0, 1).");
        }
        double clamped = Math.Clamp(value, -1, 1);
        return Math.Abs(clamped) < deadzone
            ? 0
            : (clamped - Math.Sign(clamped) * deadzone) / (1 - deadzone);
    }

    private static InputVector ApplyDeadzone(InputVector value) =>
        new(ApplyDeadzone(value.X), ApplyDeadzone(value.Y));

    private bool WasPressed(string action) => IsPressed(previousActions.GetValueOrDefault(action));

    private static bool IsPressed(double value) => value >= PressedThreshold;

    private static IReadOnlyDictionary<string, double> NormalizeActions(IReadOnlyDictionary<string, double> values)
    {
        var normalized = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach ((string id, double value) in values)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Input action IDs must not be empty.", nameof(values));
            if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(nameof(values), $"Input action {id} must be finite.");
            if (!normalized.TryAdd(id, ApplyDeadzone(value)))
            {
                throw new ArgumentException($"Input action ID is duplicated: {id}.", nameof(values));
            }
        }
        return new ReadOnlyDictionary<string, double>(normalized);
    }

    private static double ClampUnit(double value)
    {
        if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(nameof(value));
        return Math.Clamp(value, 0, 1);
    }

    private static void ValidateVector(InputVector value, string name)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (!double.IsFinite(value.X) || !double.IsFinite(value.Y))
        {
            throw new ArgumentOutOfRangeException(name, "Input vectors must be finite.");
        }
    }

    private static IReadOnlyDictionary<string, double> EmptyActions() =>
        new ReadOnlyDictionary<string, double>(new Dictionary<string, double>(StringComparer.Ordinal));

    private static IReadOnlySet<string> EmptySet() =>
        Array.Empty<string>().ToFrozenSet(StringComparer.Ordinal);

    private static IReadOnlySet<string> FreezeSet(IEnumerable<string> values) =>
        values.ToFrozenSet(StringComparer.Ordinal);

    private static RuntimeInputSnapshot EmptySnapshot() => new()
    {
        PhysicsTick = 0,
        Context = ControlContexts.Management,
        ActiveInterface = InputInterfaces.Keyboard,
        GamepadConnected = false,
        Quarantined = false,
        Suspended = false,
        Actions = EmptyActions(),
        JustPressed = EmptySet(),
        JustReleased = EmptySet(),
        PointerDelta = InputVector.Zero,
        LeftStick = InputVector.Zero,
        RightStick = InputVector.Zero,
        LeftTrigger = 0,
        RightTrigger = 0,
        Prompts = new ReadOnlyDictionary<string, string>(new Dictionary<string, string>()),
    };
}

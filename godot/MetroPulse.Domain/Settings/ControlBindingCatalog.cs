using System.Collections.ObjectModel;
using System.Text.RegularExpressions;

namespace MetroPulse.Domain.Settings;

public static class InputInterfaces
{
    public const string Keyboard = "KEYBOARD";
    public const string Gamepad = "GAMEPAD";
}

public static class ControlContexts
{
    public const string Management = "MANAGEMENT";
    public const string Builder = "BUILDER";
    public const string Vehicle = "VEHICLE";
    public const string Aircraft = "AIRCRAFT";
    public const string Pedestrian = "PEDESTRIAN";
    public const string Dialogue = "DIALOGUE";
    public const string Pause = "PAUSE";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly(
    [
        Management,
        Builder,
        Vehicle,
        Aircraft,
        Pedestrian,
        Dialogue,
        Pause,
    ]);
}

public static class KeyboardMouseInputs
{
    public const string Tab = "Tab";
    public const string Enter = "Enter";
    public const string Escape = "Escape";
    public const string Space = "Space";
    public const string Delete = "Delete";
    public const string ShiftLeft = "ShiftLeft";
    public const string KeyA = "KeyA";
    public const string KeyD = "KeyD";
    public const string KeyE = "KeyE";
    public const string KeyF = "KeyF";
    public const string KeyM = "KeyM";
    public const string KeyQ = "KeyQ";
    public const string KeyR = "KeyR";
    public const string KeyS = "KeyS";
    public const string KeyW = "KeyW";
    public const string ArrowUp = "ArrowUp";
    public const string ArrowDown = "ArrowDown";
    public const string ArrowLeft = "ArrowLeft";
    public const string ArrowRight = "ArrowRight";
    public const string MousePrimary = "Mouse0";
    public const string MouseSecondary = "Mouse2";
    public const string PointerMove = "PointerMove";
}

/// <summary>Stable contextual action catalog and keyboard/mouse override validator.</summary>
public static class ControlBindingCatalog
{
    private static readonly HashSet<string> MouseOnlyActions =
        ["ORBIT", "CAMERA", "SELECT", "PLACE", "ATTACK"];

    private static readonly HashSet<string> NamedKeyboardInputs =
    [
        "Tab",
        "Enter",
        "Escape",
        "Space",
        "Delete",
        "Backspace",
        "ShiftLeft",
        "ShiftRight",
        "ControlLeft",
        "ControlRight",
        "AltLeft",
        "AltRight",
        "Mouse0",
        "Mouse1",
        "Mouse2",
        "PointerMove",
    ];

    private static readonly IReadOnlyDictionary<string, string> InputLabels =
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Space"] = "Space",
            ["ShiftLeft"] = "Shift",
            ["Mouse0"] = "Left click",
            ["Mouse1"] = "Middle click",
            ["Mouse2"] = "Right click",
            ["PointerMove"] = "Mouse move",
        });

    public static readonly IReadOnlyList<string> ReservedBrowserInputs = Array.AsReadOnly(
        ["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"]);

    public static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> DefaultBindings =
        FreezeDefaults(new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(StringComparer.Ordinal)
        {
            [ControlContexts.Management] = Actions(
                ("ORBIT", [KeyboardMouseInputs.MousePrimary]),
                ("PAN", [KeyboardMouseInputs.KeyW, KeyboardMouseInputs.KeyS, KeyboardMouseInputs.KeyA, KeyboardMouseInputs.KeyD, KeyboardMouseInputs.KeyQ, KeyboardMouseInputs.KeyE, KeyboardMouseInputs.ShiftLeft]),
                ("SELECT", [KeyboardMouseInputs.MousePrimary]),
                ("NAVIGATE", [KeyboardMouseInputs.Tab]),
                ("BUILD", [KeyboardMouseInputs.KeyF]),
                ("MODE", [KeyboardMouseInputs.KeyM]),
                ("PAUSE_MENU", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Builder] = Actions(
                ("AIM", [KeyboardMouseInputs.PointerMove]),
                ("PLACE", [KeyboardMouseInputs.MousePrimary]),
                ("ROTATE", [KeyboardMouseInputs.KeyR]),
                ("DELETE", [KeyboardMouseInputs.Delete]),
                ("NAVIGATE", [KeyboardMouseInputs.Tab]),
                ("BACK", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Vehicle] = Actions(
                ("DRIVE", [KeyboardMouseInputs.KeyA, KeyboardMouseInputs.KeyD, KeyboardMouseInputs.ArrowLeft, KeyboardMouseInputs.ArrowRight]),
                ("THROTTLE", [KeyboardMouseInputs.KeyW, KeyboardMouseInputs.ArrowUp]),
                ("BRAKE", [KeyboardMouseInputs.KeyS, KeyboardMouseInputs.ArrowDown]),
                ("INTERACT", [KeyboardMouseInputs.KeyE]),
                ("HANDBRAKE", [KeyboardMouseInputs.Space]),
                ("VEHICLE_RESET", [KeyboardMouseInputs.KeyR]),
                ("CAMERA", [KeyboardMouseInputs.MouseSecondary]),
                ("HORN", [KeyboardMouseInputs.ShiftLeft]),
                ("MODE", [KeyboardMouseInputs.KeyM]),
                ("PAUSE_MENU", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Aircraft] = Actions(
                ("AIR_ROLL", [KeyboardMouseInputs.KeyA, KeyboardMouseInputs.KeyD]),
                ("AIR_PITCH", [KeyboardMouseInputs.ArrowUp, KeyboardMouseInputs.ArrowDown]),
                ("AIR_THROTTLE", [KeyboardMouseInputs.KeyW, KeyboardMouseInputs.KeyS]),
                ("AIR_BRAKE", [KeyboardMouseInputs.Space]),
                ("CAMERA", [KeyboardMouseInputs.MouseSecondary]),
                ("INTERACT", [KeyboardMouseInputs.KeyE]),
                ("AIR_RESET", [KeyboardMouseInputs.KeyR]),
                ("PAUSE_MENU", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Pedestrian] = Actions(
                ("MOVE", [KeyboardMouseInputs.KeyW, KeyboardMouseInputs.KeyS, KeyboardMouseInputs.KeyA, KeyboardMouseInputs.KeyD, KeyboardMouseInputs.ArrowUp, KeyboardMouseInputs.ArrowDown, KeyboardMouseInputs.ArrowLeft, KeyboardMouseInputs.ArrowRight]),
                ("SPRINT", [KeyboardMouseInputs.ShiftLeft]),
                ("JUMP", [KeyboardMouseInputs.Space]),
                ("INTERACT", [KeyboardMouseInputs.KeyE]),
                ("ATTACK", [KeyboardMouseInputs.MousePrimary]),
                ("CAMERA", [KeyboardMouseInputs.MouseSecondary]),
                ("MODE", [KeyboardMouseInputs.KeyM]),
                ("PAUSE_MENU", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Dialogue] = Actions(
                ("NAVIGATE", [KeyboardMouseInputs.Tab]),
                ("CONFIRM", [KeyboardMouseInputs.Enter]),
                ("BACK", [KeyboardMouseInputs.Escape])),
            [ControlContexts.Pause] = Actions(
                ("NAVIGATE", [KeyboardMouseInputs.Tab]),
                ("CONFIRM", [KeyboardMouseInputs.Enter]),
                ("BACK", [KeyboardMouseInputs.Escape])),
        });

    public static bool IsKnownContext(string? context) => context is not null && DefaultBindings.ContainsKey(context);

    public static bool IsKnownAction(string? context, string? action) =>
        context is not null && action is not null &&
        DefaultBindings.TryGetValue(context, out IReadOnlyDictionary<string, IReadOnlyList<string>>? actions) &&
        actions.ContainsKey(action);

    public static bool IsKeyboardMouseInput(string? value)
    {
        if (value is null) return false;
        return Regex.IsMatch(value, "^Key[A-Z]$", RegexOptions.CultureInvariant)
            || Regex.IsMatch(value, "^Digit[0-9]$", RegexOptions.CultureInvariant)
            || Regex.IsMatch(value, "^F(?:[1-9]|1[0-2])$", RegexOptions.CultureInvariant)
            || Regex.IsMatch(value, "^Arrow(?:Up|Down|Left|Right)$", RegexOptions.CultureInvariant)
            || NamedKeyboardInputs.Contains(value);
    }

    public static string FormatInput(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (InputLabels.TryGetValue(input, out string? label)) return label;
        if (Regex.IsMatch(input, "^Key[A-Z]$", RegexOptions.CultureInvariant)) return input[3..];
        if (Regex.IsMatch(input, "^Digit[0-9]$", RegexOptions.CultureInvariant)) return input[5..];
        return Regex.Replace(input, "([a-z])([A-Z])", "$1 $2", RegexOptions.CultureInvariant);
    }

    public static IReadOnlyList<string> GetBindings(
        string context,
        string action,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides = null)
    {
        if (!IsKnownAction(context, action)) return Array.Empty<string>();
        IReadOnlyList<string> inputs = overrides?.GetValueOrDefault(context)?.GetValueOrDefault(action)
            ?? DefaultBindings[context][action];
        return Array.AsReadOnly(inputs.ToArray());
    }

    public static string GetActionLabel(
        string context,
        string action,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides = null) =>
        string.Join(" / ", GetBindings(context, action, overrides).Select(FormatInput));

    public static IReadOnlyList<BindingConflict> GetConflicts(
        string context,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides = null)
    {
        if (!IsKnownContext(context)) return Array.Empty<BindingConflict>();
        var owners = new Dictionary<string, string>(StringComparer.Ordinal);
        var conflicts = new List<BindingConflict>();
        foreach (string action in DefaultBindings[context].Keys)
        {
            foreach (string input in GetBindings(context, action, overrides))
            {
                if (input == KeyboardMouseInputs.PointerMove) continue;
                if (owners.TryGetValue(input, out string? previous) &&
                    !(context == ControlContexts.Management && input == KeyboardMouseInputs.MousePrimary))
                {
                    conflicts.Add(new BindingConflict(context, input, Array.AsReadOnly([previous, action])));
                }
                else
                {
                    owners[input] = action;
                }
            }
        }
        return Array.AsReadOnly(conflicts.ToArray());
    }

    public static IReadOnlyList<ReservedBindingIssue> GetReservedIssues(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides = null)
    {
        var issues = new List<ReservedBindingIssue>();
        foreach (string context in ControlContexts.All)
        {
            foreach (string action in DefaultBindings[context].Keys)
            {
                foreach (string input in GetBindings(context, action, overrides))
                {
                    if (ReservedBrowserInputs.Contains(input, StringComparer.Ordinal))
                    {
                        issues.Add(new ReservedBindingIssue(context, action, input));
                    }
                }
            }
        }
        return Array.AsReadOnly(issues.ToArray());
    }

    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> ValidateOverrides(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? overrides)
    {
        overrides ??= EmptyOverrides();
        var normalized = new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(StringComparer.Ordinal);
        foreach ((string context, IReadOnlyDictionary<string, IReadOnlyList<string>> actions) in overrides)
        {
            if (!IsKnownContext(context) || actions is null)
            {
                throw new ArgumentException($"Unknown binding context: {context}.", nameof(overrides));
            }
            var normalizedActions = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
            foreach ((string action, IReadOnlyList<string> inputs) in actions)
            {
                if (!IsKnownAction(context, action)) throw new ArgumentException($"Unknown {context} action: {action}.", nameof(overrides));
                ValidateInputs(context, action, inputs);
                normalizedActions[action] = Array.AsReadOnly(inputs.ToArray());
            }
            normalized[context] = new ReadOnlyDictionary<string, IReadOnlyList<string>>(normalizedActions);
        }

        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> frozen =
            new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(normalized);
        foreach (string context in ControlContexts.All)
        {
            BindingConflict? conflict = GetConflicts(context, frozen).FirstOrDefault();
            if (conflict is not null)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(overrides),
                    $"{FormatInput(conflict.Input)} conflicts between {string.Join(" and ", conflict.Actions)} in {context}.");
            }
        }
        ReservedBindingIssue? reserved = GetReservedIssues(frozen).FirstOrDefault();
        if (reserved is not null)
        {
            throw new ArgumentOutOfRangeException(
                nameof(overrides),
                $"{reserved.Input} is reserved by the browser and cannot be bound.");
        }
        return frozen;
    }

    public static IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> EmptyOverrides() =>
        new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(
            new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(StringComparer.Ordinal));

    private static void ValidateInputs(string context, string action, IReadOnlyList<string>? inputs)
    {
        if (inputs is null || inputs.Count is < 1 or > 8 || inputs.Distinct(StringComparer.Ordinal).Count() != inputs.Count)
        {
            throw new ArgumentException($"{context}.{action} must contain 1-8 unique inputs.", nameof(inputs));
        }
        if (inputs.Any(input => !IsKeyboardMouseInput(input)))
        {
            throw new ArgumentException($"{context}.{action} contains an unsupported input.", nameof(inputs));
        }
        if (MouseOnlyActions.Contains(action) && inputs.Any(input => !Regex.IsMatch(input, "^Mouse[0-2]$", RegexOptions.CultureInvariant)))
        {
            throw new ArgumentException($"{context}.{action} requires a mouse-button binding.", nameof(inputs));
        }
        if (action == "AIM" && (inputs.Count != 1 || inputs[0] != KeyboardMouseInputs.PointerMove))
        {
            throw new ArgumentException($"{context}.AIM uses fixed pointer movement.", nameof(inputs));
        }
        if (!MouseOnlyActions.Contains(action) && action != "AIM" &&
            inputs.Any(input => input.StartsWith("Mouse", StringComparison.Ordinal) || input == KeyboardMouseInputs.PointerMove))
        {
            throw new ArgumentException($"{context}.{action} requires a keyboard binding.", nameof(inputs));
        }
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<string>> Actions(
        params (string Action, string[] Inputs)[] entries)
    {
        var actions = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach ((string action, string[] inputs) in entries) actions[action] = Array.AsReadOnly(inputs);
        return new ReadOnlyDictionary<string, IReadOnlyList<string>>(actions);
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> FreezeDefaults(
        Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> defaults) =>
        new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(defaults);
}

using System.Collections.ObjectModel;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MetroPulse.Domain.Settings;

/// <summary>Renderer-independent authority for global preferences and input binding overrides.</summary>
public sealed class SettingsStore
{
    private readonly ISettingsStorage? storage;
    private readonly string storageKey;
    private readonly Action<Exception>? onListenerError;
    private readonly List<Action<SettingsEvent>> listeners = [];
    private SettingsDocument document = SettingsValidator.CreateDefaultDocument();

    public SettingsStore(
        ISettingsStorage? storage = null,
        string storageKey = SettingsValidator.StorageKey,
        Action<Exception>? onListenerError = null)
    {
        this.storage = storage;
        this.storageKey = string.IsNullOrWhiteSpace(storageKey)
            ? throw new ArgumentException("A settings storage key is required.", nameof(storageKey))
            : storageKey;
        this.onListenerError = onListenerError;
    }

    public bool Loaded { get; private set; }

    public SettingsLoadResult Load()
    {
        var warnings = new List<string>();
        SettingsDocument loaded = SettingsValidator.CreateDefaultDocument();
        int? sourceVersion = null;
        try
        {
            string? raw = storage?.GetItem(storageKey);
            if (!string.IsNullOrWhiteSpace(raw))
            {
                using JsonDocument parsed = JsonDocument.Parse(raw);
                sourceVersion = parsed.RootElement.TryGetProperty("version", out JsonElement version) && version.TryGetInt32(out int number)
                    ? number
                    : null;
                loaded = SettingsValidator.Validate(parsed.RootElement);
            }
        }
        catch (Exception error)
        {
            warnings.Add($"Saved settings were ignored: {error.Message}");
            loaded = SettingsValidator.CreateDefaultDocument();
            sourceVersion = null;
        }

        if (sourceVersion is not null && sourceVersion != SettingsValidator.SchemaVersion)
        {
            try
            {
                storage?.SetItem(storageKey, JsonSerializer.Serialize(loaded, SettingsValidator.JsonOptions));
            }
            catch (Exception error)
            {
                warnings.Add($"Saved settings were ignored: {error.Message}");
            }
        }
        document = loaded;
        Loaded = true;
        return new SettingsLoadResult(
            document.Settings,
            document.Bindings,
            Array.AsReadOnly(warnings.ToArray()));
    }

    public SettingsDocument Snapshot() => document;

    public SettingsPreferences GetSettings() => document.Settings;

    public T Get<T>(string path, T fallback = default!)
    {
        string[] segments = ParsePath(path);
        JsonElement value = JsonSerializer.SerializeToElement(document.Settings, SettingsValidator.JsonOptions);
        foreach (string segment in segments)
        {
            if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(segment, out value)) return fallback;
        }
        return value.Deserialize<T>(SettingsValidator.JsonOptions) ?? fallback;
    }

    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> GetBindingOverrides() =>
        document.Bindings;

    public IReadOnlyList<string> GetBindings(string context, string action) =>
        ControlBindingCatalog.GetBindings(context, action, document.Bindings);

    public string GetActionLabel(string context, string action) =>
        ControlBindingCatalog.GetActionLabel(context, action, document.Bindings);

    public Func<bool> Subscribe(Action<SettingsEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent) listener(new SettingsEvent { Type = "CURRENT", Previous = null, Current = Snapshot() });
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public SettingsDocument Set<T>(string path, T value)
    {
        string[] segments = ParsePath(path);
        JsonObject candidate = JsonSerializer.SerializeToNode(document, SettingsValidator.JsonOptions)!.AsObject();
        JsonNode? owner = candidate["settings"];
        foreach (string segment in segments[..^1])
        {
            if (owner is not JsonObject objectOwner || objectOwner[segment] is not JsonObject child)
            {
                throw new ArgumentException($"Unknown settings path: {path}.", nameof(path));
            }
            owner = child;
        }
        if (owner is not JsonObject finalOwner || !finalOwner.ContainsKey(segments[^1]))
        {
            throw new ArgumentException($"Unknown settings path: {path}.", nameof(path));
        }
        finalOwner[segments[^1]] = JsonSerializer.SerializeToNode(value, SettingsValidator.JsonOptions);
        SettingsDocument validated = SettingsValidator.Validate(JsonSerializer.SerializeToElement(candidate, SettingsValidator.JsonOptions), allowMigration: false);
        return Commit(validated, new SettingsEvent
        {
            Type = "SETTING_CHANGED",
            Previous = null,
            Current = validated,
            Path = string.Join('.', segments),
        });
    }

    public SettingsDocument Replace(
        SettingsPreferences settings,
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>? bindings = null,
        bool persist = true,
        string source = "replace")
    {
        var candidate = new SettingsDocument
        {
            Settings = settings,
            Bindings = bindings ?? ControlBindingCatalog.EmptyOverrides(),
        };
        SettingsDocument validated = SettingsValidator.Validate(candidate);
        if (persist)
        {
            return Commit(validated, new SettingsEvent
            {
                Type = "REPLACED",
                Previous = null,
                Current = validated,
                Source = source,
            });
        }
        SettingsDocument previous = Snapshot();
        document = validated;
        Emit(new SettingsEvent
        {
            Type = "REPLACED",
            Previous = previous,
            Current = Snapshot(),
            Source = source,
        });
        return Snapshot();
    }

    public SettingsDocument SetBinding(string context, string action, string input, int index = 0)
    {
        if (!ControlBindingCatalog.IsKnownAction(context, action))
        {
            throw new ArgumentException($"Unknown {context} action: {action}.", nameof(action));
        }
        if (!ControlBindingCatalog.IsKeyboardMouseInput(input))
        {
            throw new ArgumentException($"Unsupported input: {input}.", nameof(input));
        }
        if (ControlBindingCatalog.ReservedBrowserInputs.Contains(input, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(input), $"{input} is reserved by the browser.");
        }
        var effective = GetBindings(context, action).ToList();
        if (index < 0 || index >= effective.Count) throw new ArgumentOutOfRangeException(nameof(index), "Binding index is out of range.");
        effective[index] = input;
        if (effective.Distinct(StringComparer.Ordinal).Count() != effective.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(input), $"{input} is already assigned to {action}.");
        }

        Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> bindings = MutableBindings(document.Bindings);
        Dictionary<string, IReadOnlyList<string>> actions = bindings.TryGetValue(context, out IReadOnlyDictionary<string, IReadOnlyList<string>>? existing)
            ? existing.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal)
            : new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        actions[action] = Array.AsReadOnly(effective.ToArray());
        bindings[context] = new ReadOnlyDictionary<string, IReadOnlyList<string>>(actions);
        var candidate = document with
        {
            Bindings = new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(bindings),
        };
        SettingsDocument validated = SettingsValidator.Validate(candidate);
        return Commit(validated, new SettingsEvent
        {
            Type = "BINDING_CHANGED",
            Previous = null,
            Current = validated,
            Context = context,
            Action = action,
            Input = input,
            Index = index,
        });
    }

    public IReadOnlyList<BindingConflict> GetConflicts(string context) =>
        ControlBindingCatalog.GetConflicts(context, document.Bindings);

    public SettingsDocument ResetContext(string context)
    {
        if (!ControlBindingCatalog.IsKnownContext(context))
        {
            throw new ArgumentException($"Unknown binding context: {context}.", nameof(context));
        }
        Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> bindings = MutableBindings(document.Bindings);
        bindings.Remove(context);
        return Commit(document with
        {
            Bindings = new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(bindings),
        }, new SettingsEvent
        {
            Type = "BINDINGS_RESET",
            Previous = null,
            Current = document,
            Context = context,
        });
    }

    public SettingsDocument ResetBindings() => Commit(document with
    {
        Bindings = ControlBindingCatalog.EmptyOverrides(),
    }, new SettingsEvent
    {
        Type = "BINDINGS_RESET",
        Previous = null,
        Current = document,
    });

    public SettingsDocument ResetAll() => Commit(SettingsValidator.CreateDefaultDocument(), new SettingsEvent
    {
        Type = "SETTINGS_RESET",
        Previous = null,
        Current = document,
    });

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetDefaultBindings(string context) =>
        ControlBindingCatalog.DefaultBindings.TryGetValue(context, out IReadOnlyDictionary<string, IReadOnlyList<string>>? bindings)
            ? bindings
            : new ReadOnlyDictionary<string, IReadOnlyList<string>>(new Dictionary<string, IReadOnlyList<string>>());

    public void Destroy() => listeners.Clear();

    private SettingsDocument Commit(SettingsDocument candidate, SettingsEvent template)
    {
        SettingsDocument validated = SettingsValidator.Validate(candidate);
        string serialized = JsonSerializer.Serialize(validated, SettingsValidator.JsonOptions);
        storage?.SetItem(storageKey, serialized);
        SettingsDocument previous = Snapshot();
        document = validated;
        Emit(template with { Previous = previous, Current = Snapshot() });
        return Snapshot();
    }

    private void Emit(SettingsEvent value)
    {
        foreach (Action<SettingsEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(value);
            }
            catch (Exception error)
            {
                onListenerError?.Invoke(error);
            }
        }
    }

    private static string[] ParsePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new ArgumentException("A settings path is required.", nameof(path));
        string[] segments = path.Split('.');
        if (segments.Length == 0 || segments.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException("A settings path is required.", nameof(path));
        }
        return segments;
    }

    private static Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> MutableBindings(
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> source) =>
        source.ToDictionary(
            context => context.Key,
            context => (IReadOnlyDictionary<string, IReadOnlyList<string>>)new ReadOnlyDictionary<string, IReadOnlyList<string>>(
                context.Value.ToDictionary(
                    action => action.Key,
                    action => (IReadOnlyList<string>)Array.AsReadOnly(action.Value.ToArray()),
                    StringComparer.Ordinal)),
            StringComparer.Ordinal);
}

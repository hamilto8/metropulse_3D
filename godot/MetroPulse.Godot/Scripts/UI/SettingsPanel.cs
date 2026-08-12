using Godot;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.UI;

public partial class SettingsPanel : PanelContainer
{
    private readonly Dictionary<string, Control> controls = new(StringComparer.Ordinal);
    private SettingsStore settings = null!;
    private bool applying;

    public int ControlCount => controls.Count;

    public event Action? CloseRequested;

    public void Initialize(SettingsStore settingsAuthority)
    {
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        Name = "SettingsPanel";
        ThemeTypeVariation = "GlassPanelStrong";
        MouseFilter = MouseFilterEnum.Stop;
        AccessibilityName = "Settings";
        AccessibilityDescription = "All controls, audio, accessibility, and gameplay preferences";
        var root = new VBoxContainer();
        root.AddChild(new Label { Text = "SETTINGS", ThemeTypeVariation = "Title" });
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        var content = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        string? group = null;
        var focusOrder = new List<Control>();
        foreach (SettingControlSpec spec in SettingsUiCatalog.All)
        {
            if (group != spec.Group)
            {
                group = spec.Group;
                content.AddChild(new Label { Text = group.ToUpperInvariant(), ThemeTypeVariation = "Heading" });
            }
            var row = new HBoxContainer();
            var label = new Label { Text = spec.Label, CustomMinimumSize = new Vector2(220, 0), SizeFlagsHorizontal = SizeFlags.ExpandFill };
            row.AddChild(label);
            Control control = BuildControl(spec);
            row.AddChild(control);
            content.AddChild(row);
            controls.Add(spec.Path, control);
            focusOrder.Add(control);
        }
        scroll.AddChild(content);
        root.AddChild(scroll);
        var actions = new HBoxContainer();
        Button reset = AccessibilityFocus.Describe(new Button { Text = "Restore defaults" }, "Restore default settings", "Reset every preference to its validated default");
        Button close = AccessibilityFocus.Describe(new Button { Text = "Back", ThemeTypeVariation = "AccentButton" }, "Back to pause menu", "Close settings and return to the pause menu");
        reset.Pressed += () =>
        {
            _ = settings.Replace(SettingsValidator.DefaultSettings, source: "phase9-settings-reset");
            ApplyCurrent();
        };
        close.Pressed += () => CloseRequested?.Invoke();
        actions.AddChild(reset);
        actions.AddChild(close);
        root.AddChild(actions);
        AddChild(root);
        focusOrder.Add(reset);
        focusOrder.Add(close);
        AccessibilityFocus.LinkVertical(focusOrder);
        ApplyCurrent();
    }

    public void ApplyCurrent()
    {
        applying = true;
        try
        {
            foreach (SettingControlSpec spec in SettingsUiCatalog.All)
            {
                Control control = controls[spec.Path];
                switch (control)
                {
                    case HSlider slider:
                        slider.Value = settings.Get(spec.Path, spec.Minimum);
                        break;
                    case CheckButton toggle:
                        toggle.ButtonPressed = settings.Get(spec.Path, false);
                        break;
                    case OptionButton choice:
                        string value = settings.Get(spec.Path, spec.Options![0]);
                        choice.Select(Math.Max(0, Array.IndexOf(spec.Options.ToArray(), value)));
                        break;
                }
            }
        }
        finally
        {
            applying = false;
        }
    }

    public void Shutdown() => CloseRequested = null;

    private Control BuildControl(SettingControlSpec spec)
    {
        switch (spec.Kind)
        {
            case SettingControlKinds.Slider:
                {
                    var slider = AccessibilityFocus.Describe(
                        new HSlider { MinValue = spec.Minimum, MaxValue = spec.Maximum, Step = spec.Step, CustomMinimumSize = new Vector2(240, 0) },
                        spec.Label,
                        spec.Description);
                    slider.ValueChanged += value =>
                    {
                        if (!applying) _ = settings.Set(spec.Path, value);
                    };
                    return slider;
                }
            case SettingControlKinds.Toggle:
                {
                    var toggle = AccessibilityFocus.Describe(new CheckButton(), spec.Label, spec.Description);
                    toggle.Toggled += value =>
                    {
                        if (!applying) _ = settings.Set(spec.Path, value);
                    };
                    return toggle;
                }
            case SettingControlKinds.Choice:
                {
                    var choice = AccessibilityFocus.Describe(new OptionButton { CustomMinimumSize = new Vector2(240, 0) }, spec.Label, spec.Description);
                    foreach (string option in spec.Options!) choice.AddItem(Title(option));
                    choice.ItemSelected += index =>
                    {
                        if (!applying) _ = settings.Set(spec.Path, spec.Options[(int)index]);
                    };
                    return choice;
                }
            default:
                throw new InvalidOperationException($"Unknown setting control kind: {spec.Kind}");
        }
    }

    private static string Title(string value) => string.Join(' ', value.Split('_').Select(word => string.Concat(word[0], word[1..].ToLowerInvariant())));
}

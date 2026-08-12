using Godot;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.TimeWeather;

namespace MetroPulse.Godot.UI;

public partial class ControlRibbon : PanelContainer
{
    private BoxContainer layout = null!;
    private Label prompts = null!;
    private Label device = null!;
    private readonly Dictionary<double, Button> speedButtons = [];

    public event Action<double>? TimeScaleRequested;

    public void Initialize()
    {
        Name = "ControlRibbon";
        ThemeTypeVariation = "GlassPanel";
        MouseFilter = MouseFilterEnum.Stop;
        AccessibilityName = "Adaptive control ribbon";
        AccessibilityDescription = "Current contextual controls, active input device, and city simulation speed";
        layout = new BoxContainer { Vertical = false };
        prompts = new Label { SizeFlagsHorizontal = SizeFlags.ExpandFill, AutowrapMode = TextServer.AutowrapMode.WordSmart };
        device = new Label { ThemeTypeVariation = "Metric" };
        var speeds = new HBoxContainer();
        foreach (double scale in SimulationTimeModel.SpeedOptions)
        {
            double captured = scale;
            var button = AccessibilityFocus.Describe(
                new Button { Text = $"{scale:0.#}×", ToggleMode = true },
                $"{scale:0.#} times city speed",
                "Set the Management and Builder city simulation speed");
            button.Pressed += () => TimeScaleRequested?.Invoke(captured);
            speeds.AddChild(button);
            speedButtons.Add(scale, button);
        }
        layout.AddChild(prompts);
        layout.AddChild(device);
        layout.AddChild(speeds);
        AddChild(layout);
        AccessibilityFocus.LinkHorizontal(speedButtons.Values.Cast<Control>().ToArray());
    }

    public void Apply(RuntimeInputSnapshot input, double cityTimeScale, bool compact)
    {
        ArgumentNullException.ThrowIfNull(input);
        prompts.Text = string.Join("  ·  ", input.Prompts.Select(pair => $"{pair.Value} {ToTitle(pair.Key)}"));
        prompts.AccessibilityName = $"{input.Context} controls";
        prompts.AccessibilityDescription = string.Join("; ", input.Prompts.Select(pair => $"{ToTitle(pair.Key)}: {pair.Value}"));
        device.Text = input.ActiveInterface == InputInterfaces.Gamepad ? "🎮 Controller" : "⌨ Keyboard + mouse";
        device.AccessibilityName = $"Active input: {input.ActiveInterface}";
        foreach ((double scale, Button button) in speedButtons) button.ButtonPressed = Math.Abs(scale - cityTimeScale) < 0.001;
        layout.Vertical = compact;
    }

    public void Shutdown() => TimeScaleRequested = null;

    private static string ToTitle(string value) => string.Join(' ', value.Split('_').Select(word => string.Concat(word[0], word[1..].ToLowerInvariant())));
}

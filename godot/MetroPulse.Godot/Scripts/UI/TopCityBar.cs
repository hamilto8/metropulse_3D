using Godot;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Godot.UI;

public partial class TopCityBar : PanelContainer
{
    private readonly Dictionary<string, Label> metricValues = new(StringComparer.Ordinal);
    private BoxContainer layout = null!;
    private GridContainer metrics = null!;
    private Label priority = null!;
    private Label modeAndDevice = null!;
    private Button toolsButton = null!;
    private Button modeButton = null!;

    public event Action? ToolsRequested;

    public event Action? ModeRequested;

    public void Initialize()
    {
        Name = "TopCityBar";
        ThemeTypeVariation = "GlassPanelStrong";
        MouseFilter = MouseFilterEnum.Stop;
        AccessibilityName = "City status bar";
        AccessibilityDescription = "Capital, population, jobs, energy, satisfaction, time, weather, mode, and priority alert";
        layout = new BoxContainer { Name = "Layout", Vertical = false };
        metrics = new GridContainer { Name = "Metrics", Columns = 7, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        foreach ((string id, string label) in new[]
        {
            ("capital", "Capital"),
            ("population", "Population"),
            ("jobs", "Jobs"),
            ("energy", "Energy"),
            ("satisfaction", "Satisfaction"),
            ("time", "Time"),
            ("weather", "Weather"),
        })
        {
            var stack = new VBoxContainer { Name = $"Metric_{id}" };
            var caption = new Label { Text = label, ThemeTypeVariation = "Muted", HorizontalAlignment = HorizontalAlignment.Center };
            var value = new Label { Text = "—", ThemeTypeVariation = "Metric", HorizontalAlignment = HorizontalAlignment.Center };
            stack.AddChild(caption);
            stack.AddChild(value);
            metrics.AddChild(stack);
            metricValues.Add(id, value);
        }
        var status = new VBoxContainer { Name = "Priority", CustomMinimumSize = new Vector2(240, 0) };
        priority = new Label
        {
            Text = "No priority alerts",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            TextOverrunBehavior = TextServer.OverrunBehavior.TrimEllipsis,
            MaxLinesVisible = 2,
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite,
        };
        modeAndDevice = new Label { ThemeTypeVariation = "Muted" };
        status.AddChild(priority);
        status.AddChild(modeAndDevice);
        var actions = new VBoxContainer { Name = "Actions" };
        toolsButton = AccessibilityFocus.Describe(
            new Button { Text = "City Tools", FocusMode = FocusModeEnum.All },
            "City Tools",
            "Open or close the city management tool sections");
        modeButton = AccessibilityFocus.Describe(
            new Button { Text = "Open Builder", ThemeTypeVariation = "AccentButton", FocusMode = FocusModeEnum.All },
            "Open Builder",
            "Switch between Management and Builder while preserving city location");
        toolsButton.Pressed += () => ToolsRequested?.Invoke();
        modeButton.Pressed += () => ModeRequested?.Invoke();
        actions.AddChild(toolsButton);
        actions.AddChild(modeButton);
        layout.AddChild(metrics);
        layout.AddChild(status);
        layout.AddChild(actions);
        AddChild(layout);
        AccessibilityFocus.LinkVertical([toolsButton, modeButton]);
    }

    public void Apply(TopCityBarView view, bool compact)
    {
        ArgumentNullException.ThrowIfNull(view);
        foreach (UiMetric metric in view.Metrics)
        {
            if (!metricValues.TryGetValue(metric.Id, out Label? label)) continue;
            label.Text = metric.Value;
            label.AccessibilityName = $"{metric.Label}: {metric.Value}";
            label.AccessibilityDescription = metric.Description;
        }
        priority.Text = view.PriorityAlert.Active
            ? $"{view.PriorityAlert.Severity}: {view.PriorityAlert.Title} · {view.PriorityAlert.Location}"
            : view.PriorityAlert.Title;
        priority.AccessibilityName = $"Priority alert: {view.PriorityAlert.Title}";
        priority.AccessibilityDescription = view.PriorityAlert.Detail;
        modeAndDevice.Text = $"{view.Mode} · {view.Device}";
        modeAndDevice.AccessibilityName = $"Mode {view.Mode}; active input {view.Device}";
        modeButton.Text = view.Mode == "BUILDER" ? "Return to Management" : "Open Builder";
        modeButton.AccessibilityName = modeButton.Text;
        layout.Vertical = false;
        metrics.Columns = compact ? 4 : 7;
    }

    public void Shutdown()
    {
        ToolsRequested = null;
        ModeRequested = null;
    }
}

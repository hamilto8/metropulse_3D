using Godot;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Godot.UI;

public partial class CityToolsPanel : PanelContainer
{
    private sealed record SectionControls(Button Header, Label Summary, VBoxContainer Details, Button Action);

    private readonly Dictionary<string, SectionControls> sections = new(StringComparer.Ordinal);
    private VBoxContainer content = null!;
    private Button collapseButton = null!;

    public bool Collapsed { get; private set; }

    public event Action<string>? SectionActionRequested;

    public void Initialize()
    {
        Name = "CityTools";
        ThemeTypeVariation = "GlassPanel";
        MouseFilter = MouseFilterEnum.Stop;
        AccessibilityName = "City Tools";
        AccessibilityDescription = "Economy, services, traffic, zoning, construction, atmosphere, overlay, and simulation controls";
        var root = new VBoxContainer();
        collapseButton = AccessibilityFocus.Describe(
            new Button { Text = "City Tools ▾" },
            "Collapse City Tools",
            "Collapse or expand the city tool accordion");
        collapseButton.Pressed += ToggleCollapsed;
        root.AddChild(collapseButton);
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        content = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        scroll.AddChild(content);
        root.AddChild(scroll);
        AddChild(root);

        foreach (string id in CityToolSectionIds.All)
        {
            var section = new VBoxContainer { Name = $"Section_{id}" };
            var header = AccessibilityFocus.Describe(
                new Button { Text = id, Alignment = HorizontalAlignment.Left },
                $"{id} section",
                $"Expand the {id} City Tools section");
            var summary = new Label { ThemeTypeVariation = "Muted", AutowrapMode = TextServer.AutowrapMode.WordSmart };
            var details = new VBoxContainer { Visible = id == CityToolSectionIds.Economy };
            var action = AccessibilityFocus.Describe(
                new Button { Visible = false },
                $"{id} action",
                $"Perform the available {id} action");
            header.Pressed += () => ToggleSection(id);
            action.Pressed += () => SectionActionRequested?.Invoke(id);
            section.AddChild(header);
            section.AddChild(summary);
            section.AddChild(details);
            section.AddChild(action);
            content.AddChild(section);
            sections.Add(id, new SectionControls(header, summary, details, action));
        }
        AccessibilityFocus.LinkVertical([collapseButton, .. sections.Values.Select(section => section.Header)]);
    }

    public void Apply(IReadOnlyList<CityToolSectionView> views)
    {
        foreach (CityToolSectionView view in views)
        {
            if (!sections.TryGetValue(view.Id, out SectionControls? controls)) continue;
            controls.Header.Text = $"{view.Title} {(controls.Details.Visible ? "▾" : "▸")}";
            controls.Header.AccessibilityName = view.Title;
            controls.Header.AccessibilityDescription = $"{view.Summary}. {(controls.Details.Visible ? "Expanded" : "Collapsed")}.";
            controls.Summary.Text = view.Summary;
            Clear(controls.Details);
            foreach (string detail in view.Details)
            {
                controls.Details.AddChild(new Label
                {
                    Text = $"• {detail}",
                    AutowrapMode = TextServer.AutowrapMode.WordSmart,
                });
            }
            controls.Action.Visible = view.ActionAvailable;
            controls.Action.Text = view.ActionLabel ?? "Apply";
            controls.Action.AccessibilityName = controls.Action.Text;
            controls.Action.AccessibilityDescription = $"{view.Title}: {view.Summary}";
        }
    }

    public void SetCollapsed(bool collapsed)
    {
        Collapsed = collapsed;
        content.Visible = !collapsed;
        collapseButton.Text = collapsed ? "City Tools ▸" : "City Tools ▾";
        collapseButton.AccessibilityName = collapsed ? "Expand City Tools" : "Collapse City Tools";
    }

    public void Shutdown() => SectionActionRequested = null;

    private void ToggleCollapsed() => SetCollapsed(!Collapsed);

    private void ToggleSection(string id)
    {
        foreach ((string sectionId, SectionControls controls) in sections)
        {
            controls.Details.Visible = sectionId == id && !controls.Details.Visible;
            controls.Header.Text = controls.Header.Text.TrimEnd(' ', '▾', '▸') + (controls.Details.Visible ? " ▾" : " ▸");
        }
    }

    private static void Clear(Node node)
    {
        foreach (Node child in node.GetChildren()) child.Free();
    }
}

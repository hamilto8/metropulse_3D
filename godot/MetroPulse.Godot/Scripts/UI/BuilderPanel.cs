using Godot;
using MetroPulse.Domain.Presentation;

namespace MetroPulse.Godot.UI;

public partial class BuilderPanel : PanelContainer
{
    private readonly Dictionary<string, Button> catalogButtons = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Button> toolButtons = new(StringComparer.Ordinal);
    private BoxContainer body = null!;
    private VBoxContainer catalogList = null!;
    private Label selectedTitle = null!;
    private Label selectedDetail = null!;
    private Label forecastStatus = null!;
    private VBoxContainer forecastFacts = null!;
    private Button confirm = null!;
    private Button grid = null!;
    private Button rotate = null!;
    private Button cancel = null!;
    private Button residentialZone = null!;
    private Button commercialZone = null!;
    private Button operationsZone = null!;

    public event Action<string>? CatalogSelected;

    public event Action<string>? ToolSelected;

    public event Action? ConfirmRequested;

    public event Action? GridToggleRequested;

    public event Action? RotateRequested;

    public event Action? CancelRequested;

    public event Action<string>? ZoneRequested;

    public void Initialize()
    {
        Name = "BuilderPanel";
        ThemeTypeVariation = "GlassPanel";
        MouseFilter = MouseFilterEnum.Stop;
        AccessibilityName = "Builder catalog and inspector";
        AccessibilityDescription = "Choose a building or zone, review the disclosed forecast, and confirm a world edit";
        var root = new VBoxContainer();
        root.AddChild(new Label { Text = "BUILDER", ThemeTypeVariation = "Title" });

        var toolRail = new HBoxContainer { Name = "ToolRail" };
        foreach (string tool in new[] { "PLACE", "SELECT", "MOVE", "ROTATE", "DEMOLISH", "ZONE" })
        {
            var button = AccessibilityFocus.Describe(
                new Button { Text = ToTitle(tool), ToggleMode = true },
                $"{ToTitle(tool)} tool",
                $"Select the {ToTitle(tool).ToLowerInvariant()} editor tool");
            button.Pressed += () => ToolSelected?.Invoke(tool);
            toolRail.AddChild(button);
            toolButtons.Add(tool, button);
        }
        root.AddChild(toolRail);

        body = new BoxContainer { Vertical = false, SizeFlagsVertical = SizeFlags.ExpandFill };
        var catalogColumn = new VBoxContainer { CustomMinimumSize = new Vector2(260, 0), SizeFlagsVertical = SizeFlags.ExpandFill };
        catalogColumn.AddChild(new Label { Text = "Starter catalog", ThemeTypeVariation = "Heading" });
        var catalogScroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        catalogList = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        catalogScroll.AddChild(catalogList);
        catalogColumn.AddChild(catalogScroll);
        body.AddChild(catalogColumn);

        var inspectorScroll = new ScrollContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill, SizeFlagsVertical = SizeFlags.ExpandFill };
        var inspector = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        selectedTitle = new Label { Text = "Select a catalog item", ThemeTypeVariation = "Heading", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        selectedDetail = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        forecastStatus = new Label
        {
            Text = "Forecast unavailable",
            ThemeTypeVariation = "Metric",
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
            AccessibilityLive = DisplayServer.AccessibilityLiveMode.Polite,
        };
        forecastFacts = new VBoxContainer();
        inspector.AddChild(selectedTitle);
        inspector.AddChild(selectedDetail);
        inspector.AddChild(forecastStatus);
        inspector.AddChild(forecastFacts);
        inspectorScroll.AddChild(inspector);
        body.AddChild(inspectorScroll);
        root.AddChild(body);

        var zones = new HBoxContainer { Name = "ZoneActions" };
        residentialZone = ZoneButton("Residential", "RESIDENTIAL");
        commercialZone = ZoneButton("Commercial", "COMMERCIAL");
        operationsZone = ZoneButton("Operations", "OPERATIONS");
        zones.AddChild(residentialZone);
        zones.AddChild(commercialZone);
        zones.AddChild(operationsZone);
        root.AddChild(zones);

        var actions = new HBoxContainer { Name = "Actions" };
        grid = AccessibilityFocus.Describe(new Button { Text = "Grid snap: On" }, "Toggle grid snap", "Toggle ten-metre builder grid snapping");
        rotate = AccessibilityFocus.Describe(new Button { Text = "Rotate preview" }, "Rotate preview", "Rotate the current preview by ninety degrees");
        cancel = AccessibilityFocus.Describe(new Button { Text = "Cancel" }, "Cancel edit", "Clear the selected record and return to the placement tool");
        confirm = AccessibilityFocus.Describe(
            new Button { Text = "Confirm placement", ThemeTypeVariation = "AccentButton" },
            "Confirm placement",
            "Commit the currently disclosed valid world edit");
        grid.Pressed += () => GridToggleRequested?.Invoke();
        rotate.Pressed += () => RotateRequested?.Invoke();
        cancel.Pressed += () => CancelRequested?.Invoke();
        confirm.Pressed += () => ConfirmRequested?.Invoke();
        actions.AddChild(grid);
        actions.AddChild(rotate);
        actions.AddChild(cancel);
        actions.AddChild(confirm);
        root.AddChild(actions);
        AddChild(root);
        AccessibilityFocus.LinkHorizontal(toolButtons.Values.Cast<Control>().ToArray());
        AccessibilityFocus.LinkHorizontal([residentialZone, commercialZone, operationsZone]);
        AccessibilityFocus.LinkHorizontal([grid, rotate, cancel, confirm]);
    }

    public void Apply(ManagementUiSnapshot view)
    {
        ArgumentNullException.ThrowIfNull(view);
        ReconcileCatalog(view.Catalog);
        selectedTitle.Text = view.SelectedBuildingName;
        BuilderCatalogCardView? selected = view.Catalog.FirstOrDefault(item => item.Id == view.SelectedBuildingId);
        selectedDetail.Text = selected is null
            ? "No catalog details are available."
            : $"{selected.Category} · {selected.Cost}\n{selected.Description}\n{selected.Availability}";
        forecastStatus.Text = $"{view.Forecast.Status} · {view.Forecast.Position}";
        forecastStatus.AccessibilityName = view.Forecast.Status;
        forecastStatus.AccessibilityDescription = $"{view.Forecast.Remedy} {string.Join(' ', view.Forecast.Facts)}";
        Clear(forecastFacts);
        foreach (string fact in view.Forecast.Facts)
        {
            forecastFacts.AddChild(new Label { Text = $"• {fact}", AutowrapMode = TextServer.AutowrapMode.WordSmart });
        }
        forecastFacts.AddChild(new Label { Text = view.Forecast.Remedy, AutowrapMode = TextServer.AutowrapMode.WordSmart, ThemeTypeVariation = "Muted" });
        confirm.Disabled = !view.Forecast.Valid && view.EditorTool == "PLACE";
        confirm.Text = view.EditorTool switch
        {
            "MOVE" => "Move selected",
            "ROTATE" => "Rotate selected",
            "DEMOLISH" => "Demolish selected",
            "SELECT" => "Select at preview",
            _ => "Confirm placement",
        };
        confirm.AccessibilityName = confirm.Text;
        grid.Text = $"Grid snap: {(view.GridSnapEnabled ? "On" : "Off")}";
        foreach ((string id, Button button) in toolButtons) button.ButtonPressed = id == view.EditorTool;
    }

    public void ApplyLayout(bool compact)
    {
        body.Vertical = compact;
    }

    public void Shutdown()
    {
        CatalogSelected = null;
        ToolSelected = null;
        ConfirmRequested = null;
        GridToggleRequested = null;
        RotateRequested = null;
        CancelRequested = null;
        ZoneRequested = null;
    }

    private void ReconcileCatalog(IReadOnlyList<BuilderCatalogCardView> cards)
    {
        if (catalogButtons.Count == 0)
        {
            foreach (BuilderCatalogCardView card in cards)
            {
                var button = AccessibilityFocus.Describe(
                    new Button { Alignment = HorizontalAlignment.Left, Disabled = !card.Unlocked },
                    card.Name,
                    $"{card.Category}. {card.Cost}. {card.Description}. {card.Availability}");
                button.Pressed += () => CatalogSelected?.Invoke(card.Id);
                catalogList.AddChild(button);
                catalogButtons.Add(card.Id, button);
            }
            AccessibilityFocus.LinkVertical(catalogButtons.Values.Cast<Control>().ToArray());
        }
        foreach (BuilderCatalogCardView card in cards)
        {
            if (!catalogButtons.TryGetValue(card.Id, out Button? button)) continue;
            button.Text = $"{card.Name}\n{card.Cost} · {card.Category}";
            button.Disabled = !card.Unlocked;
        }
    }

    private Button ZoneButton(string label, string id)
    {
        var button = AccessibilityFocus.Describe(
            new Button { Text = $"Zone {label}" },
            $"Zone {label}",
            $"Apply a persistent {label.ToLowerInvariant()} zone to the preview parcel");
        button.Pressed += () => ZoneRequested?.Invoke(id);
        return button;
    }

    private static string ToTitle(string value) => string.Concat(value[0], value[1..].ToLowerInvariant());

    private static void Clear(Node node)
    {
        foreach (Node child in node.GetChildren()) child.Free();
    }
}

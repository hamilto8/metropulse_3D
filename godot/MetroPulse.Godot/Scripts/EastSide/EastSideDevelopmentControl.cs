using System.Globalization;
using Godot;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.EastSide;

public partial class EastSideDevelopmentControl : PanelContainer
{
    private EastSideDevelopmentRuntime runtime = null!;
    private Label status = null!;
    private Label detail = null!;
    private Button unlock = null!;

    public bool Initialized { get; private set; }

    public string StatusText => status.Text;

    public bool UnlockEnabled => !unlock.Disabled;

    public void Initialize(EastSideDevelopmentRuntime runtimeOwner)
    {
        runtime = runtimeOwner ?? throw new ArgumentNullException(nameof(runtimeOwner));
        Name = "EastSideDevelopmentControl";
        ThemeTypeVariation = "GlassPanel";
        MouseFilter = MouseFilterEnum.Stop;
        Position = new Vector2(18, 215);
        Size = new Vector2(290, 150);
        AccessibilityName = "East-side development";
        AccessibilityDescription = "District status, unlock cost, and East-side development access";
        var stack = new VBoxContainer();
        stack.AddChild(new Label { Text = "EAST-SIDE DEVELOPMENT", ThemeTypeVariation = "Title" });
        status = new Label { AccessibilityName = "East district status" };
        detail = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        unlock = AccessibilityFocus.Describe(
            new Button { Name = "UnlockEastSide", ThemeTypeVariation = "AccentButton" },
            "Unlock East side",
            "Spend Capital to open the East Cyber-Metropolis district for construction");
        unlock.Pressed += () => runtime.TryUnlock();
        stack.AddChild(status);
        stack.AddChild(detail);
        stack.AddChild(unlock);
        AddChild(stack);
        AccessibilityFocus.LinkVertical([unlock]);
        Initialized = true;
    }

    public void ApplyState()
    {
        if (!Initialized) return;
        var snapshot = runtime.Snapshot;
        status.Text = snapshot.Unlocked ? "OPEN FOR DEVELOPMENT" : "DISTRICT LOCKED";
        detail.Text = snapshot.Reason;
        unlock.Text = snapshot.Unlocked
            ? "East side unlocked"
            : $"Unlock • ${snapshot.UnlockCost.ToString("N0", CultureInfo.GetCultureInfo("en-US"))}";
        unlock.Disabled = !snapshot.CanUnlock;
        status.AccessibilityDescription = status.Text;
        unlock.AccessibilityName = unlock.Text;
    }

    public void Shutdown() => Initialized = false;

    public override void _ExitTree() => Shutdown();
}

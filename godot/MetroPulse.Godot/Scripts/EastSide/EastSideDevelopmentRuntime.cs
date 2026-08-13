using Godot;
using MetroPulse.Domain.Economy;
using MetroPulse.Godot.Construction;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.UI;

namespace MetroPulse.Godot.EastSide;

public partial class EastSideDevelopmentRuntime : Node
{
    private CityEconomyRuntime economy = null!;
    private PlayerInterface playerInterface = null!;
    private Func<bool>? unsubscribeEconomy;

    public bool Initialized { get; private set; }

    public EastSideDevelopmentControl Control { get; private set; } = null!;

    public EastSideDevelopmentSnapshot Snapshot => EastSideDevelopmentModel.Capture(economy.Ledger, featureAvailable: true);

    public void Initialize(
        CityEconomyRuntime economyOwner,
        CityEditorRuntime editor,
        PlayerInterface interfaceOwner)
    {
        if (Initialized) throw new InvalidOperationException("East-side development is already initialized.");
        economy = economyOwner ?? throw new ArgumentNullException(nameof(economyOwner));
        ArgumentNullException.ThrowIfNull(editor);
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        Control = new EastSideDevelopmentControl();
        playerInterface.Chrome.AddChild(Control);
        Control.Initialize(this);
        unsubscribeEconomy = economy.Ledger.Subscribe(_ => Control.ApplyState());
        Initialized = true;
        Control.ApplyState();
    }

    public bool TryUnlock()
    {
        EnsureInitialized();
        EastSideDevelopmentSnapshot before = Snapshot;
        if (!before.CanUnlock)
        {
            playerInterface.Announce(before.Remedy is null ? before.Reason : $"{before.Reason} {before.Remedy}");
            return false;
        }
        if (!economy.Ledger.UnlockEastDistrict()) return false;
        Control.ApplyState();
        playerInterface.Announce("East Cyber-Metropolis unlocked. Road, bridge, and district construction access is open.", assertive: true);
        return true;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unsubscribeEconomy?.Invoke();
        unsubscribeEconomy = null;
        Control.Shutdown();
        if (GodotObject.IsInstanceValid(Control)) Control.QueueFree();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void EnsureInitialized()
    {
        if (!Initialized) throw new InvalidOperationException("East-side development is not initialized.");
    }
}

using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.World;

namespace MetroPulse.Godot.Economy;

/// <summary>
/// Session-owned live adapter between the pure economy authority, authored world, and city clock.
/// </summary>
public partial class CityEconomyRuntime : Node
{
    private Func<bool>? unsubscribeEconomy;
    private Func<bool>? unregisterCityTick;

    public bool Initialized { get; private set; }

    public EconomyLedger Ledger { get; private set; } = null!;

    public CityEconomyViewModel ReferenceBaseline { get; private set; } = null!;

    public CityEconomyViewModel AuthoredBaseline { get; private set; } = null!;

    public CityEconomyViewModel Current { get; private set; } = null!;

    public int PublishedViewCount { get; private set; }

    public int AuthoredBuildingCount { get; private set; }

    public int CityTickCount { get; private set; }

    public void Initialize(
        GameContentRegistry content,
        MvpWorldLayout world,
        SimulationScheduler scheduler)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(scheduler);
        if (Initialized) throw new InvalidOperationException("The city economy runtime is already initialized.");

        Ledger = new EconomyLedger(
            content.EconomyBalance,
            content.EconomyBalance.StartingTreasury,
            content.EconomyBalance.BaseRevenuePerSecond,
            population: 1_200,
            happiness: 70,
            landValue: 100,
            services: new EconomyBaseServices(),
            eastDistrictUnlockCost: content.EconomyBalance.Progression!.EastDistrictUnlockCost);
        ReferenceBaseline = CityEconomyViewModel.FromSnapshot(Ledger.Snapshot());

        foreach (EconomyBuilding building in BuildingEconomyAdapter.AdaptAuthoredSkyline(world))
        {
            Ledger.RegisterBuilding(building);
            AuthoredBuildingCount++;
        }

        AuthoredBaseline = CityEconomyViewModel.FromSnapshot(Ledger.Snapshot());
        Current = AuthoredBaseline;
        unsubscribeEconomy = Ledger.Subscribe(economyEvent => Publish(economyEvent.Current));
        unregisterCityTick = scheduler.RegisterTask(
            "economy.city-tick",
            SimulationStage.City,
            (delta, _) =>
            {
                Ledger.Update(delta);
                CityTickCount++;
            });
        Initialized = true;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unregisterCityTick?.Invoke();
        unregisterCityTick = null;
        _ = unsubscribeEconomy?.Invoke();
        unsubscribeEconomy = null;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Publish(EconomyLedgerSnapshot snapshot)
    {
        Current = CityEconomyViewModel.FromSnapshot(snapshot);
        PublishedViewCount++;
    }
}

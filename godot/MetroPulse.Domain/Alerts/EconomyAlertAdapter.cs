using System.Globalization;
using MetroPulse.Domain.Economy;

namespace MetroPulse.Domain.Alerts;

/// <summary>Publishes one deduplicated structured alert for authoritative fiscal stress.</summary>
public sealed class EconomyAlertAdapter : IDisposable
{
    private readonly AlertService alerts;
    private readonly Func<bool> unsubscribe;

    public EconomyAlertAdapter(EconomyLedger economy, AlertService alerts)
    {
        ArgumentNullException.ThrowIfNull(economy);
        this.alerts = alerts ?? throw new ArgumentNullException(nameof(alerts));
        unsubscribe = economy.Subscribe(economyEvent => Sync(economyEvent.Current), emitCurrent: true);
    }

    public bool Sync(EconomyLedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        const string key = "economy:fiscal-recovery";
        EconomyFiscalOverview fiscal = snapshot.Fiscal;
        if (fiscal.Status == FiscalStates.Stable)
        {
            alerts.Resolve(key, "Recurring cashflow and emergency reserves are stable");
            return true;
        }

        bool insolvent = fiscal.Status == FiscalStates.Insolvent;
        bool recovering = fiscal.Status == FiscalStates.Recovery;
        double perMinute = snapshot.BudgetBreakdown.NetRate * 60;
        string sign = perMinute >= 0 ? "+" : "−";
        string cashflow = JavascriptRound(Math.Abs(perMinute)).ToString("N0", CultureInfo.InvariantCulture);
        string recommendation = fiscal.AssistanceEligible
            ? $"Claim the ${fiscal.EmergencyGrant.ToString("N0", CultureInfo.InvariantCulture)} stabilization grant, then complete contracts or remove optional upkeep."
            : string.Join(' ', fiscal.Actions);

        alerts.Publish(new AlertInput
        {
            DedupeKey = key,
            Type = AlertTypes.Economy,
            Severity = insolvent ? AlertSeverities.Critical : AlertSeverities.Warning,
            Title = insolvent
                ? "City Capital exhausted — recovery available"
                : recovering ? "Fiscal recovery restrictions active" : "City budget is running a deficit",
            Cause = $"{fiscal.Explanation} Net cashflow is {sign}${cashflow}/min.",
            Location = AlertLocation.Named("Citywide treasury"),
            Duration = new AlertDuration { Kind = AlertDurationKinds.UntilResolved },
            Recommendation = recommendation,
            RelatedEntityIds = Array.Empty<string>(),
            FocusAction = new AlertFocusAction(),
        });
        return true;
    }

    public void Dispose() => unsubscribe();

    private static double JavascriptRound(double value) => Math.Floor(value + 0.5);
}

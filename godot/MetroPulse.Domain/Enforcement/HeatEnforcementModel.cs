using MetroPulse.Domain.Traffic;

namespace MetroPulse.Domain.Enforcement;

public static class EnforcementOutcomes
{
    public const string None = "NONE";
    public const string Escaped = "ESCAPED";
    public const string Arrested = "ARRESTED";
}

public sealed record HeatEnforcementConfig(
    double MaximumHeat = 100,
    double EscapeDistance = 35,
    double EscapeDuration = 8,
    double OnFootArrestDistance = 3,
    double VehicleArrestDistance = 4.5,
    double SafeUnseenDecayPerSecond = 3,
    int MaximumResponders = 4);

public sealed record CrimeReport(
    string Reason,
    TrafficPoint Position,
    int Severity,
    bool Witnessed,
    double Security,
    string? SourceId = null);

public sealed record HeatEnforcementState(
    double Heat,
    int WantedTier,
    double EscapeTimer,
    int Repetition,
    string? ActiveIncidentId,
    long CrimeSequence,
    string? LastReason,
    TrafficPoint? LastPosition)
{
    public bool Wanted => WantedTier > 0;

    public static readonly HeatEnforcementState Clear = new(0, 0, 0, 0, null, 0, null, null);
}

public sealed record HeatReportResult(
    HeatEnforcementState State,
    double AddedHeat,
    bool IncidentCreated,
    int RequestedResponders);

public sealed record EnforcementObservation(
    string TargetId,
    TrafficPoint Position,
    bool InVehicle,
    double NearestPoliceDistance,
    bool VisibleToPolice,
    bool SafeState);

public sealed record EnforcementAdvanceResult(
    HeatEnforcementState State,
    string Outcome,
    bool ResolveIncident,
    bool RequiresSafeRecovery);

/// <summary>Player-owned Heat, wanted, escape, arrest, and macro-incident policy.</summary>
public static class HeatEnforcementModel
{
    public static readonly HeatEnforcementConfig DefaultConfig = new();

    public static HeatReportResult Report(
        HeatEnforcementState state,
        CrimeReport report,
        HeatEnforcementConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(report);
        ArgumentException.ThrowIfNullOrWhiteSpace(report.Reason);
        if (!double.IsFinite(report.Position.X) || !double.IsFinite(report.Position.Z))
        {
            throw new ArgumentOutOfRangeException(nameof(report), "Crime position must be finite.");
        }
        config ??= DefaultConfig;
        int severity = Math.Clamp(report.Severity, 1, 5);
        double security = double.IsFinite(report.Security) ? Math.Clamp(report.Security, 0, 1) : 0.5;
        int repetition = state.Wanted ? state.Repetition + 1 : 1;
        double witnessMultiplier = report.Witnessed ? 1 : 0.25;
        double securityMultiplier = 0.75 + security * 0.5;
        double repetitionMultiplier = 1 + Math.Min(4, repetition - 1) * 0.15;
        double added = severity * 8 * witnessMultiplier * securityMultiplier * repetitionMultiplier;
        double maximum = Positive(config.MaximumHeat, DefaultConfig.MaximumHeat);
        double heat = Math.Clamp(state.Heat + added, 0, maximum);
        int tier = TierFor(heat);
        bool created = state.ActiveIncidentId is null;
        long sequence = created ? state.CrimeSequence + 1 : state.CrimeSequence;
        string incident = state.ActiveIncidentId ?? $"player-crime-{sequence:0000}";
        var next = state with
        {
            Heat = heat,
            WantedTier = tier,
            EscapeTimer = 0,
            Repetition = repetition,
            ActiveIncidentId = incident,
            CrimeSequence = sequence,
            LastReason = report.Reason,
            LastPosition = report.Position,
        };
        int responders = Math.Min(Math.Max(1, tier), Math.Max(1, config.MaximumResponders));
        return new HeatReportResult(next, added, created, responders);
    }

    public static EnforcementAdvanceResult Advance(
        HeatEnforcementState state,
        EnforcementObservation observation,
        double delta,
        HeatEnforcementConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(observation);
        config ??= DefaultConfig;
        if (!state.Wanted)
        {
            return new EnforcementAdvanceResult(state with { EscapeTimer = 0 }, EnforcementOutcomes.None, false, false);
        }
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.25) : 0;
        double arrestDistance = observation.InVehicle
            ? Positive(config.VehicleArrestDistance, DefaultConfig.VehicleArrestDistance)
            : Positive(config.OnFootArrestDistance, DefaultConfig.OnFootArrestDistance);
        if (double.IsFinite(observation.NearestPoliceDistance)
            && observation.NearestPoliceDistance < arrestDistance)
        {
            return new EnforcementAdvanceResult(ClearWithSequence(state), EnforcementOutcomes.Arrested, true, true);
        }

        double escapeDistance = Positive(config.EscapeDistance, DefaultConfig.EscapeDistance);
        bool safeUnseen = observation.SafeState
            && !observation.VisibleToPolice
            && (!double.IsFinite(observation.NearestPoliceDistance)
                || observation.NearestPoliceDistance > escapeDistance);
        if (!safeUnseen)
        {
            return new EnforcementAdvanceResult(state with { EscapeTimer = 0 }, EnforcementOutcomes.None, false, false);
        }
        double decay = Positive(config.SafeUnseenDecayPerSecond, DefaultConfig.SafeUnseenDecayPerSecond);
        double timer = state.EscapeTimer + safeDelta;
        double heat = Math.Max(0.01, state.Heat - decay * safeDelta);
        double duration = Positive(config.EscapeDuration, DefaultConfig.EscapeDuration);
        if (timer >= duration)
        {
            return new EnforcementAdvanceResult(ClearWithSequence(state), EnforcementOutcomes.Escaped, true, false);
        }
        return new EnforcementAdvanceResult(
            state with { Heat = heat, WantedTier = TierFor(heat), EscapeTimer = timer },
            EnforcementOutcomes.None,
            false,
            false);
    }

    public static int TierFor(double heat)
    {
        double safe = double.IsFinite(heat) ? Math.Max(0, heat) : 0;
        if (safe <= 0) return 0;
        if (safe < 25) return 1;
        if (safe < 50) return 2;
        if (safe < 75) return 3;
        return 4;
    }

    private static HeatEnforcementState ClearWithSequence(HeatEnforcementState state) =>
        HeatEnforcementState.Clear with { CrimeSequence = state.CrimeSequence };

    private static double Positive(double value, double fallback) =>
        double.IsFinite(value) && value > 0 ? value : fallback;
}

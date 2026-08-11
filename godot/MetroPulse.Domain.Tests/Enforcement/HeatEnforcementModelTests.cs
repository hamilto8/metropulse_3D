using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Enforcement;

public sealed class HeatEnforcementModelTests
{
    [Fact]
    public void WitnessSeveritySecurityAndRepetitionRaiseOneMacroIncident()
    {
        HeatEnforcementState state = HeatEnforcementState.Clear;
        HeatReportResult first = HeatEnforcementModel.Report(state,
            new CrimeReport("Hijack", new TrafficPoint(10, 20), 2, true, 0.8));
        HeatReportResult repeated = HeatEnforcementModel.Report(first.State,
            new CrimeReport("Ramming", new TrafficPoint(12, 20), 3, true, 0.8));
        HeatReportResult unwitnessed = HeatEnforcementModel.Report(repeated.State,
            new CrimeReport("Unseen damage", new TrafficPoint(15, 20), 3, false, 0.8));

        Assert.True(first.AddedHeat > 0);
        Assert.True(repeated.AddedHeat > first.AddedHeat);
        Assert.True(unwitnessed.AddedHeat < repeated.AddedHeat);
        Assert.True(first.IncidentCreated);
        Assert.False(repeated.IncidentCreated);
        Assert.Equal(first.State.ActiveIncidentId, unwitnessed.State.ActiveIncidentId);
        Assert.Equal(3, unwitnessed.State.Repetition);
    }

    [Fact]
    public void HeatDecaysOnlyWhileSafeUnseenAndEscapesAfterEightSeconds()
    {
        HeatEnforcementState state = HeatEnforcementModel.Report(
            HeatEnforcementState.Clear,
            new CrimeReport("Crime", new TrafficPoint(0, 0), 4, true, 1)).State;
        double initial = state.Heat;
        state = HeatEnforcementModel.Advance(state,
            Observation(distance: 50, visible: true, safe: true), 1).State;
        Assert.Equal(initial, state.Heat);
        Assert.Equal(0, state.EscapeTimer);
        state = HeatEnforcementModel.Advance(state,
            Observation(distance: 50, visible: false, safe: false), 1).State;
        Assert.Equal(initial, state.Heat);

        EnforcementAdvanceResult result = new(state, EnforcementOutcomes.None, false, false);
        for (int index = 0; index < 32; index += 1)
        {
            result = HeatEnforcementModel.Advance(result.State,
                Observation(distance: 50, visible: false, safe: true), 0.25);
        }
        Assert.Equal(EnforcementOutcomes.Escaped, result.Outcome);
        Assert.False(result.State.Wanted);
        Assert.True(result.ResolveIncident);
    }

    [Fact]
    public void ArrestDistanceTracksControlledEntityAndRequiresSafeRecovery()
    {
        HeatEnforcementState wanted = HeatEnforcementModel.Report(
            HeatEnforcementState.Clear,
            new CrimeReport("Crime", new TrafficPoint(0, 0), 2, true, 0.5)).State;
        EnforcementAdvanceResult onFoot = HeatEnforcementModel.Advance(
            wanted, Observation(distance: 3.5, inVehicle: false), 0.1);
        EnforcementAdvanceResult vehicle = HeatEnforcementModel.Advance(
            wanted, Observation(distance: 3.5, inVehicle: true), 0.1);

        Assert.Equal(EnforcementOutcomes.None, onFoot.Outcome);
        Assert.Equal(EnforcementOutcomes.Arrested, vehicle.Outcome);
        Assert.True(vehicle.RequiresSafeRecovery);
        Assert.False(vehicle.State.Wanted);
    }

    private static EnforcementObservation Observation(
        double distance,
        bool visible = false,
        bool safe = true,
        bool inVehicle = false) => new(
            "player", new TrafficPoint(0, 0), inVehicle, distance, visible, safe);
}

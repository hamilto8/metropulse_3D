using MetroPulse.Domain.Vehicles;
using Xunit;

namespace MetroPulse.Domain.Tests.Vehicles;

public sealed class VehiclePossessionModelTests
{
    [Fact]
    public void EntryDistinguishesImmediatePossessionAndTimedHijack()
    {
        VehicleEntryDecision owned = VehiclePossessionModel.EvaluateEntry(2, occupied: false, authorized: true, vehicleSupported: true);
        Assert.True(owned.Allowed);
        Assert.False(owned.RequiresHijack);
        Assert.Equal(0, owned.RequiredDuration);

        VehicleEntryDecision hijack = VehiclePossessionModel.EvaluateEntry(2, occupied: true, authorized: false, vehicleSupported: true);
        Assert.True(hijack.Allowed);
        Assert.True(hijack.RequiresHijack);
        Assert.Equal(1.25, hijack.RequiredDuration);
        Assert.Equal("VEHICLE_OUT_OF_RANGE", VehiclePossessionModel.EvaluateEntry(4, false, true, true).Code);
    }

    [Fact]
    public void HijackTimingCancelsOrCompletesExactlyOnce()
    {
        VehicleHijackProgress progress = new(0, false, false);
        for (int index = 0; index < 5; index += 1)
        {
            progress = VehiclePossessionModel.AdvanceHijack(progress, 0.25, remainsEligible: true);
        }
        Assert.True(progress.Completed);
        Assert.Equal(1.25, progress.Elapsed);
        Assert.Same(progress, VehiclePossessionModel.AdvanceHijack(progress, 1, remainsEligible: true));
        VehicleHijackProgress canceled = VehiclePossessionModel.AdvanceHijack(new(0.5, false, false), 0.1, remainsEligible: false);
        Assert.True(canceled.Canceled);
        Assert.Equal("HIJACK_INTERRUPTED", canceled.Code);
    }

    [Fact]
    public void ExitRejectsMotionAirborneRollAndBlockedPose()
    {
        Assert.True(VehiclePossessionModel.EvaluateExit(0.5, 0.1, grounded: true, exitPoseSafe: true).Allowed);
        Assert.Equal("VEHICLE_EXIT_MOVING", VehiclePossessionModel.EvaluateExit(2, 0, true, true).Code);
        Assert.Equal("VEHICLE_EXIT_AIRBORNE_OR_ROLLED", VehiclePossessionModel.EvaluateExit(0, 0, false, true).Code);
        Assert.Equal("VEHICLE_EXIT_AIRBORNE_OR_ROLLED", VehiclePossessionModel.EvaluateExit(0, 1, true, true).Code);
        Assert.Equal("VEHICLE_EXIT_POSE_BLOCKED", VehiclePossessionModel.EvaluateExit(0, 0, true, false).Code);
    }
}

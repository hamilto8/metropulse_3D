using MetroPulse.Domain.Vehicles;
using Xunit;

namespace MetroPulse.Domain.Tests.Vehicles;

public sealed class VehicleImpactRecoveryModelTests
{
    [Fact]
    public void ImpactPolicyDebouncesClampsAndSeparatesKnockdownFromEjection()
    {
        Assert.Equal("IMPACT_DEBOUNCED", VehicleImpactRecoveryModel.EvaluateImpact(20, 0.1, true, true).Code);
        Assert.Equal("IMPACT_BELOW_THRESHOLD", VehicleImpactRecoveryModel.EvaluateImpact(1, 1, true, true).Code);

        VehicleImpactDecision pedestrian = VehicleImpactRecoveryModel.EvaluateImpact(6, 1, true, false);
        Assert.True(pedestrian.Reported);
        Assert.True(pedestrian.KnockdownPedestrian);
        Assert.False(pedestrian.EjectRider);

        VehicleImpactDecision motorbike = VehicleImpactRecoveryModel.EvaluateImpact(40, 1, false, true);
        Assert.True(motorbike.EjectRider);
        Assert.Equal(VehicleImpactRecoveryModel.DefaultConfig.MaximumResponseImpulse, motorbike.ResponseImpulse);
    }

    [Fact]
    public void RecoveryPolicyClassifiesEveryUnsafeAndStuckCondition()
    {
        Assert.False(VehicleImpactRecoveryModel.EvaluateRecovery(1, 0, true, false, 0, 0, true, 0).Recover);
        Assert.Equal("VEHICLE_RESET_REQUESTED", Decision(forced: true));
        Assert.Equal("VEHICLE_OUT_OF_BOUNDS", Decision(withinBounds: false));
        Assert.Equal("VEHICLE_IN_WATER", Decision(water: true));
        Assert.Equal("VEHICLE_BELOW_SURFACE", Decision(bodyHeight: -3));
        Assert.Equal("VEHICLE_ROLLED", Decision(roll: 1.2));
        Assert.Equal("VEHICLE_STUCK", Decision(stuck: 3));
    }

    private static string? Decision(
        double bodyHeight = 1,
        bool withinBounds = true,
        bool water = false,
        double roll = 0,
        double stuck = 0,
        bool forced = false) => VehicleImpactRecoveryModel.EvaluateRecovery(
            bodyHeight,
            0,
            withinBounds,
            water,
            0,
            roll,
            true,
            stuck,
            forced).Code;
}

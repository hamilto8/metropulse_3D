using MetroPulse.Domain.Vehicles;
using Xunit;

namespace MetroPulse.Domain.Tests.Vehicles;

public sealed class VehiclePhysicsSpikeModelTests
{
    [Fact]
    public void SelectionRejectsBranchesThatCannotMeetSliceContracts()
    {
        VehiclePhysicsSpikeTelemetry builtIn = Fixture(VehiclePhysicsBranch.BuiltInVehicleBody) with
        {
            WeatherGrip = false,
            SupportedMajorProfiles = 4,
        };
        VehiclePhysicsSpikeTelemetry custom = Fixture(VehiclePhysicsBranch.CustomRaycastRigidBody) with
        {
            AveragePhysicsMicroseconds = 400,
        };

        VehiclePhysicsSpikeDecision decision = VehiclePhysicsSpikeModel.Select([builtIn, custom]);

        Assert.Equal(VehiclePhysicsBranch.CustomRaycastRigidBody, decision.Selected);
        Assert.Equal(["weather-grip", "profile-coverage"], decision.Blockers[builtIn.Branch]);
        Assert.Empty(decision.Blockers[custom.Branch]);
    }

    [Fact]
    public void SelectionRequiresUniqueFiniteBranchTelemetry()
    {
        VehiclePhysicsSpikeTelemetry builtIn = Fixture(VehiclePhysicsBranch.BuiltInVehicleBody);
        Assert.Throws<ArgumentException>(() => VehiclePhysicsSpikeModel.Select([builtIn, builtIn]));
        Assert.Throws<ArgumentException>(() => VehiclePhysicsSpikeModel.Select([
            builtIn,
            Fixture(VehiclePhysicsBranch.CustomRaycastRigidBody) with { ReplayPositionDelta = double.NaN },
        ]));
    }

    private static VehiclePhysicsSpikeTelemetry Fixture(VehiclePhysicsBranch branch) => new(
        branch,
        AccelerationSpeed: 8,
        BrakingSpeed: 1,
        ReverseSpeed: 3,
        HeadingChangeRadians: 0.4,
        TurningRadius: 12,
        MaximumRollRadians: 0.08,
        AveragePhysicsMicroseconds: 200,
        ReplayPositionDelta: 0.001,
        GroundedWheelCount: 4,
        CollisionResponse: true,
        BridgeAndCurbTraversal: true,
        SlopeTraversal: true,
        ControlTransfer: true,
        WeatherGrip: true,
        SupportedMajorProfiles: 6);
}

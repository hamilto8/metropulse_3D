using MetroPulse.Domain.Pedestrians;
using Xunit;

namespace MetroPulse.Domain.Tests.Pedestrians;

public sealed class PedestrianModelTests
{
    [Fact]
    public void PlayerLocomotionUsesMetersPerSecondAndBoundedAcceleration()
    {
        PedestrianPlanarVelocity velocity = PedestrianPlanarVelocity.Zero;
        for (int index = 0; index < 120; index += 1)
        {
            velocity = PedestrianLocomotionModel.AdvancePlanarVelocity(
                velocity,
                new PedestrianPlanarVelocity(3, 4),
                sprint: false,
                grounded: true,
                1d / 120);
        }

        Assert.Equal(PedestrianLocomotionModel.DefaultConfig.WalkSpeed, velocity.Length, 10);
        PedestrianPlanarVelocity sprint = PedestrianLocomotionModel.AdvancePlanarVelocity(
            velocity,
            new PedestrianPlanarVelocity(3, 4),
            sprint: true,
            grounded: true,
            1d / 120);
        Assert.True(sprint.Length > velocity.Length);
        Assert.True(sprint.Length <= PedestrianLocomotionModel.DefaultConfig.SprintSpeed);
    }

    [Fact]
    public void PlayerJumpGravityAnimationAndRecoveryAreExplicit()
    {
        double jump = PedestrianLocomotionModel.AdvanceVerticalVelocity(0, grounded: true, jumpPressed: true, 1d / 120);
        Assert.Equal(PedestrianLocomotionModel.DefaultConfig.JumpSpeed, jump);
        Assert.Equal(PedestrianAnimationState.Jump,
            PedestrianLocomotionModel.ClassifyAnimation(4, jump, grounded: false, sprint: false));
        double falling = PedestrianLocomotionModel.AdvanceVerticalVelocity(jump, grounded: false, jumpPressed: false, 0.1);
        Assert.True(falling < jump);
        Assert.Equal(PedestrianAnimationState.Sprint,
            PedestrianLocomotionModel.ClassifyAnimation(6, 0, grounded: true, sprint: true));

        Assert.True(PedestrianLocomotionModel.RequiresRecovery(
            new PedestrianVector3(150, -2, 20),
            (_, _) => true,
            (x, _, _) => x is >= 135 and <= 185));
        Assert.True(PedestrianLocomotionModel.RequiresRecovery(
            new PedestrianVector3(9999, 1, 0),
            (x, _) => x < 800,
            (_, _, _) => false));
        Assert.False(PedestrianLocomotionModel.RequiresRecovery(
            new PedestrianVector3(0, 1, 0),
            (_, _) => true,
            (_, _, _) => false));
    }

    [Fact]
    public void SweepCannotTunnelThroughStaticBuildingCollider()
    {
        PedestrianMovementResult movement = PedestrianCollisionModel.Move(
            new PedestrianVector3(-5, 0, 0),
            new PedestrianVector3(10, 0, 0),
            [new PedestrianCollisionBox("building", 0, 5, 0, 2, 5, 4)]);

        Assert.True(movement.Collided);
        Assert.True(movement.Position.X <= -2.42, $"pedestrian crossed wall at x={movement.Position.X}");
    }

    [Fact]
    public void CollisionPreservesTangentialWallSliding()
    {
        PedestrianMovementResult movement = PedestrianCollisionModel.Move(
            new PedestrianVector3(-3, 0, -4),
            new PedestrianVector3(3, 0, 5),
            [new PedestrianCollisionBox("wall", 0, 5, 0, 2, 5, 10)]);

        Assert.True(movement.Collided);
        Assert.True(movement.Position.X <= -2.42);
        Assert.True(movement.Position.Z > -1, $"wall sliding lost tangential progress: z={movement.Position.Z}");
    }

    [Fact]
    public void CollisionRespectsRotatedAndRemovedSnapshots()
    {
        PedestrianCollisionBox rotated = new("parked", 0, 1, 0, 1.05, 1, 2.2, Math.PI / 2);
        PedestrianMovementResult blocked = PedestrianCollisionModel.Move(
            new PedestrianVector3(-5, 0, 0),
            new PedestrianVector3(10, 0, 0),
            [rotated]);
        Assert.True(blocked.Collided);
        Assert.True(blocked.Position.X < -2.5);

        PedestrianMovementResult removed = PedestrianCollisionModel.Move(
            new PedestrianVector3(-5, 0, 0),
            new PedestrianVector3(10, 0, 0),
            Array.Empty<PedestrianCollisionBox>());
        Assert.False(removed.Collided);
        Assert.Equal(5, removed.Position.X, 12);
    }

    [Fact]
    public void CollisionSanitizesInvalidValuesAndBoundsExtremeTravel()
    {
        PedestrianMovementResult movement = PedestrianCollisionModel.Move(
            new PedestrianVector3(double.NaN, 0, 0),
            new PedestrianVector3(1000, double.NaN, double.PositiveInfinity),
            Array.Empty<PedestrianCollisionBox>());

        Assert.True(movement.Position.IsFinite);
        Assert.True(movement.Position.X <= 12.8);
    }

    [Fact]
    public void YieldDetectionIncludesReactionBrakingAndSafeClearance()
    {
        (string Type, double Speed, double Acceleration)[] fixtures =
        [
            ("SEDAN", 20, 12),
            ("SPORTS_CAR", 32, 18),
            ("BUS", 15, 12),
            ("POLICE", 42, 12),
        ];
        foreach ((string type, double speed, double acceleration) in fixtures)
        {
            PedestrianYieldKinematics kinematics = PedestrianTrafficModel.GetYieldKinematics(speed, acceleration);
            Assert.True(kinematics.DetectionDistance > kinematics.StoppingDistance);
            double current = speed;
            double remainingDistance = kinematics.DetectionDistance;
            while (current > 0)
            {
                current = PedestrianTrafficModel.ApproachTargetSpeed(
                    current,
                    0,
                    acceleration,
                    1d / 60,
                    pedestrianBlocked: true);
                remainingDistance -= current / 60;
            }
            Assert.True(remainingDistance >= 3.1, $"{type} stopped with only {remainingDistance}m clearance");
        }
    }

    [Fact]
    public void DriverDispositionWaitsHonksOnceAndPatientStateRemainsStopped()
    {
        int impatient = Enumerable.Range(0, 1000)
            .Count(index => PedestrianTrafficModel.CreateEncounter((index + 0.5) / 1000).Impatient);
        Assert.Equal(200, impatient);
        Assert.False(PedestrianTrafficModel.CreateEncounter(double.NaN).Impatient);

        PedestrianTrafficEncounter impatientState = PedestrianTrafficModel.CreateEncounter(0.1);
        PedestrianTrafficAction waiting = PedestrianTrafficModel.UpdateEncounter(impatientState, 0.1);
        Assert.True(waiting.ShouldYield);
        Assert.False(waiting.ShouldHonk);
        PedestrianTrafficAction released = PedestrianTrafficModel.UpdateEncounter(waiting.State, 3.5);
        Assert.False(released.ShouldYield);
        Assert.True(released.ShouldHonk);
        PedestrianTrafficAction repeated = PedestrianTrafficModel.UpdateEncounter(released.State, 1);
        Assert.False(repeated.ShouldHonk);

        PedestrianTrafficAction patient = PedestrianTrafficModel.UpdateEncounter(
            PedestrianTrafficModel.CreateEncounter(0.9),
            30);
        Assert.True(patient.ShouldYield);
        Assert.False(patient.ShouldHonk);
    }

    [Fact]
    public void ParticipantsAndEmergencyDistancesPreserveAuthoredPolicy()
    {
        Assert.True(PedestrianTrafficModel.IsTrafficParticipant(new PedestrianTrafficParticipant()));
        Assert.False(PedestrianTrafficModel.IsTrafficParticipant(new PedestrianTrafficParticipant(KnockedDown: true)));
        Assert.False(PedestrianTrafficModel.IsTrafficParticipant(new PedestrianTrafficParticipant(IsHijacking: true)));
        Assert.False(PedestrianTrafficModel.IsTrafficParticipant(new PedestrianTrafficParticipant(
            Archetype: "CAFE_READER",
            BehaviorMode: NpcBehaviorModes.SittingReading)));
        Assert.Equal(3.1, PedestrianTrafficModel.GetEmergencyStopDistance("SEDAN"));
        Assert.Equal(4.2, PedestrianTrafficModel.GetEmergencyStopDistance("BUS"));
        Assert.Equal(4.2, PedestrianTrafficModel.GetEmergencyStopDistance("DUMP_TRUCK"));
    }

    [Fact]
    public void NpcStatesAndTouristTransitionsUseExplicitSamples()
    {
        Assert.Equal(NpcBehaviorModes.SittingReading, NpcBehaviorModel.CreateState("CAFE_READER").Mode);
        Assert.Equal(NpcBehaviorModes.Jogging, NpcBehaviorModel.CreateState("JOGGER").Mode);
        Assert.Equal(5, NpcBehaviorModel.CreateState("TOURIST", 0).Timer);
        Assert.Equal(9.5, NpcBehaviorModel.CreateState("CRIMINAL", 0.5).Timer);

        NpcBehaviorState tourist = NpcBehaviorModel.CreateState("TOURIST", 0);
        tourist = tourist with { Timer = 0 };
        tourist = NpcBehaviorModel.AdvanceTourist(tourist, 0.1, 0);
        Assert.Equal(NpcBehaviorModes.TakingPhoto, tourist.Mode);
        Assert.Equal(2, tourist.Timer);
        tourist = NpcBehaviorModel.AdvanceTourist(tourist with { Timer = 0 }, 0.1, 0);
        Assert.Equal(NpcBehaviorModes.Walking, tourist.Mode);
        Assert.Equal(5, tourist.Timer);
    }

    [Fact]
    public void AggressionTargetPrioritizesControlledCitizenAndHonorsReservations()
    {
        PedestrianVector3 criminalPosition = PedestrianVector3.Zero;
        NpcCandidate citizen = new("citizen", "CASUAL", new PedestrianVector3(2, 0, 0));
        NpcCandidate player = new("player", "CASUAL", new PedestrianVector3(5, 0, 0));
        NpcCandidate criminal = new("criminal", "CRIMINAL", criminalPosition);

        Assert.Equal("player", NpcBehaviorModel.SelectAggressionTarget(
            criminal.Id,
            criminalPosition,
            [criminal, citizen, player],
            player.Id)!.Id);
        Assert.Equal("citizen", NpcBehaviorModel.SelectAggressionTarget(
            criminal.Id,
            criminalPosition,
            [criminal, citizen, player with { AttackedById = "other" }],
            player.Id)!.Id);
        NpcCandidate controlledTroublemaker = new("controlled", "CRIMINAL", new PedestrianVector3(4, 0, 0));
        Assert.Equal("controlled", NpcBehaviorModel.SelectAggressionTarget(
            criminal.Id,
            criminalPosition,
            [criminal, controlledTroublemaker],
            controlledTroublemaker.Id)!.Id);
    }

    [Fact]
    public void AggressionBeginAndFinishPreserveSingleTargetReservation()
    {
        NpcBehaviorState loitering = NpcBehaviorModel.CreateState("CRIMINAL", 0.5);
        AggressionTransition blocked = NpcBehaviorModel.BeginAggression(
            "criminal",
            loitering,
            "citizen",
            "other");
        Assert.False(blocked.Applied);
        Assert.Same(loitering, blocked.State);

        AggressionTransition begun = NpcBehaviorModel.BeginAggression(
            "criminal",
            loitering,
            "citizen",
            null);
        Assert.True(begun.Applied);
        Assert.Equal(NpcBehaviorModes.Chasing, begun.State.Mode);
        Assert.Equal("criminal", begun.TargetAttackedById);
        AggressionTransition finished = NpcBehaviorModel.FinishAggression(
            "criminal",
            begun.State,
            begun.TargetAttackedById,
            timingSample: 0.5);
        Assert.Equal(NpcBehaviorModes.Loitering, finished.State.Mode);
        Assert.Equal(17, finished.State.Timer);
        Assert.Null(finished.TargetAttackedById);
    }

    [Fact]
    public void KnockdownStartUsesBoundedThrowLiftAndExplicitTumbleSamples()
    {
        PedestrianKnockdownState state = PedestrianKnockdownModel.Start(
            PedestrianVector3.Zero,
            new PedestrianVector3(0, 4, 1),
            impactSpeed: 20,
            fallSideSample: 0,
            tumbleSample: 0.5);

        Assert.True(state.Active);
        Assert.Equal(4, state.Remaining());
        Assert.True(state.Velocity.Z > 3);
        Assert.True(state.Velocity.Y > 2);
        Assert.Equal(-1.42, state.RestRoll);
        Assert.Equal(-4.5, state.TumbleRate);
        Assert.Equal(1, state.LimbPose);
    }

    [Fact]
    public void KnockdownSanitizesInvalidInputsAndCompletesStandingOnTerrain()
    {
        Assert.Throws<ArgumentException>(() => PedestrianKnockdownModel.Start(
            new PedestrianVector3(double.NaN, 0, 0), null));
        PedestrianKnockdownState state = PedestrianKnockdownModel.Start(
            PedestrianVector3.Zero,
            null,
            double.NaN);
        state = PedestrianKnockdownModel.Update(state, double.NaN, (_, _) => double.NaN);
        Assert.True(state.Position.IsFinite);
        for (int index = 0; index < 250; index += 1)
        {
            state = PedestrianKnockdownModel.Update(state, 1d / 60, (_, _) => 0);
        }
        Assert.False(state.Active);
        Assert.Equal(0, state.Position.Y);
        Assert.Equal(0, state.RotationX);
        Assert.Equal(0, state.RotationZ);
        Assert.Equal(0, state.LimbPose);
    }
}

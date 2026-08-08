using MetroPulse.Domain.Aircraft;
using Xunit;

namespace MetroPulse.Domain.Tests.Aircraft;

public sealed class AircraftModelTests
{
    [Fact]
    public void StateAndControlsSanitizeNonfiniteValuesAndClampAuthority()
    {
        AircraftFlightState state = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(double.NaN, double.PositiveInfinity, double.NegativeInfinity),
            Heading = -Math.PI / 2,
            Pitch = double.NaN,
            Roll = double.PositiveInfinity,
            Speed = -4,
            VerticalSpeed = double.NaN,
            Throttle = 3,
            Grounded = false,
        });
        Assert.Equal(new AircraftVector3(0, 1.15, 0), state.Position);
        Assert.Equal(Math.PI * 1.5, state.Heading, 12);
        Assert.Equal(0, state.Speed);
        Assert.Equal(1, state.Throttle);
        Assert.Equal(AircraftModes.Airborne, state.Mode);

        AircraftControls controls = AircraftFlightModel.SanitizeControls(new AircraftControls
        {
            Roll = 4,
            Pitch = -3,
            ThrottleUp = double.NaN,
            ThrottleDown = 2,
            Brake = -1,
        });
        Assert.Equal(new AircraftControls
        {
            Roll = 1,
            Pitch = -1,
            ThrottleUp = 0,
            ThrottleDown = 1,
            Brake = 0,
        }, controls);
    }

    [Fact]
    public void FullThrottleProducesExactAssistedRunwayTakeoffWithoutTeleporting()
    {
        AircraftFlightState initial = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(-105, 1.15, -168),
            Heading = Math.PI,
            Grounded = true,
        });
        AircraftFlightState result = Simulate(initial, new AircraftControls { ThrottleUp = 1 }, 7);

        Assert.False(result.Crashed);
        Assert.False(result.Grounded);
        Assert.Equal(AircraftModes.Airborne, result.Mode);
        Assert.Equal(64, result.Speed, 12);
        Assert.Equal(6.338680553829654, result.Position!.Y, 10);
        Assert.Equal(-419.87695005114654, result.Position.Z, 10);
        Assert.Equal(0.011299040799956963, result.VerticalSpeed, 10);
    }

    [Fact]
    public void BankAuthorityMatchesBrowserHeadingRollAndPosition()
    {
        AircraftFlightState initial = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(0, 60, 0),
            Speed = 38,
            Throttle = 0.8,
            Grounded = false,
            Mode = AircraftModes.Airborne,
        });
        AircraftFlightState result = Simulate(
            initial,
            new AircraftControls { Roll = 1, ThrottleUp = 0.2 },
            2);

        Assert.Equal(1.3494306953355206, result.Heading, 10);
        Assert.Equal(0.8460082593507569, result.Roll, 10);
        Assert.Equal(61.801244119632614, result.Speed, 10);
        Assert.Equal(55.559164270487614, result.Position!.X, 10);
        Assert.Equal(71.82398880348141, result.Position.Z, 10);
    }

    [Fact]
    public void LowAirspeedProducesExactStallWarningAndControlledSink()
    {
        AircraftFlightState result = Simulate(
            AircraftFlightModel.CreateState(new AircraftFlightState
            {
                Position = new AircraftVector3(0, 50, 0),
                Speed = 10,
                Grounded = false,
                Mode = AircraftModes.Airborne,
            }),
            new AircraftControls(),
            0.5);

        Assert.True(result.StallWarning);
        Assert.Equal(-4.106106028814435, result.VerticalSpeed, 10);
        Assert.Equal(48.776554012956865, result.Position!.Y, 10);
        Assert.Equal(9.241983899911613, result.Speed, 10);
    }

    [Fact]
    public void GentleTouchdownTaxisWhileHardWaterAndUnsupportedLandingsCrash()
    {
        AircraftFlightState approach = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(-105, 1.25, -300),
            Speed = 25,
            VerticalSpeed = -3,
            Grounded = false,
            Mode = AircraftModes.Landing,
        });
        AircraftFlightState safe = AircraftFlightModel.Step(
            approach,
            new AircraftControls { Brake = 1 },
            0.1,
            new AircraftEnvironment { LandingSurface = LandingSurfaceTypes.Runway });
        Assert.False(safe.Crashed);
        Assert.True(safe.Grounded);
        Assert.Equal(AircraftModes.Taxi, safe.Mode);
        Assert.Equal(LandingSurfaceTypes.Runway, safe.LandingSurface);

        AircraftFlightState hard = AircraftFlightModel.Step(
            approach with { VerticalSpeed = -16 },
            null,
            0.1);
        Assert.True(hard.Crashed);
        Assert.Equal(AircraftModes.Crashed, hard.Mode);

        AircraftFlightState ditch = AircraftFlightModel.Step(
            approach,
            null,
            0.1,
            new AircraftEnvironment { InWater = true });
        Assert.True(ditch.Crashed);

        AircraftFlightState unsupported = AircraftFlightModel.Step(
            approach,
            null,
            0.1,
            new AircraftEnvironment
            {
                CanLand = false,
                LandingSurface = LandingSurfaceTypes.Unsuitable,
            });
        Assert.True(unsupported.Crashed);
    }

    [Fact]
    public void DeltaAltitudeCrashAndPropellerBoundariesRemainStable()
    {
        AircraftFlightState airborne = AircraftFlightModel.CreateState(new AircraftFlightState
        {
            Position = new AircraftVector3(0, 500, 0),
            Pitch = 0.4,
            Speed = 40,
            VerticalSpeed = 10,
            Throttle = 0.5,
            Grounded = false,
        });
        AircraftEnvironment environment = new() { GroundHeight = 5 };
        Assert.Equal(
            AircraftFlightModel.Step(airborne, null, 0.1, environment),
            AircraftFlightModel.Step(airborne, null, 100, environment));
        AircraftFlightState limited = AircraftFlightModel.Step(airborne, null, 0.1, environment);
        Assert.Equal(285, limited.Position!.Y);
        Assert.True(limited.VerticalSpeed <= 0);
        Assert.True(limited.Pitch <= 0);

        AircraftFlightState crashed = AircraftFlightModel.Step(
            airborne with { Crashed = true, Speed = 50, VerticalSpeed = -20 },
            new AircraftControls { ThrottleUp = 1 },
            0.1);
        Assert.Equal(AircraftModes.Crashed, crashed.Mode);
        Assert.Equal(0, crashed.Speed);
        Assert.Equal(0, crashed.VerticalSpeed);

        AircraftFlightState engine = new() { Throttle = 0.5, Speed = 20 };
        Assert.Equal(26.6, AircraftFlightModel.GetPropellerRotationRate(engine), 12);
        double rotation = AircraftFlightModel.AdvancePropellerRotation(6.1, engine, 1);
        Assert.InRange(rotation, 0, Math.PI * 2);
        Assert.Equal(0, AircraftFlightModel.GetPropellerRotationRate(new AircraftFlightState()));
    }

    [Fact]
    public void AirfieldLayoutKeepsRunwayAndSpawnInsideNorthwestParcel()
    {
        AirfieldLayout layout = AircraftLandingSurfaceModel.DefaultAirfieldLayout;
        Assert.True(AircraftLandingSurfaceModel.IsAirfieldLayoutValid(layout));
        Assert.True(layout.CenterX < 0);
        Assert.True(layout.CenterZ < -100);
        Assert.Equal(28, layout.RunwayWidth);
        Assert.Equal(210, layout.RunwayLength);
        Assert.Equal(new AircraftSpawnPoint(-105, 1.15, -190, Math.PI), layout.AircraftStart);
        Assert.False(AircraftLandingSurfaceModel.IsAirfieldLayoutValid(
            layout with { RunwayLength = 500 }));
    }

    [Fact]
    public void LandingClassificationIncludesRunwayRoadsPlacedRoadAndCountrysideButNotBridge()
    {
        AircraftLandingSurfaceModel model = AircraftLandingSurfaceModel.LoadProduction();
        AircraftLandingWorld bridge = new()
        {
            IsBridgeDeck = (x, z) => Math.Abs(x - 160) < 10 && Math.Abs(z) < 10,
        };
        Assert.Equal(LandingSurfaceTypes.Runway, model.Classify(new AircraftPlanarPoint(-105, -260)));
        Assert.Equal(LandingSurfaceTypes.Road, model.Classify(new AircraftPlanarPoint(0, 50)));
        Assert.Equal(LandingSurfaceTypes.Road, model.Classify(new AircraftPlanarPoint(550, 0)));
        Assert.Equal(LandingSurfaceTypes.Countryside, model.Classify(new AircraftPlanarPoint(525, 25)));
        Assert.Equal(LandingSurfaceTypes.Unsuitable, model.Classify(new AircraftPlanarPoint(160, 0), bridge));
        Assert.Equal(LandingSurfaceTypes.Unsuitable, model.Classify(new AircraftPlanarPoint(250, 25)));

        AircraftLandingWorld placed = new()
        {
            PlacedRoads =
            [
                new PlacedLandingRoad
                {
                    Position = new AircraftPlanarPoint(-220, 200),
                    Width = 30,
                    Depth = 60,
                    RotationY = Math.PI / 2,
                    RoadType = "STRAIGHT",
                },
                new PlacedLandingRoad
                {
                    Position = new AircraftPlanarPoint(-300, 200),
                    RoadType = "BRIDGE",
                },
            ],
        };
        Assert.Equal(LandingSurfaceTypes.Road, model.Classify(new AircraftPlanarPoint(-200, 200), placed));
        Assert.Equal(LandingSurfaceTypes.Unsuitable, model.Classify(new AircraftPlanarPoint(-300, 200), placed));
    }

    [Fact]
    public void LandingFootprintRotatesAndGuardsWingTipsWithImmutableSamples()
    {
        IReadOnlyList<AircraftPlanarPoint> northbound =
            AircraftLandingSurfaceModel.GetFootprintSamples(new AircraftPlanarPoint(500, 25));
        IReadOnlyList<AircraftPlanarPoint> eastbound =
            AircraftLandingSurfaceModel.GetFootprintSamples(new AircraftPlanarPoint(500, 25), Math.PI / 2);
        Assert.Equal(7, northbound.Count);
        Assert.Contains(northbound, point => point.X < 496);
        Assert.Contains(eastbound, point => point.Z > 29);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<AircraftPlanarPoint>)northbound).Add(new AircraftPlanarPoint(0, 0)));

        AircraftLandingSurfaceModel model = AircraftLandingSurfaceModel.LoadProduction();
        AircraftLandingAssessment wingtip = model.Assess(
            new AircraftPlanarPoint(500, 25),
            world: new AircraftLandingWorld { IsInWater = point => point.X > 504 });
        Assert.Equal(LandingFailureReasons.Water, wingtip.Reason);
    }

    [Fact]
    public void LevelRoadAndRollingCountrysideProduceSafeAssessments()
    {
        AircraftLandingSurfaceModel model = AircraftLandingSurfaceModel.LoadProduction();
        AircraftLandingWorld terrain = new()
        {
            GetTerrainHeight = (x, z) => x >= 420 ? Math.Sin(x * 0.01) * 0.2 + z * 0.001 : 0,
        };
        AircraftLandingAssessment road = model.Assess(
            new AircraftPlanarPoint(550, 0),
            Math.PI / 2,
            terrain);
        AircraftLandingAssessment countryside = model.Assess(
            new AircraftPlanarPoint(525, 25),
            0,
            terrain);

        Assert.True(road.Allowed);
        Assert.Equal(LandingSurfaceTypes.Road, road.Type);
        Assert.True(countryside.Allowed);
        Assert.Equal(LandingSurfaceTypes.Countryside, countryside.Type);
        Assert.True(countryside.MaximumGrade > 0);
        Assert.True(countryside.MaximumGrade <= AircraftLandingSurfaceModel.MaximumLandingGrade);
    }

    [Fact]
    public void WaterSteepUnsupportedAndMalformedLandingSurfacesFailWithStableReasons()
    {
        AircraftLandingSurfaceModel model = AircraftLandingSurfaceModel.LoadProduction();
        AircraftLandingAssessment wet = model.Assess(
            new AircraftPlanarPoint(160, 0),
            world: new AircraftLandingWorld
            {
                GetTerrainHeight = (_, _) => -3,
                IsInWater = point => point.X >= 135 && point.X <= 185,
            });
        Assert.Equal(LandingFailureReasons.Water, wet.Reason);
        Assert.Equal(0, wet.GroundHeight);

        AircraftLandingAssessment steep = model.Assess(
            new AircraftPlanarPoint(525, 25),
            world: new AircraftLandingWorld { GetTerrainHeight = (x, _) => (x - 525) * 0.5 });
        Assert.Equal(LandingFailureReasons.TerrainTooSteep, steep.Reason);

        AircraftLandingAssessment unsupported = model.Assess(new AircraftPlanarPoint(250, 25));
        Assert.Equal(LandingFailureReasons.UnsupportedSurface, unsupported.Reason);
        AircraftLandingAssessment malformed = model.Assess(
            new AircraftPlanarPoint(double.NaN, double.PositiveInfinity));
        Assert.Equal(LandingFailureReasons.InvalidPosition, malformed.Reason);
        Assert.Equal(double.PositiveInfinity, malformed.MaximumGrade);
        Assert.Empty(AircraftLandingSurfaceModel.GetFootprintSamples(null));
    }

    [Fact]
    public void PropellerAudioMatchesBrowserTelemetryAndCutsPowerAfterCrash()
    {
        AircraftAudioProfile idle = AircraftAudioModel.GetProfile();
        AircraftAudioProfile takeoff = AircraftAudioModel.GetProfile(new AircraftFlightState
        {
            Throttle = 1,
            Speed = 30,
            Grounded = false,
        });
        Assert.True(takeoff.RpmRatio > idle.RpmRatio);
        Assert.True(takeoff.EngineFrequency > idle.EngineFrequency);
        Assert.True(takeoff.BladeFrequency > idle.BladeFrequency);
        Assert.True(takeoff.EngineGain > idle.EngineGain);
        Assert.True(takeoff.AirflowGain > idle.AirflowGain);

        AircraftAudioProfile malformed = AircraftAudioModel.GetProfile(new AircraftFlightState
        {
            Throttle = double.NaN,
            Speed = double.PositiveInfinity,
        });
        Assert.All(ProfileValues(malformed), value => Assert.True(double.IsFinite(value)));

        AircraftAudioProfile crashed = AircraftAudioModel.GetProfile(new AircraftFlightState
        {
            Throttle = 1,
            Speed = 50,
            Grounded = false,
            Crashed = true,
        });
        Assert.Equal(0, crashed.RpmRatio);
        Assert.Equal(0.001, crashed.EngineGain);
        Assert.Equal(0.001, crashed.PropellerGain);
        Assert.Equal(0.001, crashed.AirflowGain);
    }

    private static AircraftFlightState Simulate(
        AircraftFlightState state,
        AircraftControls controls,
        double seconds,
        AircraftEnvironment? environment = null)
    {
        AircraftFlightState next = state;
        int frames = (int)Math.Floor(seconds * 60 + 0.5);
        for (int frame = 0; frame < frames; frame += 1)
        {
            next = AircraftFlightModel.Step(
                next,
                controls,
                1d / 60,
                environment ?? new AircraftEnvironment());
        }
        return next;
    }

    private static IReadOnlyList<double> ProfileValues(AircraftAudioProfile profile) =>
    [
        profile.RpmRatio,
        profile.EngineFrequency,
        profile.HarmonicFrequency,
        profile.BladeFrequency,
        profile.FilterFrequency,
        profile.EngineGain,
        profile.PropellerGain,
        profile.AirflowGain,
    ];
}

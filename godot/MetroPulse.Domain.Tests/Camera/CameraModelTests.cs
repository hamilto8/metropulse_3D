using MetroPulse.Domain.Camera;
using Xunit;

namespace MetroPulse.Domain.Tests.Camera;

public sealed class CameraModelTests
{
    [Fact]
    public void ProductionPresetsAdaptEveryCanonicalVectorWithoutMutableCopies()
    {
        CameraPresetModel presets = CameraPresetModel.LoadProduction();

        Assert.Equal(9, presets.Presets.Count);
        Assert.Equal(new CameraVector3(80, 320, 15), presets.Get("birdseye")!.Position);
        Assert.Equal(new CameraVector3(3.5, 0.75, -28), presets.Get("ground")!.LookAt);
        Assert.Equal(new CameraVector3(670, 52, -245), presets.Get("rocket")!.Position);
        Assert.Null(presets.Get("not-a-preset"));
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, CameraPose>)presets.Presets).Add(
                "new",
                new CameraPose(CameraVector3.Zero, CameraVector3.Forward)));
    }

    [Fact]
    public void GroundConstraintClampsAndLevelsBelowElevatedTerrain()
    {
        CameraGroundConstraintResult result = CameraGroundConstraintModel.Constrain(
            new CameraVector3(10, -4, 20),
            new CameraVector3(10, -10, -30),
            terrainHeight: 3.25);

        Assert.True(result.Constrained);
        Assert.Equal(4, result.MinimumY);
        Assert.Equal(new CameraVector3(10, 4, 20), result.Position);
        Assert.Equal(4, result.Target.Y);
        Assert.True(result.Target.DistanceTo(result.Position) >= 5);
        Assert.Equal(-30, result.Target.Z);
    }

    [Fact]
    public void GroundConstraintCanDelegateLevelingAndPreservesElevatedPoses()
    {
        CameraVector3 target = new(20, -10, -30);
        CameraGroundConstraintResult delegated = CameraGroundConstraintModel.Constrain(
            new CameraVector3(8, -3, 12),
            target,
            terrainHeight: 2.5,
            levelTarget: false);
        Assert.True(delegated.Constrained);
        Assert.Equal(3.25, delegated.Position.Y);
        Assert.Same(target, delegated.Target);

        CameraVector3 elevatedPosition = new(10, 20, 20);
        CameraGroundConstraintResult elevated = CameraGroundConstraintModel.Constrain(
            elevatedPosition,
            new CameraVector3(0, 0, 0),
            terrainHeight: 3.25);
        Assert.False(elevated.Constrained);
        Assert.Same(elevatedPosition, elevated.Position);
    }

    [Fact]
    public void VerticalGroundTargetFallsBackToStableHorizontalDirection()
    {
        CameraGroundConstraintResult result = CameraGroundConstraintModel.Constrain(
            new CameraVector3(2, 0, 4),
            new CameraVector3(2, -10, 4),
            fallbackForward: new CameraVector3(0, -1, 0));

        Assert.Equal(0.75, result.Position.Y);
        Assert.Equal(result.Position.Y, result.Target.Y);
        Assert.True(result.Target.IsFinite);
        Assert.Equal(5, result.Target.DistanceTo(result.Position), 12);
        Assert.True(result.Target.Z < result.Position.Z);
    }

    [Fact]
    public void StreetAltitudeYawPitchAndLevelLockMatchBrowserGeometry()
    {
        Assert.True(StreetCameraModel.IsStreetAltitude(7.9, 0));
        Assert.True(StreetCameraModel.IsStreetAltitude(14, 6));
        Assert.False(StreetCameraModel.IsStreetAltitude(14.01, 6));
        Assert.True(StreetCameraModel.IsStreetAltitude(15.5, 6, alreadyActive: true));
        Assert.False(StreetCameraModel.IsStreetAltitude(16.01, 6, alreadyActive: true));
        Assert.False(StreetCameraModel.IsStreetAltitude(double.NaN, 0));

        CameraVector3 turned = StreetCameraModel.RotateLookDirection(
            new CameraVector3(0, -0.6, -0.8),
            Math.PI / 2,
            1,
            lockLevel: true);
        Assert.True(turned.X > 0.999);
        Assert.True(Math.Abs(turned.Y) < 1e-12);
        Assert.True(Math.Abs(turned.Z) < 1e-12);
    }

    [Fact]
    public void StreetLevelingIsFrameRateInvariantAndPivotRestorationIsBounded()
    {
        CameraVector3 source = new CameraVector3(0.2, -0.75, -0.63).Normalize();
        CameraVector3 sixtyFps = source;
        for (int frame = 0; frame < 60; frame += 1)
        {
            sixtyFps = StreetCameraModel.LevelLookDirection(sixtyFps, 1d / 60);
        }
        CameraVector3 thirtyFps = source;
        for (int frame = 0; frame < 30; frame += 1)
        {
            thirtyFps = StreetCameraModel.LevelLookDirection(thirtyFps, 1d / 30);
        }
        Assert.True(sixtyFps.DistanceTo(thirtyFps) < 1e-12);
        Assert.True(Math.Abs(sixtyFps.Y) < 0.02);

        CameraVector3 position = new(10, 3, 20);
        CameraVector3 local = StreetCameraModel.CreateLocalPivot(position, new CameraVector3(0, 0, -1));
        Assert.Equal(StreetCameraModel.PivotDistance, local.DistanceTo(position), 12);
        CameraVector3 restored = StreetCameraModel.RestoreMacroPivot(position, local, 5);
        Assert.Equal(5, restored.DistanceTo(position), 12);
    }

    [Fact]
    public void ClearanceLiftsDesiredOriginAboveSlopedTerrain()
    {
        var query = CreateClearance(terrain: (x, z) => 2 + x * 0.25 + z * 0.1);
        CameraClearanceOptions options = new() { Radius = 0.75, TerrainClearance = 1 };
        CameraVector3 resolved = query.Resolve(new CameraVector3(4, -20, 3), options);

        Assert.Equal(new CameraVector3(4, 4.3, 3), resolved);
        Assert.True(query.Inspect(resolved, options).Clear);
    }

    [Fact]
    public void ClearanceSearchIsDeterministicAndCanIgnoreFollowEntity()
    {
        CameraObstacle[] obstacles =
        [
            new("building", new CameraVector3(0, 5, 0), new CameraVector3(8, 10, 8), "building"),
            new("tree", new CameraVector3(5, 2.5, 0), new CameraVector3(1.2, 5, 1.2), "tree-trunk"),
            new("vehicle-volume", new CameraVector3(10, 1.5, 10), new CameraVector3(4, 3, 8), "vehicle", "vehicle-1"),
        ];
        CameraClearanceQuery query = CreateClearance(obstacles);
        CameraVector3 desired = new(0, 3, 0);
        CameraVector3 first = query.Resolve(desired, new CameraClearanceOptions { Radius = 0.8 });
        CameraVector3 second = query.Resolve(desired, new CameraClearanceOptions { Radius = 0.8 });

        Assert.Equal(first, second);
        Assert.True(query.Inspect(first, new CameraClearanceOptions { Radius = 0.8 }).Clear);
        Assert.True(first.DistanceTo(desired) >= 4.8);
        CameraVector3 insideVehicle = new(10, 2, 10);
        Assert.Equal(CameraClearanceReasons.Obstacle, query.Inspect(insideVehicle).Reason);
        Assert.True(query.Inspect(insideVehicle, new CameraClearanceOptions
        {
            IgnoredIds = new HashSet<string>(["vehicle-1"], StringComparer.Ordinal),
        }).Clear);
    }

    [Fact]
    public void ClearanceSearchFollowsPreferredDirectionAndFailsClosed()
    {
        CameraClearanceQuery waterQuery = CreateClearance(
            water: position => position.X >= -1 && position.X <= 1
                && position.Z >= -20 && position.Z <= 20);
        CameraClearanceOptions options = new()
        {
            PreferredDirection = new CameraVector3(1, 0, 0),
            Radius = 0.5,
        };
        CameraVector3 resolved = waterQuery.Resolve(new CameraVector3(0, 1, 0), options);
        Assert.True(resolved.X > 1);
        Assert.True(waterQuery.Inspect(resolved, options).Clear);

        CameraClearanceQuery blocked = CreateClearance(water: _ => true);
        Assert.Throws<InvalidOperationException>(() => blocked.Resolve(
            new CameraVector3(0, 1, 0),
            new CameraClearanceOptions { MaximumSearchRadius = 3 }));
    }

    [Fact]
    public void PlanarHeadingAndIndependentChaseYawMatchPhysicsFraming()
    {
        const double heading = 0.72;
        CameraQuaternion quaternion = new(0, Math.Sin(heading / 2), 0, Math.Cos(heading / 2));
        Assert.Equal(heading, ChaseCameraModel.GetPlanarHeading(quaternion, -2), 12);

        ChaseCameraRequest request = new()
        {
            TargetPosition = CameraVector3.Zero,
            Type = CameraTargetTypes.Vehicle,
            UserControlled = true,
        };
        CameraPose rear = ChaseCameraModel.GetDesiredPose(request);
        Assert.True(rear.Position.Z < -14);
        CameraPose side = ChaseCameraModel.GetDesiredPose(request with { ChaseYaw = Math.PI / 2 });
        Assert.True(side.Position.X < -14);
        Assert.True(Math.Abs(side.Position.Z) < 1e-9);
    }

    [Fact]
    public void AircraftChaseAndFovUseWiderElevatedForwardLookingPose()
    {
        CameraPose pose = ChaseCameraModel.GetDesiredPose(new ChaseCameraRequest
        {
            TargetPosition = new CameraVector3(10, 50, -20),
            Type = CameraTargetTypes.Aircraft,
            UserControlled = true,
            Speed = 40,
        });

        Assert.True(pose.Position.Z < -47);
        Assert.True(pose.Position.Y >= 59);
        Assert.True(pose.LookAt.Z > -20);
        Assert.Equal(66.25, ChaseCameraModel.GetTargetFieldOfView(40, aircraft: true), 12);
        Assert.Equal(76, ChaseCameraModel.GetTargetFieldOfView(200, aircraft: false));
        Assert.Equal(63.75, ChaseCameraModel.SmoothFieldOfView(60, 67.5, 1d / 12), 12);
    }

    [Fact]
    public void QuinticSwoopInterpolationPreservesEndpointsAndMidpoint()
    {
        CameraPose start = new(CameraVector3.Zero, CameraVector3.Forward);
        CameraPose end = new(new CameraVector3(10, 20, 30), new CameraVector3(5, 6, 7));

        Assert.Equal(0, ChaseCameraModel.EaseQuintic(0));
        Assert.Equal(0.5, ChaseCameraModel.EaseQuintic(0.5), 12);
        Assert.Equal(1, ChaseCameraModel.EaseQuintic(1));
        Assert.Equal(start, ChaseCameraModel.InterpolatePose(start, end, 0));
        Assert.Equal(end, ChaseCameraModel.InterpolatePose(start, end, 1));
        Assert.Equal(new CameraVector3(5, 10, 15),
            ChaseCameraModel.InterpolatePose(start, end, 0.5).Position);
    }

    private static CameraClearanceQuery CreateClearance(
        IReadOnlyList<CameraObstacle>? obstacles = null,
        Func<double, double, double>? terrain = null,
        Func<CameraVector3, bool>? water = null) => new(
            terrain,
            water,
            () => obstacles ?? Array.Empty<CameraObstacle>(),
            new CameraClearanceDefaults(SearchStep: 1, SamplesPerRing: 8, MaximumSearchRadius: 12));
}

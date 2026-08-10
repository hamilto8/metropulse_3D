namespace MetroPulse.Domain.Vehicles;

public enum VehiclePhysicsBranch
{
    BuiltInVehicleBody,
    CustomRaycastRigidBody,
}

public sealed record VehiclePhysicsSpikeTelemetry(
    VehiclePhysicsBranch Branch,
    double AccelerationSpeed,
    double BrakingSpeed,
    double ReverseSpeed,
    double HeadingChangeRadians,
    double TurningRadius,
    double MaximumRollRadians,
    double AveragePhysicsMicroseconds,
    double ReplayPositionDelta,
    int GroundedWheelCount,
    bool CollisionResponse,
    bool BridgeAndCurbTraversal,
    bool SlopeTraversal,
    bool ControlTransfer,
    bool WeatherGrip,
    int SupportedMajorProfiles);

public sealed record VehiclePhysicsSpikeDecision(
    VehiclePhysicsBranch Selected,
    IReadOnlyDictionary<VehiclePhysicsBranch, double> Scores,
    IReadOnlyDictionary<VehiclePhysicsBranch, IReadOnlyList<string>> Blockers);

/// <summary>Stable, reviewable selection policy for the Phase 5 sedan physics spike.</summary>
public static class VehiclePhysicsSpikeModel
{
    public const int RequiredMajorProfiles = 6;

    public static VehiclePhysicsSpikeDecision Select(IEnumerable<VehiclePhysicsSpikeTelemetry> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        VehiclePhysicsSpikeTelemetry[] observations = candidates.ToArray();
        if (observations.Select(item => item.Branch).Distinct().Count() != observations.Length
            || observations.Length < 2)
        {
            throw new ArgumentException("The spike requires unique telemetry for both physics branches.", nameof(candidates));
        }

        var blockers = new Dictionary<VehiclePhysicsBranch, IReadOnlyList<string>>();
        var scores = new Dictionary<VehiclePhysicsBranch, double>();
        foreach (VehiclePhysicsSpikeTelemetry telemetry in observations)
        {
            ValidateFinite(telemetry);
            List<string> branchBlockers = [];
            if (!telemetry.CollisionResponse) branchBlockers.Add("collision-response");
            if (!telemetry.BridgeAndCurbTraversal) branchBlockers.Add("bridge-curb-traversal");
            if (!telemetry.SlopeTraversal) branchBlockers.Add("slope-traversal");
            if (!telemetry.ControlTransfer) branchBlockers.Add("control-transfer");
            if (!telemetry.WeatherGrip) branchBlockers.Add("weather-grip");
            if (telemetry.SupportedMajorProfiles < RequiredMajorProfiles) branchBlockers.Add("profile-coverage");
            blockers[telemetry.Branch] = branchBlockers.AsReadOnly();

            double dynamicScore = Math.Clamp(telemetry.AccelerationSpeed, 0, 20)
                + Math.Clamp(telemetry.ReverseSpeed, 0, 10)
                + Math.Clamp(Math.Abs(telemetry.HeadingChangeRadians) * 4, 0, 10)
                + Math.Clamp(20 / Math.Max(1, telemetry.TurningRadius), 0, 5)
                + Math.Clamp(telemetry.GroundedWheelCount, 0, 6)
                - Math.Clamp(telemetry.BrakingSpeed, 0, 20)
                - Math.Clamp(telemetry.MaximumRollRadians * 10, 0, 10)
                - Math.Clamp(telemetry.ReplayPositionDelta * 100, 0, 20)
                - Math.Clamp(telemetry.AveragePhysicsMicroseconds / 1000, 0, 10);
            scores[telemetry.Branch] = dynamicScore - (branchBlockers.Count * 100);
        }

        VehiclePhysicsSpikeTelemetry selected = observations
            .OrderBy(item => blockers[item.Branch].Count)
            .ThenByDescending(item => scores[item.Branch])
            .ThenBy(item => item.Branch)
            .First();
        return new VehiclePhysicsSpikeDecision(
            selected.Branch,
            new Dictionary<VehiclePhysicsBranch, double>(scores),
            blockers.ToDictionary(pair => pair.Key, pair => pair.Value));
    }

    private static void ValidateFinite(VehiclePhysicsSpikeTelemetry value)
    {
        double[] fields =
        [
            value.AccelerationSpeed,
            value.BrakingSpeed,
            value.ReverseSpeed,
            value.HeadingChangeRadians,
            value.TurningRadius,
            value.MaximumRollRadians,
            value.AveragePhysicsMicroseconds,
            value.ReplayPositionDelta,
        ];
        if (fields.Any(field => !double.IsFinite(field) || field < 0))
        {
            throw new ArgumentException($"{value.Branch} telemetry must be finite and non-negative.", nameof(value));
        }
    }
}

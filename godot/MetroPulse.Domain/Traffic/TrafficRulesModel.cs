using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;

namespace MetroPulse.Domain.Traffic;

public static class TrafficSignalStates
{
    public const string Red = "RED";
    public const string Yellow = "YELLOW";
    public const string Green = "GREEN";
}

public static class TrafficControlTypes
{
    public const string Stop = "STOP";
    public const string Signal = "SIGNAL";
}

public sealed record TrafficRulesConfig
{
    public double CompliantShare { get; init; } = 0.8;

    public double SignalGreenDuration { get; init; } = 9;

    public double SignalYellowDuration { get; init; } = 2;

    public double SignalAllRedDuration { get; init; } = 1;

    public double StopSignWaitDuration { get; init; } = 1.1;

    public double MinimumDetectionDistance { get; init; } = 18;

    public double MaximumDetectionDistance { get; init; } = 34;

    public double ReactionTime { get; init; } = 0.3;

    public double StoppingClearance { get; init; } = 4;
}

public sealed record DriverRuleProfile(bool Compliant, string Style);

public sealed record TrafficControl(
    string Id,
    string Type,
    double X,
    double Z,
    string District,
    double PhaseOffset);

public sealed record TrafficApproach(string Direction, string Axis, double X, double Z);

public sealed record TrafficStoppingKinematics(
    double Speed,
    double Deceleration,
    double StoppingDistance,
    double DetectionDistance);

/// <summary>Pure signal timing, authored-control planning, and stopping-distance rules.</summary>
public static partial class TrafficRulesModel
{
    public static readonly TrafficRulesConfig DefaultConfig = new();

    public static double GetSignalCycleDuration(TrafficRulesConfig? config = null)
    {
        config ??= DefaultConfig;
        return 2 * (config.SignalGreenDuration + config.SignalYellowDuration + config.SignalAllRedDuration);
    }

    public static string GetSignalState(
        double elapsed,
        string axis,
        double offset = 0,
        TrafficRulesConfig? config = null)
    {
        config ??= DefaultConfig;
        double cycle = GetSignalCycleDuration(config);
        double safeElapsed = double.IsFinite(elapsed) ? elapsed : 0;
        double safeOffset = double.IsFinite(offset) ? offset : 0;
        double time = ((safeElapsed + safeOffset) % cycle + cycle) % cycle;
        double northSouthYellowStart = config.SignalGreenDuration;
        double firstAllRedStart = northSouthYellowStart + config.SignalYellowDuration;
        double eastWestGreenStart = firstAllRedStart + config.SignalAllRedDuration;
        double eastWestYellowStart = eastWestGreenStart + config.SignalGreenDuration;
        double secondAllRedStart = eastWestYellowStart + config.SignalYellowDuration;

        if (axis == "NS")
        {
            if (time < northSouthYellowStart) return TrafficSignalStates.Green;
            if (time < firstAllRedStart) return TrafficSignalStates.Yellow;
            return TrafficSignalStates.Red;
        }
        if (time >= eastWestGreenStart && time < eastWestYellowStart) return TrafficSignalStates.Green;
        if (time >= eastWestYellowStart && time < secondAllRedStart) return TrafficSignalStates.Yellow;
        return TrafficSignalStates.Red;
    }

    public static DriverRuleProfile CreateDriverProfile(double serial)
    {
        double numeric = double.IsFinite(serial) ? serial : 1;
        long safeSerial = (long)Math.Abs(Math.Floor(numeric));
        bool compliant = safeSerial % 5 != 0;
        return new DriverRuleProfile(compliant, compliant ? "RULE_FOLLOWER" : "RECKLESS");
    }

    public static IReadOnlyList<TrafficControl> CreateControlPlan(
        IReadOnlyList<double> coordinatesX,
        IReadOnlyList<double> coordinatesZ)
    {
        ArgumentNullException.ThrowIfNull(coordinatesX);
        ArgumentNullException.ThrowIfNull(coordinatesZ);
        var controls = new List<TrafficControl>(coordinatesX.Count * coordinatesZ.Count);
        double cycle = GetSignalCycleDuration();
        for (int xi = 0; xi < coordinatesX.Count; xi += 1)
        {
            double x = coordinatesX[xi];
            for (int zi = 0; zi < coordinatesZ.Count; zi += 1)
            {
                double z = coordinatesZ[zi];
                bool countryside = x >= 420;
                string type = countryside && z != 0 ? TrafficControlTypes.Stop : TrafficControlTypes.Signal;
                controls.Add(new TrafficControl(
                    $"{type}:{FormatCoordinate(x)},{FormatCoordinate(z)}",
                    type,
                    x,
                    z,
                    countryside ? "COUNTRYSIDE" : "URBAN",
                    type == TrafficControlTypes.Signal ? ((xi + zi) % 2) * (cycle / 2) : 0));
            }
        }
        return new ReadOnlyCollection<TrafficControl>(controls);
    }

    public static TrafficApproach? ParseApproach(string? nodeId)
    {
        Match match = ApproachPattern().Match(nodeId ?? string.Empty);
        if (!match.Success) return null;
        string direction = match.Groups[1].Value;
        return new TrafficApproach(
            direction,
            direction is "EB" or "WB" ? "EW" : "NS",
            double.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
            double.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture));
    }

    public static TrafficStoppingKinematics GetStoppingKinematics(
        double speed,
        double acceleration,
        TrafficRulesConfig? config = null)
    {
        config ??= DefaultConfig;
        double safeSpeed = double.IsFinite(speed) ? Math.Abs(speed) : 0;
        double safeAcceleration = double.IsFinite(acceleration) ? Math.Max(0, acceleration) : 0;
        double deceleration = Math.Max(18, safeAcceleration * 2.5);
        double stoppingDistance = safeSpeed * safeSpeed / (2 * deceleration);
        double detectionDistance = Math.Max(
            config.MinimumDetectionDistance,
            Math.Min(
                config.MaximumDetectionDistance,
                stoppingDistance + safeSpeed * config.ReactionTime + config.StoppingClearance));
        return new TrafficStoppingKinematics(safeSpeed, deceleration, stoppingDistance, detectionDistance);
    }

    private static string FormatCoordinate(double value) => value.ToString("0.################", CultureInfo.InvariantCulture);

    [GeneratedRegex("^(EB|WB|SB|NB)_IN:(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)$", RegexOptions.CultureInvariant)]
    private static partial Regex ApproachPattern();
}

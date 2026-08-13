namespace MetroPulse.Domain.Rocket;

public static class RocketLaunchPolicy
{
    public const double CountdownSeconds = 300;
    public const double InitialAltitude = 1.5;
    public const double Acceleration = 45;
}

public enum RocketLaunchPhase
{
    Countdown,
    Launched,
}

public sealed record RocketLaunchSnapshot(
    RocketLaunchPhase Phase,
    double Countdown,
    double Altitude,
    double VelocityY,
    int LaunchCount,
    int ResetCount);

/// <summary>Pure countdown and vertical launch authority.</summary>
public sealed class RocketLaunchModel
{
    public RocketLaunchPhase Phase { get; private set; } = RocketLaunchPhase.Countdown;

    public double Countdown { get; private set; } = RocketLaunchPolicy.CountdownSeconds;

    public double Altitude { get; private set; } = RocketLaunchPolicy.InitialAltitude;

    public double VelocityY { get; private set; }

    public int LaunchCount { get; private set; }

    public int ResetCount { get; private set; }

    public bool Launched => Phase == RocketLaunchPhase.Launched;

    public bool LaunchNow()
    {
        if (Launched) return false;
        Phase = RocketLaunchPhase.Launched;
        Countdown = 0;
        LaunchCount++;
        return true;
    }

    public RocketLaunchSnapshot Advance(double deltaSeconds)
    {
        if (!double.IsFinite(deltaSeconds) || deltaSeconds < 0) throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
        if (deltaSeconds == 0) return Snapshot();
        if (!Launched)
        {
            Countdown = Math.Max(0, Countdown - deltaSeconds);
            if (Countdown == 0) LaunchNow();
        }
        else
        {
            VelocityY += RocketLaunchPolicy.Acceleration * deltaSeconds;
            Altitude += VelocityY * deltaSeconds;
        }
        return Snapshot();
    }

    public RocketLaunchSnapshot Reset()
    {
        Phase = RocketLaunchPhase.Countdown;
        Countdown = RocketLaunchPolicy.CountdownSeconds;
        Altitude = RocketLaunchPolicy.InitialAltitude;
        VelocityY = 0;
        ResetCount++;
        return Snapshot();
    }

    public RocketLaunchSnapshot Snapshot() => new(Phase, Countdown, Altitude, VelocityY, LaunchCount, ResetCount);
}

using MetroPulse.Domain.Rocket;
using Xunit;

namespace MetroPulse.Domain.Tests.Rocket;

public sealed class RocketLaunchModelTests
{
    [Fact]
    public void CountdownAutoLaunchesAndUsesSourceAcceleration()
    {
        var model = new RocketLaunchModel();

        model.Advance(299);
        Assert.Equal(1, model.Countdown);
        Assert.False(model.Launched);
        model.Advance(1);
        Assert.True(model.Launched);
        Assert.Equal(1, model.LaunchCount);

        RocketLaunchSnapshot launched = model.Advance(1);
        Assert.Equal(45, launched.VelocityY);
        Assert.Equal(46.5, launched.Altitude);
    }

    [Fact]
    public void ImmediateLaunchIsIdempotentAndResetRestoresPadState()
    {
        var model = new RocketLaunchModel();

        Assert.True(model.LaunchNow());
        Assert.False(model.LaunchNow());
        model.Advance(2);
        RocketLaunchSnapshot reset = model.Reset();

        Assert.Equal(RocketLaunchPhase.Countdown, reset.Phase);
        Assert.Equal(300, reset.Countdown);
        Assert.Equal(1.5, reset.Altitude);
        Assert.Equal(0, reset.VelocityY);
        Assert.Equal(1, reset.LaunchCount);
        Assert.Equal(1, reset.ResetCount);
    }

    [Fact]
    public void InvalidDeltaFailsClosedWithoutMutation()
    {
        var model = new RocketLaunchModel();
        RocketLaunchSnapshot baseline = model.Snapshot();

        Assert.Throws<ArgumentOutOfRangeException>(() => model.Advance(-1));
        Assert.Throws<ArgumentOutOfRangeException>(() => model.Advance(double.NaN));
        Assert.Equal(baseline, model.Snapshot());
    }
}

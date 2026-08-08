namespace MetroPulse.Domain.Aircraft;

public static class AircraftModes
{
    public const string Parked = "PARKED";
    public const string Taxi = "TAXI";
    public const string Takeoff = "TAKEOFF";
    public const string Airborne = "AIRBORNE";
    public const string Landing = "LANDING";
    public const string Crashed = "CRASHED";
}

public sealed record AircraftVector3(double X, double Y, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Y) && double.IsFinite(Z);
}

public sealed record AircraftFlightConfig
{
    public double GearHeight { get; init; } = 1.15;
    public double MaximumSpeed { get; init; } = 64;
    public double TakeoffSpeed { get; init; } = 24;
    public double StallSpeed { get; init; } = 18;
    public double MaximumLandingSpeed { get; init; } = 35;
    public double MaximumAltitude { get; init; } = 280;
    public double MaximumPitch { get; init; } = Math.PI * 0.16;
    public double MaximumRoll { get; init; } = Math.PI * 0.27;
    public double ThrottleRate { get; init; } = 0.52;
    public double GroundTurnRate { get; init; } = 0.62;
    public double BankTurnRate { get; init; } = 0.78;
    public double SafeVerticalSpeed { get; init; } = -8;
    public double SafeLandingRoll { get; init; } = Math.PI * 0.16;
}

public sealed record AircraftFlightState
{
    public AircraftVector3? Position { get; init; }
    public double Heading { get; init; }
    public double Pitch { get; init; }
    public double Roll { get; init; }
    public double Speed { get; init; }
    public double VerticalSpeed { get; init; }
    public double Throttle { get; init; }
    public bool Grounded { get; init; } = true;
    public string? LandingSurface { get; init; }
    public string? Mode { get; init; }
    public bool StallWarning { get; init; }
    public bool Crashed { get; init; }
}

public sealed record AircraftControls
{
    public double Roll { get; init; }
    public double Pitch { get; init; }
    public double ThrottleUp { get; init; }
    public double ThrottleDown { get; init; }
    public double Brake { get; init; }
}

public sealed record AircraftEnvironment
{
    public double GroundHeight { get; init; }
    public bool InWater { get; init; }
    public bool? CanLand { get; init; }
    public string? LandingSurface { get; init; }
}

/// <summary>Deterministic renderer-independent arcade flight authority.</summary>
public static class AircraftFlightModel
{
    public static readonly AircraftFlightConfig DefaultConfig = new();

    public static AircraftFlightState CreateState(AircraftFlightState? source = null)
    {
        source ??= new AircraftFlightState();
        AircraftVector3? position = source.Position;
        bool grounded = source.Grounded;
        return new AircraftFlightState
        {
            Position = new AircraftVector3(
                FiniteOrZero(position?.X),
                FiniteOrFallback(position?.Y, DefaultConfig.GearHeight),
                FiniteOrZero(position?.Z)),
            Heading = NormalizeHeading(source.Heading),
            Pitch = FiniteOrZero(source.Pitch),
            Roll = FiniteOrZero(source.Roll),
            Speed = Math.Max(0, FiniteOrZero(source.Speed)),
            VerticalSpeed = FiniteOrZero(source.VerticalSpeed),
            Throttle = Math.Clamp(FiniteOrZero(source.Throttle), 0, 1),
            Grounded = grounded,
            LandingSurface = source.LandingSurface,
            Mode = string.IsNullOrEmpty(source.Mode)
                ? grounded ? AircraftModes.Parked : AircraftModes.Airborne
                : source.Mode,
            StallWarning = source.StallWarning,
            Crashed = source.Crashed,
        };
    }

    public static AircraftControls SanitizeControls(AircraftControls? controls = null)
    {
        controls ??= new AircraftControls();
        return new AircraftControls
        {
            Roll = Math.Clamp(FiniteOrZero(controls.Roll), -1, 1),
            Pitch = Math.Clamp(FiniteOrZero(controls.Pitch), -1, 1),
            ThrottleUp = Math.Clamp(FiniteOrZero(controls.ThrottleUp), 0, 1),
            ThrottleDown = Math.Clamp(FiniteOrZero(controls.ThrottleDown), 0, 1),
            Brake = Math.Clamp(FiniteOrZero(controls.Brake), 0, 1),
        };
    }

    public static AircraftFlightState Step(
        AircraftFlightState? currentState,
        AircraftControls? rawControls,
        double rawDelta,
        AircraftEnvironment? environment = null,
        AircraftFlightConfig? config = null)
    {
        AircraftFlightState state = CreateState(currentState);
        AircraftControls controls = SanitizeControls(rawControls);
        environment ??= new AircraftEnvironment();
        config ??= DefaultConfig;
        double delta = Math.Clamp(FiniteOrZero(rawDelta), 0, 0.1);
        double groundHeight = FiniteOrZero(environment.GroundHeight);
        double gearY = groundHeight + config.GearHeight;
        AircraftVector3 position = state.Position!;

        if (state.Crashed || state.Mode == AircraftModes.Crashed)
        {
            return state with
            {
                Crashed = true,
                Mode = AircraftModes.Crashed,
                Speed = 0,
                VerticalSpeed = 0,
            };
        }

        double throttle = Math.Clamp(
            state.Throttle
                + (controls.ThrottleUp - controls.ThrottleDown) * config.ThrottleRate * delta,
            0,
            1);
        double brakeDeceleration = controls.Brake * (state.Grounded ? 28 : 8);
        double baseDrag = state.Grounded ? 2.2 + state.Speed * 0.055 : 1.15 + state.Speed * 0.038;
        double thrust = throttle * (state.Grounded ? 19.5 : 16.5);
        double climbPenalty = state.Grounded ? 0 : Math.Max(0, state.VerticalSpeed) * 0.2;
        double speed = Math.Clamp(
            state.Speed + (thrust - baseDrag - brakeDeceleration - climbPenalty) * delta,
            0,
            config.MaximumSpeed);
        double heading = state.Heading;
        double pitch = state.Pitch;
        double roll = state.Roll;
        double verticalSpeed = state.VerticalSpeed;
        bool grounded = state.Grounded;
        string mode = state.Mode!;
        bool stallWarning = state.StallWarning;
        string? landingSurface = state.LandingSurface;

        if (grounded)
        {
            double taxiAuthority = Math.Clamp(speed / 14, 0, 1);
            heading = NormalizeHeading(
                heading + controls.Roll * config.GroundTurnRate * taxiAuthority * delta);
            roll = Approach(roll, controls.Roll * 0.08, 7, delta);

            bool takeoffReady = speed >= config.TakeoffSpeed && throttle >= 0.72;
            double takeoffBias = takeoffReady ? 0.14 : 0;
            double targetPitch = Math.Clamp(
                controls.Pitch * config.MaximumPitch + takeoffBias,
                -config.MaximumPitch,
                config.MaximumPitch);
            pitch = Approach(pitch, targetPitch, takeoffReady ? 2.8 : 5, delta);

            if (takeoffReady && pitch > 0.055)
            {
                mode = AircraftModes.Takeoff;
                verticalSpeed = Math.Max(1.2, Math.Sin(pitch) * speed * 0.75);
                position = position with
                {
                    Y = Math.Max(gearY, position.Y + verticalSpeed * delta),
                };
                if (position.Y >= gearY + 1.8)
                {
                    grounded = false;
                    mode = AircraftModes.Airborne;
                }
            }
            else
            {
                mode = speed > 0.6 ? AircraftModes.Taxi : AircraftModes.Parked;
                position = position with { Y = gearY };
                verticalSpeed = 0;
            }
        }
        else
        {
            double targetRoll = controls.Roll * config.MaximumRoll;
            double takeoffAssist = mode == AircraftModes.Takeoff ? 0.12 : 0;
            double targetPitch = Math.Clamp(
                controls.Pitch * config.MaximumPitch + takeoffAssist,
                -config.MaximumPitch,
                config.MaximumPitch);
            roll = Approach(roll, targetRoll, 2.9, delta);
            pitch = Approach(pitch, targetPitch, 2.35, delta);

            double speedAuthority = Math.Clamp(
                speed / Math.Max(1, config.TakeoffSpeed),
                0.35,
                1.35);
            heading = NormalizeHeading(
                heading + Math.Sin(roll) * config.BankTurnRate * speedAuthority * delta);

            double stallDeficit = Math.Max(0, config.StallSpeed - speed);
            double targetVerticalSpeed = Math.Sin(pitch) * speed * 0.78
                - stallDeficit * 0.72
                - Math.Abs(Math.Sin(roll)) * 1.1;
            verticalSpeed = Approach(verticalSpeed, targetVerticalSpeed, 2.2, delta);
            position = position with { Y = position.Y + verticalSpeed * delta };
            stallWarning = speed < config.StallSpeed + 2;
            mode = verticalSpeed < -1.2 && position.Y < gearY + 25
                ? AircraftModes.Landing
                : AircraftModes.Airborne;

            if (position.Y > groundHeight + config.MaximumAltitude)
            {
                position = position with { Y = groundHeight + config.MaximumAltitude };
                verticalSpeed = Math.Min(0, verticalSpeed);
                pitch = Math.Min(0, pitch);
            }

            if (position.Y <= gearY)
            {
                bool safeLanding = !environment.InWater
                    && environment.CanLand is not false
                    && speed <= config.MaximumLandingSpeed
                    && verticalSpeed >= config.SafeVerticalSpeed
                    && Math.Abs(roll) <= config.SafeLandingRoll;
                if (!safeLanding)
                {
                    return state with
                    {
                        Position = position with { Y = gearY },
                        Heading = heading,
                        Pitch = pitch,
                        Roll = roll,
                        Throttle = throttle,
                        Crashed = true,
                        Mode = AircraftModes.Crashed,
                        Speed = 0,
                        VerticalSpeed = 0,
                        StallWarning = stallWarning,
                    };
                }
                position = position with { Y = gearY };
                verticalSpeed = 0;
                grounded = true;
                landingSurface = environment.LandingSurface ?? landingSurface;
                pitch = Approach(pitch, 0, 7, delta);
                roll = Approach(roll, 0, 7, delta);
                mode = speed > 0.6 ? AircraftModes.Taxi : AircraftModes.Parked;
                stallWarning = false;
            }
        }

        double horizontalSpeed = speed * Math.Max(0.25, Math.Cos(pitch));
        position = position with
        {
            X = position.X + Math.Sin(heading) * horizontalSpeed * delta,
            Z = position.Z + Math.Cos(heading) * horizontalSpeed * delta,
        };
        return new AircraftFlightState
        {
            Position = position,
            Heading = heading,
            Pitch = pitch,
            Roll = roll,
            Speed = speed,
            VerticalSpeed = verticalSpeed,
            Throttle = throttle,
            Grounded = grounded,
            LandingSurface = landingSurface,
            Mode = mode,
            StallWarning = stallWarning,
            Crashed = false,
        };
    }

    public static double GetPropellerRotationRate(
        AircraftFlightState? state,
        bool userControlled = false)
    {
        AircraftFlightState normalized = CreateState(state);
        bool engineRunning = userControlled || normalized.Throttle > 0.02 || normalized.Speed > 1;
        return engineRunning ? 6 + normalized.Throttle * 34 + normalized.Speed * 0.18 : 0;
    }

    public static double AdvancePropellerRotation(
        double rotation,
        AircraftFlightState? state,
        double delta,
        bool userControlled = false)
    {
        double safeRotation = FiniteOrZero(rotation);
        double safeDelta = Math.Max(0, FiniteOrZero(delta));
        return NormalizeHeading(
            safeRotation + GetPropellerRotationRate(state, userControlled) * safeDelta);
    }

    private static double Approach(double current, double target, double rate, double delta) =>
        current + (target - current) * Math.Min(1, Math.Max(0, rate * delta));

    private static double NormalizeHeading(double value)
    {
        const double turn = Math.PI * 2;
        double safe = FiniteOrZero(value);
        return ((safe % turn) + turn) % turn;
    }

    private static double FiniteOrZero(double? value) =>
        value is { } number && double.IsFinite(number) ? number : 0;

    private static double FiniteOrFallback(double? value, double fallback) =>
        value is { } number && double.IsFinite(number) ? number : fallback;
}

using Godot;
using MetroPulse.Domain.Vehicles;

namespace MetroPulse.Godot.Vehicles;

public sealed record VehiclePrototypeControl(
    double Throttle,
    double Brake,
    double Steering,
    double GripMultiplier = 1);

public interface IVehiclePhysicsPrototype
{
    VehiclePhysicsBranch Branch { get; }

    Vector3 VehicleVelocity { get; }

    int GroundedWheelCount { get; }

    double AveragePhysicsMicroseconds { get; }

    void ApplyControl(VehiclePrototypeControl control);

    double CapturePlanarHeading();
}

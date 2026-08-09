namespace MetroPulse.Domain.Boot;

public static class DesktopCapabilityIds
{
    public const string UserData = "user-data";
    public const string GraphicsBackend = "graphics-backend";
    public const string InputService = "input-service";
    public const string ProjectResources = "project-resources";
}

public sealed record DesktopCapabilityResult(
    string Id,
    bool Available,
    string Detail,
    string? Guidance = null);

public sealed class DesktopCapabilityReport
{
    public DesktopCapabilityReport(IEnumerable<DesktopCapabilityResult> checks)
    {
        ArgumentNullException.ThrowIfNull(checks);
        DesktopCapabilityResult[] values = checks.ToArray();
        if (values.Length == 0)
        {
            throw new ArgumentException("A desktop capability report requires at least one check.", nameof(checks));
        }

        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (DesktopCapabilityResult check in values)
        {
            ArgumentNullException.ThrowIfNull(check);
            if (string.IsNullOrWhiteSpace(check.Id) || !ids.Add(check.Id))
            {
                throw new ArgumentException($"Capability ID is missing or duplicated: {check.Id ?? "<missing>"}.", nameof(checks));
            }
        }

        Checks = Array.AsReadOnly(values);
        Failures = Array.AsReadOnly(values.Where(check => !check.Available).ToArray());
    }

    public IReadOnlyList<DesktopCapabilityResult> Checks { get; }

    public IReadOnlyList<DesktopCapabilityResult> Failures { get; }

    public bool Compatible => Failures.Count == 0;

    public void AssertCompatible(string stageId, string stageLabel)
    {
        if (Compatible)
        {
            return;
        }

        throw new BootStageException(
            stageId,
            stageLabel,
            "INCOMPATIBLE_DESKTOP",
            "MetroPulse cannot safely start because a required desktop capability is unavailable.",
            Failures.Select(failure => failure.Guidance).OfType<string>());
    }
}

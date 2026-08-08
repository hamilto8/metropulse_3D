namespace MetroPulse.Domain.Alerts;

public static class AlertTypes
{
    public const string System = "SYSTEM";
    public const string Mission = "MISSION";
    public const string Crime = "CRIME";
    public const string Traffic = "TRAFFIC";
    public const string Economy = "ECONOMY";
    public const string Infrastructure = "INFRASTRUCTURE";
    public const string Construction = "CONSTRUCTION";
    public const string Weather = "WEATHER";
    public const string Control = "CONTROL";
}

public static class AlertSeverities
{
    public const string Info = "INFO";
    public const string Success = "SUCCESS";
    public const string Warning = "WARNING";
    public const string Critical = "CRITICAL";
}

public static class AlertStates
{
    public const string Active = "ACTIVE";
    public const string Resolved = "RESOLVED";
    public const string Superseded = "SUPERSEDED";
}

public static class AlertDurationKinds
{
    public const string Timed = "TIMED";
    public const string UntilResolved = "UNTIL_RESOLVED";
    public const string Persistent = "PERSISTENT";
}

public static class AlertFocusActions
{
    public const string None = "NONE";
    public const string ManagementCamera = "MANAGEMENT_CAMERA";
    public const string StreetWaypoint = "STREET_WAYPOINT";
}

public sealed record AlertPosition
{
    public AlertPosition()
    {
    }

    public AlertPosition(double x, double y, double z)
    {
        X = x;
        Y = y;
        Z = z;
    }

    public AlertPosition(double x, double z)
        : this(x, 0, z)
    {
    }

    public double X { get; init; }

    public double Y { get; init; }

    public double Z { get; init; }
}

public sealed record AlertLocation
{
    public string Label { get; init; } = "Citywide";

    public string? DistrictId { get; init; }

    public AlertPosition? Position { get; init; }

    public static AlertLocation Named(string label) => new() { Label = label };
}

public sealed record AlertDuration
{
    public string Kind { get; init; } = AlertDurationKinds.UntilResolved;

    public double? Seconds { get; init; }
}

public sealed record AlertFocusAction
{
    public string Type { get; init; } = AlertFocusActions.None;

    public string? Label { get; init; }

    public AlertPosition? Position { get; init; }
}

public sealed record AlertInput
{
    public int? Version { get; init; }

    public string? Id { get; init; }

    public string? DedupeKey { get; init; }

    public string? Type { get; init; }

    public string? Severity { get; init; }

    public string? Title { get; init; }

    public string? Cause { get; init; }

    public AlertLocation? Location { get; init; }

    public string? StartTime { get; init; }

    public string? LastObservedAt { get; init; }

    public AlertDuration? Duration { get; init; }

    public string? State { get; init; }

    public string? Recommendation { get; init; }

    public IReadOnlyList<string>? RelatedEntityIds { get; init; }

    public AlertFocusAction? FocusAction { get; init; }

    public int? Occurrences { get; init; }

    public string? ResolvedAt { get; init; }

    public string? ResolutionReason { get; init; }

    public string? SupersededBy { get; init; }

    public IReadOnlyList<string>? Supersedes { get; init; }
}

public sealed record AlertRecord
{
    public int Version { get; init; } = 1;

    public required string Id { get; init; }

    public required string DedupeKey { get; init; }

    public required string Type { get; init; }

    public required string Severity { get; init; }

    public required string Title { get; init; }

    public required string Cause { get; init; }

    public required AlertLocation Location { get; init; }

    public required string StartTime { get; init; }

    public required string LastObservedAt { get; init; }

    public required AlertDuration Duration { get; init; }

    public required string State { get; init; }

    public required string Recommendation { get; init; }

    public required IReadOnlyList<string> RelatedEntityIds { get; init; }

    public required AlertFocusAction FocusAction { get; init; }

    public required int Occurrences { get; init; }

    public required string? ResolvedAt { get; init; }

    public required string? ResolutionReason { get; init; }

    public required string? SupersededBy { get; init; }
}

public sealed record AlertSnapshot
{
    public int Version { get; init; } = 2;

    public required long Revision { get; init; }

    public required IReadOnlyList<AlertRecord> Items { get; init; }

    public required IReadOnlyList<AlertRecord> Active { get; init; }
}

public sealed record AlertStateDocument
{
    public int Version { get; init; } = 2;

    public required long Sequence { get; init; }

    public required IReadOnlyList<AlertRecord> Items { get; init; }
}

public sealed record LegacyAlertItem(string Time, string Message, string Type);

public sealed record AlertEvent
{
    public required string Type { get; init; }

    public AlertRecord? Alert { get; init; }

    public IReadOnlyList<AlertRecord>? Alerts { get; init; }

    public required AlertSnapshot Current { get; init; }
}

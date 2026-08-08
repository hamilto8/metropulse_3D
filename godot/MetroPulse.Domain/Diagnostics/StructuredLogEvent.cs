namespace MetroPulse.Domain.Diagnostics;

public enum LogCategory
{
    Application,
    Boot,
    Session,
    Diagnostics,
    Test,
}

public enum LogSeverity
{
    Debug,
    Information,
    Warning,
    Error,
    Fatal,
}

public sealed record StructuredLogEvent(
    LogCategory Category,
    LogSeverity Severity,
    string EventId,
    string Message,
    IReadOnlyDictionary<string, string>? Context = null);

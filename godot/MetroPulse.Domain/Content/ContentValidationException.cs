namespace MetroPulse.Domain.Content;

public sealed class ContentValidationException : Exception
{
    public ContentValidationException(
        string message,
        string source,
        object? recordId = null,
        string? field = null,
        string code = "INVALID_GAME_DATA")
        : base($"{BuildPath(source, recordId, field)}: {message}")
    {
        Code = code;
        Source = source;
        RecordId = recordId;
        Field = field;
        Path = BuildPath(source, recordId, field);
        UserMessage = $"MetroPulse found invalid authored data in {Path}. {message}";
        Actions = Array.AsReadOnly([
            "Correct the identified source record and field, then reload MetroPulse.",
        ]);
    }

    public string Code { get; }

    public new string Source { get; }

    public object? RecordId { get; }

    public string? Field { get; }

    public string Path { get; }

    public string UserMessage { get; }

    public IReadOnlyList<string> Actions { get; }

    private static string BuildPath(string source, object? recordId, string? field)
    {
        string record = recordId is null ? string.Empty : $"[{recordId}]";
        string suffix = field is null ? string.Empty : $".{field}";
        return $"{source}{record}{suffix}";
    }
}

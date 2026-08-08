using System.Text.Json;
using Godot;
using MetroPulse.Domain.Diagnostics;

namespace MetroPulse.Godot.Diagnostics;

public static class AppLog
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static void Write(StructuredLogEvent logEvent)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        string json = JsonSerializer.Serialize(logEvent, SerializerOptions);

        if (logEvent.Severity is LogSeverity.Error or LogSeverity.Fatal)
        {
            GD.PushError(json);
            return;
        }

        if (logEvent.Severity is LogSeverity.Warning)
        {
            GD.PushWarning(json);
            return;
        }

        GD.Print(json);
    }
}

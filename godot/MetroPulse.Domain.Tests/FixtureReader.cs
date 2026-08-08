using System.Reflection;

namespace MetroPulse.Domain.Tests;

internal static class FixtureReader
{
    public static string Read(string name)
    {
        Assembly assembly = typeof(FixtureReader).Assembly;
        string resourceName = $"MetroPulse.Domain.Tests.Fixtures.{name}";
        using Stream stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Missing embedded fixture: {resourceName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}

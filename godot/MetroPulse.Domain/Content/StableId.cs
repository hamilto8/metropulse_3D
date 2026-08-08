using System.Text.RegularExpressions;

namespace MetroPulse.Domain.Content;

public static partial class StableId
{
    [GeneratedRegex("^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();

    public static bool IsValid(string? value) => value is not null && Pattern().IsMatch(value);
}

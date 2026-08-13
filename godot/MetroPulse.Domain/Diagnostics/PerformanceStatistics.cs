namespace MetroPulse.Domain.Diagnostics;

public sealed record PerformanceSeriesSummary(
    int Samples,
    double Minimum,
    double Average,
    double P95,
    double P99,
    double Maximum);

public static class PerformanceStatistics
{
    public static PerformanceSeriesSummary Summarize(IEnumerable<double> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        double[] ordered = values
            .Where(double.IsFinite)
            .OrderBy(value => value)
            .ToArray();
        if (ordered.Length == 0)
        {
            return new(0, 0, 0, 0, 0, 0);
        }

        return new(
            ordered.Length,
            ordered[0],
            ordered.Average(),
            Percentile(ordered, 0.95),
            Percentile(ordered, 0.99),
            ordered[^1]);
    }

    private static double Percentile(IReadOnlyList<double> ordered, double percentile)
    {
        if (ordered.Count == 1) return ordered[0];
        double index = Math.Clamp(percentile, 0, 1) * (ordered.Count - 1);
        int lower = (int)Math.Floor(index);
        int upper = (int)Math.Ceiling(index);
        if (lower == upper) return ordered[lower];
        double fraction = index - lower;
        return ordered[lower] + ((ordered[upper] - ordered[lower]) * fraction);
    }
}

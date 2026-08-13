using MetroPulse.Domain.Diagnostics;
using Xunit;

namespace MetroPulse.Domain.Tests.Diagnostics;

public sealed class PerformanceStatisticsTests
{
    [Fact]
    public void Summarize_ReportsInterpolatedTailAndIgnoresNonFiniteSamples()
    {
        PerformanceSeriesSummary summary = PerformanceStatistics.Summarize(
            Enumerable.Range(1, 100).Select(value => (double)value).Append(double.NaN));

        Assert.Equal(100, summary.Samples);
        Assert.Equal(1, summary.Minimum);
        Assert.Equal(50.5, summary.Average);
        Assert.Equal(95.05, summary.P95, 6);
        Assert.Equal(99.01, summary.P99, 6);
        Assert.Equal(100, summary.Maximum);
    }

    [Fact]
    public void Summarize_EmptyInputProducesExplicitZeroSampleSummary()
    {
        Assert.Equal(new PerformanceSeriesSummary(0, 0, 0, 0, 0, 0), PerformanceStatistics.Summarize([]));
    }
}

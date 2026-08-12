using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class UiFoundationTests
{
    [Theory]
    [InlineData(1024, 576, 1.0, DesktopUiBreakpoint.Compact)]
    [InlineData(1280, 720, 1.0, DesktopUiBreakpoint.Standard)]
    [InlineData(1920, 1080, 1.0, DesktopUiBreakpoint.Wide)]
    [InlineData(2560, 1080, 1.5, DesktopUiBreakpoint.Standard)]
    [InlineData(1920, 1200, 1.5, DesktopUiBreakpoint.Standard)]
    public void SupportedDesktopLayoutsRemainBoundedAtEveryBreakpoint(
        int width,
        int height,
        double textScale,
        DesktopUiBreakpoint expected)
    {
        UiLayoutSnapshot layout = UiLayoutModel.Resolve(new UiLayoutRequest(width, height, textScale));

        Assert.Equal(expected, layout.Breakpoint);
        Assert.InRange(layout.ModalMaximumWidth, 1, width - (layout.HorizontalMargin * 2));
        Assert.InRange(layout.ToolPanelWidth, 240, width / 2);
        Assert.InRange(layout.MinimapSize, 160, (int)(height * 0.38));
        Assert.True(layout.TopBarHeight + (layout.VerticalMargin * 2) < height);
    }

    [Fact]
    public void FullTextScaleRangeSwitchesDenseLayoutsBeforeControlsClip()
    {
        UiLayoutSnapshot smallest = UiLayoutModel.Resolve(new UiLayoutRequest(1280, 720, 0.8));
        UiLayoutSnapshot largest = UiLayoutModel.Resolve(new UiLayoutRequest(1280, 720, 1.5));

        Assert.Equal(DesktopUiBreakpoint.Standard, smallest.Breakpoint);
        Assert.Equal(DesktopUiBreakpoint.Compact, largest.Breakpoint);
        Assert.True(largest.StackTopStats);
        Assert.True(largest.UseTwoRowControlRibbon);
        Assert.True(largest.ModalMaximumWidth <= 1280 - (largest.HorizontalMargin * 2));
    }

    [Fact]
    public void UnsupportedViewportAndScaleInputsFailBeforeLayout()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => UiLayoutModel.Resolve(new UiLayoutRequest(800, 720, 1)));
        Assert.Throws<ArgumentOutOfRangeException>(() => UiLayoutModel.Resolve(new UiLayoutRequest(1280, 480, 1)));
        Assert.Throws<ArgumentOutOfRangeException>(() => UiLayoutModel.Resolve(new UiLayoutRequest(1280, 720, 1.51)));
    }

    [Theory]
    [InlineData(SettingValues.StandardContrast, false)]
    [InlineData(SettingValues.StandardContrast, true)]
    [InlineData(SettingValues.HighContrast, false)]
    [InlineData(SettingValues.DarkContrast, false)]
    public void ThemeTextAndFocusTokensMeetNonTextContrastMinimums(string mode, bool operatingSystemHighContrast)
    {
        UiThemePalette palette = UiThemeTokens.ForContrast(mode, operatingSystemHighContrast);

        Assert.True(UiThemeTokens.ContrastRatio(palette.Text, palette.Background) >= 7);
        Assert.True(UiThemeTokens.ContrastRatio(palette.TextMuted, palette.Background) >= 4.5);
        Assert.True(UiThemeTokens.ContrastRatio(palette.Focus, palette.Background) >= 3);
    }

    [Fact]
    public void FocusGraphWrapsAndContainsModalNavigationThenRestoresInvoker()
    {
        var graph = new AccessibilityFocusGraph(
        [
            new("tools", 0, "City Tools", "Open city tools"),
            new("pause", 1, "Pause", "Open pause menu"),
            new("resume", 2, "Resume", "Close pause menu", "pause-menu", Down: "settings"),
            new("settings", 3, "Settings", "Open settings", "pause-menu", Up: "resume"),
        ],
        [new ModalFocusScope("pause-menu", "resume", "pause", ["resume", "settings"])]);

        Assert.Equal(["tools", "pause", "resume", "settings"], graph.LogicalOrder);
        Assert.Equal("pause", graph.Move("tools", FocusDirection.Previous));
        Assert.Equal("resume", graph.EnterModal("pause-menu"));
        Assert.Equal("settings", graph.Move("resume", FocusDirection.Down, "pause-menu"));
        Assert.Equal("resume", graph.Move("settings", FocusDirection.Next, "pause-menu"));
        Assert.Equal("pause", graph.ExitModal("pause-menu"));
    }

    [Fact]
    public void FocusGraphRejectsMissingLabelsAndModalEscapeEdges()
    {
        Assert.Throws<ArgumentException>(() => new AccessibilityFocusGraph(
            [new AccessibleFocusNode("bad", 0, string.Empty, "Missing name")]));
        Assert.Throws<ArgumentException>(() => new AccessibilityFocusGraph(
        [
            new("outside", 0, "Outside", "Outside control"),
            new("inside", 1, "Inside", "Inside control", "dialog", Down: "outside"),
        ],
        [new ModalFocusScope("dialog", "inside", "outside", ["inside"])]));
    }
}

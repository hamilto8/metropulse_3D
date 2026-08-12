namespace MetroPulse.Domain.Presentation;

public enum DesktopUiBreakpoint
{
    Compact,
    Standard,
    Wide,
}

public sealed record UiLayoutRequest(int Width, int Height, double TextScale);

public sealed record UiLayoutSnapshot(
    DesktopUiBreakpoint Breakpoint,
    double EffectiveWidth,
    int HorizontalMargin,
    int VerticalMargin,
    int TopBarHeight,
    int ToolPanelWidth,
    int InspectorPanelWidth,
    int ModalMaximumWidth,
    int MinimapSize,
    bool StackTopStats,
    bool CollapseToolsByDefault,
    bool UseTwoRowControlRibbon);

/// <summary>Pure responsive policy shared by Godot controls and layout acceptance tests.</summary>
public static class UiLayoutModel
{
    public const int MinimumWidth = 1024;
    public const int MinimumHeight = 576;
    public const double MinimumTextScale = 0.8;
    public const double MaximumTextScale = 1.5;

    public static UiLayoutSnapshot Resolve(UiLayoutRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Width < MinimumWidth)
        {
            throw new ArgumentOutOfRangeException(nameof(request), $"UI width must be at least {MinimumWidth} pixels.");
        }
        if (request.Height < MinimumHeight)
        {
            throw new ArgumentOutOfRangeException(nameof(request), $"UI height must be at least {MinimumHeight} pixels.");
        }
        if (!double.IsFinite(request.TextScale)
            || request.TextScale < MinimumTextScale
            || request.TextScale > MaximumTextScale)
        {
            throw new ArgumentOutOfRangeException(nameof(request),
                $"Text scale must be between {MinimumTextScale} and {MaximumTextScale}.");
        }

        double effectiveWidth = request.Width / request.TextScale;
        DesktopUiBreakpoint breakpoint = effectiveWidth switch
        {
            < 1120 => DesktopUiBreakpoint.Compact,
            < 1760 => DesktopUiBreakpoint.Standard,
            _ => DesktopUiBreakpoint.Wide,
        };
        double density = Math.Clamp(request.Height / 720d, 0.8, 1.5);
        int horizontalMargin = Scale(breakpoint == DesktopUiBreakpoint.Compact ? 12 : 20, density);
        int verticalMargin = Scale(breakpoint == DesktopUiBreakpoint.Compact ? 10 : 16, density);
        int availableWidth = request.Width - (horizontalMargin * 2);
        int panelWidth = breakpoint switch
        {
            DesktopUiBreakpoint.Compact => Math.Min(360, Scale(300, request.TextScale)),
            DesktopUiBreakpoint.Standard => Math.Min(420, Scale(336, request.TextScale)),
            _ => Math.Min(480, Scale(372, request.TextScale)),
        };
        int modalMaximumWidth = Math.Min(
            breakpoint == DesktopUiBreakpoint.Compact ? availableWidth : Scale(860, request.TextScale),
            availableWidth);
        int minimap = Math.Min(
            Scale(breakpoint == DesktopUiBreakpoint.Wide ? 240 : 208, request.TextScale),
            Math.Min(availableWidth / 3, (int)(request.Height * 0.38)));

        return new UiLayoutSnapshot(
            breakpoint,
            effectiveWidth,
            horizontalMargin,
            verticalMargin,
            Scale(120, request.TextScale),
            panelWidth,
            panelWidth,
            modalMaximumWidth,
            minimap,
            breakpoint == DesktopUiBreakpoint.Compact,
            breakpoint == DesktopUiBreakpoint.Compact,
            breakpoint == DesktopUiBreakpoint.Compact || request.TextScale >= 1.35);
    }

    private static int Scale(double value, double scale) => (int)Math.Round(value * scale, MidpointRounding.AwayFromZero);
}

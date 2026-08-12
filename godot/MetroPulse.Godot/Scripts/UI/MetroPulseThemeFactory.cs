using Godot;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;

namespace MetroPulse.Godot.UI;

/// <summary>Creates the shared dark-glass MetroPulse theme from stable domain tokens.</summary>
public static class MetroPulseThemeFactory
{
    public static Theme Create(SettingsPreferences settings, bool operatingSystemRequestsHighContrast = false)
    {
        ArgumentNullException.ThrowIfNull(settings);
        UiThemePalette palette = UiThemeTokens.ForContrast(settings.ContrastMode, operatingSystemRequestsHighContrast);
        float scale = (float)settings.TextScale;
        Color text = Color.FromHtml(palette.Text);
        Color muted = Color.FromHtml(palette.TextMuted);
        Color cyan = Color.FromHtml(palette.Cyan);
        Color amber = Color.FromHtml(palette.Amber);
        var theme = new Theme();

        theme.SetTypeVariation("Title", "Label");
        theme.SetTypeVariation("Heading", "Label");
        theme.SetTypeVariation("Muted", "Label");
        theme.SetTypeVariation("Metric", "Label");
        theme.SetTypeVariation("GlassPanel", "PanelContainer");
        theme.SetTypeVariation("GlassPanelStrong", "PanelContainer");
        theme.SetTypeVariation("AccentButton", "Button");
        theme.SetTypeVariation("DangerButton", "Button");

        SetFont(theme, "Label", text, FontSize(16, scale));
        SetFont(theme, "Button", text, FontSize(15, scale));
        SetFont(theme, "CheckButton", text, FontSize(15, scale));
        SetFont(theme, "OptionButton", text, FontSize(15, scale));
        SetFont(theme, "LineEdit", text, FontSize(15, scale));
        SetFont(theme, "RichTextLabel", text, FontSize(15, scale));
        SetFont(theme, "Title", cyan, FontSize(28, scale));
        SetFont(theme, "Heading", text, FontSize(20, scale));
        SetFont(theme, "Muted", muted, FontSize(14, scale));
        SetFont(theme, "Metric", amber, FontSize(17, scale));

        theme.SetStylebox("panel", "PanelContainer", Panel(palette.Glass, palette.Outline, 1, 12));
        theme.SetStylebox("panel", "GlassPanel", Panel(palette.Glass, palette.Outline, 1, 14));
        theme.SetStylebox("panel", "GlassPanelStrong", Panel(palette.GlassStrong, palette.Cyan, 2, 18));

        StyleBoxFlat button = Panel(palette.GlassStrong, palette.Outline, 1, 10);
        StyleBoxFlat hover = Panel(palette.GlassStrong, palette.Cyan, 2, 10);
        StyleBoxFlat pressed = Panel(palette.Background, palette.Cyan, 2, 10);
        StyleBoxFlat disabled = Panel(palette.Glass, palette.Outline, 1, 10);
        StyleBoxFlat focusStyle = Panel("00000000", palette.Focus, UiThemeTokens.FocusWidth, 10, 2);
        foreach (string type in new[] { "Button", "CheckButton", "OptionButton" })
        {
            theme.SetStylebox("normal", type, button);
            theme.SetStylebox("hover", type, hover);
            theme.SetStylebox("pressed", type, pressed);
            theme.SetStylebox("disabled", type, disabled);
            theme.SetStylebox("focus", type, focusStyle);
        }
        theme.SetColor("font_disabled_color", "Button", muted with { A = 0.72f });
        theme.SetColor("font_hover_color", "Button", cyan);
        theme.SetColor("font_pressed_color", "Button", cyan);
        theme.SetConstant("outline_size", "Label", 1);
        theme.SetColor("font_outline_color", "Label", Color.FromHtml(palette.Background) with { A = 0.9f });
        theme.SetConstant("separation", "VBoxContainer", FontSize(10, scale));
        theme.SetConstant("separation", "HBoxContainer", FontSize(10, scale));
        theme.SetConstant("h_separation", "GridContainer", FontSize(12, scale));
        theme.SetConstant("v_separation", "GridContainer", FontSize(10, scale));

        theme.SetStylebox("normal", "AccentButton", Panel(palette.Cyan, palette.Cyan, 1, 10));
        theme.SetStylebox("hover", "AccentButton", Panel(palette.Text, palette.Cyan, 2, 10));
        theme.SetStylebox("pressed", "AccentButton", Panel(palette.Amber, palette.Cyan, 2, 10));
        theme.SetStylebox("focus", "AccentButton", focusStyle);
        theme.SetColor("font_color", "AccentButton", Color.FromHtml(palette.Background));
        theme.SetColor("font_hover_color", "AccentButton", Color.FromHtml(palette.Background));
        theme.SetColor("font_pressed_color", "AccentButton", Color.FromHtml(palette.Background));
        theme.SetStylebox("normal", "DangerButton", Panel(palette.Danger, palette.Danger, 1, 10));
        theme.SetStylebox("hover", "DangerButton", Panel(palette.Text, palette.Danger, 2, 10));
        theme.SetStylebox("pressed", "DangerButton", Panel(palette.Background, palette.Danger, 2, 10));
        theme.SetStylebox("focus", "DangerButton", focusStyle);
        theme.SetColor("font_color", "DangerButton", Color.FromHtml(palette.Background));

        return theme;
    }

    private static void SetFont(Theme theme, string type, Color color, int size)
    {
        theme.SetColor("font_color", type, color);
        theme.SetFontSize("font_size", type, size);
    }

    private static int FontSize(double baseSize, float scale) =>
        (int)Math.Round(baseSize * scale, MidpointRounding.AwayFromZero);

    private static StyleBoxFlat Panel(string background, string border, int borderWidth, int radius, int expand = 0)
    {
        var style = new StyleBoxFlat
        {
            BgColor = Color.FromHtml(background),
            BorderColor = Color.FromHtml(border),
            BorderWidthLeft = borderWidth,
            BorderWidthTop = borderWidth,
            BorderWidthRight = borderWidth,
            BorderWidthBottom = borderWidth,
            CornerRadiusTopLeft = radius,
            CornerRadiusTopRight = radius,
            CornerRadiusBottomLeft = radius,
            CornerRadiusBottomRight = radius,
            ContentMarginLeft = 14,
            ContentMarginTop = 10,
            ContentMarginRight = 14,
            ContentMarginBottom = 10,
            ExpandMarginLeft = expand,
            ExpandMarginTop = expand,
            ExpandMarginRight = expand,
            ExpandMarginBottom = expand,
        };
        return style;
    }
}

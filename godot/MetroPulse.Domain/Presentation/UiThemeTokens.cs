using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Presentation;

public sealed record UiThemePalette(
    string Background,
    string Glass,
    string GlassStrong,
    string Text,
    string TextMuted,
    string Cyan,
    string Amber,
    string Success,
    string Danger,
    string Focus,
    string Outline);

/// <summary>Stable player-facing theme tokens, including explicit high-contrast variants.</summary>
public static class UiThemeTokens
{
    public const int CornerRadius = 10;
    public const int FocusWidth = 3;
    public const int ControlHeight = 42;

    public static UiThemePalette ForContrast(string contrastMode, bool operatingSystemRequestsHighContrast = false) =>
        contrastMode switch
        {
            SettingValues.HighContrast => HighContrast,
            SettingValues.DarkContrast => DarkContrast,
            SettingValues.StandardContrast when operatingSystemRequestsHighContrast => HighContrast,
            SettingValues.StandardContrast => Standard,
            _ => throw new ArgumentOutOfRangeException(nameof(contrastMode), contrastMode, "Unknown contrast mode."),
        };

    public static double ContrastRatio(string foreground, string background)
    {
        (double red, double green, double blue) foregroundRgb = Parse(foreground);
        (double red, double green, double blue) backgroundRgb = Parse(background);
        double light = Math.Max(Luminance(foregroundRgb), Luminance(backgroundRgb));
        double dark = Math.Min(Luminance(foregroundRgb), Luminance(backgroundRgb));
        return (light + 0.05) / (dark + 0.05);
    }

    private static UiThemePalette Standard { get; } = new(
        "07101B", "132536E8", "193247F5", "F4FAFF", "AAC0D0", "42E8E0", "FFC857", "6BE6A8", "FF6B7A", "F6E05E", "3B6A82");

    private static UiThemePalette HighContrast { get; } = new(
        "000000", "071018FA", "0C1822FF", "FFFFFF", "DDEEFF", "66FFFF", "FFE066", "80FFB8", "FF8190", "FFFFFF", "A8EFFF");

    private static UiThemePalette DarkContrast { get; } = new(
        "020509", "09131DF5", "0D1C28FF", "EEF8FF", "BED0DC", "37D9D3", "F2BB4E", "5BD798", "F15F70", "8FE9FF", "264B60");

    private static (double red, double green, double blue) Parse(string hex)
    {
        string normalized = hex.TrimStart('#');
        if (normalized.Length is not (6 or 8)) throw new ArgumentException("A six- or eight-digit RGB color is required.", nameof(hex));
        return (
            Convert.ToInt32(normalized[..2], 16) / 255d,
            Convert.ToInt32(normalized[2..4], 16) / 255d,
            Convert.ToInt32(normalized[4..6], 16) / 255d);
    }

    private static double Luminance((double red, double green, double blue) color) =>
        (0.2126 * Linear(color.red)) + (0.7152 * Linear(color.green)) + (0.0722 * Linear(color.blue));

    private static double Linear(double channel) => channel <= 0.04045
        ? channel / 12.92
        : Math.Pow((channel + 0.055) / 1.055, 2.4);
}

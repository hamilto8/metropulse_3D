using System.Text.Json;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class SettingsUiCatalogTests
{
    [Fact]
    public void CatalogCoversEveryPreferenceLeafExactlyOnce()
    {
        JsonElement settings = JsonSerializer.SerializeToElement(SettingsValidator.DefaultSettings, SettingsValidator.JsonOptions);
        string[] leaves = LeafPaths(settings).Order(StringComparer.Ordinal).ToArray();
        string[] catalog = SettingsUiCatalog.All.Select(item => item.Path).Order(StringComparer.Ordinal).ToArray();

        Assert.Equal(27, leaves.Length);
        Assert.Equal(leaves, catalog);
        Assert.Equal(catalog.Length, catalog.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void EveryControlHasAccessibleCopyAndValidChoiceOrRangeMetadata()
    {
        Assert.All(SettingsUiCatalog.All, control =>
        {
            Assert.False(string.IsNullOrWhiteSpace(control.Label));
            Assert.False(string.IsNullOrWhiteSpace(control.Description));
            if (control.Kind == SettingControlKinds.Choice) Assert.NotEmpty(control.Options!);
            if (control.Kind == SettingControlKinds.Slider)
            {
                Assert.True(control.Maximum > control.Minimum);
                Assert.True(control.Step > 0);
            }
        });
    }

    private static IEnumerable<string> LeafPaths(JsonElement value, string prefix = "")
    {
        foreach (JsonProperty property in value.EnumerateObject())
        {
            string path = string.IsNullOrEmpty(prefix) ? property.Name : $"{prefix}.{property.Name}";
            if (property.Value.ValueKind == JsonValueKind.Object)
            {
                foreach (string child in LeafPaths(property.Value, path)) yield return child;
            }
            else
            {
                yield return path;
            }
        }
    }
}

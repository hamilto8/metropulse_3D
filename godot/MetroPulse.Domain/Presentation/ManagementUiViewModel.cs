using System.Globalization;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Services;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.Traffic;

namespace MetroPulse.Domain.Presentation;

public static class CityToolSectionIds
{
    public const string Economy = "economy";
    public const string Services = "services";
    public const string Traffic = "traffic";
    public const string Zoning = "zoning";
    public const string Construction = "construction";
    public const string Atmosphere = "atmosphere";
    public const string Overlay = "overlay";
    public const string Simulation = "simulation";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([
        Economy,
        Services,
        Traffic,
        Zoning,
        Construction,
        Atmosphere,
        Overlay,
        Simulation,
    ]);
}

public sealed record UiMetric(string Id, string Label, string Value, string Description);

public sealed record PriorityAlertView(
    string? Id,
    string Severity,
    string Title,
    string Detail,
    string Location,
    bool Active);

public sealed record TopCityBarView(
    IReadOnlyList<UiMetric> Metrics,
    string Mode,
    string Device,
    PriorityAlertView PriorityAlert);

public sealed record CityToolSectionView(
    string Id,
    string Title,
    string Summary,
    IReadOnlyList<string> Details,
    bool ActionAvailable = false,
    string? ActionLabel = null);

public sealed record BuilderCatalogCardView(
    string Id,
    string Name,
    string Category,
    string Description,
    string Cost,
    bool Unlocked,
    string Availability);

public sealed record PlacementForecastView(
    bool Valid,
    string Status,
    string Remedy,
    IReadOnlyList<string> Facts,
    string Position);

public sealed record ManagementUiSource(
    CityEconomyViewModel Economy,
    EconomyFiscalOverview Fiscal,
    CityServiceSnapshot Services,
    TrafficProductivitySnapshot Traffic,
    AlertSnapshot Alerts,
    EnvironmentPresentationSnapshot Environment,
    GameState State,
    string ActiveInput,
    double CityTimeScale,
    IReadOnlyList<BuildingDefinition> Catalog,
    BuildingDefinition SelectedBuilding,
    PlacementDecision Placement,
    bool GridSnapEnabled,
    string EditorTool,
    int UserBuildingCount,
    int ZoneCount,
    bool CongestionOverlayVisible);

public sealed record ManagementUiSnapshot(
    TopCityBarView TopBar,
    IReadOnlyList<CityToolSectionView> Tools,
    IReadOnlyList<BuilderCatalogCardView> Catalog,
    PlacementForecastView Forecast,
    string SelectedBuildingId,
    string SelectedBuildingName,
    string EditorTool,
    bool GridSnapEnabled,
    bool BuilderVisible);

/// <summary>Pure projection for management and builder UI; it owns no mutable simulation state.</summary>
public static class ManagementUiViewModel
{
    public static ManagementUiSnapshot Build(ManagementUiSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(source.Economy);
        ArgumentNullException.ThrowIfNull(source.Fiscal);
        ArgumentNullException.ThrowIfNull(source.Services);
        ArgumentNullException.ThrowIfNull(source.Traffic);
        ArgumentNullException.ThrowIfNull(source.Alerts);
        ArgumentNullException.ThrowIfNull(source.Environment);
        ArgumentNullException.ThrowIfNull(source.Catalog);
        ArgumentNullException.ThrowIfNull(source.SelectedBuilding);
        ArgumentNullException.ThrowIfNull(source.Placement);

        TopCityBarView topBar = BuildTopBar(source);
        IReadOnlyList<CityToolSectionView> tools = BuildTools(source);
        BuilderCatalogCardView[] catalog = source.Catalog.Select(BuildCatalogCard).ToArray();
        return new ManagementUiSnapshot(
            topBar,
            tools,
            Array.AsReadOnly(catalog),
            BuildForecast(source.Placement),
            source.SelectedBuilding.Id ?? "unknown-building",
            source.SelectedBuilding.Name ?? source.SelectedBuilding.Id ?? "Unknown building",
            source.EditorTool,
            source.GridSnapEnabled,
            source.State == GameState.Builder);
    }

    private static TopCityBarView BuildTopBar(ManagementUiSource source)
    {
        CityEconomyViewModel economy = source.Economy;
        EnvironmentPresentationSnapshot environment = source.Environment;
        IReadOnlyList<UiMetric> metrics = Array.AsReadOnly<UiMetric>([
            new("capital", "Capital", Money(economy.Treasury), $"{economy.FiscalStatus}: {economy.FiscalExplanation}"),
            new("population", "Population", Number(economy.Population), "Current city population"),
            new("jobs", "Jobs", Number(economy.Employees), "Currently filled city jobs"),
            new("energy", "Energy", Percent(economy.EnergyCoverage), "Citywide energy coverage"),
            new("satisfaction", "Satisfaction", $"{Math.Round(economy.Happiness):0}%", "Current city satisfaction"),
            new("time", "Time", FormatHour(environment.Hour), "Current simulated city time"),
            new("weather", "Weather", Title(environment.WeatherMode), "Current city weather"),
        ]);
        AlertRecord? priority = source.Alerts.Active
            .OrderByDescending(alert => SeverityRank(alert.Severity))
            .ThenByDescending(alert => alert.LastObservedAt, StringComparer.Ordinal)
            .ThenBy(alert => alert.Id, StringComparer.Ordinal)
            .FirstOrDefault();
        PriorityAlertView alert = priority is null
            ? new(null, AlertSeverities.Info, "No priority alerts", "The city has no active priority alert.", "Citywide", false)
            : new(
                priority.Id,
                priority.Severity,
                priority.Title,
                $"{priority.Cause} {priority.Recommendation}",
                priority.Location.Label,
                true);
        return new TopCityBarView(metrics, source.State.ToToken(), Title(source.ActiveInput), alert);
    }

    private static IReadOnlyList<CityToolSectionView> BuildTools(ManagementUiSource source)
    {
        CityEconomyViewModel economy = source.Economy;
        EconomyFiscalOverview fiscal = source.Fiscal;
        CityServiceSnapshot services = source.Services;
        TrafficProductivitySnapshot traffic = source.Traffic;
        return Array.AsReadOnly<CityToolSectionView>([
            new(
                CityToolSectionIds.Economy,
                "Economy recovery",
                $"{fiscal.Label} · {SignedMoneyRate(economy.NetIncomeRate)}",
                Array.AsReadOnly(new[]
                {
                    fiscal.Explanation,
                    $"Gross {MoneyRate(economy.GrossIncomeRate)} · upkeep {MoneyRate(economy.UpkeepRate)}",
                    fiscal.RunwayMinutes is null ? $"Reserve target {Money(fiscal.ReserveFloor)}" : $"Runway {Math.Ceiling(fiscal.RunwayMinutes.Value):0} minutes",
                }.Concat(fiscal.Actions).ToArray()),
                fiscal.AssistanceEligible,
                fiscal.AssistanceEligible ? $"Claim {Money(fiscal.EmergencyGrant)} assistance" : null),
            new(
                CityToolSectionIds.Services,
                "City services",
                $"Energy {services.Energy.CoveragePercent:0}% · Safety {services.Safety.CoveragePercent:0}%",
                Array.AsReadOnly([
                    services.Energy.Explanation,
                    services.Safety.Explanation,
                    $"{services.ActiveIncidentCount} active incidents · {services.OpenWorkOrderCount} open work orders",
                ])),
            new(
                CityToolSectionIds.Traffic,
                "Traffic & productivity",
                $"{traffic.Network.Rating} · {traffic.Productivity.Percent}% productivity",
                Array.AsReadOnly(new[]
                {
                    $"Congestion {traffic.Network.Congestion * 100:0}% · {traffic.Deliveries.OnTimePercent}% deliveries on time",
                    $"{Number(traffic.Jobs.AccessibleJobs)} accessible jobs · {Number(traffic.Jobs.JobsDelayedByCommute)} delayed",
                    traffic.Policy.Tradeoff,
                }.Concat(traffic.Explanation).ToArray()),
                true,
                traffic.Policy.Id == BridgePolicies.FreightPriority ? "Use balanced bridge policy" : "Prioritize bridge freight"),
            new(
                CityToolSectionIds.Zoning,
                "Zoning",
                $"{source.ZoneCount} player parcels",
                Array.AsReadOnly([
                    "Residential supports households and satisfaction.",
                    "Commercial supports services and customer-facing work.",
                    "Operations supports industrial jobs and freight demand.",
                ])),
            new(
                CityToolSectionIds.Construction,
                "Construction",
                $"{source.UserBuildingCount} player assets · {source.Catalog.Count} starter choices",
                Array.AsReadOnly([
                    $"Selected: {source.SelectedBuilding.Name}",
                    $"Tool: {Title(source.EditorTool)} · grid snap {(source.GridSnapEnabled ? "on" : "off")}",
                    source.Placement.Valid ? "Preview is valid and ready to confirm." : source.Placement.PrimaryBlocker?.Message ?? "Choose a catalog item.",
                ])),
            new(
                CityToolSectionIds.Atmosphere,
                "Atmosphere",
                $"{FormatHour(source.Environment.Hour)} · {Title(source.Environment.WeatherMode)}",
                Array.AsReadOnly([
                    $"Rain {source.Environment.RainOpacity * 100:0}% · wetness {source.Environment.Wetness * 100:0}%",
                    $"Fog {source.Environment.FogDensity:0.000} · night {source.Environment.NightFactor * 100:0}%",
                    "Cycle weather without changing mission outcome ownership.",
                ]),
                true,
                "Next weather"),
            new(
                CityToolSectionIds.Overlay,
                "Overlays",
                source.CongestionOverlayVisible ? "Congestion overlay on" : "Congestion overlay off",
                Array.AsReadOnly([
                    "Congestion uses the traffic productivity snapshot.",
                    "Service and zoning layers retain text and pattern alternatives.",
                ]),
                true,
                source.CongestionOverlayVisible ? "Hide congestion" : "Show congestion"),
            new(
                CityToolSectionIds.Simulation,
                "Simulation",
                $"{FormatScale(source.CityTimeScale)} city speed",
                Array.AsReadOnly([
                    $"Clock policy: {GameStateCatalog.Policies[source.State].Clock.ToToken()}",
                    "0.5×, 1×, 5×, and 15× affect the city clock in Management and Builder.",
                    "Street gameplay remains real-time.",
                ])),
        ]);
    }

    private static BuilderCatalogCardView BuildCatalogCard(BuildingDefinition building)
    {
        CatalogAccess access = ConstructionVocabulary.GetCatalogAccess(building, [ProgressionTiers.Operator]);
        return new BuilderCatalogCardView(
            building.Id ?? "unknown-building",
            building.Name ?? building.Id ?? "Unknown building",
            Title(building.Category ?? "other"),
            building.Description ?? "No description available.",
            Money(building.Cost),
            access.Unlocked,
            access.Unlocked ? "Available" : access.Reason ?? "Locked");
    }

    private static PlacementForecastView BuildForecast(PlacementDecision placement)
    {
        string position = placement.Position is null
            ? "No target"
            : $"X {placement.Position.X:0}, Z {placement.Position.Z:0}";
        if (!placement.Valid || placement.Preview is null)
        {
            PlacementBlocker? blocker = placement.PrimaryBlocker;
            return new PlacementForecastView(
                false,
                blocker?.Message ?? "Placement unavailable",
                blocker?.Remedy ?? "Move the preview or choose another catalog item.",
                Array.AsReadOnly(placement.Blockers.Select(item => $"{item.Code}: {item.Message}").ToArray()),
                position);
        }
        PlacementPreview preview = placement.Preview;
        var facts = new List<string>
        {
            preview.Summary.Cost,
            preview.Summary.OperatingCost,
            preview.Summary.NetCashflow,
            $"Capacity: {Number(preview.Capacity.Residents)} residents · {Number(preview.Capacity.Jobs)} jobs · {Number(preview.Capacity.Traffic)} traffic",
            $"Payback: {preview.Payback.Label}",
        };
        facts.AddRange(preview.Risks.Select(risk => $"{risk.Level}: {risk.Label}"));
        return new PlacementForecastView(true, "Valid placement", "Confirm to commit this disclosed forecast.", Array.AsReadOnly(facts.ToArray()), position);
    }

    private static int SeverityRank(string severity) => severity switch
    {
        AlertSeverities.Critical => 4,
        AlertSeverities.Warning => 3,
        AlertSeverities.Success => 2,
        _ => 1,
    };

    private static string Money(double value) => string.Format(CultureInfo.InvariantCulture, "${0:N0}", value);

    private static string MoneyRate(double value) => $"{Money(Math.Abs(value) * 60)}/min";

    private static string SignedMoneyRate(double value) => $"{(value >= 0 ? "+" : "−")}{MoneyRate(value)}";

    private static string Number(double value) => string.Format(CultureInfo.InvariantCulture, "{0:N0}", value);

    private static string Percent(double value) => $"{Math.Round(value * 100):0}%";

    private static string FormatHour(double hour)
    {
        int totalMinutes = (int)Math.Round(SimulationTimeModel.NormalizeHour(hour) * 60) % (24 * 60);
        return $"{totalMinutes / 60:00}:{totalMinutes % 60:00}";
    }

    private static string FormatScale(double scale) => $"{SimulationTimeModel.NormalizeSpeed(scale):0.#}×";

    private static string Title(string value) => string.Join(' ', value
        .Split(['_', '-'], StringSplitOptions.RemoveEmptyEntries)
        .Select(word => string.Concat(char.ToUpperInvariant(word[0]), word[1..].ToLowerInvariant())));
}

using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.World;

public sealed record SurfaceDeck(
    string Id,
    double MinX,
    double MaxX,
    double MinZ,
    double MaxZ,
    double Height)
{
    public bool Contains(double x, double z) =>
        x >= MinX && x <= MaxX && z >= MinZ && z <= MaxZ;
}

public sealed record SurfaceBounds(double MinX, double MaxX, double MinZ, double MaxZ)
{
    public bool Contains(double x, double z) =>
        double.IsFinite(x)
        && double.IsFinite(z)
        && x >= MinX
        && x <= MaxX
        && z >= MinZ
        && z <= MaxZ;
}

public sealed class WorldSurfaceModel
{
    private static readonly double[] CityRoadX = [-100, -50, 0, 50, 100, 210, 260, 310];
    private static readonly double[] CityRoadZ = [-100, -50, 0, 50, 100];
    private static readonly double[] BlockCentersX = [-75, -25, 25, 75, 235, 285];
    private static readonly double[] BlockCentersZ = [-75, -25, 25, 75];
    private static readonly double[] CountrysideRoadX = [450, 550, 650, 700, 750];
    private static readonly double[] CountrysideRoadZ = [-100, -50, 0, 50, 100];
    private readonly Dictionary<string, SurfaceDeck> decks;

    public WorldSurfaceModel(IEnumerable<SurfaceDeck>? decks = null)
    {
        this.decks = (decks ?? CreateProductionDecks()).ToDictionary(deck => deck.Id, StringComparer.Ordinal);
    }

    public static SurfaceBounds DrivableBounds { get; } = new(-498, 818, -398, 398);

    public IReadOnlyList<SurfaceDeck> Decks => Array.AsReadOnly(decks.Values.ToArray());

    public bool RegisterDeck(SurfaceDeck deck)
    {
        ArgumentNullException.ThrowIfNull(deck);
        if (string.IsNullOrWhiteSpace(deck.Id)
            || !double.IsFinite(deck.MinX)
            || !double.IsFinite(deck.MaxX)
            || !double.IsFinite(deck.MinZ)
            || !double.IsFinite(deck.MaxZ)
            || !double.IsFinite(deck.Height)
            || deck.MinX >= deck.MaxX
            || deck.MinZ >= deck.MaxZ)
        {
            throw new ArgumentException("Surface deck geometry must have a stable ID and finite positive bounds.", nameof(deck));
        }
        return decks.TryAdd(deck.Id, deck);
    }

    public bool UnregisterDeck(string id)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        return decks.Remove(id);
    }

    public static IReadOnlyList<SurfaceDeck> CreateProductionDecks()
    {
        List<SurfaceDeck> result =
        [
            new("grand-suspension", 110, 210, -9, 9, 0),
        ];
        foreach ((double z, int index) in new (double, int)[] { (-100, 0), (-50, 1), (50, 2), (100, 3) })
        {
            result.Add(new($"urban-{index}", 110, 210, z - 7.3, z + 7.3, 0));
        }
        foreach ((double z, int index) in new (double, int)[] { (-100, 0), (-50, 1), (0, 2), (50, 3), (100, 4) })
        {
            result.Add(new($"countryside-{index}", 380, 420, z - 7, z + 7, 0));
        }
        return result.AsReadOnly();
    }

    public bool IsWithinWorldBounds(double x, double z) =>
        double.IsFinite(x) && double.IsFinite(z) && ContentDefinitions.WorldBounds.Contains(x, z);

    public bool IsWithinDrivableBounds(double x, double z) => DrivableBounds.Contains(x, z);

    public double? GetBridgeDeckHeight(double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z))
        {
            return null;
        }
        foreach (SurfaceDeck deck in decks.Values)
        {
            if (deck.Contains(x, z))
            {
                return deck.Height;
            }
        }
        return null;
    }

    public bool IsWater(double x, double y, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(y) || !double.IsFinite(z))
        {
            return false;
        }
        double? deckHeight = GetBridgeDeckHeight(x, z);
        if (deckHeight is not null && y >= deckHeight.Value - 1)
        {
            return false;
        }
        return (x >= 135 && x <= 185) || (x >= 380 && x <= 420);
    }

    public double GetTerrainHeight(double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z))
        {
            return 0;
        }
        double? bridgeHeight = GetBridgeDeckHeight(x, z);
        if (bridgeHeight is not null)
        {
            return bridgeHeight.Value;
        }
        if ((x >= 135 && x <= 185) || (x >= 380 && x <= 420))
        {
            return -4;
        }
        if (x >= 420)
        {
            return GetHillHeight(x, z);
        }
        if (CityRoadX.Any(roadX => Math.Abs(x - roadX) <= 7)
            || CityRoadZ.Any(roadZ => Math.Abs(z - roadZ) <= 7))
        {
            return 0;
        }
        if (x < -60 && z < -60 && x > -100 && z > -100)
        {
            return 0.7;
        }
        foreach (double blockX in BlockCentersX)
        {
            foreach (double blockZ in BlockCentersZ)
            {
                if (Math.Abs(x - blockX) < 22 && Math.Abs(z - blockZ) < 22)
                {
                    return 0.4;
                }
            }
        }
        return 0;
    }

    public double GetHillHeightRaw(double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z) || x < 420)
        {
            return 0;
        }
        double factor = Math.Min(1, (x - 420) / 100);
        return ((Math.Sin(x * 0.05) * Math.Cos(z * 0.04) * 1.8) + (Math.Sin(x * 0.02) * 3.4)) * factor;
    }

    public double GetIntersectionHeight(double x, double z)
    {
        if (x <= 420)
        {
            return 0;
        }
        if (x == 700 && z == -100)
        {
            return 0.5 * (GetHillHeightRaw(650, -100) + GetHillHeightRaw(750, -100));
        }
        return GetHillHeightRaw(x, z);
    }

    public double GetHillHeight(double x, double z)
    {
        if (!double.IsFinite(x) || !double.IsFinite(z) || x < 420)
        {
            return 0;
        }
        double rawHeight = GetHillHeightRaw(x, z);
        if (x >= 630 && x <= 795 && z <= -70 && z >= -345)
        {
            double startHeight = GetIntersectionHeight(700, -100);
            double padHeight = GetHillHeightRaw(700, -280);
            double distanceToRoadX = Math.Abs(x - 700);
            double? targetHeight = null;
            if (distanceToRoadX <= 7.5 && z <= -100 && z >= -280)
            {
                double t = (z + 100) / -180;
                targetHeight = Lerp(startHeight, padHeight, SmoothStep(t));
            }
            if (Hypotenuse(x - 700, z + 280) <= 22)
            {
                targetHeight = padHeight;
            }
            if (Hypotenuse(x - 735, z + 245) <= 20)
            {
                targetHeight = padHeight;
            }
            if (x >= 700 && x <= 735 && Math.Abs(z + 245) <= 6.5)
            {
                double accessT = -145d / -180d;
                double accessJunctionHeight = Lerp(startHeight, padHeight, SmoothStep(accessT));
                targetHeight = Lerp(accessJunctionHeight, padHeight, SmoothStep(Math.Min(1, (x - 700) / 10)));
            }
            if (targetHeight is not null)
            {
                return targetHeight.Value;
            }

            List<(double Distance, double Height)> candidates = [];
            if (z <= -100 && z >= -280)
            {
                double t = (z + 100) / -180;
                candidates.Add((Math.Max(0, distanceToRoadX - 7.5), Lerp(startHeight, padHeight, SmoothStep(t))));
            }
            candidates.Add((Math.Max(0, Hypotenuse(x - 700, z + 280) - 22), padHeight));
            candidates.Add((Math.Max(0, Hypotenuse(x - 735, z + 245) - 20), padHeight));
            if (x >= 700 && x <= 735)
            {
                candidates.Add((Math.Max(0, Math.Abs(z + 245) - 6.5), padHeight));
            }
            (double Influence, double Height) strongest = (0, rawHeight);
            foreach ((double distance, double height) in candidates)
            {
                if (distance >= 20)
                {
                    continue;
                }
                double influence = 1 - SmoothStep(distance / 20);
                if (influence > strongest.Influence)
                {
                    strongest = (influence, height);
                }
            }
            if (strongest.Influence > 0)
            {
                double normalRoadDistance = Math.Max(0, Math.Abs(z + 100) - 8);
                double normalRoadInfluence = 1 - SmoothStep(Math.Min(1, normalRoadDistance / 20));
                if (strongest.Influence > normalRoadInfluence)
                {
                    return Lerp(rawHeight, strongest.Height, strongest.Influence);
                }
            }
        }

        double nearestX = Nearest(CountrysideRoadX, x, out double minimumDistanceX);
        double nearestZ = Nearest(CountrysideRoadZ, z, out double minimumDistanceZ);
        const double roadHalfWidth = 8;
        const double blendDistance = 20;
        bool verticalRoadCore = z >= -100 && z <= 100;
        if (minimumDistanceX <= roadHalfWidth && minimumDistanceZ <= roadHalfWidth)
        {
            return GetIntersectionHeight(nearestX, nearestZ);
        }

        double firstX = 420;
        double secondX = 450;
        if (x > 450 && x < 750)
        {
            for (int index = 0; index < CountrysideRoadX.Length - 1; index++)
            {
                if (x >= CountrysideRoadX[index] && x <= CountrysideRoadX[index + 1])
                {
                    firstX = CountrysideRoadX[index];
                    secondX = CountrysideRoadX[index + 1];
                    break;
                }
            }
        }
        else if (x >= 750)
        {
            firstX = 750;
            secondX = 800;
        }
        double startX = firstX == 420 ? 420 : firstX + roadHalfWidth;
        double endX = secondX == 800 ? 800 : secondX - roadHalfWidth;
        double firstHorizontalHeight = GetIntersectionHeight(firstX, nearestZ);
        double secondHorizontalHeight = secondX == 800
            ? GetIntersectionHeight(750, nearestZ)
            : GetIntersectionHeight(secondX, nearestZ);
        double horizontalHeight = firstHorizontalHeight;
        if (x >= endX)
        {
            horizontalHeight = secondHorizontalHeight;
        }
        else if (x > startX)
        {
            horizontalHeight = Lerp(firstHorizontalHeight, secondHorizontalHeight, SmoothStep((x - startX) / (endX - startX)));
        }

        double firstZ = -100;
        double secondZ = -50;
        if (z <= -100)
        {
            secondZ = -100;
        }
        else if (z >= 100)
        {
            firstZ = 100;
            secondZ = 100;
        }
        else
        {
            for (int index = 0; index < CountrysideRoadZ.Length - 1; index++)
            {
                if (z >= CountrysideRoadZ[index] && z <= CountrysideRoadZ[index + 1])
                {
                    firstZ = CountrysideRoadZ[index];
                    secondZ = CountrysideRoadZ[index + 1];
                    break;
                }
            }
        }
        double startZ = firstZ + roadHalfWidth;
        double endZ = secondZ - roadHalfWidth;
        double firstVerticalHeight = GetIntersectionHeight(nearestX, firstZ);
        double secondVerticalHeight = GetIntersectionHeight(nearestX, secondZ);
        double verticalHeight = firstVerticalHeight;
        if (firstZ != secondZ)
        {
            if (z >= endZ)
            {
                verticalHeight = secondVerticalHeight;
            }
            else if (z > startZ)
            {
                verticalHeight = Lerp(firstVerticalHeight, secondVerticalHeight, SmoothStep((z - startZ) / (endZ - startZ)));
            }
        }
        if (minimumDistanceZ <= roadHalfWidth)
        {
            return horizontalHeight;
        }
        if (verticalRoadCore && minimumDistanceX <= roadHalfWidth)
        {
            return verticalHeight;
        }

        double distanceToHorizontal = minimumDistanceZ - roadHalfWidth;
        double distanceToVertical = Hypotenuse(
            Math.Max(0, minimumDistanceX - roadHalfWidth),
            Math.Max(0, Math.Abs(z) - 100));
        double nearestRoadDistance = Math.Min(distanceToHorizontal, distanceToVertical);
        if (nearestRoadDistance < blendDistance)
        {
            double horizontalWeight = Math.Pow(Math.Max(0, blendDistance - distanceToHorizontal), 2);
            double verticalWeight = Math.Pow(Math.Max(0, blendDistance - distanceToVertical), 2);
            double totalWeight = horizontalWeight + verticalWeight;
            double nearestRoadHeight = totalWeight > 0
                ? ((horizontalHeight * horizontalWeight) + (verticalHeight * verticalWeight)) / totalWeight
                : rawHeight;
            return Lerp(nearestRoadHeight, rawHeight, SmoothStep(nearestRoadDistance / blendDistance));
        }
        return rawHeight;
    }

    private static double Nearest(IReadOnlyList<double> values, double target, out double minimumDistance)
    {
        double nearest = values[0];
        minimumDistance = Math.Abs(target - nearest);
        for (int index = 1; index < values.Count; index++)
        {
            double distance = Math.Abs(target - values[index]);
            if (distance < minimumDistance)
            {
                minimumDistance = distance;
                nearest = values[index];
            }
        }
        return nearest;
    }

    private static double SmoothStep(double value) => value * value * (3 - (2 * value));

    private static double Hypotenuse(double x, double y) => Math.Sqrt((x * x) + (y * y));

    private static double Lerp(double from, double to, double amount) => from + ((to - from) * amount);
}

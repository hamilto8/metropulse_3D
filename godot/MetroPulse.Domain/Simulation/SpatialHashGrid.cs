using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Simulation;

public readonly record struct SpatialPoint(double X, double Z)
{
    public bool IsFinite => double.IsFinite(X) && double.IsFinite(Z);
}

public sealed record SpatialQueryResult<T>(
    IReadOnlyList<T> Items,
    int CellsVisited,
    int CandidatesTested);

public readonly record struct SpatialQueryMetrics(int CellsVisited, int CandidatesTested);

/// <summary>
/// Deterministic XZ index for bounded local simulation queries. Publication and
/// query ordering use stable IDs rather than collection insertion order.
/// </summary>
public sealed class SpatialHashGrid<T>
{
    private readonly double cellSize;
    private readonly Func<T, string> idSelector;
    private readonly Func<T, SpatialPoint> positionSelector;
    private readonly Comparison<T> itemComparison;
    private readonly Dictionary<CellKey, List<Entry>> cells = [];
    private readonly HashSet<CellKey> occupiedCells = [];
    private readonly HashSet<string> indexedIds = new(StringComparer.Ordinal);
    private int indexedCount;

    public SpatialHashGrid(
        double cellSize,
        Func<T, string> idSelector,
        Func<T, SpatialPoint> positionSelector)
    {
        if (!double.IsFinite(cellSize) || cellSize <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(cellSize), "Cell size must be finite and positive.");
        }
        this.idSelector = idSelector ?? throw new ArgumentNullException(nameof(idSelector));
        this.positionSelector = positionSelector ?? throw new ArgumentNullException(nameof(positionSelector));
        itemComparison = (left, right) => StringComparer.Ordinal.Compare(this.idSelector(left), this.idSelector(right));
        this.cellSize = cellSize;
    }

    public double CellSize => cellSize;

    public int IndexedCount => indexedCount;

    public int OccupiedCellCount => occupiedCells.Count;

    public void Rebuild(IEnumerable<T> entities)
    {
        ArgumentNullException.ThrowIfNull(entities);
        foreach (CellKey key in occupiedCells) cells[key].Clear();
        occupiedCells.Clear();
        indexedCount = 0;
        indexedIds.Clear();
        foreach (T entity in entities)
        {
            string id = idSelector(entity);
            if (string.IsNullOrWhiteSpace(id))
            {
                throw new ArgumentException("Spatial entities require a non-empty stable ID.", nameof(entities));
            }
            if (!indexedIds.Add(id))
            {
                throw new ArgumentException($"Duplicate spatial entity ID '{id}'.", nameof(entities));
            }
            SpatialPoint position = positionSelector(entity);
            if (!position.IsFinite)
            {
                continue;
            }
            CellKey key = GetCell(position);
            if (!cells.TryGetValue(key, out List<Entry>? cell))
            {
                cell = [];
                cells.Add(key, cell);
            }
            occupiedCells.Add(key);
            cell.Add(new Entry(id, entity, position));
            indexedCount += 1;
        }
        foreach (CellKey key in occupiedCells)
        {
            cells[key].Sort(static (left, right) => StringComparer.Ordinal.Compare(left.Id, right.Id));
        }
    }

    public SpatialQueryResult<T> Query(SpatialPoint center, double radius)
    {
        List<T> matches = [];
        SpatialQueryMetrics metrics = QueryInto(center, radius, matches);
        return new SpatialQueryResult<T>(
            new ReadOnlyCollection<T>(matches.ToArray()),
            metrics.CellsVisited,
            metrics.CandidatesTested);
    }

    public SpatialQueryMetrics QueryInto(SpatialPoint center, double radius, List<T> matches)
    {
        ArgumentNullException.ThrowIfNull(matches);
        matches.Clear();
        if (!center.IsFinite || !double.IsFinite(radius) || radius < 0) return new(0, 0);

        int minimumX = GetCoordinate(center.X - radius);
        int maximumX = GetCoordinate(center.X + radius);
        int minimumZ = GetCoordinate(center.Z - radius);
        int maximumZ = GetCoordinate(center.Z + radius);
        double radiusSquared = radius * radius;
        int cellsVisited = 0;
        int candidatesTested = 0;

        for (int x = minimumX; x <= maximumX; x += 1)
        {
            for (int z = minimumZ; z <= maximumZ; z += 1)
            {
                cellsVisited += 1;
                if (!cells.TryGetValue(new CellKey(x, z), out List<Entry>? cell))
                {
                    continue;
                }
                foreach (Entry entry in cell)
                {
                    candidatesTested += 1;
                    double offsetX = entry.Position.X - center.X;
                    double offsetZ = entry.Position.Z - center.Z;
                    if (offsetX * offsetX + offsetZ * offsetZ <= radiusSquared)
                    {
                        matches.Add(entry.Value);
                    }
                }
            }
        }

        matches.Sort(itemComparison);
        return new(cellsVisited, candidatesTested);
    }

    private CellKey GetCell(SpatialPoint point) => new(GetCoordinate(point.X), GetCoordinate(point.Z));

    private int GetCoordinate(double coordinate) => checked((int)Math.Floor(coordinate / cellSize));

    private readonly record struct CellKey(int X, int Z);

    private readonly record struct Entry(string Id, T Value, SpatialPoint Position);
}

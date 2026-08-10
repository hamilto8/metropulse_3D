using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Interactions;

public static class InteractionPriorities
{
    public const double MissionObjective = 1000;
    public const double ServiceObjective = 950;
    public const double MissionPickup = 900;
    public const double AircraftBoard = 800;
    public const double VehicleHijack = 700;
    public const double NpcConversation = 600;
    public const double ControlledEntityExit = 500;
    public const double SelectedEntity = 100;
}

public static class InteractionResolutionStatuses
{
    public const string None = "NONE";
    public const string Completed = "COMPLETED";
    public const string Ineligible = "INELIGIBLE";
    public const string ActionRejected = "ACTION_REJECTED";
    public const string ActionFailed = "ACTION_FAILED";
}

public sealed record InteractionEligibility(bool Allowed, string? Reason = null);

public sealed record InteractionCandidateInput
{
    public string? Id { get; init; }

    public string? Kind { get; init; }

    public double Priority { get; init; } = double.NaN;

    public string? Prompt { get; init; }

    public Func<InteractionActionContext, object?>? Action { get; init; }

    public InteractionEligibility? Eligibility { get; init; }

    public string? FailureReason { get; init; }

    public double Distance { get; init; } = double.NaN;

    public string? AccessibilityLabel { get; init; }

    public IReadOnlyDictionary<string, object?>? Metadata { get; init; }
}

public sealed record InteractionCandidate
{
    public required string Id { get; init; }

    public required string Kind { get; init; }

    public required double Priority { get; init; }

    public required string Prompt { get; init; }

    public required Func<InteractionActionContext, object?> Action { get; init; }

    public required InteractionEligibility Eligibility { get; init; }

    public required string? FailureReason { get; init; }

    public required double Distance { get; init; }

    public required string AccessibilityLabel { get; init; }

    public required IReadOnlyDictionary<string, object?>? Metadata { get; init; }

    public required string ProviderId { get; init; }
}

public sealed record InteractionActionContext(
    InteractionCandidate Candidate,
    IReadOnlyDictionary<string, object?> Context);

public sealed record InteractionSnapshot(
    long Revision,
    InteractionCandidate? Primary,
    IReadOnlyList<InteractionCandidate> Candidates);

public sealed record InteractionResolution
{
    public required bool Handled { get; init; }

    public required string Status { get; init; }

    public required InteractionCandidate? Candidate { get; init; }

    public string? Reason { get; init; }

    public object? Result { get; init; }

    public Exception? Error { get; init; }
}

public sealed class InteractionService
{
    private readonly Dictionary<string, Func<IReadOnlyDictionary<string, object?>, IEnumerable<InteractionCandidateInput>?>>
        providers = new(StringComparer.Ordinal);
    private readonly List<Action<InteractionSnapshot>> listeners = [];
    private readonly Func<IReadOnlyDictionary<string, object?>?> contextProvider;
    private readonly Action<string?, InteractionCandidate>? onFailure;
    private readonly Action<Exception, string>? onError;
    private long revision;
    private bool resolving;

    public InteractionService(
        Func<IReadOnlyDictionary<string, object?>?>? contextProvider = null,
        Action<string?, InteractionCandidate>? onFailure = null,
        Action<Exception, string>? onError = null)
    {
        this.contextProvider = contextProvider ?? (() => EmptyContext);
        this.onFailure = onFailure;
        this.onError = onError;
        Snapshot = new InteractionSnapshot(0, null, Array.Empty<InteractionCandidate>());
    }

    public InteractionSnapshot Snapshot { get; private set; }

    public InteractionCandidate? Primary => Snapshot.Primary;

    public int ProviderCount => providers.Count;

    public int SubscriberCount => listeners.Count;

    public Func<bool> RegisterProvider(
        string id,
        Func<IReadOnlyDictionary<string, object?>, IEnumerable<InteractionCandidateInput>?> getCandidates)
    {
        string providerId = RequireText(id, "interaction provider id");
        ArgumentNullException.ThrowIfNull(getCandidates);
        if (!providers.TryAdd(providerId, getCandidates))
        {
            throw new InvalidOperationException($"Interaction provider already registered: {providerId}");
        }
        bool registered = true;
        return () =>
        {
            if (!registered) return false;
            registered = false;
            return providers.Remove(providerId);
        };
    }

    public Func<bool> Subscribe(Action<InteractionSnapshot> listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public InteractionSnapshot Refresh()
    {
        IReadOnlyDictionary<string, object?> context;
        try
        {
            context = CopyContext(contextProvider());
        }
        catch (Exception error)
        {
            ReportError(error, "context");
            context = EmptyContext;
        }

        var candidates = new List<InteractionCandidate>();
        foreach ((string providerId, Func<IReadOnlyDictionary<string, object?>, IEnumerable<InteractionCandidateInput>?> getCandidates)
            in providers)
        {
            try
            {
                IEnumerable<InteractionCandidateInput>? published = getCandidates(context);
                if (published is null) continue;
                foreach (InteractionCandidateInput? candidate in published)
                {
                    if (candidate is null) continue;
                    candidates.Add(NormalizeCandidate(candidate, providerId));
                }
            }
            catch (Exception error)
            {
                ReportError(error, providerId);
            }
        }

        candidates.Sort(CompareInteractions);
        revision += 1;
        Snapshot = new InteractionSnapshot(
            revision,
            candidates.FirstOrDefault(),
            Array.AsReadOnly(candidates.ToArray()));
        Notify();
        return Snapshot;
    }

    public InteractionResolution ResolvePrimary()
    {
        if (resolving) return NoneResolution;
        InteractionCandidate? candidate = Refresh().Primary;
        if (candidate is null) return NoneResolution;
        if (!candidate.Eligibility.Allowed)
        {
            onFailure?.Invoke(candidate.FailureReason, candidate);
            return new InteractionResolution
            {
                Handled = true,
                Status = InteractionResolutionStatuses.Ineligible,
                Candidate = candidate,
                Reason = candidate.FailureReason,
            };
        }

        resolving = true;
        try
        {
            IReadOnlyDictionary<string, object?> context = CopyContext(contextProvider());
            object? result = candidate.Action(new InteractionActionContext(candidate, context));
            return new InteractionResolution
            {
                Handled = true,
                Status = result is bool accepted && !accepted
                    ? InteractionResolutionStatuses.ActionRejected
                    : InteractionResolutionStatuses.Completed,
                Candidate = candidate,
                Result = result,
            };
        }
        catch (Exception error)
        {
            ReportError(error, candidate.ProviderId);
            return new InteractionResolution
            {
                Handled = true,
                Status = InteractionResolutionStatuses.ActionFailed,
                Candidate = candidate,
                Error = error,
            };
        }
        finally
        {
            resolving = false;
            Refresh();
        }
    }

    public InteractionSnapshot Clear()
    {
        revision += 1;
        Snapshot = new InteractionSnapshot(revision, null, Array.Empty<InteractionCandidate>());
        Notify();
        return Snapshot;
    }

    public static InteractionCandidate NormalizeCandidate(
        InteractionCandidateInput candidate,
        string providerId = "anonymous")
    {
        ArgumentNullException.ThrowIfNull(candidate);
        string id = RequireText(candidate.Id, "interaction id");
        string kind = RequireText(candidate.Kind, "interaction kind");
        string prompt = RequireText(candidate.Prompt, "interaction prompt");
        string accessibilityLabel = RequireText(
            candidate.AccessibilityLabel,
            "interaction accessibility label");
        if (!double.IsFinite(candidate.Priority))
        {
            throw new ArgumentOutOfRangeException(nameof(candidate), $"Interaction {id} priority must be finite.");
        }
        if (!(candidate.Distance >= 0) || double.IsNaN(candidate.Distance))
        {
            throw new ArgumentOutOfRangeException(
                nameof(candidate),
                $"Interaction {id} distance must be non-negative or Infinity.");
        }
        if (candidate.Action is null) throw new ArgumentException($"Interaction {id} requires an action.", nameof(candidate));
        InteractionEligibility eligibility = NormalizeEligibility(candidate.Eligibility, candidate.FailureReason);
        if (!eligibility.Allowed && eligibility.Reason is null)
        {
            throw new ArgumentException($"Ineligible interaction {id} must publish a failure reason.", nameof(candidate));
        }

        return new InteractionCandidate
        {
            Id = id,
            Kind = kind,
            Priority = candidate.Priority,
            Prompt = prompt,
            Action = candidate.Action,
            Eligibility = eligibility,
            FailureReason = eligibility.Reason,
            Distance = candidate.Distance,
            AccessibilityLabel = accessibilityLabel,
            Metadata = candidate.Metadata is null
                ? null
                : new ReadOnlyDictionary<string, object?>(
                    candidate.Metadata.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal)),
            ProviderId = RequireText(providerId, "interaction provider id"),
        };
    }

    public static int CompareInteractions(InteractionCandidate left, InteractionCandidate right)
    {
        if (left.Eligibility.Allowed != right.Eligibility.Allowed)
        {
            return left.Eligibility.Allowed ? -1 : 1;
        }
        int comparison = right.Priority.CompareTo(left.Priority);
        if (comparison != 0) return comparison;
        comparison = left.Distance.CompareTo(right.Distance);
        if (comparison != 0) return comparison;
        comparison = string.CompareOrdinal(left.Id, right.Id);
        return comparison != 0 ? comparison : string.CompareOrdinal(left.ProviderId, right.ProviderId);
    }

    public static InteractionCandidate? SelectPrimary(IEnumerable<InteractionCandidate>? candidates) =>
        candidates?.OrderBy(candidate => candidate, InteractionComparer.Instance).FirstOrDefault();

    private void Notify()
    {
        foreach (Action<InteractionSnapshot> listener in listeners.ToArray())
        {
            try
            {
                listener(Snapshot);
            }
            catch (Exception error)
            {
                ReportError(error, "listener");
            }
        }
    }

    private void ReportError(Exception error, string source) => onError?.Invoke(error, source);

    private static InteractionEligibility NormalizeEligibility(
        InteractionEligibility? value,
        string? failureReason)
    {
        if (value is null)
        {
            throw new ArgumentException("Interaction eligibility is required.", nameof(value));
        }
        string? reason = value.Allowed
            ? null
            : value.Reason ?? failureReason;
        return new InteractionEligibility(
            value.Allowed,
            reason is null ? null : RequireText(reason, "interaction failure reason"));
    }

    private static IReadOnlyDictionary<string, object?> CopyContext(
        IReadOnlyDictionary<string, object?>? context) =>
        context is null
            ? EmptyContext
            : new ReadOnlyDictionary<string, object?>(
                context.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));

    private static string RequireText(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{name} must be a non-empty string.", name);
        return value.Trim();
    }

    private static readonly IReadOnlyDictionary<string, object?> EmptyContext =
        new ReadOnlyDictionary<string, object?>(new Dictionary<string, object?>());

    private static readonly InteractionResolution NoneResolution = new()
    {
        Handled = false,
        Status = InteractionResolutionStatuses.None,
        Candidate = null,
    };

    private sealed class InteractionComparer : IComparer<InteractionCandidate>
    {
        public static readonly InteractionComparer Instance = new();

        public int Compare(InteractionCandidate? left, InteractionCandidate? right)
        {
            if (ReferenceEquals(left, right)) return 0;
            if (left is null) return 1;
            if (right is null) return -1;
            return CompareInteractions(left, right);
        }
    }
}

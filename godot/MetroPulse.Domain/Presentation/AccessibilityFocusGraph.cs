using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Presentation;

public enum FocusDirection
{
    Previous,
    Next,
    Up,
    Down,
    Left,
    Right,
}

public sealed record AccessibleFocusNode(
    string Id,
    int Order,
    string AccessibleName,
    string AccessibleDescription,
    string? ModalId = null,
    string? Up = null,
    string? Down = null,
    string? Left = null,
    string? Right = null);

public sealed record ModalFocusScope(
    string Id,
    string DefaultFocusId,
    string RestoreFocusId,
    IReadOnlyList<string> MemberIds);

/// <summary>Validates logical navigation, modal containment, and deterministic focus restoration.</summary>
public sealed class AccessibilityFocusGraph
{
    private readonly IReadOnlyDictionary<string, AccessibleFocusNode> nodes;
    private readonly IReadOnlyDictionary<string, ModalFocusScope> modals;
    private readonly IReadOnlyList<AccessibleFocusNode> ordered;

    public AccessibilityFocusGraph(
        IEnumerable<AccessibleFocusNode> focusNodes,
        IEnumerable<ModalFocusScope>? modalScopes = null)
    {
        ArgumentNullException.ThrowIfNull(focusNodes);
        AccessibleFocusNode[] nodeArray = focusNodes.ToArray();
        if (nodeArray.Length == 0) throw new ArgumentException("A focus graph requires at least one control.", nameof(focusNodes));
        if (nodeArray.Any(node => string.IsNullOrWhiteSpace(node.Id)
            || string.IsNullOrWhiteSpace(node.AccessibleName)
            || string.IsNullOrWhiteSpace(node.AccessibleDescription)))
        {
            throw new ArgumentException("Every focus control requires an ID, accessible name, and accessible description.", nameof(focusNodes));
        }
        if (nodeArray.Select(node => node.Id).Distinct(StringComparer.Ordinal).Count() != nodeArray.Length)
        {
            throw new ArgumentException("Focus control IDs must be unique.", nameof(focusNodes));
        }
        if (nodeArray.Select(node => node.Order).Distinct().Count() != nodeArray.Length)
        {
            throw new ArgumentException("Logical focus order values must be unique.", nameof(focusNodes));
        }

        nodes = new ReadOnlyDictionary<string, AccessibleFocusNode>(
            nodeArray.ToDictionary(node => node.Id, StringComparer.Ordinal));
        ordered = Array.AsReadOnly(nodeArray.OrderBy(node => node.Order).ToArray());
        ModalFocusScope[] modalArray = modalScopes?.ToArray() ?? [];
        if (modalArray.Select(scope => scope.Id).Distinct(StringComparer.Ordinal).Count() != modalArray.Length)
        {
            throw new ArgumentException("Modal focus scope IDs must be unique.", nameof(modalScopes));
        }
        modals = new ReadOnlyDictionary<string, ModalFocusScope>(
            modalArray.ToDictionary(scope => scope.Id, StringComparer.Ordinal));
        ValidateReferences();
    }

    public IReadOnlyList<string> LogicalOrder => Array.AsReadOnly(ordered.Select(node => node.Id).ToArray());

    public string EnterModal(string modalId) => GetModal(modalId).DefaultFocusId;

    public string ExitModal(string modalId) => GetModal(modalId).RestoreFocusId;

    public string Move(string currentId, FocusDirection direction, string? activeModalId = null)
    {
        AccessibleFocusNode current = GetNode(currentId);
        ModalFocusScope? modal = activeModalId is null ? null : GetModal(activeModalId);
        AccessibleFocusNode[] available = modal is null
            ? ordered.Where(node => node.ModalId is null).ToArray()
            : ordered.Where(node => node.ModalId == modal.Id).ToArray();
        if (!available.Contains(current)) throw new InvalidOperationException($"Control {currentId} is outside the active focus scope.");
        string? explicitTarget = direction switch
        {
            FocusDirection.Up => current.Up,
            FocusDirection.Down => current.Down,
            FocusDirection.Left => current.Left,
            FocusDirection.Right => current.Right,
            _ => null,
        };
        if (explicitTarget is not null)
        {
            AccessibleFocusNode target = GetNode(explicitTarget);
            if (available.Contains(target)) return target.Id;
        }
        int index = Array.IndexOf(available, current);
        int delta = direction is FocusDirection.Previous or FocusDirection.Up or FocusDirection.Left ? -1 : 1;
        return available[(index + delta + available.Length) % available.Length].Id;
    }

    private void ValidateReferences()
    {
        foreach (AccessibleFocusNode node in nodes.Values)
        {
            if (node.ModalId is not null && !modals.ContainsKey(node.ModalId))
            {
                throw new ArgumentException($"Control {node.Id} references unknown modal {node.ModalId}.");
            }
            foreach (string target in new[] { node.Up, node.Down, node.Left, node.Right }.OfType<string>())
            {
                AccessibleFocusNode referenced = GetNode(target);
                if (!string.Equals(node.ModalId, referenced.ModalId, StringComparison.Ordinal))
                {
                    throw new ArgumentException($"Focus edge {node.Id} -> {target} escapes its modal scope.");
                }
            }
        }
        foreach (ModalFocusScope modal in modals.Values)
        {
            if (modal.MemberIds.Count == 0 || modal.MemberIds.Distinct(StringComparer.Ordinal).Count() != modal.MemberIds.Count)
            {
                throw new ArgumentException($"Modal {modal.Id} requires unique members.");
            }
            HashSet<string> declared = modal.MemberIds.ToHashSet(StringComparer.Ordinal);
            HashSet<string> actual = nodes.Values.Where(node => node.ModalId == modal.Id).Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
            if (!declared.SetEquals(actual)) throw new ArgumentException($"Modal {modal.Id} member list does not match its focus controls.");
            if (!declared.Contains(modal.DefaultFocusId)) throw new ArgumentException($"Modal {modal.Id} default focus is outside the modal.");
            if (!nodes.TryGetValue(modal.RestoreFocusId, out AccessibleFocusNode? restore) || restore.ModalId is not null)
            {
                throw new ArgumentException($"Modal {modal.Id} restore focus must target a non-modal control.");
            }
        }
    }

    private AccessibleFocusNode GetNode(string id) => nodes.TryGetValue(id, out AccessibleFocusNode? node)
        ? node
        : throw new KeyNotFoundException($"Unknown focus control: {id}.");

    private ModalFocusScope GetModal(string id) => modals.TryGetValue(id, out ModalFocusScope? modal)
        ? modal
        : throw new KeyNotFoundException($"Unknown modal focus scope: {id}.");
}

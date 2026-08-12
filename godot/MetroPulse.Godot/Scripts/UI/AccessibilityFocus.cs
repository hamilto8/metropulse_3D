using Godot;

namespace MetroPulse.Godot.UI;

public static class AccessibilityFocus
{
    public static T Describe<T>(T control, string accessibleName, string accessibleDescription) where T : Control
    {
        ArgumentNullException.ThrowIfNull(control);
        if (string.IsNullOrWhiteSpace(accessibleName)) throw new ArgumentException("An accessible name is required.", nameof(accessibleName));
        if (string.IsNullOrWhiteSpace(accessibleDescription)) throw new ArgumentException("An accessible description is required.", nameof(accessibleDescription));
        control.AccessibilityName = accessibleName;
        control.AccessibilityDescription = accessibleDescription;
        return control;
    }

    public static void LinkLinear(IReadOnlyList<Control> controls, bool wrap = true)
    {
        ArgumentNullException.ThrowIfNull(controls);
        if (controls.Count == 0) return;
        for (int index = 0; index < controls.Count; index++)
        {
            Control control = controls[index];
            control.FocusMode = Control.FocusModeEnum.All;
            Control? previous = index > 0 ? controls[index - 1] : wrap ? controls[^1] : null;
            Control? next = index + 1 < controls.Count ? controls[index + 1] : wrap ? controls[0] : null;
            control.FocusPrevious = previous?.GetPath() ?? default;
            control.FocusNext = next?.GetPath() ?? default;
        }
    }

    public static void LinkVertical(IReadOnlyList<Control> controls, bool wrap = true)
    {
        LinkLinear(controls, wrap);
        for (int index = 0; index < controls.Count; index++)
        {
            Control? previous = index > 0 ? controls[index - 1] : wrap ? controls[^1] : null;
            Control? next = index + 1 < controls.Count ? controls[index + 1] : wrap ? controls[0] : null;
            controls[index].FocusNeighborTop = previous?.GetPath() ?? default;
            controls[index].FocusNeighborBottom = next?.GetPath() ?? default;
        }
    }

    public static void LinkHorizontal(IReadOnlyList<Control> controls, bool wrap = true)
    {
        LinkLinear(controls, wrap);
        for (int index = 0; index < controls.Count; index++)
        {
            Control? previous = index > 0 ? controls[index - 1] : wrap ? controls[^1] : null;
            Control? next = index + 1 < controls.Count ? controls[index + 1] : wrap ? controls[0] : null;
            controls[index].FocusNeighborLeft = previous?.GetPath() ?? default;
            controls[index].FocusNeighborRight = next?.GetPath() ?? default;
        }
    }
}

/// <summary>Contains modal focus and restores the invoking control when the modal closes.</summary>
public sealed class ModalFocusController
{
    private readonly Control modal;
    private readonly Control initialFocus;
    private readonly IReadOnlyList<Control> controls;
    private Control? restoreFocus;

    public ModalFocusController(Control modal, Control initialFocus, IReadOnlyList<Control> controls)
    {
        this.modal = modal ?? throw new ArgumentNullException(nameof(modal));
        this.initialFocus = initialFocus ?? throw new ArgumentNullException(nameof(initialFocus));
        this.controls = controls ?? throw new ArgumentNullException(nameof(controls));
        if (controls.Count == 0 || !controls.Contains(initialFocus))
        {
            throw new ArgumentException("A modal focus scope must contain its initial control.", nameof(controls));
        }
        AccessibilityFocus.LinkVertical(controls);
    }

    public void Open(Control? invoker = null)
    {
        restoreFocus = invoker ?? modal.GetViewport().GuiGetFocusOwner();
        modal.Visible = true;
        initialFocus.CallDeferred(Control.MethodName.GrabFocus);
    }

    public void Close()
    {
        modal.Visible = false;
        if (restoreFocus is not null && GodotObject.IsInstanceValid(restoreFocus) && restoreFocus.IsVisibleInTree())
        {
            restoreFocus.CallDeferred(Control.MethodName.GrabFocus);
        }
        else
        {
            modal.GetViewport().GuiReleaseFocus();
        }
        restoreFocus = null;
    }
}

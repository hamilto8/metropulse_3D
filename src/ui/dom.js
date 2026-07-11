/**
 * Replaces an element's contents with trusted text segments. Dynamic values are
 * always assigned through textContent, so callers cannot accidentally create a
 * DOM-XSS sink while retaining styled prompt fragments.
 */
export function setTextSegments(element, segments = []) {
  if (!element) return element;
  element.replaceChildren();
  for (const segment of segments) {
    if (typeof segment === 'string') {
      element.appendChild(document.createTextNode(segment));
      continue;
    }
    const span = document.createElement('span');
    if (segment.className) span.className = segment.className;
    span.textContent = String(segment.text ?? '');
    element.appendChild(span);
  }
  return element;
}

export function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text ?? '');
  return element;
}

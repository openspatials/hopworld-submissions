// focus.js — the focus handoff (04 section 7, rule 1).
// After spawning, the core calls the adapter's focusGame(). An adapter with no focusGame gets
// defaultFocusGame: give the game element (the first canvas unless told otherwise) a tabindex,
// focus it, and call window.focus(). Keyboard listeners stay on window, so focus inside the
// page is enough. Whether page script can take focus back from Chrome's own translate prompt
// is untested; page rule 2 (lang + notranslate) is the main guard.

/** Finds the game element: the given element, a CSS selector, or the first canvas. */
export function findGameElement(target) {
  const doc = globalThis.document;
  if (!doc) return null;
  if (target && typeof target === 'object' && 'focus' in target) return target;
  if (typeof target === 'string') return doc.querySelector(target);
  return doc.querySelector('canvas');
}

/**
 * Default focusGame. Returns { focused, element } where element is a short description.
 * Safe to call in Node (no document): returns { focused: false, element: null }.
 */
export function defaultFocusGame(target) {
  const el = findGameElement(target);
  if (!el) return { focused: false, element: null };
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  try { globalThis.window?.focus(); } catch { /* ignore */ }
  return { focused: globalThis.document.activeElement === el, element: describe(el) };
}

export function describe(el) {
  if (!el) return null;
  return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
}

/** What has focus now, as a short description (null outside a browser). */
export function activeElement() {
  const doc = globalThis.document;
  return doc ? describe(doc.activeElement) : null;
}

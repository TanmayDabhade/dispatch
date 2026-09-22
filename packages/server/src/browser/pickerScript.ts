/**
 * The script injected into a page for Design Mode.
 *
 * It is a string rather than a module because it runs in the page, not here —
 * evaluated through `Runtime.evaluate`, with no bundler and no imports
 * available. Everything it needs is inside it.
 *
 * What it does: outlines whatever the pointer is over, and on click records
 * that element's markup, its computed styles and its position, then removes
 * itself. The daemon reads the recorded value out of the page afterwards.
 *
 * Two details it has to get right:
 *
 *   - The click must not reach the page. A picker that lets the click through
 *     navigates away from the thing the user was trying to describe, so it
 *     captures in the capture phase and stops the event there.
 *   - Its own overlay must never be pickable. The outline is drawn on a
 *     `pointer-events: none` element, so `elementFromPoint` always returns the
 *     page's element rather than the highlight.
 */

/** Where the picker leaves its result for the daemon to read. */
export const PICK_RESULT_GLOBAL = '__dispatchPick';

/** Set while a pick is armed, so re-arming twice is a no-op. */
const PICK_ACTIVE_GLOBAL = '__dispatchPickActive';

/**
 * The computed properties captured for a picked element.
 *
 * A deliberate subset: the full computed style is several hundred properties,
 * almost all of them defaults, and pasting that into an agent's prompt buries
 * the handful that describe how the element actually looks.
 */
export const CAPTURED_STYLE_PROPERTIES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background-color',
  'border',
  'border-radius',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'opacity',
  'z-index',
  'overflow',
  'box-shadow',
] as const;

/** How much of an element's markup is kept, so one huge node cannot flood a prompt. */
const MAX_OUTER_HTML_CHARS = 20_000;

export function buildPickerScript(): string {
  const props = JSON.stringify(CAPTURED_STYLE_PROPERTIES);
  return `(() => {
  if (window.${PICK_ACTIVE_GLOBAL}) return 'already-active';
  window.${PICK_ACTIVE_GLOBAL} = true;
  window.${PICK_RESULT_GLOBAL} = null;

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483647',
    'border:2px solid #4aa5f0',
    'background:rgba(74,165,240,0.12)',
    'border-radius:2px',
    'transition:all 40ms linear',
    'display:none',
  ].join(';');

  const label = document.createElement('div');
  label.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483647',
    'background:#4aa5f0',
    'color:#fff',
    'font:11px/1.4 ui-monospace,monospace',
    'padding:2px 6px',
    'border-radius:3px',
    'display:none',
  ].join(';');

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);

  // A CSS path good enough to find the element again. Ids short-circuit it;
  // otherwise each step is a tag plus its position among same-tag siblings,
  // which stays valid even for markup with no classes worth naming.
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === node.tagName
      );
      parts.unshift(
        sameTag.length > 1
          ? tag + ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')'
          : tag
      );
      node = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    const styles = {};
    for (const prop of ${props}) styles[prop] = computed.getPropertyValue(prop);
    const html = el.outerHTML || '';
    return {
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      className: typeof el.className === 'string' ? el.className : null,
      text: (el.textContent || '').trim().slice(0, 500),
      outerHTML: html.slice(0, ${MAX_OUTER_HTML_CHARS}),
      outerHTMLTruncated: html.length > ${MAX_OUTER_HTML_CHARS},
      styles: styles,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      url: location.href,
    };
  }

  let current = null;

  function onMove(event) {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === overlay || el === label) return;
    current = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    label.style.display = 'block';
    label.textContent = el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      ' ' + Math.round(rect.width) + '×' + Math.round(rect.height);
    // Above the element, unless that would be off-screen.
    label.style.left = rect.left + 'px';
    label.style.top = (rect.top > 20 ? rect.top - 20 : rect.bottom + 4) + 'px';
  }

  function teardown() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    label.remove();
    window.${PICK_ACTIVE_GLOBAL} = false;
  }

  function onClick(event) {
    // Capture phase and fully swallowed: letting the click reach the page
    // would navigate away from the element being described.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const el = current || event.target;
    window.${PICK_RESULT_GLOBAL} = describe(el);
    teardown();
  }

  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    window.${PICK_RESULT_GLOBAL} = { cancelled: true };
    teardown();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  return 'armed';
})()`;
}

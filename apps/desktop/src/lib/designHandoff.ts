import type { PickedElement } from '@dispatch/client';

/**
 * Turning a picked element into text an agent can act on.
 *
 * This is the whole point of Design Mode: the person points at the thing that
 * is wrong, and what reaches the agent has to be specific enough that it knows
 * which thing that is. A screenshot alone is ambiguous in a page with six
 * similar buttons; a selector alone says nothing about how it looks. So the
 * handoff carries the selector, the markup, and only the styles that are
 * actually doing something.
 */

/**
 * Styles worth sending.
 *
 * A computed style has a value for every property whether or not the author
 * set one, and most of them are defaults that say nothing. Sending all of them
 * buries the two or three that describe the problem, so the obvious no-ops are
 * dropped. This is a readability filter, not a correctness one — anything it
 * removes is visible in the screenshot regardless.
 */
const UNINTERESTING: Record<string, string[]> = {
  opacity: ['1'],
  'z-index': ['auto'],
  overflow: ['visible'],
  'box-shadow': ['none'],
  border: ['0px none rgb(0, 0, 0)', 'medium none'],
  'border-radius': ['0px'],
  margin: ['0px'],
  padding: ['0px'],
  gap: ['normal', '0px'],
  'flex-direction': ['row'],
  'justify-content': ['normal', 'flex-start'],
  'align-items': ['normal', 'flex-start'],
  'grid-template-columns': ['none'],
  'text-align': ['start'],
  position: ['static'],
};

export function interestingStyles(
  styles: Record<string, string>
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [prop, value] of Object.entries(styles)) {
    if (value === '') continue;
    if ((UNINTERESTING[prop] ?? []).includes(value)) continue;
    kept[prop] = value;
  }
  return kept;
}

/**
 * The prompt text for a picked element.
 *
 * Markdown, with the markup fenced, because that is what every agent in this
 * app is already reading. `note` is whatever the person typed alongside the
 * pick — the actual request — and it leads, because the element is context for
 * the request rather than the other way round.
 */
export function designHandoffText(
  element: PickedElement,
  note: string
): string {
  const styles = interestingStyles(element.styles);
  const lines: string[] = [];

  const trimmed = note.trim();
  if (trimmed !== '') lines.push(trimmed, '');

  lines.push('## The element', '');
  lines.push(`- page: ${element.url}`);
  lines.push(`- selector: \`${element.selector}\``);
  if (element.text !== '') {
    lines.push(`- text: ${JSON.stringify(element.text)}`);
  }
  lines.push(
    `- box: ${Math.round(element.rect.width)}×${Math.round(element.rect.height)} at ` +
      `(${Math.round(element.rect.x)}, ${Math.round(element.rect.y)})`
  );

  lines.push('', '### Markup', '', '```html', element.outerHTML, '```');
  if (element.outerHTMLTruncated) {
    lines.push('', '_(markup truncated)_');
  }

  if (Object.keys(styles).length > 0) {
    lines.push('', '### Computed styles', '', '```css');
    for (const [prop, value] of Object.entries(styles)) {
      lines.push(`${prop}: ${value};`);
    }
    lines.push('```');
  }

  return `${lines.join('\n')}\n`;
}

/** A short label for the pick, for a task title or a list row. */
export function designHandoffTitle(element: PickedElement): string {
  const name =
    element.id !== null && element.id !== ''
      ? `#${element.id}`
      : element.text !== ''
        ? element.text.slice(0, 40)
        : element.tagName;
  return `Design: ${name}`;
}

import { useEffect, useMemo, useRef } from 'react';

import { cellColor } from '../../lib/terminalPalette';
import type {
  CellStyle,
  StyledSpan,
  TerminalScreen,
} from '../../lib/terminalScreen';

/**
 * Renders a `TerminalScreen` as styled text.
 *
 * DOM spans rather than a canvas: the output has to be selectable and
 * copyable, which is the single most common thing anyone does with a terminal
 * inside a review tool. A canvas would render faster and support nothing.
 */

// A cell's style as inline CSS. Inline rather than classes because the colour
// space is 256 palette entries plus arbitrary true colour — the class count
// would be unbounded.
function styleToCss(style: CellStyle): React.CSSProperties {
  const fg = cellColor(style.fg);
  const bg = cellColor(style.bg);
  // Inverse swaps the two at render time. An inverted cell with no explicit
  // colours still has to flip, so it falls back to the surface's own colours.
  const [color, background] = style.inverse
    ? [bg ?? 'var(--color-background)', fg ?? 'var(--color-foreground)']
    : [fg, bg];
  return {
    ...(color === null || color === undefined ? {} : { color }),
    ...(background === null || background === undefined
      ? {}
      : { backgroundColor: background }),
    ...(style.bold ? { fontWeight: 600 } : {}),
    // Dim is opacity, not a second colour: it has to compose with whatever
    // foreground is already set.
    ...(style.dim ? { opacity: 0.65 } : {}),
    ...(style.italic ? { fontStyle: 'italic' as const } : {}),
    ...(style.underline || style.strike
      ? {
          textDecorationLine: [
            style.underline ? 'underline' : '',
            style.strike ? 'line-through' : '',
          ]
            .filter(Boolean)
            .join(' '),
        }
      : {}),
  };
}

interface TerminalCanvasProps {
  screen: TerminalScreen | null;
  /** Changes whenever the screen mutates, so memoized spans recompute. */
  revision: number;
  /** Matching text is highlighted; empty means no search is active. */
  search: string;
  /** Pins the view to the bottom as output arrives. */
  follow: boolean;
}

// Splits one span around every case-insensitive match, so the highlight can be
// wrapped without disturbing the span's own styling.
function highlightParts(
  text: string,
  needle: string
): { text: string; hit: boolean }[] {
  if (needle === '') return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const haystack = text.toLowerCase();
  const lower = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(lower, from);
    if (at === -1) break;
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + needle.length), hit: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

function SpanRun({ span, search }: { span: StyledSpan; search: string }) {
  const css = styleToCss(span.style);
  if (search === '') return <span style={css}>{span.text}</span>;
  return (
    <span style={css}>
      {highlightParts(span.text, search).map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className="rounded-[2px] bg-amber-300/70 text-black dark:bg-amber-400/70"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  );
}

export function TerminalCanvas({
  screen,
  revision,
  search,
  follow,
}: TerminalCanvasProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(
    () => (screen === null ? [] : screen.toSpans()),
    // `revision` is the dependency that matters: the emulator is mutated in
    // place, so its identity never changes when new output lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screen, revision]
  );

  useEffect(() => {
    if (!follow) return;
    const node = scrollRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [lines, follow]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto bg-[var(--color-card)] px-3 py-2 font-mono text-[12px] leading-[1.45] whitespace-pre"
      data-testid="terminal-canvas"
    >
      {lines.map((spans, row) => (
        <div key={row} className="min-h-[1.45em]">
          {spans.map((span, index) => (
            <SpanRun key={index} span={span} search={search} />
          ))}
        </div>
      ))}
    </div>
  );
}

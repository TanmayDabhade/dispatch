/**
 * The xterm 256-colour palette, as CSS colours.
 *
 * A cell's colour arrives as a palette index (or a `#rrggbb` string for a
 * true-colour cell), and something has to turn an index into a colour the
 * browser understands. The first 16 are the named ANSI colours, which are a
 * matter of taste — these are tuned to stay legible on both the light and dark
 * app surfaces rather than copied from a terminal's defaults, where a dark
 * background is assumed.
 */

// 0–7 normal, 8–15 bright. Blue is lightened from the classic #0000ee, which
// is effectively unreadable on a dark background.
const BASE_16 = [
  '#1e1e28',
  '#e05561',
  '#8cc265',
  '#d18f52',
  '#4aa5f0',
  '#c162de',
  '#42b3c2',
  '#d7dae0',
  '#6b7280',
  '#ff6a72',
  '#a5e075',
  '#f0a45d',
  '#61b2ff',
  '#d373e8',
  '#56c7d6',
  '#ffffff',
] as const;

// The 6x6x6 colour cube's per-axis levels, which xterm spaces unevenly: the
// first step is large and the rest are even, so dark tones stay separable.
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A palette index as a CSS colour.
 *
 * Indices split three ways: 0–15 named, 16–231 the colour cube, 232–255 a
 * 24-step greyscale ramp. An index outside 0–255 falls back to the default
 * foreground rather than throwing — a malformed SGR should not break a render.
 */
export function paletteColor(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) return BASE_16[index] ?? null;
  if (index < 232) {
    const offset = index - 16;
    const r = CUBE_LEVELS[Math.floor(offset / 36) % 6] ?? 0;
    const g = CUBE_LEVELS[Math.floor(offset / 6) % 6] ?? 0;
    const b = CUBE_LEVELS[offset % 6] ?? 0;
    return hex(r, g, b);
  }
  // 232–255: black to white in 24 even steps, starting at 8 and rising by 10.
  const level = 8 + (index - 232) * 10;
  return hex(level, level, level);
}

/** A cell colour — index or literal — as CSS, or null to leave it to the theme. */
export function cellColor(value: number | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'number' ? paletteColor(value) : value;
}

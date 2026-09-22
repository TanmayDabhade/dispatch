import { describe, expect, it } from 'bun:test';

import { cellColor, paletteColor } from './terminalPalette';

describe('paletteColor', () => {
  it('returns a named colour for the first sixteen', () => {
    expect(paletteColor(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(paletteColor(1)).toMatch(/^#[0-9a-f]{6}$/);
    expect(paletteColor(15)).toBe('#ffffff');
  });

  it('places the colour cube on xterm’s uneven axis levels', () => {
    // 16 is the cube's origin: pure black.
    expect(paletteColor(16)).toBe('#000000');
    // 21 is the last step of the first row: maximum blue, no red or green.
    expect(paletteColor(21)).toBe('#0000ff');
    // 196 is pure red, the well-known "bright red" index.
    expect(paletteColor(196)).toBe('#ff0000');
    // 231 is the far corner: white.
    expect(paletteColor(231)).toBe('#ffffff');
  });

  it('walks the grayscale ramp in even steps', () => {
    expect(paletteColor(232)).toBe('#080808');
    expect(paletteColor(233)).toBe('#121212');
    expect(paletteColor(255)).toBe('#eeeeee');
  });

  it('is null outside the palette rather than throwing', () => {
    // A malformed SGR must not break a render.
    expect(paletteColor(-1)).toBeNull();
    expect(paletteColor(256)).toBeNull();
    expect(paletteColor(1.5)).toBeNull();
  });
});

describe('cellColor', () => {
  it('resolves an index through the palette', () => {
    expect(cellColor(196)).toBe('#ff0000');
  });

  it('passes a true-colour literal straight through', () => {
    expect(cellColor('#abcdef')).toBe('#abcdef');
  });

  it('leaves an unset colour to the theme', () => {
    expect(cellColor(null)).toBeNull();
  });
});

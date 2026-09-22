import type { PickedElement } from '@dispatch/client';
import { describe, expect, it } from 'bun:test';

import {
  designHandoffText,
  designHandoffTitle,
  interestingStyles,
} from './designHandoff';

function element(overrides: Partial<PickedElement> = {}): PickedElement {
  return {
    selector: '#save',
    tagName: 'button',
    id: 'save',
    className: 'btn primary',
    text: 'Save changes',
    outerHTML: '<button id="save" class="btn primary">Save changes</button>',
    outerHTMLTruncated: false,
    styles: {
      color: 'rgb(255, 255, 255)',
      'background-color': 'rgb(0, 100, 200)',
      opacity: '1',
      'z-index': 'auto',
      'box-shadow': 'none',
      padding: '8px 16px',
    },
    rect: { x: 12.4, y: 300.6, width: 120.2, height: 32 },
    devicePixelRatio: 2,
    url: 'http://localhost:5173/settings',
    ...overrides,
  };
}

describe('interestingStyles', () => {
  it('drops the properties that are doing nothing', () => {
    // A computed style has a value for every property whether or not the
    // author set one; the defaults bury the two that describe the problem.
    const kept = interestingStyles(element().styles);
    expect(kept.opacity).toBeUndefined();
    expect(kept['z-index']).toBeUndefined();
    expect(kept['box-shadow']).toBeUndefined();
  });

  it('keeps the ones that are', () => {
    const kept = interestingStyles(element().styles);
    expect(kept.color).toBe('rgb(255, 255, 255)');
    expect(kept['background-color']).toBe('rgb(0, 100, 200)');
    expect(kept.padding).toBe('8px 16px');
  });

  it('drops empty values', () => {
    expect(interestingStyles({ border: '', color: 'red' })).toEqual({
      color: 'red',
    });
  });

  it('keeps a non-default value of an otherwise droppable property', () => {
    expect(interestingStyles({ opacity: '0.5' }).opacity).toBe('0.5');
  });
});

describe('designHandoffText', () => {
  it('leads with what the person asked for', () => {
    // The element is context for the request, not the other way round.
    const text = designHandoffText(element(), 'This button is too dark.');
    expect(text.startsWith('This button is too dark.')).toBe(true);
  });

  it('omits the note section entirely when there is no note', () => {
    const text = designHandoffText(element(), '   ');
    expect(text.startsWith('## The element')).toBe(true);
  });

  it('names the element precisely enough to find it again', () => {
    const text = designHandoffText(element(), 'fix');
    expect(text).toContain('selector: `#save`');
    expect(text).toContain('http://localhost:5173/settings');
  });

  it('fences the markup so an agent reads it as markup', () => {
    const text = designHandoffText(element(), 'fix');
    expect(text).toContain('```html');
    expect(text).toContain('<button id="save"');
  });

  it('says so when the markup was cut short', () => {
    const text = designHandoffText(
      element({ outerHTMLTruncated: true }),
      'fix'
    );
    expect(text).toContain('truncated');
  });

  it('includes only the interesting styles', () => {
    const text = designHandoffText(element(), 'fix');
    expect(text).toContain('background-color: rgb(0, 100, 200);');
    expect(text).not.toContain('z-index');
  });

  it('leaves out the styles block when nothing survived the filter', () => {
    const text = designHandoffText(
      element({ styles: { opacity: '1', 'z-index': 'auto' } }),
      'fix'
    );
    expect(text).not.toContain('Computed styles');
  });

  it('rounds the box, since sub-pixel values help nobody', () => {
    expect(designHandoffText(element(), 'fix')).toContain(
      '120×32 at (12, 301)'
    );
  });
});

describe('designHandoffTitle', () => {
  it('prefers the id', () => {
    expect(designHandoffTitle(element())).toBe('Design: #save');
  });

  it('falls back to the text', () => {
    expect(designHandoffTitle(element({ id: null }))).toBe(
      'Design: Save changes'
    );
  });

  it('falls back to the tag when there is neither', () => {
    expect(designHandoffTitle(element({ id: null, text: '' }))).toBe(
      'Design: button'
    );
  });
});

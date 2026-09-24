import { render } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';

import { FlightNodeCard, type FlightNodeView } from './FlightNodeCard';

function view(overrides: Partial<FlightNodeView> = {}): FlightNodeView {
  return {
    id: 't-1',
    refLabel: 'ENG-1',
    title: 'Cache the index',
    state: 'review',
    glyphStatus: 'In Review',
    sentence: 'Ready for review',
    tone: 'review',
    owner: null,
    startedAt: null,
    costUsd: null,
    landing: null,
    critical: false,
    x: 0,
    y: 0,
    ...overrides,
  };
}

function renderCard(overrides: Partial<FlightNodeView> = {}) {
  return render(
    <FlightNodeCard
      {...view(overrides)}
      focused={false}
      onActivate={() => {}}
    />
  );
}

function sentence(container: HTMLElement): string {
  return (
    container.querySelector('[data-slot=flight-node-sentence]')?.textContent ??
    ''
  );
}

describe('FlightNodeCard landing', () => {
  test('a review node in the merge queue says where it is, not "Ready for review"', () => {
    const { container } = renderCard({ landing: 'verifying' });
    expect(sentence(container)).toBe('Landing · verifying');
    // The sentence already says it; the header carries no second badge.
    expect(container.querySelector('[data-slot=landing-badge]')).toBeNull();
    expect(
      container
        .querySelector('[data-slot=flight-node]')
        ?.getAttribute('aria-label')
    ).toBe('ENG-1 Cache the index: Landing · verifying');
  });

  test('any other node in the queue carries the header badge', () => {
    const { container } = renderCard({
      state: 'running',
      sentence: 'Working',
      tone: 'working',
      landing: 'queued',
    });
    expect(sentence(container)).toBe('Working');
    expect(
      container.querySelector('[data-slot=landing-badge]')?.textContent
    ).toBe('Landing');
  });

  test('a node outside the queue is unchanged', () => {
    const { container } = renderCard();
    expect(sentence(container)).toBe('Ready for review');
    expect(container.querySelector('[data-slot=landing-badge]')).toBeNull();
  });
});

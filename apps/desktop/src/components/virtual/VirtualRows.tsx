import {
  observeElementRect,
  useVirtualizer,
  type Virtualizer,
} from '@tanstack/react-virtual';
import {
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react';

import {
  indexByKey,
  pinnedRangeExtractor,
  UNMEASURED_VIEWPORT,
  viewportOrFallback,
} from '../../lib/virtualRows';
import { cn } from '@/lib/utils';

export type ScrollAlign = 'start' | 'center' | 'end' | 'auto';

/** What a list reaches for from outside: bring a row into view (a j/k move). */
export interface VirtualRowsHandle {
  scrollToIndex: (index: number, align?: ScrollAlign) => void;
  scrollToKey: (key: string, align?: ScrollAlign) => void;
}

export interface VirtualRowsProps<R> {
  rows: readonly R[];
  /** Stable per row (a task id, a header key) — measurements and React keys follow it. */
  rowKey: (row: R) => string;
  /** Pixel height before measuring; exact when `measure` is off. */
  estimateSize: (row: R) => number;
  renderRow: (row: R, index: number) => ReactNode;
  /** The element that scrolls — an ancestor the caller owns (its padding, keyboard
   * handling, ARIA role); this renders only the sized track inside it. Pass it as state
   * from a callback ref: an ancestor's ref is not attached yet when this track's first
   * layout effect runs, so a ref read here would miss it until some later render. */
  scrollElement: HTMLElement | null;
  /** Measure each mounted row for variable heights (board cards). Off, every row is
   * exactly `estimateSize` tall. */
  measure?: boolean;
  gap?: number;
  overscan?: number;
  /** This track's offset from the top of the scroll element's content — non-zero when
   * several tracks share one scroller (the board's columns under their headers). */
  scrollMargin?: number;
  /** Space a sticky header covers at the top, so `scrollToKey` never parks a row under it. */
  scrollPaddingStart?: number;
  /** Keys kept mounted however far they scroll away (see `pinnedRangeExtractor`). */
  pinnedKeys?: readonly string[];
  handleRef?: Ref<VirtualRowsHandle>;
  className?: string;
  rowClassName?: string;
}

// The stock observer, with an unmeasured (0×0) viewport windowed as a typical screen.
const observeRect: typeof observeElementRect = (instance, cb) =>
  observeElementRect(instance, (rect) => cb(viewportOrFallback(rect)));

/**
 * The shared virtual-list primitive over `@tanstack/react-virtual`: a relatively
 * positioned track as tall as every row together, with only the rows in (and just
 * around) the viewport mounted, each absolutely placed at its offset. Rows are flat — a
 * grouped list passes header rows and item rows in one array (`flattenGroups`) — and keyed
 * by `rowKey`, so a row keeps its DOM node and measured size across reorders.
 *
 * Its own component so a scroll re-renders only this track and the handful of visible
 * rows, never the view around it.
 */
export function VirtualRows<R>({
  rows,
  rowKey,
  estimateSize,
  renderRow,
  scrollElement,
  measure = false,
  gap = 0,
  overscan = 8,
  scrollMargin = 0,
  scrollPaddingStart = 0,
  pinnedKeys,
  handleRef,
  className,
  rowClassName,
}: VirtualRowsProps<R>) {
  const indexOf = useMemo(() => indexByKey(rows, rowKey), [rows, rowKey]);
  // The pinned rows' indexes as a string, so an equal-but-fresh `pinnedKeys` array never
  // hands the virtualizer a new extractor (it re-windows on every identity change).
  const pinnedSignature = (pinnedKeys ?? [])
    .map((key) => indexOf.get(key))
    .filter((index) => index !== undefined)
    .join(',');
  const rangeExtractor = useMemo(
    () =>
      pinnedRangeExtractor(
        pinnedSignature === '' ? [] : pinnedSignature.split(',').map(Number)
      ),
    [pinnedSignature]
  );
  // Stable while `rows` is, so the virtualizer's measurement memo survives a scroll.
  const getItemKey = useCallback(
    (index: number) => rowKey(rows[index]),
    [rows, rowKey]
  );
  const estimate = useCallback(
    (index: number) => estimateSize(rows[index]),
    [rows, estimateSize]
  );

  const virtualizer: Virtualizer<HTMLElement, HTMLDivElement> = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: estimate,
    getItemKey,
    overscan,
    gap,
    scrollMargin,
    scrollPaddingStart,
    rangeExtractor,
    observeElementRect: observeRect,
    initialRect: UNMEASURED_VIEWPORT,
  });

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex: (index, align = 'auto') =>
        virtualizer.scrollToIndex(index, { align }),
      scrollToKey: (key, align = 'auto') => {
        const index = indexOf.get(key);
        if (index !== undefined) virtualizer.scrollToIndex(index, { align });
      },
    }),
    [virtualizer, indexOf]
  );

  const items = virtualizer.getVirtualItems();
  return (
    <div
      data-slot="virtual-rows"
      className={cn('relative w-full shrink-0', className)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((item) => (
        <div
          key={item.key.toString()}
          data-index={item.index}
          ref={measure ? virtualizer.measureElement : undefined}
          className={cn('absolute top-0 left-0 w-full', rowClassName)}
          style={{
            transform: `translateY(${item.start - scrollMargin}px)`,
            height: measure ? undefined : item.size,
          }}
        >
          {renderRow(rows[item.index], item.index)}
        </div>
      ))}
    </div>
  );
}

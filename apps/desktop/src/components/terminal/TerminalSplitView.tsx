import type { ApiClient, TerminalInfo } from '@dispatch/client';
import { useCallback, useRef } from 'react';

import type { TerminalSubscribe } from '../../hooks/useTerminalOutput';
import type { LayoutNode, SplitDirection } from '../../lib/terminalSplits';
import { TerminalPane } from './TerminalPane';

/**
 * Lays the split tree out, one nested flex box per split.
 *
 * Flex with an explicit basis rather than a grid: the tree nests to any depth,
 * and a grid would need a track computed across the whole layout, while a flex
 * pair only has to know its own ratio.
 */

interface TerminalSplitViewProps {
  node: LayoutNode;
  client: ApiClient | null;
  terminals: TerminalInfo[];
  focusedPaneId: string | null;
  subscribe: TerminalSubscribe | null;
  onFocusPane: (paneId: string) => void;
  onAttach: (paneId: string, terminalId: string | null) => void;
  onOpenSession: (paneId: string) => void;
  onSplit: (paneId: string, direction: SplitDirection) => void;
  onClosePane: (paneId: string) => void;
  onRemoveSession: (terminalId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
}

// The grab handle between two children. Dragging it reports a ratio measured
// against the split's own box, so nesting needs no coordinate translation.
function Divider({
  direction,
  onDrag,
}: {
  direction: SplitDirection;
  onDrag: (ratio: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = ref.current?.parentElement;
      if (container == null) return;
      event.preventDefault();
      const box = container.getBoundingClientRect();
      const move = (moveEvent: PointerEvent) => {
        const ratio =
          direction === 'row'
            ? (moveEvent.clientX - box.left) / box.width
            : (moveEvent.clientY - box.top) / box.height;
        if (Number.isFinite(ratio)) onDrag(ratio);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [direction, onDrag]
  );

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      className={
        direction === 'row'
          ? 'w-1 shrink-0 cursor-col-resize hover:bg-[var(--color-ring)]'
          : 'h-1 shrink-0 cursor-row-resize hover:bg-[var(--color-ring)]'
      }
    />
  );
}

export function TerminalSplitView(props: TerminalSplitViewProps) {
  const { node } = props;

  if (node.kind === 'pane') {
    return (
      <TerminalPane
        client={props.client}
        paneId={node.id}
        terminalId={node.terminalId}
        terminals={props.terminals}
        focused={props.focusedPaneId === node.id}
        subscribe={props.subscribe}
        onFocus={() => props.onFocusPane(node.id)}
        onAttach={(terminalId) => props.onAttach(node.id, terminalId)}
        onOpenSession={() => props.onOpenSession(node.id)}
        onSplit={(direction) => props.onSplit(node.id, direction)}
        onClose={() => props.onClosePane(node.id)}
        onRemoveSession={props.onRemoveSession}
      />
    );
  }

  const [first, second] = node.children;
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 gap-0 ${
        node.direction === 'row' ? 'flex-row' : 'flex-col'
      }`}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={{
          flexBasis: `${node.ratio * 100}%`,
          flexGrow: 0,
          flexShrink: 1,
        }}
      >
        <TerminalSplitView {...props} node={first} />
      </div>
      <Divider
        direction={node.direction}
        onDrag={(ratio) => props.onResize(node.id, ratio)}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TerminalSplitView {...props} node={second} />
      </div>
    </div>
  );
}

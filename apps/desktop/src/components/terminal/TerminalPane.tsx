import type { ApiClient, TerminalInfo } from '@dispatch/client';
import {
  ChevronDown,
  Columns2,
  Plus,
  Rows2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TerminalSubscribe } from '../../hooks/useTerminalOutput';
import { useTerminalOutput } from '../../hooks/useTerminalOutput';
import { encodeKey } from '../../lib/terminalKeys';
import { TerminalCanvas } from './TerminalCanvas';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

/**
 * One pane of the terminal view: a session's screen, its keyboard, and the
 * controls that act on the pane itself.
 *
 * Keystrokes are encoded to the bytes a pty expects (see lib/terminalKeys) and
 * posted; the screen updates when the daemon reports the output, not
 * optimistically. That round trip is what makes local echo correct — the shell
 * decides what a keystroke looks like, including when it shows nothing at all,
 * as at a password prompt.
 */

interface TerminalPaneProps {
  client: ApiClient | null;
  paneId: string;
  terminalId: string | null;
  terminals: TerminalInfo[];
  focused: boolean;
  subscribe: TerminalSubscribe | null;
  onFocus: () => void;
  onAttach: (terminalId: string | null) => void;
  onOpenSession: () => void;
  onSplit: (direction: 'row' | 'column') => void;
  onClose: () => void;
  onRemoveSession: (terminalId: string) => void;
}

function stateLabel(info: TerminalInfo | null): string {
  if (info === null) return '';
  if (info.state === 'running')
    return info.pty ? 'running' : 'running (no pty)';
  if (info.state === 'orphaned') return 'from a previous daemon — read only';
  return info.exitCode === null ? 'exited' : `exited ${info.exitCode}`;
}

export function TerminalPane({
  client,
  paneId,
  terminalId,
  terminals,
  focused,
  subscribe,
  onFocus,
  onAttach,
  onOpenSession,
  onSplit,
  onClose,
  onRemoveSession,
}: TerminalPaneProps) {
  const { screen, revision, info, refresh } = useTerminalOutput(
    client,
    terminalId,
    subscribe
  );
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  // Scroll following is off while searching: jumping to the bottom on every
  // chunk is exactly wrong when the user is reading something further up.
  const [follow, setFollow] = useState(true);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const running = info?.state === 'running';

  const send = useCallback(
    async (data: string) => {
      if (client === null || terminalId === null) return;
      try {
        await client.sendTerminalInput(terminalId, data);
        // Read straight back rather than waiting for the socket: at a prompt
        // the echo is the only feedback that a key landed.
        refresh();
      } catch {
        // A write to a session that just exited is the ordinary race; the next
        // read reports the new state.
      }
    },
    [client, terminalId, refresh]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!running) return;
      const bytes = encodeKey(event);
      if (bytes === null) return;
      event.preventDefault();
      event.stopPropagation();
      void send(bytes);
    },
    [running, send]
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!running) return;
      const text = event.clipboardData.getData('text');
      if (text === '') return;
      event.preventDefault();
      void send(text);
    },
    [running, send]
  );

  useEffect(() => {
    if (focused) surfaceRef.current?.focus();
  }, [focused]);

  // Focused on open rather than through `autoFocus`: the attribute is a
  // genuine accessibility problem when a page loads with it, and this field
  // only exists because the user just asked for it.
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-md border ${
        focused ? 'border-[var(--color-ring)]' : 'border-[var(--color-border)]'
      }`}
      onMouseDown={onFocus}
      data-testid={`terminal-pane-${paneId}`}
    >
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-1">
        <div className="relative min-w-0 flex-1">
          <select
            className="w-full min-w-0 appearance-none truncate bg-transparent pr-5 text-xs outline-none"
            value={terminalId ?? ''}
            onChange={(event) =>
              onAttach(event.target.value === '' ? null : event.target.value)
            }
            aria-label="Session shown in this pane"
          >
            <option value="">No session</option>
            {terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminal.title}
                {terminal.state === 'running' ? '' : ` · ${terminal.state}`}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-0 size-3 -translate-y-1/2 opacity-60" />
        </div>
        <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
          {stateLabel(info)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="New session"
          onClick={onOpenSession}
        >
          <Plus className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Search scrollback"
          onClick={() => {
            setSearching((value) => !value);
            setFollow(searching);
          }}
        >
          <Search className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Split right"
          onClick={() => onSplit('row')}
        >
          <Columns2 className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Split down"
          onClick={() => onSplit('column')}
        >
          <Rows2 className="size-3" />
        </Button>
        {terminalId !== null && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            title="End and forget this session"
            onClick={() => onRemoveSession(terminalId)}
          >
            <Trash2 className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Close pane"
          onClick={onClose}
        >
          <X className="size-3" />
        </Button>
      </div>

      {searching && (
        <div className="border-b border-[var(--color-border)] px-2 py-1">
          <Input
            ref={searchRef}
            value={search}
            placeholder="Find in scrollback"
            className="h-7 text-xs"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      )}

      {/* The keyboard surface. `tabIndex` makes a div focusable, which is what
          lets a pane take keystrokes without an input element stealing and
          reinterpreting them. */}
      <div
        ref={surfaceRef}
        tabIndex={0}
        role="textbox"
        aria-label="Terminal"
        className="min-h-0 flex-1 outline-none"
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={onFocus}
      >
        {terminalId === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--color-muted-foreground)]">
            <span>No session in this pane.</span>
            <Button size="sm" variant="outline" onClick={onOpenSession}>
              Open a shell
            </Button>
          </div>
        ) : (
          <TerminalCanvas
            screen={screen}
            revision={revision}
            search={searching ? search : ''}
            follow={follow && !searching}
          />
        )}
      </div>
    </div>
  );
}

import type { ApiClient, TerminalInfo } from '@dispatch/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { TerminalScreen } from '../lib/terminalScreen';

/**
 * Registers interest in one session's output. Returns an unsubscribe.
 *
 * The view owns a single WebSocket and fans `terminal.output` out through this,
 * rather than every pane opening a socket of its own.
 */
export type TerminalSubscribe = (
  terminalId: string,
  onOutput: () => void
) => () => void;

// A backstop poll, in case a socket is down or an event is missed. Slow on
// purpose: the socket is the real signal and this only has to stop a pane
// getting permanently stuck, not carry the stream.
const POLL_INTERVAL_MS = 1500;

/** Base64 to bytes. `atob` yields one character per byte, not text. */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface TerminalOutputState {
  /** The emulator holding this session's screen, or null before it attaches. */
  screen: TerminalScreen | null;
  /** Bumped whenever the screen changes — the render trigger, since the
   * emulator is a mutable object React cannot diff. */
  revision: number;
  info: TerminalInfo | null;
  /** Re-reads immediately, for right after sending input. */
  refresh: () => void;
}

/**
 * Streams a session's scrollback into a `TerminalScreen`.
 *
 * Reads are cursor-based, so this catches up in one pass after the app has
 * been closed and resumes exactly where it left off — including across a
 * daemon restart, where the session comes back as `orphaned` with its output
 * intact.
 */
export function useTerminalOutput(
  client: ApiClient | null,
  terminalId: string | null,
  subscribe: TerminalSubscribe | null
): TerminalOutputState {
  const screenRef = useRef<TerminalScreen | null>(null);
  const cursorRef = useRef(0);
  // Kept across reads: a chunk boundary can fall inside a multi-byte character,
  // and a streaming decoder holds the partial sequence until the rest arrives
  // rather than emitting a replacement character.
  const decoderRef = useRef<TextDecoder | null>(null);
  const drainingRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const [info, setInfo] = useState<TerminalInfo | null>(null);

  const drain = useCallback(async () => {
    if (client === null || terminalId === null) return;
    // One drain at a time: an event arriving mid-read must not start a second
    // pass that interleaves chunks and corrupts the cursor.
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (;;) {
        const chunk = await client.fetchTerminalOutput(
          terminalId,
          cursorRef.current
        );
        const screen = screenRef.current;
        const decoder = decoderRef.current;
        if (screen === null || decoder === null) return;
        if (chunk.data !== '') {
          screen.write(
            decoder.decode(decodeBase64(chunk.data), { stream: true })
          );
        }
        cursorRef.current = chunk.next;
        setInfo((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                state: chunk.state,
                exitCode: chunk.exitCode,
                total: chunk.total,
              }
        );
        if (chunk.data !== '') setRevision((value) => value + 1);
        if (!chunk.more) return;
      }
    } catch {
      // A read that fails (daemon restarting, session removed) is retried by
      // the poll below. Surfacing it per-read would flash an error on every
      // reconnect.
    } finally {
      drainingRef.current = false;
    }
  }, [client, terminalId]);

  // Fresh emulator per session, so switching a pane never shows the previous
  // session's screen while the first read is in flight.
  useEffect(() => {
    if (terminalId === null) {
      screenRef.current = null;
      decoderRef.current = null;
      setInfo(null);
      return;
    }
    screenRef.current = new TerminalScreen();
    decoderRef.current = new TextDecoder('utf-8');
    cursorRef.current = 0;
    setRevision((value) => value + 1);
    void drain();
  }, [terminalId, drain]);

  useEffect(() => {
    if (client === null || terminalId === null) return;
    let cancelled = false;
    void client
      .fetchTerminal(terminalId)
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch(() => {
        // The session is gone; the pane renders its detached state.
      });
    return () => {
      cancelled = true;
    };
  }, [client, terminalId]);

  useEffect(() => {
    if (terminalId === null) return;
    const unsubscribe = subscribe?.(terminalId, () => void drain());
    const timer = setInterval(() => void drain(), POLL_INTERVAL_MS);
    return () => {
      unsubscribe?.();
      clearInterval(timer);
    };
  }, [terminalId, subscribe, drain]);

  const refresh = useCallback(() => void drain(), [drain]);

  return { screen: screenRef.current, revision, info, refresh };
}

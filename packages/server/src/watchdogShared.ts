// Layout of the SharedArrayBuffer the watchdog's main thread and worker share.
// Kept in its own module so the worker entry imports no daemon code.
//
//   [0, 8)    BigInt64  Date.now() at the main thread's last heartbeat
//   [8, 12)   Int32     byte length of the current label (0 while rewriting)
//   [16, 272) UTF-8     the label itself — the last blocking section entered
export const HEARTBEAT_OFFSET = 0;
export const LABEL_LENGTH_OFFSET = 8;
export const LABEL_OFFSET = 16;
export const LABEL_BYTES = 256;
export const SHARED_BUFFER_BYTES = LABEL_OFFSET + LABEL_BYTES;

// One worker thread serves every watchdog in the process (see watchdog.ts), so
// each command and report names the watchdog it belongs to by `id`.
export interface WatchdogWorkerInit {
  type: 'start';
  id: number;
  buffer: SharedArrayBuffer;
  thresholdMs: number;
  checkMs: number;
  /** Skip the stderr lines; reports are still posted back. */
  quiet: boolean;
}

// The `stop` command is sent by stop(): clear that watchdog's timer. The
// thread itself stays up for the next watchdog.
export type WatchdogCommand = WatchdogWorkerInit | { type: 'stop'; id: number };

export type WatchdogReport =
  // The worker received its init and is polling: the module resolved and
  // the thread is up, which a compiled binary missing the worker entry
  // never reaches.
  | { type: 'ready'; id: number }
  | {
      type: 'stall-ended';
      id: number;
      stalledMs: number;
      section: string;
    };

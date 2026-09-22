/**
 * Serializes keystrokes to a terminal session: one request in flight at a
 * time, with keys typed meanwhile batched into the next request. Each key is
 * otherwise its own HTTP request, and concurrent requests can land in any
 * order — which scrambles anything typed faster than one round trip.
 *
 * A failed send is dropped rather than retried: it is almost always a session
 * that just exited, which the next read reports.
 */
export function createInputQueue(
  send: (data: string) => Promise<void>
): (data: string) => void {
  let pending = '';
  let inFlight = false;

  const drain = async () => {
    inFlight = true;
    while (pending !== '') {
      const batch = pending;
      pending = '';
      try {
        await send(batch);
      } catch {
        // See above.
      }
    }
    inFlight = false;
  };

  return (data: string) => {
    pending += data;
    if (!inFlight) void drain();
  };
}

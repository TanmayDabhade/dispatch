// Who is here right now, read off live connections rather than stored.
//
// A person is present while at least one of their clients holds the event
// socket open — the desktop app, a browser tab, both. Presence is derived, not
// declared: nobody sets a status, so it cannot go stale the way a manual
// "online" flag does, and it costs nothing beyond the socket every client
// already opens.

/** One person's presence, as clients see it. */
export interface PresenceEntry {
  handle: string;
  /** Serialized ActorRef, `human:<handle>`. */
  ref: string;
  /** How many of their clients are connected. Two means app and a tab, not
   *  two people — the handle is the person. */
  connections: number;
  /** When their current stretch of presence began: the first connection
   *  after they had none. */
  since: string;
  /** Runs they dispatched that are still live, so "who is here" also answers
   *  "and what are they running". */
  runs: string[];
  /** The task they have open, or null. Declared by their client rather than
   *  derived, but it cannot outlive them: it goes when they do. */
  viewing: string | null;
}

/** The slice of a run presence needs. Kept structural so this module does
 *  not import the orchestrator. */
export interface PresenceRun {
  id: string;
  dispatchedBy?: string;
  live: boolean;
}

interface Tracked {
  ref: string;
  connections: number;
  since: string;
  viewing: string | null;
}

export class PresenceTracker {
  private readonly people = new Map<string, Tracked>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Records one client connecting as `handle`, and returns the function that
   * records it leaving. Returning the release rather than exposing a
   * disconnect(handle) makes a double-release harmless: a socket that closes
   * twice cannot drag someone's count below what their other clients hold.
   *
   * `changed` is true only when this connection made them present — the one
   * moment clients need a `presence.changed` event for. A second tab opening
   * changes nothing anyone can see.
   */
  connect(
    handle: string,
    ref: string
  ): { changed: boolean; release: () => boolean } {
    const existing = this.people.get(handle);
    if (existing === undefined) {
      this.people.set(handle, {
        ref,
        connections: 1,
        since: this.now().toISOString(),
        viewing: null,
      });
    } else {
      existing.connections += 1;
    }
    let released = false;
    return {
      changed: existing === undefined,
      // True when this release made them absent, for the same reason.
      release: () => {
        if (released) return false;
        released = true;
        const person = this.people.get(handle);
        if (person === undefined) return false;
        person.connections -= 1;
        if (person.connections > 0) return false;
        this.people.delete(handle);
        return true;
      },
    };
  }

  /**
   * Records which task someone has open, or none. Returns whether anything
   * visible changed, so the caller broadcasts only real moves.
   *
   * Someone with no open connection is not present, and focus is part of
   * presence, so it is dropped rather than held for a person nobody can see.
   * Two clients of one person (the app and a tab) share one focus — the most
   * recent — since presence is per person, not per window.
   */
  setFocus(handle: string, taskId: string | null): boolean {
    const person = this.people.get(handle);
    if (person === undefined || person.viewing === taskId) return false;
    person.viewing = taskId;
    return true;
  }

  /** Everyone present, with the live runs each dispatched. Sorted by handle so
   *  the order a surface renders is stable across refetches. */
  list(runs: readonly PresenceRun[]): PresenceEntry[] {
    return [...this.people.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([handle, person]) => ({
        handle,
        ref: person.ref,
        connections: person.connections,
        since: person.since,
        runs: runs
          .filter((r) => r.live && r.dispatchedBy === person.ref)
          .map((r) => r.id),
        viewing: person.viewing,
      }));
  }
}

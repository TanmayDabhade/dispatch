import { randomUUID } from 'node:crypto';

import type { LaunchOptions } from './session.js';
import { BrowserSession } from './session.js';

/**
 * The browsers this daemon has open.
 *
 * Held by the daemon rather than the app for the same reason terminals are: a
 * browser opened to look at a dev server should survive the app window being
 * closed, and something has to kill the processes on shutdown or every session
 * leaks a Chromium.
 */

export interface BrowserInfo {
  id: string;
  url: string;
  headless: boolean;
  startedAt: string;
  /** Set while Design Mode is armed and waiting for a click. */
  picking: boolean;
}

interface Entry {
  info: BrowserInfo;
  session: BrowserSession;
}

export class BrowserRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async launch(options: LaunchOptions = {}): Promise<BrowserInfo> {
    const id = randomUUID();
    const session = await BrowserSession.launch(id, options);
    const info: BrowserInfo = {
      id,
      url: options.url ?? 'about:blank',
      headless: options.headless === true,
      startedAt: this.now().toISOString(),
      picking: false,
    };
    this.entries.set(id, { info, session });
    return { ...info };
  }

  list(): BrowserInfo[] {
    return [...this.entries.values()]
      .map((entry) => ({ ...entry.info }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  get(id: string): BrowserInfo | null {
    const entry = this.entries.get(id);
    return entry === undefined ? null : { ...entry.info };
  }

  /** The live session, for the routes that drive it. Null for an unknown id. */
  session(id: string): BrowserSession | null {
    return this.entries.get(id)?.session ?? null;
  }

  /** Keeps the cached info in step with what the page actually shows. */
  async refreshUrl(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    try {
      entry.info.url = await entry.session.currentUrl();
    } catch {
      // A page mid-navigation can refuse to answer; the next poll gets it.
    }
  }

  setPicking(id: string, picking: boolean): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) entry.info.picking = picking;
  }

  close(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    entry.session.close();
    this.entries.delete(id);
    return true;
  }

  /** Kills every browser. Called on daemon shutdown so none are orphaned. */
  shutdown(): void {
    for (const entry of this.entries.values()) entry.session.close();
    this.entries.clear();
  }
}

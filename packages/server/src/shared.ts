import type { NetworkInterfaceInfo } from 'node:os';

// Team-local mode: one daemon a team reaches from their own browsers.
//
// Off by default and deliberately narrow. The daemon has always bound
// 127.0.0.1 and leaned on that for part of its safety — it injects its agent
// token into the page it serves, and it trusts every loopback origin. Both of
// those are fine when nothing but this machine can connect and both are holes
// the moment anything else can. So a non-loopback bind is its own mode, and
// every rule that loopback made safe is restated here for when it does not.

/** Addresses a daemon may bind. Loopback keeps today's behaviour; a wildcard
 *  opts into team-local mode. A specific interface address is refused rather
 *  than supported: it would stop binding loopback, and the CLI, the MCP server
 *  and the desktop app all reach the daemon at 127.0.0.1. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

export type BindMode = 'loopback' | 'shared';

/** Which mode a `--host` puts the daemon in, or why it cannot be used. */
export function bindModeFor(
  host: string
): { ok: true; mode: BindMode } | { ok: false; error: string } {
  if (LOOPBACK_HOSTS.has(host)) return { ok: true, mode: 'loopback' };
  if (WILDCARD_HOSTS.has(host)) return { ok: true, mode: 'shared' };
  return {
    ok: false,
    error:
      `--host ${host} is not supported: use 127.0.0.1 (this machine only) or ` +
      '0.0.0.0 (teammates on your network). A single interface address would ' +
      'stop the daemon answering on loopback, where the CLI, MCP server and ' +
      'app all reach it.',
  };
}

/** Whether a peer address is this machine. The preview proxy answers only
 *  these in shared mode — see index.ts's proxyPreview. Covers the IPv4-mapped
 *  IPv6 form Bun reports for an IPv4 peer on a dual-stack socket. */
export function isLoopbackAddress(address: string): boolean {
  const bare = address.startsWith('::ffff:') ? address.slice(7) : address;
  return bare === '::1' || bare.startsWith('127.');
}

/**
 * The origins a browser shows when it loads the app from this daemon over the
 * network: one per non-internal interface address, plus any the operator
 * names (a hostname teammates use, a reverse proxy in front).
 *
 * These are trusted in shared mode because they are the daemon's own origin —
 * a teammate's page making a same-origin request. What is NOT done is trusting
 * whatever the Host header claims: that would let a DNS-rebinding page, whose
 * Origin and Host agree by construction, count as the daemon's own.
 */
export function ownOrigins(
  port: number,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  extra: readonly string[] = []
): Set<string> {
  const origins = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const addr of entries ?? []) {
      if (addr.internal) continue;
      const host = addr.family === 'IPv6' ? `[${addr.address}]` : addr.address;
      origins.add(`http://${host}:${port}`);
    }
  }
  for (const origin of extra) {
    const trimmed = origin.trim().replace(/\/+$/, '');
    if (trimmed !== '') origins.add(trimmed);
  }
  return origins;
}

/** What a page served in shared mode is told about where it is. No token:
 *  a teammate signs in with their own, issued by `dispatch team invite`. The
 *  base URL is empty because the page talks to the daemon that served it. */
export interface SharedPageConfig {
  root: string;
  baseUrl: '';
}

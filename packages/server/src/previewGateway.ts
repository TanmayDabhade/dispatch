import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { PreviewSupervisor } from './preview.js';
import {
  previewRequestHeaders,
  previewResponseHeaders,
} from './previewHeaders.js';

// Previews for teammates on a team-local daemon.
//
// On the daemon's own origin a preview lives at /preview/<runId>/, answered
// only to the machine running it (see index.ts): it has no credential of its
// own, and serving unmerged agent code to the whole network unauthenticated is
// not on. This is the network's way in, and it differs on three counts.
//
// Its own origin. Each preview gets a listener on a port of its own, so the
// dev server's root-relative URLs (/@vite/client, /assets/…) resolve as they
// would on its own port, and the preview's script runs in an origin that is
// not the daemon's — it cannot read the daemon page's storage, and its
// requests to the daemon are cross-origin, which the cookie guard refuses.
//
// A capability, not an identity. The link carries a signed, expiring grant
// for one run: HMAC over the run and the expiry, with a secret this daemon
// mints at boot and never writes down. It proves the holder was handed the
// link by someone signed in — the API only returns it to an authenticated
// caller — without the dev server ever seeing who.
//
// Traded for a cookie on first load. An iframe cannot attach a credential to
// every script, stylesheet and image it loads, so the grant is exchanged for
// an HttpOnly cookie named after this port (cookies are per host, not per
// port) and the URL is redirected clean. The cookie and every other daemon cookie are stripped
// before anything reaches the dev server — see previewHeaders.ts.

/** How long a link grants access. Re-issued whenever the app asks for the
 *  preview, so an open tab keeps working; a link pasted somewhere stops. */
const GRANT_TTL_MS = 60 * 60 * 1000;

const GRANT_PARAM = 'dispatch_preview';

interface Listener {
  port: number;
  stop: () => void;
}

interface GatewayOptions {
  previews: PreviewSupervisor;
  /** Given when the daemon serves teammates over HTTPS: a preview framed in
   *  an https page must be https too, or the browser blocks it as mixed. */
  tls?: { cert: ReturnType<typeof Bun.file>; key: ReturnType<typeof Bun.file> };
  now?: () => Date;
  /** Injected so tests can sign with a known key. */
  secret?: Buffer;
}

export class PreviewGateway {
  private readonly listeners = new Map<string, Listener>();
  private readonly secret: Buffer;
  private readonly now: () => Date;

  constructor(private readonly opts: GatewayOptions) {
    this.secret = opts.secret ?? randomBytes(32);
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * The link a teammate's app frames for this run's preview, or null when
   * the preview is not up. `host` is the name the caller reached the daemon
   * by, so the link works from where they are; it decides nothing about
   * access, which the signed grant alone does.
   */
  link(runId: string, host: string): string | null {
    const preview = this.opts.previews.get(runId);
    if (preview?.status !== 'ready') return null;
    const port = this.listen(runId);
    const scheme = this.opts.tls === undefined ? 'http' : 'https';
    const bracketed = host.includes(':') ? `[${host}]` : host;
    return `${scheme}://${bracketed}:${port}/?${GRANT_PARAM}=${this.grant(runId)}`;
  }

  /** Closes the listener for one run. Wired to the supervisor's onStop. */
  close(runId: string): void {
    this.listeners.get(runId)?.stop();
    this.listeners.delete(runId);
  }

  closeAll(): void {
    for (const runId of [...this.listeners.keys()]) this.close(runId);
  }

  /** `<expiry ms>.<signature>`, base64url. */
  private grant(runId: string): string {
    const expires = this.now().getTime() + GRANT_TTL_MS;
    return `${expires}.${this.sign(runId, expires)}`;
  }

  private sign(runId: string, expires: number): string {
    return createHmac('sha256', this.secret)
      .update(`${runId}.${expires}`)
      .digest('base64url');
  }

  /** Whether a presented grant is this daemon's, for this run, and current.
   *  The signature is compared in constant time; the run is not in the grant
   *  at all, so a grant for one preview is simply wrong for any other. */
  private valid(runId: string, grant: string | null): boolean {
    if (grant === null) return false;
    const dot = grant.indexOf('.');
    if (dot === -1) return false;
    const expires = Number(grant.slice(0, dot));
    if (!Number.isFinite(expires) || this.now().getTime() >= expires) {
      return false;
    }
    const given = Buffer.from(grant.slice(dot + 1));
    const wanted = Buffer.from(this.sign(runId, expires));
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  }

  /** The port serving this run's preview, opening it on first use. */
  private listen(runId: string): number {
    const existing = this.listeners.get(runId);
    if (existing !== undefined) return existing.port;
    // The cookie is named after the port, which is only known once bound;
    // no request can arrive before this function returns, so the handler
    // reads it from the listener record rather than a variable it closes
    // over before assignment.
    const record: Listener & { cookieName: string } = {
      port: 0,
      cookieName: '',
      stop: () => {},
    };
    const server = Bun.serve({
      hostname: '0.0.0.0',
      port: 0,
      ...(this.opts.tls === undefined ? {} : { tls: this.opts.tls }),
      fetch: (req) => this.handle(runId, req, record.cookieName),
    });
    record.port = server.port ?? 0;
    record.cookieName = `dispatch_preview_${record.port}`;
    record.stop = () => void server.stop(true);
    this.listeners.set(runId, record);
    return record.port;
  }

  private async handle(
    runId: string,
    req: Request,
    cookieName: string
  ): Promise<Response> {
    const url = new URL(req.url);

    // First load: trade the link's grant for this port's cookie, and send the
    // browser on to the same page without it, so the grant is not left in
    // the address bar or handed to the dev server as a query parameter.
    const offered = url.searchParams.get(GRANT_PARAM);
    if (offered !== null) {
      if (!this.valid(runId, offered)) return expired();
      url.searchParams.delete(GRANT_PARAM);
      const expires = Number(offered.slice(0, offered.indexOf('.')));
      const maxAge = Math.max(
        0,
        Math.floor((expires - this.now().getTime()) / 1000)
      );
      return new Response(null, {
        status: 303,
        headers: {
          location: `${url.pathname}${url.search}`,
          'set-cookie': [
            `${cookieName}=${offered}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${maxAge}`,
            ...(this.opts.tls === undefined ? [] : ['Secure']),
          ].join('; '),
        },
      });
    }

    if (!this.valid(runId, cookieFrom(req, cookieName))) return expired();

    const preview = this.opts.previews.get(runId);
    if (preview?.status !== 'ready') {
      return new Response(`preview is ${preview?.status ?? 'stopped'}`, {
        status: 503,
      });
    }
    this.opts.previews.touch(runId);
    try {
      const upstream = await fetch(
        new URL(
          `${url.pathname}${url.search}`,
          `http://127.0.0.1:${preview.port}`
        ),
        {
          method: req.method,
          headers: previewRequestHeaders(req.headers),
          body: req.body,
          redirect: 'manual',
          ...{ duplex: 'half' },
        }
      );
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: previewResponseHeaders(upstream.headers),
      });
    } catch {
      return new Response('preview is not reachable', { status: 502 });
    }
  }
}

function cookieFrom(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/** What a stale, forged or missing grant gets: a sentence pointing back at
 *  the app, which issues a fresh link every time it shows the preview. */
function expired(): Response {
  return new Response(
    'This preview link has expired or is not valid here. Open the preview from the task in Dispatch to get a fresh one.',
    { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } }
  );
}

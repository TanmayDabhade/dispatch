// A teammate's browser session on a team-local daemon, held in a cookie.
//
// The page used to keep the teammate's token in localStorage and send it as a
// bearer header. Anything that runs script on the page can read localStorage,
// so one injected script — a malicious dependency, a rendered task body that
// slipped past sanitizing — walked off with a credential that works from any
// machine until it is revoked. An HttpOnly cookie is sent by the browser and
// readable by nobody's script.
//
// The cookie's value is the token itself rather than a separate session id, so
// revoking or expiring the token ends every session it opened with no second
// table to keep in step.
//
// A cookie is sent automatically, which is the CSRF problem bearer headers
// never had. So it only counts when the browser shows the request came from
// the daemon's own page, in this order:
//
// 1. `Sec-Fetch-Site`, when present, decides. The browser sets it, page script
//    cannot, and it reads `cross-site` for a sandboxed preview iframe (opaque
//    origin) as well as for any other site.
// 2. Otherwise `Origin` must be one of the daemon's own origins exactly.
// 3. With neither, only a read-only method is accepted.
//
// Steps 2 and 3 are not a fallback for old browsers — they are the common case.
// Chromium sends fetch metadata only to potentially trustworthy origins (HTTPS
// or loopback), so a teammate on http://192.168.1.5:4771 sends none, and a
// same-origin GET carries no Origin either. Measured against Chromium on both a
// LAN address and loopback before this was written; see session.test.ts.
//
// Step 3 is safe because of what else a browser does. A cross-origin fetch
// always carries Origin, a state change always does, and the cookie is
// SameSite=Strict so no cross-site request carries it at all. What is left
// without either header is a same-site page's no-cors GET (an <img>, a
// <script>), whose response it cannot read — and reads here change nothing.

export const SESSION_COOKIE = 'dispatch_session';

/** Parses one cookie out of a Cookie header, or null. */
function cookieValue(header: string | null, name: string): string | null {
  if (header === null) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

const READ_ONLY = new Set(['GET', 'HEAD']);

/** Whether the browser shows this request came from the page the daemon
 *  served. See the header comment for the three steps and why each holds. */
function fromOwnPage(
  req: Request,
  sessionOrigins: ReadonlySet<string>
): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = req.headers.get('origin');
  if (origin !== null) return sessionOrigins.has(origin);
  return READ_ONLY.has(req.method);
}

/** The session token a request carries, or null when it has none or the
 *  cookie arrived from anywhere but the daemon's own page. `sessionOrigins`
 *  is every origin the daemon itself is served from (see sessionOrigins). */
export function sessionToken(
  req: Request,
  sessionOrigins: ReadonlySet<string>
): string | null {
  const token = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  if (token === null) return null;
  return fromOwnPage(req, sessionOrigins) ? token : null;
}

/**
 * The origins a session cookie may be used from: the daemon's own network
 * origins plus its own loopback origin on its own port — someone at the
 * machine running a shared daemon signs in from http://127.0.0.1:<port> too.
 *
 * Its own port only. Bearer requests trust every loopback origin, but a cookie
 * from http://127.0.0.1:5173 would be any local dev server riding a session.
 */
export function sessionOrigins(
  port: number,
  ownOrigins: ReadonlySet<string>
): string[] {
  return [
    ...ownOrigins,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ];
}

/** Whether the request reached the daemon over TLS, directly or through a
 *  proxy that says so. Only decides the cookie's `Secure` flag, which is why
 *  trusting the forwarded header costs nothing: a lie makes the cookie
 *  stricter, never looser. */
function overTls(req: Request): boolean {
  return (
    new URL(req.url).protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https'
  );
}

/** Set-Cookie for a new session. `Strict` keeps it off every cross-site
 *  navigation; `Path=/` because the WebSocket and the API both need it. */
export function sessionCookie(req: Request, token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(overTls(req) ? ['Secure'] : []),
  ].join('; ');
}

/** Set-Cookie that ends the session in this browser. */
export function clearedSessionCookie(req: Request): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    ...(overTls(req) ? ['Secure'] : []),
  ].join('; ');
}

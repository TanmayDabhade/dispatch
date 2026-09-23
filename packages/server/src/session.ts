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
// never had. So it only counts when the browser itself says the request came
// from this origin: `Sec-Fetch-Site` is set by the browser, cannot be written by
// page script, and reads `cross-site` for a sandboxed preview iframe (opaque
// origin) as well as for any other site. A browser too old to send it falls
// back to an exact match against the daemon's own network origins.

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

/** Whether the browser vouches that this request came from the page the
 *  daemon served. See the header comment for why a cookie needs this. */
function fromOwnPage(req: Request, ownOrigins: ReadonlySet<string>): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = req.headers.get('origin');
  return origin !== null && ownOrigins.has(origin);
}

/** The session token a request carries, or null when it has none or the
 *  cookie arrived from anywhere but the daemon's own page. */
export function sessionToken(
  req: Request,
  ownOrigins: ReadonlySet<string>
): string | null {
  const token = cookieValue(req.headers.get('cookie'), SESSION_COOKIE);
  if (token === null) return null;
  return fromOwnPage(req, ownOrigins) ? token : null;
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

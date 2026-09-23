// Which headers cross the preview proxy, in each direction.
//
// A preview is a dev server running out of a run's worktree — code an agent
// just wrote. The proxy sits between it and a browser that holds the daemon's
// credentials, so it must pass through what a page needs to render and
// nothing that would let that code act as, or unseat, the person viewing it.

// Hop-by-hop headers, which belong to one connection and must not be
// forwarded to or from an upstream (RFC 9110 7.6.1). Forwarding
// `connection`/`upgrade` in particular makes Bun's fetch reject the request.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Credentials the browser attaches for the daemon, never for the preview.
// The iframe's own navigation is a same-origin request from the daemon's
// page, so a teammate's session cookie rides it; forwarded, the dev server
// would receive a working token for the person looking at it.
const REQUEST_CREDENTIALS = new Set(['cookie', 'authorization']);

// Cookies are scoped to a host, not a port, so a Set-Cookie from the preview
// lands in the daemon's cookie jar too — where a `dispatch_session` of the
// dev server's choosing would replace the viewer's own.
const RESPONSE_CREDENTIALS = new Set(['set-cookie']);

function without(headers: Headers, drop: ReadonlySet<string>): Headers {
  const copy = new Headers();
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (!HOP_BY_HOP.has(name) && !drop.has(name)) copy.append(key, value);
  });
  return copy;
}

/** A browser's request headers, as the dev server may see them. */
export function previewRequestHeaders(headers: Headers): Headers {
  return without(headers, REQUEST_CREDENTIALS);
}

/** The dev server's response headers, as the browser may see them. */
export function previewResponseHeaders(headers: Headers): Headers {
  return without(headers, RESPONSE_CREDENTIALS);
}

import type { ApiContext } from '../api.js';
import { BrowserLaunchError } from '../browser/session.js';
import { errorResponse, jsonResponse, readJsonBody } from './http.js';

/**
 * The routes under /api/browser — open a Chromium the daemon drives, script
 * it, and pick an element out of it for Design Mode.
 *
 * All of it is decide-tier, for the same reason the terminal routes are:
 * `evaluate` runs arbitrary JavaScript in a browser holding the user's own
 * session cookies, which is at least as much authority as a shell. An agent
 * holding the on-disk token must not reach it.
 */

type BrowserRouteContext = Pick<ApiContext, 'browsers'>;

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function readDimension(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : undefined;
}

export async function launchBrowser(
  req: Request,
  ctx: BrowserRouteContext
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;

  const url = readString(body, 'url');
  const width = readDimension(body.width);
  const height = readDimension(body.height);
  try {
    return jsonResponse(
      await ctx.browsers.launch({
        ...(url === null ? {} : { url }),
        ...(body.headless === true ? { headless: true } : {}),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
      }),
      201
    );
  } catch (err) {
    if (err instanceof BrowserLaunchError) {
      // A missing browser is a setup problem the user can fix, not a bug —
      // 409 rather than 500, with the remedy in the message.
      return errorResponse(409, err.message);
    }
    throw err;
  }
}

/** Runs `action` against a session, turning an unknown id into a 404. */
async function withSession(
  ctx: BrowserRouteContext,
  id: string,
  action: (
    session: NonNullable<ReturnType<ApiContext['browsers']['session']>>
  ) => Promise<Response>
): Promise<Response> {
  const session = ctx.browsers.session(id);
  if (session === null) return errorResponse(404, `no browser ${id}`);
  try {
    return await action(session);
  } catch (err) {
    // A page that navigated away mid-command, a selector that matched
    // nothing, a tab that crashed: all of it is a bad request against the
    // page's current state rather than a daemon failure.
    return errorResponse(400, err instanceof Error ? err.message : String(err));
  }
}

export async function navigateBrowser(
  req: Request,
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const url = readString(parsed.value as Record<string, unknown>, 'url');
  if (url === null) return errorResponse(400, 'url is required');
  return withSession(ctx, id, async (session) => {
    await session.navigate(url);
    await ctx.browsers.refreshUrl(id);
    return jsonResponse(ctx.browsers.get(id));
  });
}

export async function clickInBrowser(
  req: Request,
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const selector = readString(
    parsed.value as Record<string, unknown>,
    'selector'
  );
  if (selector === null) return errorResponse(400, 'selector is required');
  return withSession(ctx, id, async (session) => {
    await session.click(selector);
    return jsonResponse({ ok: true });
  });
}

export async function fillInBrowser(
  req: Request,
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;
  const selector = readString(body, 'selector');
  if (selector === null) return errorResponse(400, 'selector is required');
  if (typeof body.value !== 'string') {
    return errorResponse(400, 'value must be a string');
  }
  const value = body.value;
  return withSession(ctx, id, async (session) => {
    await session.fill(selector, value);
    return jsonResponse({ ok: true });
  });
}

export function readBrowserText(
  ctx: BrowserRouteContext,
  id: string,
  selector: string | null
): Promise<Response> {
  if (selector === null || selector === '') {
    return Promise.resolve(errorResponse(400, 'selector is required'));
  }
  return withSession(ctx, id, async (session) => {
    const text = await session.textOf(selector);
    return text === null
      ? errorResponse(404, `no element matches ${selector}`)
      : jsonResponse({ selector, text });
  });
}

export async function evaluateInBrowser(
  req: Request,
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const expression = readString(
    parsed.value as Record<string, unknown>,
    'expression'
  );
  if (expression === null) return errorResponse(400, 'expression is required');
  return withSession(ctx, id, async (session) => {
    return jsonResponse({ value: await session.evaluate(expression) });
  });
}

export function screenshotBrowser(
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  return withSession(ctx, id, async (session) => {
    // Base64 in JSON rather than image bytes: the caller is usually putting it
    // in a prompt or an `img` src, and both want it encoded anyway.
    return jsonResponse({ screenshot: await session.screenshot() });
  });
}

/** Arms Design Mode. The next click in the page is captured, not delivered. */
export function startBrowserPick(
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  return withSession(ctx, id, async (session) => {
    await session.startPicking();
    ctx.browsers.setPicking(id, true);
    return jsonResponse({ picking: true });
  });
}

/** Polled by the UI while a pick is armed. */
export function readBrowserPick(
  ctx: BrowserRouteContext,
  id: string
): Promise<Response> {
  return withSession(ctx, id, async (session) => {
    const outcome = await session.pickResult();
    if (outcome.state !== 'waiting') ctx.browsers.setPicking(id, false);
    return jsonResponse(outcome);
  });
}

export function closeBrowser(ctx: BrowserRouteContext, id: string): Response {
  if (!ctx.browsers.close(id)) return errorResponse(404, `no browser ${id}`);
  return jsonResponse({ ok: true });
}

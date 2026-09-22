import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { ApiContext } from '../api.js';
import { worktreePath, worktreesDir } from '../orchestrator/paths.js';
import { errorResponse, jsonResponse, readJsonBody } from './http.js';

// The routes under /api/terminals — create a shell session, read its output
// from a byte cursor, type into it, resize it, close it.
//
// Every one of these sits on the `decide` tier (see DECIDE_TIER_ROUTES in
// api.ts). That is not incidental: a terminal is arbitrary command execution,
// so putting it on the `request` tier would hand every agent holding the
// on-disk agent token a way around the scope, floor and approval machinery
// that the rest of the daemon spends its time enforcing. The human's app
// token is never written to disk, which is exactly the property this needs.

type TerminalRouteContext = Pick<ApiContext, 'rootDir' | 'terminals'>;

// How much output one read returns. A client resuming a long-idle session
// catches up over several requests rather than pulling megabytes into one
// response body.
const MAX_READ_BYTES = 256 * 1024;

/**
 * Resolves the directory a new session should start in.
 *
 * A caller names either a run (its worktree) or a path, and a path is only
 * accepted inside the project or inside the worktree root. The check is not
 * about the human's authority — they hold the app token and could run a shell
 * themselves — it is about keeping a session anchored to something the app can
 * label and clean up, so a stray `..` does not silently open a terminal in
 * someone's home directory under a project's name.
 */
export function resolveTerminalCwd(
  rootDir: string,
  spec: { runId?: unknown; cwd?: unknown }
):
  | { ok: true; cwd: string; runId: string | null }
  | { ok: false; message: string } {
  if (typeof spec.runId === 'string' && spec.runId !== '') {
    const path = worktreePath(rootDir, spec.runId);
    if (!existsSync(path)) {
      return {
        ok: false,
        message: `run ${spec.runId} has no worktree on disk`,
      };
    }
    return { ok: true, cwd: path, runId: spec.runId };
  }
  if (spec.cwd === undefined || spec.cwd === null || spec.cwd === '') {
    return { ok: true, cwd: rootDir, runId: null };
  }
  if (typeof spec.cwd !== 'string') {
    return { ok: false, message: 'cwd must be a string' };
  }
  const path = resolve(rootDir, spec.cwd);
  const root = resolve(rootDir);
  const worktrees = resolve(worktreesDir(rootDir));
  const inside = (parent: string): boolean =>
    path === parent || path.startsWith(parent + sep);
  if (!inside(root) && !inside(worktrees)) {
    return {
      ok: false,
      message: 'cwd must be inside the project or one of its worktrees',
    };
  }
  if (!existsSync(path))
    return { ok: false, message: `no such directory: ${path}` };
  return { ok: true, cwd: path, runId: null };
}

// A command is a list of strings or nothing at all (meaning "the login
// shell"). An empty list is treated as absent rather than rejected, since that
// is what a UI sends when its command field is blank.
function readCommand(
  raw: unknown
): { ok: true; command?: string[] } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true };
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
    return { ok: false };
  }
  return raw.length === 0 ? { ok: true } : { ok: true, command: raw };
}

function readDimension(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : undefined;
}

export async function createTerminal(
  req: Request,
  ctx: TerminalRouteContext
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;

  const where = resolveTerminalCwd(ctx.rootDir, body);
  if (!where.ok) return errorResponse(400, where.message);

  const command = readCommand(body.command);
  if (!command.ok)
    return errorResponse(400, 'command must be a list of strings');

  const title = body.title;
  if (title !== undefined && typeof title !== 'string') {
    return errorResponse(400, 'title must be a string');
  }

  return jsonResponse(
    ctx.terminals.create({
      cwd: where.cwd,
      runId: where.runId,
      ...(command.command === undefined ? {} : { command: command.command }),
      ...(title === undefined ? {} : { title }),
      ...(readDimension(body.cols) === undefined
        ? {}
        : { cols: readDimension(body.cols) }),
      ...(readDimension(body.rows) === undefined
        ? {}
        : { rows: readDimension(body.rows) }),
    }),
    201
  );
}

/**
 * `GET /api/terminals/:id/output?since=N` — the scrollback after byte N.
 *
 * `more` in the reply is what lets a client drain a backlog without guessing:
 * it means the read was capped and another request will return the rest
 * immediately, rather than waiting for new output.
 */
export function readTerminalOutput(
  ctx: TerminalRouteContext,
  id: string,
  sinceParam: string | null
): Response {
  const raw = sinceParam === null ? 0 : Number(sinceParam);
  const since = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  const result = ctx.terminals.read(id, since);
  if (result === null) return errorResponse(404, `no terminal ${id}`);

  // Cap in decoded bytes, not base64 characters, so `next` stays a real cursor.
  const decoded = Buffer.from(result.data, 'base64');
  if (decoded.length <= MAX_READ_BYTES) {
    return jsonResponse({ ...result, next: result.total, more: false });
  }
  const capped = decoded.subarray(0, MAX_READ_BYTES);
  return jsonResponse({
    ...result,
    data: capped.toString('base64'),
    next: result.since + MAX_READ_BYTES,
    more: true,
  });
}

export async function writeTerminalInput(
  req: Request,
  ctx: TerminalRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const data = (parsed.value as Record<string, unknown>).data;
  if (typeof data !== 'string')
    return errorResponse(400, 'data must be a string');
  if (ctx.terminals.get(id) === null)
    return errorResponse(404, `no terminal ${id}`);
  if (!ctx.terminals.write(id, data)) {
    // The session exists but nothing is on the other end — it exited, or this
    // daemon inherited it from a previous process (`orphaned`). Saying so is
    // more useful than a 404 the client would read as "that id is wrong".
    return errorResponse(409, 'terminal is not running');
  }
  return jsonResponse({ ok: true });
}

export async function resizeTerminal(
  req: Request,
  ctx: TerminalRouteContext,
  id: string
): Promise<Response> {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;
  const cols = readDimension(body.cols);
  const rows = readDimension(body.rows);
  if (cols === undefined || rows === undefined) {
    return errorResponse(400, 'cols and rows must be positive numbers');
  }
  if (!ctx.terminals.resize(id, cols, rows)) {
    return errorResponse(404, `no terminal ${id}`);
  }
  return jsonResponse(ctx.terminals.get(id));
}

export function closeTerminal(ctx: TerminalRouteContext, id: string): Response {
  if (!ctx.terminals.close(id)) return errorResponse(404, `no terminal ${id}`);
  return jsonResponse({ ok: true });
}

export function deleteTerminal(
  ctx: TerminalRouteContext,
  id: string
): Response {
  if (!ctx.terminals.remove(id)) return errorResponse(404, `no terminal ${id}`);
  return jsonResponse({ ok: true });
}

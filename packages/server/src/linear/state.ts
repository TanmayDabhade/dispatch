import type { FieldBase, LinearEntity, StatusRoles } from '@dispatch/core';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One record this sync wrote, and the `updatedAt` the mutation returned for it. */
export interface EchoRecord {
  issueId: string;
  updatedAt: string;
  recordedAt: string;
}

/** Display-only data for a linked record. The UUID stays the join key; this is what a chip shows. */
export interface LinearIssueLink {
  identifier: string;
  url: string;
}

/** A task's per-field base, each side's hashes joined in `baseFields` order. */
interface EncodedBase {
  e: LinearEntity;
  l: string;
  r: string;
}

/** A local comment's Linear twin: [remote id, task id, body hash at last sync]. */
export type CommentLink = [string, string, string];

/** One field both sides changed, and which side's edit was kept. */
export interface ConflictRecord {
  taskId: string;
  field: string;
  kept: 'local' | 'remote';
  at: string;
}

/** A registered Linear webhook. The secret signs every delivery. */
export interface WebhookRecord {
  id: string;
  url: string;
  secret: string;
  teamId: string;
  createdAt: string;
}

export interface LinearSyncState {
  /** High-water mark for the issue and container pulls; null until the first pull. */
  cursor: string | null;
  /** High-water mark for the comment pull. */
  commentCursor: string | null;
  /** Set once the first sync has established the link, gating automatic issue creation. */
  bootstrappedAt: string | null;
  /** Task id -> the `updated` value the sync has accounted for. Absent means outstanding. */
  pushed: Record<string, string>;
  /** Legacy retry queue, read once by the fold below and then dropped. */
  pushRetry?: string[];
  /** Watermark written by versions predating `pushed`; folded into it once, then cleared. */
  lastPushAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  echoes: EchoRecord[];
  /** Record UUID -> its display identifier and URL, for clients that only hold `external`. */
  links: Record<string, LinearIssueLink>;
  /** Task id -> its field-level merge base. */
  bases: Record<string, EncodedBase>;
  /** Field order each entity's bases were encoded in. */
  baseFields: Partial<Record<LinearEntity, string[]>>;
  /** Local comment id -> its Linear twin. */
  comments: Record<string, CommentLink>;
  /** Task id -> local comment ids changed since their last push. */
  pendingComments: Record<string, string[]>;
  /** Workflow state id -> the status name last generated for it. */
  stateNames: Record<string, string>;
  /** The roles the last generation defaulted to; a config role differing is an override. */
  generatedRoles: StatusRoles | null;
  webhook: WebhookRecord | null;
  webhookError: string | null;
  lastWebhookAt: string | null;
  /** The most recent field conflicts, newest last. */
  conflicts: ConflictRecord[];
  conflictTotal: number;
  /** Issue id -> the task it was linked to before it left the team. */
  movedOut: Record<string, string>;
  /** When linked issues were last checked for team moves and deletions. */
  lastAuditAt: string | null;
}

// Sync state is user-level, not project-level: `.dispatch/` is committed to the
// user's repo, so a cursor there would land in their git history.
function stateHome(): string {
  const home = process.env.DISPATCH_HOME;
  return home !== undefined && home !== '' ? home : homedir();
}

/** `~/.dispatch/linear/<hash of rootDir>.json`, keyed the same way daemon files are. */
function linearStatePath(rootDir: string): string {
  const key = createHash('sha256').update(rootDir).digest('hex').slice(0, 12);
  return join(stateHome(), '.dispatch', 'linear', `${key}.json`);
}

export function emptyLinearState(): LinearSyncState {
  return {
    cursor: null,
    commentCursor: null,
    bootstrappedAt: null,
    pushed: {},
    lastPushAt: null,
    lastSyncAt: null,
    lastError: null,
    echoes: [],
    links: {},
    bases: {},
    baseFields: {},
    comments: {},
    pendingComments: {},
    stateNames: {},
    generatedRoles: null,
    webhook: null,
    webhookError: null,
    lastWebhookAt: null,
    conflicts: [],
    conflictTotal: 0,
    movedOut: {},
    lastAuditAt: null,
  };
}

// A missing or corrupt file reads as a fresh state, which re-establishes the link from
// scratch — a pass that reconciles nothing and pushes nothing.
export function readLinearState(rootDir: string): LinearSyncState {
  const path = linearStatePath(rootDir);
  if (!existsSync(path)) return emptyLinearState();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as
      | Partial<LinearSyncState>
      | undefined;
    return { ...emptyLinearState(), ...(parsed ?? {}) };
  } catch {
    return emptyLinearState();
  }
}

// Owner-only: the file carries the webhook's signing secret.
export function writeLinearState(
  rootDir: string,
  state: LinearSyncState
): void {
  const path = linearStatePath(rootDir);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const MIN_ECHO_TTL_MS = 60 * 60 * 1000;

// An echo only has to survive until the pull that would re-apply it, so the TTL
// tracks the poll interval — a floor of an hour, and never fewer than 3 polls.
export function echoTtlMs(intervalSec: number): number {
  return Math.max(MIN_ECHO_TTL_MS, intervalSec * 3 * 1000);
}

// Drops records past the TTL so the file cannot grow without bound, keeping the
// most recent ones when a single pass writes an unusual number of records.
export function pruneEchoes(
  echoes: EchoRecord[],
  now: number,
  ttlMs: number = MIN_ECHO_TTL_MS
): EchoRecord[] {
  return echoes
    .filter((e) => now - Date.parse(e.recordedAt) < ttlMs)
    .slice(-2000);
}

const CONFLICTS_KEPT = 50;

/** Records field conflicts, keeping the newest few and a running total. */
export function recordConflicts(
  state: LinearSyncState,
  conflicts: ConflictRecord[]
): void {
  if (conflicts.length === 0) return;
  state.conflicts = [...state.conflicts, ...conflicts].slice(-CONFLICTS_KEPT);
  state.conflictTotal += conflicts.length;
}

/** A task's decoded merge base, or null when it has none for this entity. */
export function readBase(
  state: LinearSyncState,
  taskId: string,
  entity: LinearEntity
): FieldBase | null {
  const encoded = state.bases[taskId];
  const fields = state.baseFields[entity];
  if (encoded === undefined || encoded.e !== entity || fields === undefined) {
    return null;
  }
  const decode = (joined: string) => {
    const out: Record<string, string> = {};
    joined.split('.').forEach((hash, i) => {
      const field = fields[i];
      if (field !== undefined && hash !== '') out[field] = hash;
    });
    return out;
  };
  return { local: decode(encoded.l), remote: decode(encoded.r) };
}

/**
 * Stores a task's merge base compactly: one string per side, hashes in the
 * entity's current field order. A field order that changed since the stored
 * bases were written re-encodes them first, so no base is misread.
 */
export function writeBase(
  state: LinearSyncState,
  taskId: string,
  entity: LinearEntity,
  fields: readonly string[],
  base: FieldBase
): void {
  const stored = state.baseFields[entity];
  if (stored === undefined || stored.join(',') !== fields.join(',')) {
    const previous = Object.keys(state.bases).map(
      (id) => [id, readBase(state, id, entity)] as const
    );
    state.baseFields[entity] = [...fields];
    for (const [id, old] of previous) {
      if (old !== null) writeBase(state, id, entity, fields, old);
    }
  }
  const encode = (hashes: Record<string, string>) =>
    fields.map((f) => hashes[f] ?? '').join('.');
  state.bases[taskId] = {
    e: entity,
    l: encode(base.local),
    r: encode(base.remote),
  };
}

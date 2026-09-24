import {
  clearProjectCredential,
  DEFAULT_LINEAR,
  isOutstanding,
  loadConfig,
  parseLinearExternal,
  resolveLinearApiKey,
  writeProjectCredential,
} from '@dispatch/core';
import type {
  CommentStorePort,
  CredentialSource,
  DispatchConfig,
  LinearComment,
  LinearConfig,
  LinearInitiative,
  LinearIssue,
  LinearLabel,
  LinearProject,
  LinearProjectMilestone,
  LinearUser,
  TaskDoc,
  TaskStorePort,
} from '@dispatch/core';

import type { TaskCache } from '../cache.js';
import type { EventBus } from '../events.js';
import { TaskChangeBatch } from './batch.js';
import type {
  LinearClient,
  LinearFailure,
  LinearPage,
  LinearWorkspace,
} from './client.js';
import { HttpLinearClient } from './client.js';
import { CommentSync } from './comments.js';
import type {
  LinearSyncSummary,
  ReconcileMode,
  RemoteRecord,
} from './reconcile.js';
import { emptySummary, LinearPass } from './reconcile.js';
import type {
  ConflictRecord,
  LinearIssueLink,
  LinearSyncState,
} from './state.js';
import {
  echoTtlMs,
  pruneEchoes,
  readLinearState,
  writeLinearState,
} from './state.js';
import type { PassContext } from './workspace.js';
import {
  buildContext,
  refreshPeople,
  regenerateStatuses,
  syncPeople,
} from './workspace.js';

export type { LinearSyncSummary } from './reconcile.js';

/** Where a long pass (an import) has got to. `total` is null while unknown. */
export interface LinearProgress {
  phase: 'containers' | 'issues' | 'applying';
  done: number;
  total: number | null;
}

export interface LinearStatus {
  enabled: boolean;
  connected: boolean;
  keySource: CredentialSource;
  teamId: string | null;
  direction: LinearConfig['direction'];
  intervalSec: number;
  statusMap: Record<string, string>;
  cursor: string | null;
  bootstrappedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastSummary: LinearSyncSummary | null;
  syncing: boolean;
  /** Field conflicts resolved since the link, and the latest few. */
  conflicts: { total: number; recent: ConflictRecord[] };
  /** Set while an import or other long pass is running. */
  progress: LinearProgress | null;
}

export interface LinearSyncDeps {
  rootDir: string;
  store: TaskStorePort;
  cache: TaskCache;
  events: EventBus;
  /** Task comments; absent, comments are not synced. */
  comments?: CommentStorePort;
  /** A ready-made client, bypassing credential lookup entirely. Tests inject a fake here. */
  client?: LinearClient;
  /** Overridden in tests that need a real client against a stub endpoint. */
  createClient?: (apiKey: string) => LinearClient;
  /** Debounce for the push triggered by a local task change. */
  pushDebounceMs?: number;
  /** The local human's person ref; the API key's Linear user maps to it. */
  localHumanRef?: string;
}

// 'both' is the ordinary pass; 'push' is the debounced local-edit trigger;
// 'import' is the explicit "bring existing Linear issues down" action.
type SyncMode = 'both' | 'push' | 'import';

interface RunOptions {
  mode: SyncMode;
  taskIds?: string[];
}

interface Session {
  client: LinearClient;
  config: DispatchConfig;
  linear: LinearConfig;
  teamId: string;
  workspace: LinearWorkspace;
  labels: LinearLabel[];
}

/** Everything one pass holds while it runs. */
interface Run {
  pass: LinearPass;
  session: Session;
  state: LinearSyncState;
  ctx: PassContext;
  docs: Map<string, TaskDoc>;
  /** Tasks the pull already reconciled; the push skips them. */
  touched: Set<string>;
  comments: CommentSync | null;
  mayPull: boolean;
  /** Whether a pair may push: every task, or only those an explicit push names. */
  pushable: (id: string) => boolean;
  importing: boolean;
  taskIds: string[] | undefined;
}

/** Everything the pull fetched, by kind. */
interface Fetched {
  initiatives: LinearInitiative[];
  projects: LinearProject[];
  milestones: LinearProjectMilestone[];
  issues: LinearIssue[];
  comments: LinearComment[];
}

const DEFAULT_PUSH_DEBOUNCE_MS = 5_000;
const WORKSPACE_TTL_MS = 5 * 60_000;
const AUDIT_EVERY_MS = 30 * 60_000;

// A second before the newest record seen: `gt` would otherwise drop any
// record sharing that exact timestamp, and re-reading one is free.
function rewind(high: string | null): string | null {
  return high === null ? null : new Date(Date.parse(high) - 1000).toISOString();
}

function newest(
  records: readonly { updatedAt: string }[],
  start: string | null
): string | null {
  let high = start;
  for (const r of records) {
    if (high === null || r.updatedAt > high) high = r.updatedAt;
  }
  return high;
}

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/**
 * Keeps a project's tasks and one Linear team as two faithful copies: every
 * field both ways, merged field by field against a per-field base in
 * `~/.dispatch/`, with the team's workflow states as the project's statuses,
 * its users as the project's people, and issue comments as task comments.
 * Its own writes are recorded and skipped on the next pull.
 */
export class LinearSync {
  private readonly deps: LinearSyncDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<LinearSyncSummary> | null = null;
  private lastSummary: LinearSyncSummary | null = null;
  private progress: LinearProgress | null = null;
  // Set after a rate-limit failure; the timer and the debounced push both stand
  // down until it passes rather than spending the remaining hourly budget.
  private backoffUntil = 0;
  // Mirrors config.linear.enabled as of the last start(), so a task change on a
  // project with no Linear sync costs nothing and schedules no timer.
  private enabled = false;
  // Set when .dispatch/config.yml cannot be parsed. Sync stands down rather than
  // throwing out of a timer or blocking daemon boot.
  private configError: string | null = null;
  // True while this engine broadcasts its own writes, so they do not schedule
  // a push of what it just wrote.
  private selfBroadcast = false;
  // Local comment changes since the last pass, by task; folded into the
  // persisted queue when the next pass starts.
  private readonly commentChanges = new Map<string, Set<string>>();
  private workspaceCache: {
    teamId: string;
    at: number;
    workspace: LinearWorkspace;
    labels: LinearLabel[];
  } | null = null;

  constructor(deps: LinearSyncDeps) {
    this.deps = deps;
  }

  // Config is read on every pass, from a file a person edits by hand, so a parse
  // failure is a normal state to be in rather than an exception to propagate.
  private safeConfig(): DispatchConfig | null {
    try {
      const config = loadConfig(this.deps.rootDir);
      this.configError = null;
      return config;
    } catch (err) {
      this.configError = `invalid config, Linear sync paused: ${(err as Error).message}`;
      return null;
    }
  }

  status(): LinearStatus {
    const config = this.safeConfig();
    const linear = config?.linear ?? DEFAULT_LINEAR;
    const state = readLinearState(this.deps.rootDir);
    const { source } = resolveLinearApiKey(this.deps.rootDir);
    return {
      enabled: config !== null && linear.enabled,
      connected: this.deps.client !== undefined || source !== null,
      keySource: source,
      teamId: linear.teamId,
      direction: linear.direction,
      intervalSec: linear.intervalSec,
      statusMap: linear.statusMap,
      cursor: state.cursor,
      bootstrappedAt: state.bootstrappedAt,
      lastSyncAt: state.lastSyncAt,
      lastError: this.configError ?? state.lastError,
      lastSummary: this.lastSummary,
      syncing: this.inFlight !== null,
      conflicts: { total: state.conflictTotal, recent: state.conflicts },
      progress: this.progress,
    };
  }

  /** Record UUID -> display identifier and URL, for clients holding only `TaskMeta.external`. */
  links(): Record<string, LinearIssueLink> {
    return readLinearState(this.deps.rootDir).links;
  }

  /** Builds a client for ad-hoc reads (the team/state pickers), or null when no key is available. */
  client(): LinearClient | null {
    if (this.deps.client !== undefined) return this.deps.client;
    const { apiKey } = resolveLinearApiKey(this.deps.rootDir);
    if (apiKey === null) return null;
    const make =
      this.deps.createClient ?? ((key: string) => new HttpLinearClient(key));
    return make(apiKey);
  }

  /** Stores an API key for this project only — the daemon's own `rootDir` is the credential's
   *  key. The machine-wide key is never written, staying a read-only fallback. */
  connect(apiKey: string): void {
    this.workspaceCache = null;
    writeProjectCredential(this.deps.rootDir, 'linear', { apiKey });
  }

  /** Forgets this project's key. An env or machine-wide key still resolves afterwards, which
   *  `status().keySource` makes visible. */
  disconnect(): void {
    this.workspaceCache = null;
    clearProjectCredential(this.deps.rootDir, 'linear');
  }

  /** Starts the poll timer when the config enables it. Safe to call repeatedly. */
  start(): void {
    this.stopTimers();
    this.workspaceCache = null;
    const config = this.safeConfig();
    this.enabled = config?.linear.enabled ?? false;
    if (config === null || !config.linear.enabled) return;
    this.timer = setInterval(() => {
      void this.syncOnce().catch(() => undefined);
    }, config.linear.intervalSec * 1000);
  }

  private stopTimers(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
  }

  // Clears both timers and waits for any pass already running, so shutdown cannot
  // race a sync that is still writing task files and broadcasting.
  async stop(): Promise<void> {
    this.stopTimers();
    const pending = this.inFlight;
    if (pending !== null) await pending.catch(() => undefined);
  }

  // A local task changed: push it up shortly, coalescing a burst of edits into
  // one call. Pull is left to the timer — a local edit says nothing about Linear.
  notifyTaskChanged(): void {
    if (!this.enabled || this.selfBroadcast) return;
    this.schedulePush();
  }

  /** Local comments changed (added, edited or removed): queue them for the next push. */
  notifyCommentChanged(taskId: string, commentIds: readonly string[]): void {
    if (!this.enabled || this.selfBroadcast) return;
    if (this.deps.comments === undefined) return;
    const ids = this.commentChanges.get(taskId) ?? new Set<string>();
    for (const id of commentIds) ids.add(id);
    this.commentChanges.set(taskId, ids);
    this.schedulePush();
  }

  private schedulePush(): void {
    if (this.debounce !== null) clearTimeout(this.debounce);
    const delay = this.deps.pushDebounceMs ?? DEFAULT_PUSH_DEBOUNCE_MS;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      const config = this.safeConfig();
      if (config === null) return;
      if (!config.linear.enabled || config.linear.direction === 'pull') return;
      void this.enqueue({ mode: 'push' }).catch(() => undefined);
    }, delay);
  }

  /** Pull then push, per the configured direction. Concurrent callers share one pass. */
  async syncOnce(taskIds?: string[]): Promise<LinearSyncSummary> {
    // An explicit push carries tasks the in-flight pass never considered, so it
    // queues behind that pass instead of being answered by it.
    if (taskIds === undefined && this.inFlight !== null) return this.inFlight;
    return this.enqueue({ mode: 'both', taskIds });
  }

  /** Brings the team's whole backlog down: containers, issues, comments, links. */
  async importIssues(): Promise<LinearSyncSummary> {
    return this.enqueue({ mode: 'import' });
  }

  private enqueue(opts: RunOptions): Promise<LinearSyncSummary> {
    const previous = this.inFlight;
    const settled =
      previous === null
        ? Promise.resolve()
        : previous.then(
            () => undefined,
            () => undefined
          );
    const next = settled.then(() => this.run(opts));
    this.inFlight = next;
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.inFlight === next) this.inFlight = null;
      });
    return next;
  }

  // Turns a client failure into a summary message, arming the backoff clock when
  // the failure was a throttle.
  private note(failure: LinearFailure): string {
    if (failure.kind === 'rate-limit') {
      this.backoffUntil = Date.now() + (failure.retryAfterMs ?? 60_000);
    }
    return failure.error;
  }

  private setProgress(progress: LinearProgress | null): void {
    this.progress = progress;
    if (progress !== null) {
      this.deps.events.broadcast({ type: 'linear.progress', progress });
    }
  }

  // Broadcasts this engine's own writes without queueing a push of them.
  private quietly(send: () => void): void {
    this.selfBroadcast = true;
    try {
      send();
    } finally {
      this.selfBroadcast = false;
    }
  }

  private async openSession(
    force: boolean
  ): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
    const config = this.safeConfig();
    if (config === null) {
      return { ok: false, error: this.configError ?? 'invalid config' };
    }
    const teamId = config.linear.teamId;
    if (teamId === null || teamId.trim() === '') {
      return { ok: false, error: 'no Linear team selected' };
    }
    const client = this.client();
    if (client === null) {
      return { ok: false, error: 'no Linear API key configured' };
    }
    const cached = this.workspaceCache;
    const fresh =
      !force &&
      cached !== null &&
      cached.teamId === teamId &&
      Date.now() - cached.at < WORKSPACE_TTL_MS;
    if (!fresh) {
      const workspace = await client.workspace(teamId);
      if (!workspace.ok) return { ok: false, error: this.note(workspace) };
      const labels = await client.labels(teamId);
      if (!labels.ok) return { ok: false, error: this.note(labels) };
      this.workspaceCache = {
        teamId,
        at: Date.now(),
        workspace: workspace.data,
        labels: labels.data,
      };
    }
    const current = this.workspaceCache;
    if (current === null) return { ok: false, error: 'no Linear workspace' };
    return {
      ok: true,
      session: {
        client,
        config,
        linear: config.linear,
        teamId,
        workspace: current.workspace,
        labels: current.labels,
      },
    };
  }

  private async run(opts: RunOptions): Promise<LinearSyncSummary> {
    const summary = emptySummary(new Date().toISOString());
    if (Date.now() < this.backoffUntil) {
      summary.rateLimited = true;
      summary.errors.push('linear rate limit backoff in effect');
      return this.finish(summary, readLinearState(this.deps.rootDir), null);
    }
    const opened = await this.openSession(opts.mode === 'import');
    if (!opened.ok) {
      summary.errors.push(opened.error);
      // Persisted so `status().lastError` explains a misconfiguration, not just the summary.
      return this.finish(summary, readLinearState(this.deps.rootDir), null);
    }
    const session = opened.session;
    const { store, cache, rootDir } = this.deps;
    const state = readLinearState(rootDir);
    this.takeCommentChanges(state);
    const docs = new Map(store.listSafe().docs.map((d) => [d.meta.id, d]));
    this.foldLegacyWatermark(state, docs);
    const batch = new TaskChangeBatch(
      store,
      cache,
      (id) => docs.get(id),
      (ids) => {
        this.quietly(() =>
          this.deps.events.broadcast({ type: 'task.changed', ids })
        );
        if (this.progress !== null) {
          this.setProgress({
            ...this.progress,
            phase: 'applying',
            done: batch.count(),
          });
        }
      }
    );

    // The team's workflow is the project's status vocabulary, and its users
    // are the project's people; both are refreshed before anything maps.
    const regen = regenerateStatuses(
      rootDir,
      store,
      docs,
      state,
      session.workspace.states
    );
    for (const id of regen.migrated) batch.add(id);
    const localRef = this.deps.localHumanRef ?? 'human:me';
    const people = syncPeople(
      rootDir,
      regen.config,
      session.workspace.members,
      session.workspace.viewer.id,
      localRef
    );
    if (regen.configChanged || people.changed) {
      this.deps.events.broadcast({ type: 'config.changed' });
    }
    const config = people.config;
    const ctx = buildContext(
      rootDir,
      config,
      state,
      docs,
      session.labels,
      session.workspace.projectStatuses,
      localRef
    );
    const pass = new LinearPass({
      store,
      client: session.client,
      config,
      teamId: session.teamId,
      state,
      summary,
      ctx,
      docs,
      batch,
      note: (failure) => this.note(failure),
    });
    const changedComments = new Map<string, Set<string>>();
    const direction = session.linear.direction;
    const mayPull = direction !== 'push';
    const mayPush = direction !== 'pull';
    const run: Run = {
      pass,
      session,
      state,
      ctx,
      docs,
      touched: new Set(),
      comments:
        this.deps.comments === undefined
          ? null
          : new CommentSync({
              comments: this.deps.comments,
              client: session.client,
              state,
              ctx,
              pass,
              changed: changedComments,
            }),
      mayPull,
      // An explicit push writes only the tasks it names; others a pull meets
      // take Linear's changes and keep their own for an ordinary pass.
      pushable: (id) =>
        mayPush && (opts.taskIds === undefined || opts.taskIds.includes(id)),
      importing: opts.mode === 'import',
      taskIds: opts.taskIds,
    };

    // A first sync reconciles nothing — no task to create, no link to update — so it
    // takes a cursor instead of scanning a whole team it has no use for.
    const baselining = state.bootstrappedAt === null && !run.importing;
    if (baselining) {
      const now = new Date().toISOString();
      state.cursor = rewind(now);
      state.commentCursor = rewind(now);
      // Everything on disk is accounted for BEFORE the push: nothing local has been
      // reconciled yet, so a fresh clone must send none of it over a linked issue.
      this.accountForAll(state, docs);
      state.bootstrappedAt = now;
      await pass.guarded(() => this.audit(run, true));
    } else if (run.importing || (mayPull && opts.mode === 'both')) {
      if (run.importing) {
        this.setProgress({ phase: 'containers', done: 0, total: null });
      }
      await pass.guarded(() => this.pull(run));
    }

    const pushing = baselining ? opts.taskIds !== undefined : !run.importing;
    if (pushing && mayPush && !pass.stopped) {
      await pass.guarded(() => this.push(run));
    }

    if (!baselining && !pass.stopped) {
      await pass.guarded(() => this.audit(run, run.importing));
    }

    if (pass.withheld > 0) {
      summary.errors.push(
        `withheld ${pass.withheld} issue update(s): Linear holds a newer copy, or its version could not be checked`
      );
    }

    // The link is established once the team answered, not once a data pass came back
    // clean — otherwise one persistent error would freeze the integration forever.
    if (state.bootstrappedAt === null) {
      // An import establishes the link without ever pushing, so the same rule as the
      // baseline path applies: nothing already on disk goes up automatically.
      this.accountForAll(state, docs);
      state.bootstrappedAt = new Date().toISOString();
    }
    this.quietly(() => {
      for (const [taskId, ids] of changedComments) {
        this.deps.events.broadcast({
          type: 'comment.changed',
          taskId,
          commentIds: [...ids],
        });
      }
    });
    return this.finish(summary, state, batch, session.linear.intervalSec);
  }

  // Moves comment changes noted since the last pass into the persisted queue.
  private takeCommentChanges(state: LinearSyncState): void {
    for (const [taskId, ids] of this.commentChanges) {
      state.pendingComments[taskId] = [
        ...new Set([...(state.pendingComments[taskId] ?? []), ...ids]),
      ];
    }
    this.commentChanges.clear();
  }

  // Records every task on disk at its current version, so establishing the link leaves
  // nothing outstanding for the push to send.
  private accountForAll(
    state: LinearSyncState,
    docs: Map<string, TaskDoc>
  ): void {
    for (const doc of docs.values()) {
      state.pushed[doc.meta.id] = doc.meta.updated;
    }
  }

  // A state file written before per-task accounting carries only a watermark. Everything at
  // or before it is recorded once, so an upgrade neither re-sends work nor strands it.
  private foldLegacyWatermark(
    state: LinearSyncState,
    docs: Map<string, TaskDoc>
  ): void {
    if (state.lastPushAt === null) return;
    if (Object.keys(state.pushed).length === 0) {
      const mark = Date.parse(state.lastPushAt);
      // Ids in `pushRetry` were outstanding despite the watermark covering them.
      const queued = new Set(state.pushRetry ?? []);
      for (const doc of docs.values()) {
        if (queued.has(doc.meta.id)) continue;
        if (Date.parse(doc.meta.updated) <= mark) {
          state.pushed[doc.meta.id] = doc.meta.updated;
        }
      }
    }
    delete state.pushRetry;
    state.lastPushAt = null;
  }

  // Records the pass: flushes the task batch, persists cursor/echo state, and
  // tells connected clients the sync ran.
  private finish(
    summary: LinearSyncSummary,
    state: LinearSyncState,
    batch: TaskChangeBatch | null,
    intervalSec = 300
  ): LinearSyncSummary {
    batch?.flush();
    this.progress = null;
    state.lastSyncAt = summary.at;
    state.lastError = summary.errors[0] ?? null;
    state.echoes = pruneEchoes(
      state.echoes,
      Date.now(),
      echoTtlMs(intervalSec)
    );
    writeLinearState(this.deps.rootDir, state);
    this.lastSummary = summary;
    this.deps.events.broadcast({ type: 'linear.changed', summary });
    return summary;
  }

  private async pull(run: Run): Promise<void> {
    const { pass, session, state, importing } = run;
    const { client, teamId } = session;
    const summary = pass.summary;
    let records = true;
    let comments = true;
    // An idle poll is one cheap probe. When any record moved, every kind is
    // read against the same cursor, so no kind's change can fall behind it.
    const probeFrom = earliest(state.cursor, state.commentCursor);
    if (!importing && probeFrom !== null) {
      // Cursors sit a second behind the newest record seen; the probe asks
      // about anything after that record itself, or an idle team never looks idle.
      const seen = new Date(Date.parse(probeFrom) + 1000).toISOString();
      const probe = pass.take(await client.probe(teamId, seen));
      if (probe === null) return;
      records =
        probe.issues || probe.projects || probe.milestones || probe.initiatives;
      comments = probe.comments;
      if (!records && !comments) return;
    }
    const fetched: Fetched = {
      initiatives: [],
      projects: [],
      milestones: [],
      issues: [],
      comments: [],
    };
    const since = importing ? null : state.cursor;
    let recordsOk = true;
    let issuesTruncated = false;
    if (records) {
      const projects = pass.take(await client.projects(teamId, since));
      const milestones = pass.take(
        await client.projectMilestones(teamId, since)
      );
      const initiatives = pass.take(await client.initiatives(since));
      if (importing)
        this.setProgress({ phase: 'issues', done: 0, total: null });
      const page = pass.take(
        await client.issuesUpdatedSince(teamId, since, (n) => {
          if (importing) {
            this.setProgress({ phase: 'issues', done: n, total: null });
          }
        })
      );
      fetched.initiatives = initiatives?.nodes ?? [];
      fetched.projects = projects?.nodes ?? [];
      fetched.milestones = milestones?.nodes ?? [];
      fetched.issues = page?.issues ?? [];
      const pages: (LinearPage<unknown> | null)[] = [
        projects,
        milestones,
        initiatives,
      ];
      recordsOk =
        page !== null && pages.every((p) => p !== null && !p.truncated);
      issuesTruncated = page?.truncated ?? false;
    }
    let commentPage: LinearPage<LinearComment> | null = null;
    if (comments && run.comments !== null) {
      commentPage = pass.take(
        await client.comments(teamId, importing ? null : state.commentCursor)
      );
      fetched.comments = commentPage?.nodes ?? [];
    }

    await this.fillReferences(run, fetched);
    await this.learnUsers(run, fetched);

    if (importing) {
      this.setProgress({
        phase: 'applying',
        done: 0,
        total: fetched.issues.length + fetched.projects.length,
      });
    }
    await this.applyContainers(run, fetched);
    await this.applyIssues(run, fetched.issues);
    if (run.comments !== null && commentPage !== null) {
      // An import read every comment of the team, so a twin missing from it
      // was deleted in Linear.
      const complete = importing
        ? new Set(fetched.issues.map((i) => i.id))
        : new Set<string>();
      await run.comments.pull(fetched.comments, complete);
      if (!commentPage.truncated) {
        state.commentCursor = rewind(
          newest(fetched.comments, state.commentCursor)
        );
      }
    }

    if (issuesTruncated) {
      // The cursor must not move past issues this walk never reached.
      summary.errors.push(
        'linear returned more issues than one sync could page through; cursor held'
      );
    } else if (records && recordsOk) {
      state.cursor = rewind(
        newest(
          [
            ...fetched.issues,
            ...fetched.projects,
            ...fetched.milestones,
            ...fetched.initiatives,
          ],
          state.cursor
        )
      );
    }
  }

  // A pulled record naming a container this project has never seen (a delta
  // after the link, or a project added to an initiative) brings that
  // container, and its own parents, down too.
  private async fillReferences(run: Run, fetched: Fetched): Promise<void> {
    const { pass, session, ctx } = run;
    const known = (id: string | null) =>
      id === null || ctx.taskByRemote.has(id);
    const have = new Set([
      ...fetched.projects.map((p) => p.id),
      ...fetched.milestones.map((m) => m.id),
    ]);
    const wantsContainers = fetched.issues.some(
      (i) =>
        (!known(i.projectId) && !have.has(i.projectId ?? '')) ||
        (!known(i.projectMilestoneId) && !have.has(i.projectMilestoneId ?? ''))
    );
    if (wantsContainers) {
      const projects = pass.take(
        await session.client.projects(session.teamId, null)
      );
      const milestones = pass.take(
        await session.client.projectMilestones(session.teamId, null)
      );
      const byId = new Map(fetched.projects.map((p) => [p.id, p]));
      for (const p of projects?.nodes ?? []) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      fetched.projects = [...byId.values()];
      const msById = new Map(fetched.milestones.map((m) => [m.id, m]));
      for (const m of milestones?.nodes ?? []) {
        if (!msById.has(m.id)) msById.set(m.id, m);
      }
      fetched.milestones = [...msById.values()];
    }
    const initiativeIds = new Set(
      fetched.projects.flatMap((p) => p.initiatives.map((i) => i.initiativeId))
    );
    const fetchedInitiatives = new Set(fetched.initiatives.map((i) => i.id));
    const missing = [...initiativeIds].filter(
      (id) => !known(id) && !fetchedInitiatives.has(id)
    );
    if (missing.length > 0) {
      const all = pass.take(await session.client.initiatives(null));
      for (const i of all?.nodes ?? []) {
        if (missing.includes(i.id)) fetched.initiatives.push(i);
      }
    }
    // Only the team's initiatives: ones a team project belongs to, or already linked.
    fetched.initiatives = fetched.initiatives.filter(
      (i) => initiativeIds.has(i.id) || ctx.taskByRemote.has(i.id)
    );
  }

  // Users a record names who are not team members (a guest, someone from
  // another team) are looked up and added to the people registry, so an
  // assignment or a comment never silently maps to nobody.
  private async learnUsers(
    run: Pick<Run, 'session' | 'ctx'>,
    fetched: Partial<Fetched>
  ): Promise<void> {
    const { session, ctx } = run;
    const ids = new Set<string>();
    const want = (id: string | null) => {
      if (id !== null && !ctx.people.refByUser.has(id)) ids.add(id);
    };
    for (const i of fetched.issues ?? []) {
      want(i.assigneeId);
      want(i.creatorId);
    }
    for (const p of fetched.projects ?? []) want(p.leadId);
    for (const i of fetched.initiatives ?? []) want(i.ownerId);
    for (const c of fetched.comments ?? []) want(c.userId);
    if (ids.size === 0) return;
    const users = await session.client.users([...ids]);
    if (!users.ok || users.data.length === 0) return;
    const merged: LinearUser[] = [...session.workspace.members, ...users.data];
    const result = syncPeople(
      this.deps.rootDir,
      loadConfig(this.deps.rootDir),
      merged,
      session.workspace.viewer.id,
      ctx.people.localRef
    );
    if (result.changed) {
      refreshPeople(this.deps.rootDir, ctx, result.config);
      this.deps.events.broadcast({ type: 'config.changed' });
    }
  }

  private async applyContainers(run: Run, fetched: Fetched): Promise<void> {
    const { pass, ctx, docs, touched, mayPull, pushable } = run;
    const ready = ctx.model.roles.ready;
    // Created first, all of them, so every reference among them resolves.
    const pairs: [
      TaskDoc,
      RemoteRecord,
      'initiative' | 'project' | 'milestone',
    ][] = [];
    const lists: ['initiative' | 'project' | 'milestone', RemoteRecord[]][] = [
      ['initiative', fetched.initiatives],
      ['project', fetched.projects],
      ['milestone', fetched.milestones],
    ];
    for (const [entity, records] of lists) {
      for (const r of records) {
        const taskId = ctx.taskByRemote.get(r.id);
        if (taskId === undefined) {
          if (r.archivedAt !== null || !mayPull) continue;
          pairs.push([pass.createLocal(entity, r, ready), r, entity]);
          continue;
        }
        const doc = docs.get(taskId);
        if (doc === undefined) continue;
        if (pass.isEcho(r.id, r.updatedAt)) {
          pass.recordChip(r);
          continue;
        }
        pairs.push([doc, r, entity]);
      }
    }
    for (const [doc, r, entity] of pairs) {
      const current = docs.get(doc.meta.id) ?? doc;
      touched.add(current.meta.id);
      const mode = { mayPull, mayPush: pushable(current.meta.id) };
      if (entity === 'initiative') {
        await pass.reconcileInitiative(current, r as LinearInitiative, mode);
      } else if (entity === 'project') {
        await pass.reconcileProject(current, r as LinearProject, mode);
      } else {
        await pass.reconcileMilestone(
          current,
          r as LinearProjectMilestone,
          mode
        );
      }
    }
  }

  private async applyIssues(run: Run, issues: LinearIssue[]): Promise<void> {
    const { pass, session, state, ctx, docs, touched, mayPull, pushable } = run;
    const sorted = [...issues].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
    const pairs: [TaskDoc, LinearIssue][] = [];
    for (const issue of sorted) {
      const taskId = ctx.taskByRemote.get(issue.id);
      const inTeam = issue.team === null || issue.team.id === session.teamId;
      if (taskId === undefined) {
        if (issue.archivedAt !== null || !inTeam || !mayPull) continue;
        const returning = state.movedOut[issue.id];
        const relinked =
          returning === undefined ? null : pass.relink(returning, issue);
        pairs.push([relinked ?? pass.createLocal('issue', issue, ''), issue]);
        continue;
      }
      const doc = docs.get(taskId);
      if (doc === undefined) continue;
      pass.recordLink(issue.id, issue.identifier, issue.url);
      if (!inTeam) {
        pass.unlinkMoved(doc, issue.id, issue.team?.key ?? 'another team');
        continue;
      }
      if (pass.isEcho(issue.id, issue.updatedAt)) continue;
      pairs.push([doc, issue]);
    }
    for (const [doc, issue] of pairs) {
      const current = docs.get(doc.meta.id) ?? doc;
      touched.add(current.meta.id);
      await pass.reconcileIssue(current, issue, {
        mayPull,
        mayPush: pushable(current.meta.id),
      });
    }
  }

  private async push(run: Run): Promise<void> {
    const { pass, session, state, docs, touched, taskIds, mayPull } = run;
    const explicit = taskIds !== undefined;
    const summary = pass.summary;
    // A derived task's description is the artifact's own prose (a PR body),
    // and it exists only to anchor a local review — so it never becomes an
    // issue, not even on an explicit push, which is still a request to
    // publish it to a whole team's tracker.
    const candidates = [...docs.values()].filter(
      (doc) =>
        doc.meta.derivedFrom === undefined &&
        (explicit
          ? taskIds.includes(doc.meta.id)
          : !touched.has(doc.meta.id) &&
            isOutstanding(doc.meta.updated, state.pushed[doc.meta.id]))
    );
    const linked = candidates.filter(
      (d) => parseLinearExternal(d.meta.external) !== null
    );
    const unlinked = candidates.filter(
      (d) => parseLinearExternal(d.meta.external) === null
    );

    // Linked tasks are reconciled against a fresh copy, so a push is a real
    // three-way merge and never a blind overwrite.
    const issueIds = linked.flatMap((d) => {
      const ref = parseLinearExternal(d.meta.external);
      return ref?.entity === 'issue' ? [ref.id] : [];
    });
    if (issueIds.length > 0) {
      const fresh = pass.take(await session.client.issuesByIds(issueIds));
      if (fresh === null) {
        summary.errors.push(
          `skipped ${issueIds.length} issue update(s): their current copy could not be fetched`
        );
      } else {
        const byId = new Map(fresh.map((i) => [i.id, i]));
        await this.learnUsers(run, { issues: fresh });
        for (const doc of linked) {
          const ref = parseLinearExternal(doc.meta.external);
          if (ref?.entity !== 'issue') continue;
          const issue = byId.get(ref.id);
          if (issue === undefined) continue;
          const current = docs.get(doc.meta.id) ?? doc;
          if (issue.team !== null && issue.team.id !== session.teamId) {
            pass.unlinkMoved(current, issue.id, issue.team.key);
            continue;
          }
          await pass.reconcileIssue(current, issue, {
            mayPull,
            mayPush: true,
            explicit: explicit && taskIds.includes(current.meta.id),
          });
        }
      }
    }
    const containers = linked.filter((d) => {
      const entity = parseLinearExternal(d.meta.external)?.entity;
      return entity !== undefined && entity !== 'issue';
    });
    if (containers.length > 0) {
      await this.pushContainers(run, containers, {
        mayPull,
        mayPush: true,
        explicit,
      });
    }

    for (const doc of pass.creationOrder(unlinked)) {
      const current = docs.get(doc.meta.id) ?? doc;
      if (!explicit && !this.mayAutoCreate(state, current)) {
        state.pushed[current.meta.id] = current.meta.updated;
        continue;
      }
      // An archived task that never reached Linear stays local.
      if (!explicit && current.meta.archivedAt !== undefined) {
        state.pushed[current.meta.id] = current.meta.updated;
        continue;
      }
      await pass.createRemote(current);
      // A task that just got its issue takes its comments along.
      const now = docs.get(current.meta.id);
      if (
        run.comments !== null &&
        parseLinearExternal(now?.meta.external)?.entity === 'issue'
      ) {
        await run.comments.pushAll(current.meta.id);
        delete state.pendingComments[current.meta.id];
      }
    }

    if (run.comments !== null) {
      for (const [taskId, ids] of Object.entries(state.pendingComments)) {
        const retry = await run.comments.push(taskId, ids);
        if (retry.length > 0) state.pendingComments[taskId] = retry;
        else delete state.pendingComments[taskId];
      }
    }
  }

  private async pushContainers(
    run: Run,
    containers: TaskDoc[],
    mode: ReconcileMode
  ): Promise<void> {
    const { pass, session, docs } = run;
    const { client, teamId } = session;
    const [projects, milestones, initiatives] = [
      pass.take(await client.projects(teamId, null)),
      pass.take(await client.projectMilestones(teamId, null)),
      pass.take(await client.initiatives(null)),
    ];
    const byId = new Map<string, RemoteRecord>();
    for (const r of [
      ...(projects?.nodes ?? []),
      ...(milestones?.nodes ?? []),
      ...(initiatives?.nodes ?? []),
    ]) {
      byId.set(r.id, r);
    }
    for (const doc of containers) {
      const ref = parseLinearExternal(doc.meta.external);
      const remote = ref === null ? undefined : byId.get(ref.id);
      if (ref === null || remote === undefined) continue;
      const current = docs.get(doc.meta.id) ?? doc;
      if (ref.entity === 'project') {
        await pass.reconcileProject(current, remote as LinearProject, mode);
      } else if (ref.entity === 'milestone') {
        await pass.reconcileMilestone(
          current,
          remote as LinearProjectMilestone,
          mode
        );
      } else if (ref.entity === 'initiative') {
        await pass.reconcileInitiative(
          current,
          remote as LinearInitiative,
          mode
        );
      }
    }
  }

  /**
   * Every so often (and on every import) checks each linked issue is still in
   * the team: one moved elsewhere is unlinked, one deleted is archived and
   * unlinked. The same walk refreshes every chip's identifier.
   */
  private async audit(run: Run, force: boolean): Promise<void> {
    const { pass, session, state, docs } = run;
    const due =
      force ||
      state.lastAuditAt === null ||
      Date.now() - Date.parse(state.lastAuditAt) > AUDIT_EVERY_MS;
    if (!due) return;
    const linked = new Map<string, TaskDoc>();
    for (const doc of docs.values()) {
      const ref = parseLinearExternal(doc.meta.external);
      if (ref?.entity === 'issue') linked.set(ref.id, doc);
    }
    if (linked.size === 0) {
      state.lastAuditAt = new Date().toISOString();
      return;
    }
    const refs = pass.take(await session.client.issueLinks(session.teamId));
    if (refs === null) return;
    const inTeam = new Set<string>();
    for (const ref of refs) {
      inTeam.add(ref.id);
      if (linked.has(ref.id)) pass.recordLink(ref.id, ref.identifier, ref.url);
    }
    const missing = [...linked.keys()].filter((id) => !inTeam.has(id));
    if (missing.length > 0) {
      const found = pass.take(await session.client.issuesByIds(missing));
      if (found === null) return;
      const byId = new Map(found.map((i) => [i.id, i]));
      for (const id of missing) {
        const doc = docs.get(linked.get(id)?.meta.id ?? '');
        if (doc === undefined) continue;
        const issue = byId.get(id);
        if (issue === undefined) pass.unlinkDeleted(doc);
        else if (issue.team !== null && issue.team.id !== session.teamId) {
          pass.recordLink(issue.id, issue.identifier, issue.url);
          pass.unlinkMoved(doc, id, issue.team.key);
        }
      }
    }
    state.lastAuditAt = new Date().toISOString();
  }

  // Whether an unlinked task may be auto-created in Linear. Tasks predating the link
  // are left alone so connecting a tracker does not dump a whole backlog; explicit pushes still do.
  private mayAutoCreate(state: LinearSyncState, doc: TaskDoc): boolean {
    if (state.bootstrappedAt === null) return false;
    return Date.parse(doc.meta.updated) >= Date.parse(state.bootstrappedAt);
  }
}

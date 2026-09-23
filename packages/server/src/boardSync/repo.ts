import type { BoardOp } from '@dispatch/core';
import { absoluteGitLocation } from '@dispatch/core';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { AsyncGitRunner } from '../sync/worktree.js';

// The git half of board sync: a clone of one branch, where every replica keeps
// an append-only log of the changes it made, `ops/<replica>.jsonl`.
//
// One file per replica, written only by that replica, is what makes this safe
// to run unattended. Two replicas never edit the same file, so pulling someone
// else's work into this clone is a merge git always completes on its own —
// there is no conflict for a person to resolve at 3am, and nothing here ever
// has to rewrite history or force a push.

const OPS_DIR = 'ops';

// Identical on every replica, so two that each started the branch from
// nothing still merge cleanly: git treats the same file added on both sides
// with the same content as no conflict.
const README = `# Dispatch board sync

This branch carries changes to a Dispatch board between teammates' machines.
Each file under ops/ is one machine's append-only log; only that machine
writes it. Nothing here is meant to be edited by hand.
`;

// Commits here are the daemon's, not the person's, and must not run their
// hooks or ask for a signing key.
const IDENTITY = [
  '-c',
  'user.name=Dispatch sync',
  '-c',
  'user.email=sync@dispatch.invalid',
  '-c',
  'commit.gpgsign=false',
];

/** What a push-and-pull pass found. */
export interface RepoSyncResult {
  pushed: boolean;
  /** Why the remote could not be reached, when it could not. The replica
   *  keeps working locally and tries again next pass. */
  offline?: string;
}

export class SyncRepo {
  constructor(
    readonly dir: string,
    private readonly remoteUrl: string,
    private readonly branch: string,
    private readonly replica: string,
    private readonly git: AsyncGitRunner
  ) {}

  private async run(args: string[]): Promise<{ ok: boolean; out: string }> {
    const res = await this.git(this.dir, args);
    return { ok: res.status === 0, out: `${res.stdout}${res.stderr}`.trim() };
  }

  /**
   * Makes sure the clone exists and tracks the remote branch. A branch the
   * remote does not have yet is started locally and created by the first
   * push, so the first person to turn sync on needs nothing set up.
   */
  async ensure(): Promise<void> {
    if (!existsSync(join(this.dir, '.git'))) {
      mkdirSync(this.dir, { recursive: true });
      await this.run(['init', '-q']);
      await this.run(['remote', 'add', 'origin', this.remoteUrl]);
      const fetched = await this.run(['fetch', '-q', 'origin', this.branch]);
      if (fetched.ok) {
        await this.run([
          'checkout',
          '-q',
          '-B',
          this.branch,
          `origin/${this.branch}`,
        ]);
      } else {
        await this.run(['checkout', '-q', '--orphan', this.branch]);
        writeFileSync(join(this.dir, 'README.md'), README);
        await this.run(['add', 'README.md']);
        await this.run([
          ...IDENTITY,
          'commit',
          '-q',
          '--no-verify',
          '-m',
          'Start board sync',
        ]);
      }
    } else {
      // The remote may have been changed in config.yml since the clone was
      // made; follow it rather than syncing with the old one forever.
      await this.run(['remote', 'set-url', 'origin', this.remoteUrl]);
    }
    mkdirSync(join(this.dir, OPS_DIR), { recursive: true });
  }

  /** Appends this replica's changes to its log and commits them. */
  async write(ops: BoardOp[]): Promise<void> {
    if (ops.length === 0) return;
    const file = join(this.dir, OPS_DIR, `${this.replica}.jsonl`);
    appendFileSync(file, ops.map((op) => `${JSON.stringify(op)}\n`).join(''));
    await this.run(['add', join(OPS_DIR, `${this.replica}.jsonl`)]);
    const committed = await this.run([
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `${this.replica}: ${ops.length} change${ops.length === 1 ? '' : 's'}`,
    ]);
    if (!committed.ok)
      throw new Error(`could not commit sync log: ${committed.out}`);
  }

  /**
   * Brings in what everyone else has pushed, then pushes this replica's log.
   * A push the remote rejects because someone pushed in between is retried
   * once after pulling again; failing that, the next pass tries.
   */
  async exchange(): Promise<RepoSyncResult> {
    const pulled = await this.pull();
    if (pulled !== null) return { pushed: false, offline: pulled };
    for (let attempt = 0; attempt < 2; attempt++) {
      const push = await this.run([
        'push',
        '-q',
        'origin',
        `HEAD:${this.branch}`,
      ]);
      if (push.ok) return { pushed: true };
      const again = await this.pull();
      if (again !== null) return { pushed: false, offline: again };
    }
    return { pushed: false, offline: 'the remote kept rejecting the push' };
  }

  // Fetch and merge the remote branch. Null on success, or why it failed.
  private async pull(): Promise<string | null> {
    const fetched = await this.run(['fetch', '-q', 'origin', this.branch]);
    if (!fetched.ok) {
      // A branch nobody has pushed yet is not an error: this push creates it.
      if (/couldn't find remote ref|not found/i.test(fetched.out)) return null;
      return fetched.out === '' ? 'git fetch failed' : fetched.out;
    }
    const merged = await this.run([
      ...IDENTITY,
      'merge',
      '-q',
      '--no-edit',
      '--allow-unrelated-histories',
      `origin/${this.branch}`,
    ]);
    if (!merged.ok) {
      // Cannot happen while every replica writes only its own file; if it
      // does, leave the clone as it was rather than half-merged.
      await this.run(['merge', '--abort']);
      return `could not merge the sync branch: ${merged.out}`;
    }
    return null;
  }

  /** Every other replica's changes past where this one has read to. */
  readOthers(cursor: (replica: string) => number): BoardOp[] {
    const dir = join(this.dir, OPS_DIR);
    if (!existsSync(dir)) return [];
    const ops: BoardOp[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const replica = file.slice(0, -'.jsonl'.length);
      if (replica === this.replica) continue;
      const from = cursor(replica);
      for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        let op: BoardOp;
        try {
          op = JSON.parse(line) as BoardOp;
        } catch {
          // A torn last line from a write that died partway: skip it, and
          // pick it up whole on a later pass once its writer finishes it.
          continue;
        }
        if (op.v !== 1 || op.replica !== replica || op.seq <= from) continue;
        ops.push(op);
      }
    }
    return ops;
  }
}

/** A push target as the config names it: one of the project's remotes by
 *  name, or a repository of its own. */
export interface PushTarget {
  remote?: string;
  repo?: string;
}

/**
 * The location a push target points at, in a form git reads the same from
 * any directory: `repo` itself, or the URL of the project's `remote`. Null
 * when the remote is not one this project has.
 *
 * A relative path — `repo: ../board.git`, or an `origin` added as one — is
 * made absolute against the project root, where the person meant it (see
 * absoluteGitLocation).
 */
export async function resolvePushTarget(
  rootDir: string,
  target: PushTarget,
  git: AsyncGitRunner
): Promise<string | null> {
  if (target.repo !== undefined)
    return absoluteGitLocation(rootDir, target.repo);
  if (target.remote === undefined) return null;
  const res = await git(rootDir, ['remote', 'get-url', target.remote]);
  if (res.status !== 0) return null;
  return absoluteGitLocation(rootDir, res.stdout.trim());
}

import type { TaskDoc } from '@dispatch/core';
import { isDone } from '@dispatch/core';
import { choice, noul } from '@typesafe-ai/sdk';
import type {
  ChoiceQuestion,
  ChoiceResponse,
  EntryType,
  JsonValue,
  NoulQuestion,
  NoulResponse,
} from '@typesafe-ai/sdk';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { InboxItem, InboxKind } from '../inbox.js';
import { INBOX_KINDS } from '../inbox.js';
import type { JudgmentClient } from './client.js';
import { capText, mapLimit, warnOnce } from './client.js';

/**
 * Triage for inbox captures: per item, which kind it really is, which open
 * epic it belongs to, and whether it duplicates work already captured. Runs
 * before the Claude clustering pass so items with a confident home never
 * reach it — that is where the agent spend drops.
 *
 * Everything here is either pure (candidates, questions, interpretation) or
 * a thin runner around the judgment client; the runner returns null on any
 * failure so `clusterInbox` behaves exactly as before.
 */

export interface TriageEpic {
  id: string;
  title: string;
  /** First line of the epic's body, so the model can tell similar titles apart. */
  summary: string;
}

export interface TriageCandidate {
  id: string;
  title: string;
}

export type TriageKind = InboxKind | 'noise';

export interface InboxTriage {
  itemId: string;
  /** Hash of the item text this was judged against; a mismatch means re-judge. */
  hash: string;
  kind: TriageKind;
  kindConfidence: number;
  /** Null when no listed epic won with confidence ≥ EPIC_CONFIDENCE. */
  epicId: string | null;
  epicConfidence: number;
  /** Tasks or other inbox items this looks like a duplicate of, strongest first. */
  duplicates: { id: string; probability: number }[];
}

export interface InboxTriageSnapshot {
  items: Record<string, InboxTriage>;
  updatedAt: string;
}

/** Below this the epic Choice is treated as "no home" and the item still
 *  goes to the clusterer. */
const EPIC_CONFIDENCE = 0.6;
/** A duplicate noul at or above this is surfaced to the user. */
const DUPLICATE_PROBABILITY = 0.7;
/** How many lexical near-matches get a duplicate question. */
const DEFAULT_CANDIDATES = 8;
/** Item text sent as state; captures are short, so this only guards pastes. */
const ITEM_TEXT_CAP = 4000;
/** Requests in flight at once — the whole inbox is judged per pass. */
const CONCURRENCY = 4;

const KIND_CRITERIA: Record<TriageKind, string> = {
  bug: 'reports something that is broken or behaving wrongly',
  idea: 'proposes something new or a different way of doing things',
  task: 'a concrete piece of work someone could pick up as written',
  note: 'context, a thought or a reference — not work to do',
  noise: 'empty, a test string, or not about this project at all',
};

function isInboxKind(value: string): value is InboxKind {
  return (INBOX_KINDS as readonly string[]).includes(value);
}

export function triageHash(item: InboxItem): string {
  return createHash('sha256').update(item.text).digest('hex').slice(0, 16);
}

// Lower-cased words of three or more letters; short tokens ("a", "to") only
// add false overlap.
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * The duplicate candidates for one item: open tasks and the other open inbox
 * items with the most word overlap. Found in code so the model is only asked
 * about a short list it can actually compare — Jev cannot pick a duplicate
 * from a candidate it was never shown, and cannot scan a whole board.
 */
export function triageCandidates(
  item: InboxItem,
  tasks: TaskDoc[],
  others: InboxItem[],
  limit = DEFAULT_CANDIDATES
): TriageCandidate[] {
  const mine = tokens(item.text);
  const scored: { candidate: TriageCandidate; score: number }[] = [];
  for (const task of tasks) {
    if (isDone(task) || task.meta.kind === 'epic') continue;
    const score = jaccard(mine, tokens(task.meta.title));
    if (score > 0)
      scored.push({
        candidate: { id: task.meta.id, title: task.meta.title },
        score,
      });
  }
  for (const other of others) {
    if (other.id === item.id || other.done) continue;
    const title = other.text.split('\n')[0];
    const score = jaccard(mine, tokens(other.text));
    if (score > 0) scored.push({ candidate: { id: other.id, title }, score });
  }
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.candidate.id.localeCompare(b.candidate.id)
  );
  return scored.slice(0, limit).map((s) => s.candidate);
}

/** The open epics an item could belong to, with their first body line. */
export function triageEpics(tasks: TaskDoc[]): TriageEpic[] {
  return tasks
    .filter((t) => t.meta.kind === 'epic' && !isDone(t))
    .map((t) => ({
      id: t.meta.id,
      title: t.meta.title,
      summary:
        t.body
          .split('\n')
          .find((line) => line.trim() !== '')
          ?.trim() ?? '',
    }));
}

type TriageQuestions = {
  kind: ChoiceQuestion<Record<TriageKind, string>>;
  epic?: ChoiceQuestion<Record<string, string>>;
} & Record<`dup_${string}`, NoulQuestion>;

/** One request's questions: the kind, the epic (only when there are any)
 *  and one duplicate check per candidate. Keyed so `interpretTriage` can
 *  find each answer by name. */
export function triageQuestions(
  epics: TriageEpic[],
  candidates: TriageCandidate[]
): TriageQuestions {
  const questions: TriageQuestions = {
    kind: choice(
      'Which kind of capture is `item.text`? Judge what it is, not what `item.kind` says.',
      { ...KIND_CRITERIA }
    ),
  };
  if (epics.length > 0) {
    const criteria: Record<string, string> = {};
    for (const epic of epics) {
      criteria[epic.id] =
        epic.summary === '' ? epic.title : `${epic.title}: ${epic.summary}`;
    }
    criteria.none = 'belongs to none of the listed epics';
    questions.epic = choice(
      'Which of the epics in `epics` is `item.text` a piece of? Pick `none` unless the item is clearly work for that epic.',
      criteria
    );
  }
  for (const candidate of candidates) {
    questions[`dup_${candidate.id}`] = noul(
      {
        candidate: { id: candidate.id, title: candidate.title },
        question:
          'Is `item.text` describing the same piece of work as `candidate`?',
      },
      {
        true: 'the same change, bug or idea, even if worded differently',
        false: 'related or similar-sounding, but a different piece of work',
      }
    );
  }
  return questions;
}

function triageState(
  item: InboxItem,
  epics: TriageEpic[],
  candidates: TriageCandidate[]
): EntryType {
  // Spelled out as literals: EntryType is a JSON index signature, which the
  // named interfaces above are not assignable to.
  const epicsJson: JsonValue[] = epics.map((e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
  }));
  const candidatesJson: JsonValue[] = candidates.map((c) => ({
    id: c.id,
    title: c.title,
  }));
  return {
    item: { kind: item.kind, text: capText(item.text, ITEM_TEXT_CAP) },
    epics: epicsJson,
    candidates: candidatesJson,
  };
}

type TriageAnswers = {
  kind: ChoiceResponse;
  epic?: ChoiceResponse;
} & Record<string, ChoiceResponse | NoulResponse | undefined>;

/** Applies the thresholds to one item's answers. */
export function interpretTriage(
  itemId: string,
  hash: string,
  candidates: TriageCandidate[],
  answers: TriageAnswers
): InboxTriage {
  const kind: TriageKind = isInboxKind(answers.kind.choice)
    ? answers.kind.choice
    : 'noise';
  const epic = answers.epic;
  const epicId =
    epic !== undefined &&
    epic.choice !== 'none' &&
    epic.confidence >= EPIC_CONFIDENCE
      ? epic.choice
      : null;
  const duplicates: InboxTriage['duplicates'] = [];
  for (const candidate of candidates) {
    const answer = answers[`dup_${candidate.id}`];
    if (answer?.type !== 'noul' || answer.noul < DUPLICATE_PROBABILITY)
      continue;
    duplicates.push({ id: candidate.id, probability: answer.noul });
  }
  duplicates.sort((a, b) => b.probability - a.probability);
  return {
    itemId,
    hash,
    kind,
    kindConfidence: answers.kind.confidence,
    epicId,
    epicConfidence: epic?.confidence ?? 0,
    duplicates,
  };
}

/**
 * Judges every open item whose text changed since `previous`, carrying the
 * rest over. Null means "no triage" — no client, or the API failed — and
 * the caller keeps its old behaviour; a partial pass is never saved.
 */
export async function triageInbox(
  client: JudgmentClient | null,
  items: InboxItem[],
  tasks: TaskDoc[],
  previous: InboxTriageSnapshot | null
): Promise<InboxTriageSnapshot | null> {
  if (client === null) return null;
  const open = items.filter((i) => !i.done);
  const epics = triageEpics(tasks);
  const result: Record<string, InboxTriage> = {};
  const pending: InboxItem[] = [];
  for (const item of open) {
    const hash = triageHash(item);
    const cached = previous?.items[item.id];
    if (cached !== undefined && cached.hash === hash) result[item.id] = cached;
    else pending.push(item);
  }
  try {
    const judged = await mapLimit(pending, CONCURRENCY, async (item) => {
      const candidates = triageCandidates(item, tasks, open);
      const { answers } = await client.judge(
        triageState(item, epics, candidates),
        triageQuestions(epics, candidates)
      );
      return interpretTriage(
        item.id,
        triageHash(item),
        candidates,
        answers as TriageAnswers
      );
    });
    for (const triage of judged) result[triage.itemId] = triage;
  } catch (err) {
    warnOnce('inbox triage', err);
    return null;
  }
  return { items: result, updatedAt: new Date().toISOString() };
}

/** The items the Claude clusterer still needs to see: anything without a
 *  confident epic. With no snapshot, that is everything — as before. */
export function untriagedForClustering(
  items: InboxItem[],
  snapshot: InboxTriageSnapshot | null
): InboxItem[] {
  if (snapshot === null) return items;
  return items.filter((item) => snapshot.items[item.id]?.epicId == null);
}

/** `.dispatch/inbox-triage.json`, overwritten per pass — a cache of the last
 *  answers, same contract as InboxClusterSnapshotStore. */
export class InboxTriageSnapshotStore {
  private readonly file: string;

  constructor(rootDir: string) {
    this.file = join(rootDir, '.dispatch', 'inbox-triage.json');
  }

  load(): InboxTriageSnapshot | null {
    if (!existsSync(this.file)) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.file, 'utf8')
      ) as InboxTriageSnapshot;
      if (typeof parsed.items !== 'object' || parsed.items === null)
        return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(snapshot: InboxTriageSnapshot): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
}

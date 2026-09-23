import {
  DISPATCH_DIR,
  loadConfig,
  parseTeam,
  resolvePeople,
  TeamParseError,
} from '@dispatch/core';
import type { Person, TeamMember } from '@dispatch/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApiContext } from '../api.js';
import { humanActor } from './caller.js';
import { jsonResponse } from './http.js';

/** GET /api/people's body: everyone a picker offers, and who is asking. */
export interface PeopleSnapshot {
  /** The caller's own ref; the legacy bare `human` assignee means this. */
  me: string;
  people: Person[];
}

// team.yml's members; an unreadable roster (conflict markers) contributes
// nobody rather than failing the picker.
function rosterMembers(rootDir: string): TeamMember[] {
  const file = join(rootDir, DISPATCH_DIR, 'team.yml');
  if (!existsSync(file)) return [];
  try {
    return parseTeam(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err instanceof TeamParseError) return [];
    throw err;
  }
}

// GET /api/people — the team roster merged with config `people` (see core's
// resolvePeople). Agents are not listed: executors come from /api/executors.
export function listPeople(
  ctx: Pick<ApiContext, 'rootDir' | 'caller' | 'actorContext'>
): Response {
  const configured = loadConfig(ctx.rootDir).people ?? [];
  const snapshot: PeopleSnapshot = {
    me: humanActor(ctx),
    people: resolvePeople(configured, rosterMembers(ctx.rootDir)),
  };
  return jsonResponse(snapshot);
}

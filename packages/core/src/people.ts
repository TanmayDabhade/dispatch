// The project's people registry: who a `human:<handle>` ref is, for pickers
// and avatars. Pure shapes and merging, no node:* imports.
import { parseActorRef } from './actor.js';
import type { TeamMember } from './team.js';

export interface Person {
  /** A serialized human ActorRef, `human:<handle>`. */
  ref: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  /** The id in an external tracker (`linear:<user-uuid>`), or null. */
  external?: string | null;
}

/** Why `value` is not a valid `people:` entry, or null when it is. */
export function personError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'expected a map';
  const p = value as Record<string, unknown>;
  if (typeof p.ref !== 'string') return 'ref must be a string';
  let kind: string | null = null;
  let handle: string | null = null;
  try {
    const ref = parseActorRef(p.ref);
    kind = ref?.kind ?? null;
    handle = ref?.handle ?? null;
  } catch {
    return `ref ${p.ref} is not an actor ref`;
  }
  if (kind !== 'human' || handle === null) {
    return `ref ${p.ref} must be human:<handle>`;
  }
  if (typeof p.name !== 'string' || p.name.trim() === '') {
    return 'name must be a non-empty string';
  }
  for (const key of ['email', 'avatarUrl', 'external'] as const) {
    if (p[key] != null && typeof p[key] !== 'string') {
      return `${key} must be a string`;
    }
  }
  return null;
}

/**
 * Everyone a picker should offer: the team roster (`team.yml`, whose members
 * are `human:<handle>`) merged with configured `people`, which win field by
 * field on a shared ref. Roster order first, then configured-only people.
 */
export function resolvePeople(
  configured: readonly Person[],
  members: readonly TeamMember[]
): Person[] {
  const byRef = new Map<string, Person>();
  for (const m of members) {
    byRef.set(`human:${m.handle}`, {
      ref: `human:${m.handle}`,
      name: m.displayName,
      email: m.email,
      avatarUrl: null,
      external: null,
    });
  }
  for (const p of configured) {
    const base = byRef.get(p.ref);
    byRef.set(p.ref, {
      ref: p.ref,
      name: p.name,
      email: p.email ?? base?.email ?? null,
      avatarUrl: p.avatarUrl ?? base?.avatarUrl ?? null,
      external: p.external ?? base?.external ?? null,
    });
  }
  return [...byRef.values()];
}

/**
 * An assignee as a person-level ref: the legacy bare `human` is the local
 * user (`localHumanRef`); every other value passes through.
 */
export function canonicalAssignee(raw: string, localHumanRef: string): string {
  return raw === 'human' ? localHumanRef : raw;
}

/** The person behind `ref` (after the legacy alias), if registered. */
export function personFor(
  ref: string,
  people: readonly Person[],
  localHumanRef: string
): Person | undefined {
  const canonical = canonicalAssignee(ref, localHumanRef);
  return people.find((p) => p.ref === canonical);
}

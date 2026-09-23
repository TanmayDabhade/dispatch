import { describe, expect, it } from 'bun:test';

import {
  canonicalKind,
  isContainer,
  isContainerKind,
  parentIdsOf,
} from '../src/kinds.js';
import { parseTaskFile, serializeTaskFile } from '../src/taskfile.js';

const LEGACY_EPIC = `---
id: e-abc123
title: Old epic
status: ready
kind: epic
parent: null
milestone: null
blocked-by: []
labels: []
priority: none
assignee: none
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
external: null
writes: []
---

## Description
`;

describe('kinds', () => {
  it('reads legacy epic as milestone', () => {
    expect(canonicalKind('epic')).toBe('milestone');
    expect(canonicalKind('task')).toBe('task');
    const doc = parseTaskFile(LEGACY_EPIC);
    expect(doc.meta.kind).toBe('milestone');
    expect(serializeTaskFile(doc)).toContain('kind: milestone');
  });

  it('treats container kinds as containers without children', () => {
    for (const kind of ['initiative', 'project', 'milestone', 'epic']) {
      expect(isContainerKind(kind)).toBe(true);
      expect(isContainer({ id: 'e-000001', kind })).toBe(true);
    }
    expect(isContainerKind('task')).toBe(false);
  });

  it('treats a task with children as a container', () => {
    const tasks = [
      { meta: { id: 't-000001', parent: null } },
      { meta: { id: 't-000002', parent: 't-000001' } },
    ];
    const parents = parentIdsOf(tasks);
    expect(isContainer({ id: 't-000001', kind: 'task' }, parents)).toBe(true);
    expect(isContainer({ id: 't-000002', kind: 'task' }, parents)).toBe(false);
    expect(isContainer({ id: 't-000001', kind: 'task' })).toBe(false);
  });
});

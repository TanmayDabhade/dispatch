import { describe, expect, test } from 'bun:test';

import { describeSync } from '../src/commands/boardSync.js';

describe('describeSync', () => {
  test('off says how to turn it on', () => {
    expect(describeSync({ enabled: false }).join('\n')).toContain(
      'sync: { enabled: true }'
    );
  });

  test('on says where, when, what is waiting, and what went wrong', () => {
    const lines = describeSync({
      enabled: true,
      replica: 'ada-1a2b3c4d',
      remote: 'git@example.com:team/repo.git',
      branch: 'dispatch-sync',
      lastSyncAt: '2026-09-23T10:00:00.000Z',
      lastError: 'Could not resolve host',
      pending: 3,
      applied: 12,
      problems: [
        {
          task: 't-abc12345',
          message: 'created separately on two machines',
          at: 'x',
        },
      ],
    }).join('\n');
    expect(lines).toContain('ada-1a2b3c4d');
    expect(lines).toContain('Could not resolve host');
    expect(lines).toContain('3 change(s) waiting');
    expect(lines).toContain('t-abc12345');
  });
});

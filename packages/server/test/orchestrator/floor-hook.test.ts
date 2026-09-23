import { describe, expect, it } from 'bun:test';

import { floorHooks } from '../../src/orchestrator/floorHook.js';
import { floorDecision } from './helpers.js';

describe('floorHooks', () => {
  it('asks for a human on every floor command, from any tool carrying a command', async () => {
    const hooks = floorHooks('ask');
    for (const command of [
      'git push --force origin main',
      'npm publish',
      'git push origin v1.2.3',
      'gh repo edit --visibility public',
      'git push origin --delete feature',
    ]) {
      expect(await floorDecision(hooks, 'Bash', { command })).toBe('ask');
    }
    // The tool's name is not what decides: a renamed shell tool still counts.
    expect(
      await floorDecision(hooks, 'mcp__shell__run', {
        command: 'git push -f origin main',
      })
    ).toBe('ask');
  });

  it('denies floor commands outright in a session with no human to ask', async () => {
    expect(
      await floorDecision(floorHooks('deny'), 'Bash', {
        command: 'cargo publish',
      })
    ).toBe('deny');
  });

  it('names the floor check in the reason the CLI passes on', async () => {
    const hook = floorHooks('ask').PreToolUse?.[0]?.hooks[0];
    const output = await hook?.(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git push --force' },
        tool_use_id: 'tu-1',
      } as never,
      'tu-1',
      { signal: new AbortController().signal }
    );
    expect(JSON.stringify(output)).toContain('force-push');
  });

  it('gives no decision for anything the floor does not cover', async () => {
    const hooks = floorHooks('ask');
    // No decision (not "allow"): the call takes the session's normal path.
    expect(
      await floorDecision(hooks, 'Bash', { command: 'git push origin HEAD' })
    ).toBeUndefined();
    expect(
      await floorDecision(hooks, 'Edit', { file_path: 'a.ts' })
    ).toBeUndefined();
    expect(await floorDecision(hooks, 'Read', null)).toBeUndefined();
  });

  it('gives no decision for events other than PreToolUse', async () => {
    const hook = floorHooks('deny').PreToolUse?.[0]?.hooks[0];
    const output = await hook?.(
      {
        hook_event_name: 'PostToolUse',
        tool_input: { command: 'npm publish' },
      } as never,
      undefined,
      { signal: new AbortController().signal }
    );
    expect(output).toEqual({});
  });
});

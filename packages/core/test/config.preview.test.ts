import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigError, loadConfig } from '../src/config.js';
import { DEFAULT_PREVIEW, previewSettings } from '../src/configTypes.js';

function root(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-preview-'));
  mkdirSync(join(dir, '.dispatch'), { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(dir, '.dispatch', 'config.yml'), contents);
  }
  return dir;
}

describe('preview config', () => {
  it('defaults when the block is absent', () => {
    expect(loadConfig(root('autoCommit: true\n')).preview).toEqual(
      DEFAULT_PREVIEW
    );
    const empty = mkdtempSync(join(tmpdir(), 'dispatch-preview-'));
    expect(loadConfig(empty).preview).toEqual(DEFAULT_PREVIEW);
  });

  it('a partial block keeps the defaults it does not name', () => {
    // The trap this guards: naming only `command` must not drop both timeouts
    // to undefined and leave the supervisor with no ceiling at all.
    const dir = root('preview:\n  command: pnpm run serve\n');
    expect(loadConfig(dir).preview).toEqual({
      ...DEFAULT_PREVIEW,
      command: 'pnpm run serve',
    });
  });

  it('reads every field off disk', () => {
    const dir = root(
      [
        'preview:',
        '  enabled: false',
        '  command: pnpm run serve',
        '  installCommand: pnpm install',
        '  readyTimeoutSec: 30',
        '  idleTimeoutSec: 60',
        '',
      ].join('\n')
    );
    expect(loadConfig(dir).preview).toEqual({
      enabled: false,
      command: 'pnpm run serve',
      installCommand: 'pnpm install',
      readyTimeoutSec: 30,
      idleTimeoutSec: 60,
    });
  });

  it('rejects a malformed block rather than ignoring it', () => {
    expect(() => loadConfig(root('preview: nope\n'))).toThrow(ConfigError);
    expect(() => loadConfig(root('preview:\n  enabled: yes please\n'))).toThrow(
      ConfigError
    );
    expect(() => loadConfig(root('preview:\n  readyTimeoutSec: 0\n'))).toThrow(
      ConfigError
    );
    expect(() => loadConfig(root('preview:\n  idleTimeoutSec: -5\n'))).toThrow(
      ConfigError
    );
    // An empty command is a mistake worth hearing about, not a request to
    // autodetect instead.
    expect(() => loadConfig(root("preview:\n  command: ''\n"))).toThrow(
      ConfigError
    );
  });

  it('previewSettings fills the defaults in for a hand-built config', () => {
    // Test fixtures predate the block, so every reader goes through this
    // rather than touching config.preview directly.
    const settings = previewSettings({ statuses: [] } as never);
    expect(settings).toEqual(DEFAULT_PREVIEW);
  });

  it('previewSettings hands out a fresh object each call', () => {
    // DEFAULT_PREVIEW is a shared module constant; returning it by reference
    // would let one caller's mutation change every later read.
    const first = previewSettings({ statuses: [] } as never);
    first.enabled = false;
    expect(previewSettings({ statuses: [] } as never).enabled).toBe(true);
  });
});

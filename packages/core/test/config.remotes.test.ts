import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigError, loadConfig } from '../src/config.js';

function root(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-remotes-'));
  mkdirSync(join(dir, '.dispatch'), { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(dir, '.dispatch', 'config.yml'), contents);
  }
  return dir;
}

describe('remotes config', () => {
  it('defaults to none', () => {
    expect(loadConfig(root('autoCommit: true\n')).remotes).toEqual({});
  });

  it('parses a full remote', () => {
    const cfg = loadConfig(
      root(
        'remotes:\n  box:\n    host: build-box\n    user: ci\n    port: 2222\n    path: /srv/repo\n    identityFile: /keys/id\n'
      )
    );
    expect(cfg.remotes?.box).toEqual({
      host: 'build-box',
      user: 'ci',
      port: 2222,
      path: '/srv/repo',
      identityFile: '/keys/id',
    });
  });

  it('accepts a bare host, since ssh config supplies the rest', () => {
    expect(
      loadConfig(root('remotes:\n  box:\n    host: build-box\n')).remotes?.box
    ).toEqual({ host: 'build-box' });
  });

  it('requires a host', () => {
    expect(() => loadConfig(root('remotes:\n  box:\n    user: ci\n'))).toThrow(
      ConfigError
    );
    expect(() =>
      loadConfig(root("remotes:\n  box:\n    host: '  '\n"))
    ).toThrow(ConfigError);
  });

  it('names the key that was wrong', () => {
    // A typo must fail the load rather than produce a remote that cannot
    // connect for reasons nothing explains.
    try {
      loadConfig(root('remotes:\n  box:\n    hostname: build-box\n'));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('hostname');
    }
  });

  it('rejects a non-integer or negative port', () => {
    expect(() =>
      loadConfig(root('remotes:\n  box:\n    host: h\n    port: 0\n'))
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(root('remotes:\n  box:\n    host: h\n    port: 22.5\n'))
    ).toThrow(ConfigError);
  });

  it('rejects a non-string path', () => {
    expect(() =>
      loadConfig(root('remotes:\n  box:\n    host: h\n    path: 42\n'))
    ).toThrow(ConfigError);
  });

  it('rejects a remotes block that is not an object', () => {
    expect(() => loadConfig(root('remotes: [box]\n'))).toThrow(ConfigError);
  });
});

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ConfigError,
  DEFAULT_MODELS,
  executorModels,
  loadConfig,
  updateConfig,
} from '../src/config.js';

function root(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-executors-'));
  mkdirSync(join(dir, '.dispatch'), { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(dir, '.dispatch', 'config.yml'), contents);
  }
  return dir;
}

describe('executors config', () => {
  it('defaults: no executors block, claude as the default executor', () => {
    const cfg = loadConfig(root('autoCommit: true\n'));
    expect(cfg.executors).toEqual({});
    expect(cfg.orchestrator.executor).toBe('claude');
  });

  it('parses per-executor models and the default executor', () => {
    const cfg = loadConfig(
      root(
        'orchestrator:\n  executor: codex\nexecutors:\n  codex:\n    models:\n      execute: gpt-5.5\n      plan: gpt-5.5-mini\n'
      )
    );
    expect(cfg.orchestrator.executor).toBe('codex');
    expect(cfg.executors?.codex).toEqual({
      models: { execute: 'gpt-5.5', plan: 'gpt-5.5-mini' },
    });
  });

  it('rejects an unknown role, a non-string model and a blank executor name', () => {
    expect(() =>
      loadConfig(root('executors:\n  codex:\n    models:\n      overseer: x\n'))
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(root('executors:\n  codex:\n    models:\n      execute: 3\n'))
    ).toThrow(ConfigError);
    expect(() => loadConfig(root('executors:\n  codex: 3\n'))).toThrow(
      ConfigError
    );
    expect(() => loadConfig(root('orchestrator:\n  executor: ""\n'))).toThrow(
      ConfigError
    );
  });

  it('executorModels: claude aliases models.execute/plan and overlays its own block', () => {
    const cfg = loadConfig(
      root(
        'models:\n  execute: claude-opus-5\nexecutors:\n  claude:\n    models:\n      plan: claude-sonnet-5\n'
      )
    );
    expect(executorModels(cfg, 'claude')).toEqual({
      execute: 'claude-opus-5',
      plan: 'claude-sonnet-5',
    });
    expect(executorModels(cfg, 'codex')).toEqual({});
    expect(executorModels(cfg, 'fake')).toEqual({});
    expect(executorModels({ models: DEFAULT_MODELS }, 'claude')).toEqual({
      execute: DEFAULT_MODELS.execute,
      plan: DEFAULT_MODELS.plan,
    });
  });

  it('updateConfig writes executor and executors patches and round-trips', () => {
    const dir = root();
    updateConfig(dir, {
      executor: 'codex',
      executors: { codex: { models: { execute: 'gpt-5.5' } } },
    });
    const cfg = loadConfig(dir);
    expect(cfg.orchestrator.executor).toBe('codex');
    expect(cfg.executors?.codex?.models.execute).toBe('gpt-5.5');
    expect(
      readFileSync(join(dir, '.dispatch', 'config.yml'), 'utf8')
    ).toContain('executor: codex');
    expect(() =>
      updateConfig(dir, {
        executors: { codex: { models: { draft: 'x' } as never } },
      })
    ).toThrow(ConfigError);
    expect(() => updateConfig(dir, { executor: ' ' })).toThrow(ConfigError);
  });

  it('parses, validates and patches per-executor pricing', () => {
    const cfg = loadConfig(
      root(
        'executors:\n  codex:\n    pricing:\n      input: 1.25\n      cachedInput: 0.125\n      output: 10\n'
      )
    );
    expect(cfg.executors?.codex).toEqual({
      models: {},
      pricing: { input: 1.25, cachedInput: 0.125, output: 10 },
    });
    expect(() =>
      loadConfig(root('executors:\n  codex:\n    pricing:\n      input: 1\n'))
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(
        root(
          'executors:\n  codex:\n    pricing:\n      input: 1\n      output: -2\n'
        )
      )
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(
        root(
          'executors:\n  codex:\n    pricing:\n      input: 1\n      output: 2\n      reasoning: 3\n'
        )
      )
    ).toThrow(ConfigError);

    const dir = root();
    updateConfig(dir, {
      executors: { codex: { pricing: { input: 2, output: 8 } } },
    });
    expect(loadConfig(dir).executors?.codex?.pricing).toEqual({
      input: 2,
      output: 8,
    });
    expect(() =>
      updateConfig(dir, {
        executors: { codex: { pricing: { input: 2 } as never } },
      })
    ).toThrow(ConfigError);
  });
});

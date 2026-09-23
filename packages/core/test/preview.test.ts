import { describe, expect, test } from 'bun:test';

import {
  detectPackageManager,
  detectPreviewCommand,
  previewEnv,
} from '../src/preview.js';

describe('detectPackageManager', () => {
  test('reads the manager off the lockfile', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm');
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn');
    expect(detectPackageManager(['package-lock.json'])).toBe('npm');
    expect(detectPackageManager(['bun.lockb'])).toBe('bun');
    expect(detectPackageManager(['bun.lock'])).toBe('bun');
  });

  test('falls back to npm rather than refusing when no lockfile is present', () => {
    expect(detectPackageManager(['package.json', 'src'])).toBe('npm');
    expect(detectPackageManager([])).toBe('npm');
  });
});

describe('detectPreviewCommand', () => {
  test('binds vite to the allocated port and refuses to let it drift', () => {
    const found = detectPreviewCommand({ dev: 'vite' }, 'pnpm', 5311);
    // --strictPort is the whole point: a vite that silently moved to 5312
    // would leave the proxy pointing at a closed port.
    expect(found).toEqual({
      command: 'pnpm run dev -- --port 5311 --strictPort',
      script: 'dev',
    });
  });

  test('passes a port flag to the other tools that take one', () => {
    expect(
      detectPreviewCommand({ dev: 'next dev' }, 'npm', 4100)?.command
    ).toBe('npm run dev -- --port 4100');
    expect(
      detectPreviewCommand({ dev: 'astro dev' }, 'yarn', 4100)?.command
    ).toBe('yarn run dev -- --port 4100');
    expect(
      detectPreviewCommand({ dev: 'webpack-dev-server' }, 'npm', 4100)?.command
    ).toBe('npm run dev -- --port 4100');
  });

  test('leaves an unrecognized tool to the PORT environment variable', () => {
    // react-scripts takes no --port flag at all, so adding one would break the
    // command rather than bind it.
    expect(
      detectPreviewCommand({ dev: 'react-scripts start' }, 'npm', 4100)
    ).toEqual({ command: 'npm run dev', script: 'dev' });
    expect(previewEnv(4100).PORT).toBe('4100');
  });

  test('does not mistake vitest for vite', () => {
    // Substring matching would append vite's flags to a test runner.
    expect(detectPreviewCommand({ dev: 'vitest watch' }, 'pnpm', 4100)).toEqual(
      { command: 'pnpm run dev', script: 'dev' }
    );
  });

  test('prefers dev over start, since start is as often a production server', () => {
    const found = detectPreviewCommand(
      { start: 'node server.js', dev: 'vite' },
      'pnpm',
      4100
    );
    expect(found?.script).toBe('dev');
  });

  test('falls back to start when there is no dev script', () => {
    expect(
      detectPreviewCommand({ start: 'node server.js' }, 'pnpm', 4100)
    ).toEqual({ command: 'pnpm run start', script: 'start' });
  });

  test('a checkout with no usable script has no preview', () => {
    expect(detectPreviewCommand(undefined, 'pnpm', 4100)).toBeNull();
    expect(detectPreviewCommand({}, 'pnpm', 4100)).toBeNull();
    expect(detectPreviewCommand({ build: 'tsc' }, 'pnpm', 4100)).toBeNull();
    // An empty script is a mistake, not a dev server.
    expect(detectPreviewCommand({ dev: '   ' }, 'pnpm', 4100)).toBeNull();
  });
});

describe('previewEnv', () => {
  test('pins the dev server to loopback', () => {
    // A preview must not outlive the daemon's own promise that nothing is
    // reachable from off the machine.
    expect(previewEnv(4100).HOST).toBe('127.0.0.1');
  });

  test('stops the dev server opening a browser window', () => {
    expect(previewEnv(4100).BROWSER).toBe('none');
  });
});

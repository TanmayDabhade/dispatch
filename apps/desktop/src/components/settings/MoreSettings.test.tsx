import type { ConfigPatch } from '@dispatch/core/browser';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { AgentsMoreGroups, argvFromLines } from './AgentsMoreGroups';
import {
  DaemonConfigGroups,
  ownRepoPatch,
  receiptsPlacePatch,
  syncPlacePatch,
} from './DaemonConfigGroups';
import { OPERATOR_ONLY } from './fields';
import { testConfig as config } from './fixtures.test-helper';
import { PreviewsSection } from './PreviewsSection';
import { moved, ProjectGroups } from './ProjectGroups';
import { QueueWeightsGroup } from './QueueWeightsGroup';
import {
  describeRemote,
  remoteFromForm,
  RemotesSection,
} from './RemotesSection';

// The settings that used to live only in config.yml: each control sends the
// patch the daemon expects, and the ones that run a command or send data
// elsewhere are read-only to anyone below the operator tier.

function recorder() {
  const saved: ConfigPatch[] = [];
  return {
    saved,
    onSave: (p: ConfigPatch) => Promise.resolve(void saved.push(p)),
  };
}

function type(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

test('previews: the dev command saves on blur', () => {
  const r = recorder();
  render(<PreviewsSection config={config} onSave={r.onSave} canOperate />);
  type('Dev server command', 'pnpm dev --port $PORT');
  expect(r.saved).toEqual([{ preview: { command: 'pnpm dev --port $PORT' } }]);
});

test('previews: emptying a saved command sends null, restoring autodetect', () => {
  const r = recorder();
  render(
    <PreviewsSection
      config={{
        ...config,
        preview: {
          enabled: true,
          command: 'pnpm dev',
          readyTimeoutSec: 90,
          idleTimeoutSec: 600,
        },
      }}
      onSave={r.onSave}
      canOperate
    />
  );
  type('Dev server command', '');
  expect(r.saved).toEqual([{ preview: { command: null } }]);
});

test('previews: below the operator tier the commands are read-only', () => {
  const r = recorder();
  render(
    <PreviewsSection config={config} onSave={r.onSave} canOperate={false} />
  );
  expect(
    screen.queryByRole('textbox', { name: 'Dev server command' })
  ).toBeNull();
  expect(screen.getAllByText(OPERATOR_ONLY).length).toBeGreaterThan(0);
});

test('remotes: a filled form adds one, and only a real port is accepted', () => {
  expect(
    remoteFromForm({
      host: ' box ',
      user: '',
      port: '22x',
      path: '',
      identityFile: '',
    })
  ).toBeNull();
  expect(
    describeRemote({ host: 'box', user: 'ci', port: 2222, path: '/srv/r' })
  ).toBe('ci@box:2222  /srv/r');

  const r = recorder();
  render(<RemotesSection config={config} onSave={r.onSave} canOperate />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'box' } });
  fireEvent.change(screen.getByLabelText('Host'), {
    target: { value: 'build-box' },
  });
  fireEvent.change(screen.getByLabelText('Checkout path'), {
    target: { value: '/srv/repo' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Add remote/ }));
  expect(r.saved).toEqual([
    { remotes: { box: { host: 'build-box', path: '/srv/repo' } } },
  ]);
});

test('statuses: a new one goes before the last, and they reorder and remove', () => {
  expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);

  const r = recorder();
  const statuses = ['draft', 'ready', 'landed'];
  render(
    <ProjectGroups
      config={{ ...config, statuses }}
      onSave={r.onSave}
      canOperate
    />
  );
  fireEvent.change(screen.getByLabelText('Add a status'), {
    target: { value: 'QA' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add status' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move ready up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove draft' }));
  expect(r.saved).toEqual([
    { statuses: ['draft', 'ready', 'qa', 'landed'] },
    { statuses: ['ready', 'draft', 'landed'] },
    { statuses: ['ready', 'landed'] },
  ]);
});

test('verify steps: added in order, and removing the last clears the list', () => {
  const r = recorder();
  render(
    <ProjectGroups
      config={{
        ...config,
        verifySteps: [{ name: 'types', command: 'pnpm typecheck' }],
      }}
      onSave={r.onSave}
      canOperate
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove types' }));
  expect(r.saved).toEqual([{ verifySteps: null }]);
});

test('agents: a CLI agent is declared from one argument per line', () => {
  expect(argvFromLines('gemini\n  -p \n\n{prompt}\n')).toEqual([
    'gemini',
    '-p',
    '{prompt}',
  ]);
  const r = recorder();
  render(
    <AgentsMoreGroups
      config={config}
      executors={null}
      onSave={r.onSave}
      canOperate
    />
  );
  fireEvent.change(screen.getByLabelText('Add an agent'), {
    target: { value: 'gemini' },
  });
  fireEvent.change(screen.getByLabelText('Command, one argument per line'), {
    target: { value: 'gemini\n-p\n{prompt}' },
  });
  fireEvent.change(screen.getByLabelText('Model for coding runs'), {
    target: { value: 'gemini-2.5-pro' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Add agent/ }));
  expect(r.saved).toEqual([
    {
      executors: {
        gemini: {
          command: { run: ['gemini', '-p', '{prompt}'] },
          models: { execute: 'gemini-2.5-pro' },
        },
      },
    },
  ]);
});

test('agents: the run limits save as the numbers they are', () => {
  const r = recorder();
  render(
    <AgentsMoreGroups
      config={config}
      executors={null}
      onSave={r.onSave}
      canOperate
    />
  );
  type('Most runs at once', '6');
  type('Cost estimate per run', '0.75');
  type('Most runs at once', 'lots');
  expect(r.saved).toEqual([
    { maxConcurrency: 6 },
    { runCostEstimateUsd: 0.75 },
  ]);
});

test('where sync and receipts go: nothing is written until there is somewhere to write', () => {
  // A repo of its own waits for its URL.
  expect(syncPlacePatch('repo', {})).toBeNull();
  expect(syncPlacePatch('remote', { repo: 'x' })).toEqual({ repo: null });
  expect(syncPlacePatch('remote', {})).toBeNull();
  // Entering one writes it alone, never beside a remote.
  expect(ownRepoPatch('git@x:y.git')).toEqual({
    remote: null,
    repo: 'git@x:y.git',
  });
  expect(receiptsPlacePatch('off', { remote: 'origin' })).toEqual({
    remote: null,
    repo: null,
  });
  expect(receiptsPlacePatch('off', {})).toBeNull();
  expect(receiptsPlacePatch('remote', {})).toEqual({
    repo: null,
    remote: 'origin',
  });
  expect(receiptsPlacePatch('repo', { remote: 'origin' })).toBeNull();
});

test('daemon: interval and digest save; the receipt folder is the owner’s', () => {
  const r = recorder();
  render(
    <DaemonConfigGroups config={config} onSave={r.onSave} canOperate={false} />
  );
  type("Check for teammates' changes every", '60');
  type('Refresh the digest at most every', '12');
  expect(r.saved).toEqual([
    { sync: { intervalSec: 60 } },
    { repoDigest: { cooldownHours: 12 } },
  ]);
  expect(screen.queryByRole('textbox', { name: 'Folder' })).toBeNull();
});

test('queue weights: each factor saves, and 0 is allowed', () => {
  const r = recorder();
  render(<QueueWeightsGroup config={config} onSave={r.onSave} />);
  type('Age', '0');
  expect(r.saved).toEqual([{ queue: { weights: { age: 0 } } }]);
});

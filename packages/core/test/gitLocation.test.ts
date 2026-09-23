import { expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { absoluteGitLocation } from '../src/gitLocation.js';

// Where each kind of location a person writes ends up, from a project at
// /work/app — the form git will be handed, whichever directory it runs in.

test('URLs of every kind git takes pass through untouched', () => {
  for (const url of [
    'https://github.com/acme/board.git',
    'ssh://git@github.com/acme/board.git',
    'file:///srv/git/board.git',
    'git@github.com:acme/board.git',
    'github.com:acme/board.git',
  ]) {
    expect(absoluteGitLocation('/work/app', url)).toBe(url);
  }
});

test('an absolute path stays; a relative one is read from the base directory', () => {
  expect(absoluteGitLocation('/work/app', '/srv/git/board.git')).toBe(
    '/srv/git/board.git'
  );
  expect(absoluteGitLocation('/work/app', '../board.git')).toBe(
    '/work/board.git'
  );
  expect(absoluteGitLocation('/work/app', 'boards/team.git')).toBe(
    '/work/app/boards/team.git'
  );
});

test('~/ is the home directory, as a shell would read it', () => {
  expect(absoluteGitLocation('/work/app', '~/git/board.git')).toBe(
    join(homedir(), 'git/board.git')
  );
});

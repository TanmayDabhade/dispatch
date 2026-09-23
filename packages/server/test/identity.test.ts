import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PersistedToken, TokenStore } from '../src/identity.js';
import { fileTokenStore, TokenRegistry } from '../src/identity.js';

// A store the test can inspect, standing in for the file.
function memoryStore(initial: PersistedToken[] = []) {
  let saved = initial;
  const store: TokenStore = {
    load: () => saved,
    save: (tokens) => {
      saved = tokens;
    },
  };
  return { store, saved: () => saved };
}

const BUILT_IN = { agentToken: 'agent-aaa', appToken: 'app-bbb' };

function registry() {
  return new TokenRegistry(BUILT_IN, 'wyat');
}

describe('TokenRegistry', () => {
  test('the built-in pair keeps its tiers and now names the operator', () => {
    const reg = registry();

    // The app token sits at the top of the ladder — it only ever reaches the
    // person at this machine — and the agent token stays at the bottom.
    expect(reg.resolve('app-bbb')).toEqual({
      handle: 'wyat',
      ref: 'human:wyat',
      tier: 'operator',
    });
    expect(reg.resolve('agent-aaa')).toEqual({
      handle: 'wyat',
      ref: 'human:wyat',
      tier: 'request',
    });
  });

  test('an unknown or absent credential resolves to nobody', () => {
    const reg = registry();

    expect(reg.resolve('nope')).toBeNull();
    expect(reg.resolve(null)).toBeNull();
    // A prefix of a real token must not pass.
    expect(reg.resolve('app-')).toBeNull();
    expect(reg.resolve('')).toBeNull();
  });

  test('an issued token tells one teammate from another', () => {
    const reg = registry();

    const ada = reg.issue('ada', 'request');
    const grace = reg.issue('grace', 'request');

    // The whole point: two humans on one daemon are no longer the same caller.
    expect(reg.resolve(ada)?.handle).toBe('ada');
    expect(reg.resolve(grace)?.handle).toBe('grace');
    expect(ada).not.toBe(grace);
  });

  test('an issued token carries the tier it was issued for', () => {
    const reg = registry();

    const requester = reg.issue('ada', 'request');
    const decider = reg.issue('grace', 'decide');
    const operator = reg.issue('linus', 'operator');

    expect(reg.resolve(requester)?.tier).toBe('request');
    expect(reg.resolve(decider)?.tier).toBe('decide');
    expect(reg.resolve(operator)?.tier).toBe('operator');
  });

  test('one token per person: a new tier replaces the old token', () => {
    const reg = registry();
    const asRequester = reg.issue('ada', 'request');

    const asDecider = reg.issue('ada', 'decide');

    // Promoting someone must not leave their old token live at the old tier,
    // where a later `revoke ada` would be expected to have killed it.
    expect(reg.resolve(asRequester)).toBeNull();
    expect(reg.resolve(asDecider)?.tier).toBe('decide');
    expect(reg.issuedTier('ada')).toBe('decide');
    expect(reg.list().filter((e) => !e.builtIn)).toHaveLength(1);
  });

  test('re-issuing replaces the old credential rather than adding one', () => {
    const reg = registry();
    const first = reg.issue('ada', 'request');

    const second = reg.issue('ada', 'request');

    // A teammate whose laptop was lost is re-credentialed; the old token must
    // stop working the moment the new one exists.
    expect(reg.resolve(first)).toBeNull();
    expect(reg.resolve(second)?.handle).toBe('ada');
    expect(reg.list().filter((e) => e.handle === 'ada')).toHaveLength(1);
  });

  test('revoking stops a credential working', () => {
    const reg = registry();
    const ada = reg.issue('ada', 'request');

    expect(reg.revoke('ada')).toBe(true);
    expect(reg.resolve(ada)).toBeNull();
    expect(reg.issuedTier('ada')).toBeNull();
    // Revoking again is false, not an error.
    expect(reg.revoke('ada')).toBe(false);
  });

  test('the built-in pair cannot be revoked', () => {
    const reg = registry();

    // Dropping them would lock the operator out of the daemon running on
    // their own machine, with no way back short of a restart.
    expect(reg.revoke('wyat')).toBe(false);
    expect(reg.resolve('app-bbb')?.tier).toBe('operator');
    expect(reg.issuedTier('wyat')).toBeNull();
  });

  test('listing holders never discloses the credentials', () => {
    const reg = registry();
    const ada = reg.issue('ada', 'request');

    const listed = reg.list();

    expect(listed).toContainEqual(
      expect.objectContaining({
        handle: 'ada',
        tier: 'request',
        builtIn: false,
      })
    );
    // A list endpoint built on this must not be able to hand out tokens.
    expect(JSON.stringify(listed)).not.toContain(ada);
  });

  test('issued tokens survive a restart, as hashes only', () => {
    const { store, saved } = memoryStore();
    const first = new TokenRegistry(BUILT_IN, 'wyat', store);
    const ada = first.issue('ada', 'request');

    // Nothing on disk can be walked back to the token.
    expect(JSON.stringify(saved())).not.toContain(ada);
    expect(saved()[0].hash).toMatch(/^[0-9a-f]{64}$/);

    // A new daemon over the same store still knows Ada.
    const second = new TokenRegistry(
      { agentToken: 'agent-new', appToken: 'app-new' },
      'wyat',
      store
    );
    expect(second.resolve(ada)?.handle).toBe('ada');
  });

  test('the built-in pair is never written to the store', () => {
    const { store, saved } = memoryStore();
    const reg = new TokenRegistry(BUILT_IN, 'wyat', store);
    reg.issue('ada', 'request');

    // The app token is never persisted anywhere by design; a hash of it on
    // disk would be the first place it ever was.
    expect(saved().every((t) => t.handle === 'ada')).toBe(true);
  });

  test('revoking persists too, so a restart does not resurrect a token', () => {
    const { store } = memoryStore();
    const first = new TokenRegistry(BUILT_IN, 'wyat', store);
    const ada = first.issue('ada', 'request');
    first.revoke('ada');

    const second = new TokenRegistry(BUILT_IN, 'wyat', store);
    expect(second.resolve(ada)).toBeNull();
  });
  test('a file from before one-token-per-person is revoked whole', () => {
    // Written by a daemon that keyed tokens on handle and tier together, so
    // Ada could hold one of each.
    const { store } = memoryStore([
      { handle: 'ada', tier: 'request', hash: 'a'.repeat(64), issuedAt: 'x' },
      { handle: 'ada', tier: 'decide', hash: 'b'.repeat(64), issuedAt: 'x' },
    ]);
    const reg = new TokenRegistry(BUILT_IN, 'wyat', store);

    expect(reg.revoke('ada')).toBe(true);
    expect(reg.list().filter((e) => e.handle === 'ada')).toHaveLength(0);
  });
});

describe('fileTokenStore', () => {
  test('round-trips through a 0600 file', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'dispatch-tokens-')),
      'team-tokens.json'
    );
    const store = fileTokenStore(path);
    const reg = new TokenRegistry(BUILT_IN, 'wyat', store);
    const ada = reg.issue('ada', 'decide');

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).not.toContain(ada);
    expect(
      new TokenRegistry(BUILT_IN, 'wyat', fileTokenStore(path)).resolve(ada)
        ?.tier
    ).toBe('decide');
  });

  test('a missing file loads as empty rather than failing boot', () => {
    expect(
      fileTokenStore(join(tmpdir(), 'no-such-dir-8f1a', 'x.json')).load()
    ).toEqual([]);
  });

  test('a corrupt file loads as empty rather than failing boot', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'dispatch-tokens-')),
      'team-tokens.json'
    );
    writeFileSync(path, '{ not json');
    expect(fileTokenStore(path).load()).toEqual([]);
  });

  test('drops entries that are not well-formed hashes', () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'dispatch-tokens-')),
      'team-tokens.json'
    );
    // A hand-edited file that put a raw token where the hash goes must not
    // turn into a credential that matches its own sha256.
    writeFileSync(
      path,
      JSON.stringify([
        {
          handle: 'ada',
          tier: 'request',
          hash: 'raw-token-oops',
          issuedAt: '',
        },
        { handle: 'eve', tier: 'admin', hash: 'a'.repeat(64), issuedAt: '' },
      ])
    );
    expect(fileTokenStore(path).load()).toEqual([]);
  });
});

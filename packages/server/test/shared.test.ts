import { describe, expect, test } from 'bun:test';

import { bindModeFor, isLoopbackAddress, ownOrigins } from '../src/shared.js';

describe('bindModeFor', () => {
  test('loopback keeps the daemon to this machine', () => {
    expect(bindModeFor('127.0.0.1')).toEqual({ ok: true, mode: 'loopback' });
    expect(bindModeFor('localhost')).toEqual({ ok: true, mode: 'loopback' });
    expect(bindModeFor('::1')).toEqual({ ok: true, mode: 'loopback' });
  });

  test('a wildcard opts into team-local mode', () => {
    expect(bindModeFor('0.0.0.0')).toEqual({ ok: true, mode: 'shared' });
    expect(bindModeFor('::')).toEqual({ ok: true, mode: 'shared' });
  });

  test('a single interface address is refused, since loopback would stop answering', () => {
    const result = bindModeFor('192.168.1.5');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('0.0.0.0');
  });
});

describe('isLoopbackAddress', () => {
  test('recognises this machine in every form Bun reports', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test('a LAN peer is not loopback', () => {
    expect(isLoopbackAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackAddress('::ffff:10.0.0.4')).toBe(false);
    expect(isLoopbackAddress('fe80::1')).toBe(false);
  });
});

describe('ownOrigins', () => {
  const interfaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: '192.168.1.5', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
  } as unknown as Parameters<typeof ownOrigins>[1];

  test('one origin per reachable interface, never the internal ones', () => {
    expect([...ownOrigins(4771, interfaces)].sort()).toEqual([
      'http://192.168.1.5:4771',
      'http://[fe80::1]:4771',
    ]);
  });

  test('adds the operator-named origins, trimmed', () => {
    const origins = ownOrigins(4771, {}, ['http://dispatch.lan:4771/', '  ']);
    expect([...origins]).toEqual(['http://dispatch.lan:4771']);
  });
});

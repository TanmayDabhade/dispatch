import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FREE_SEATS,
  LicenseManager,
  readLicenseKey,
  seatLimitMessage,
} from '../../src/team/license.js';
import { licenseFor, testKeys } from './licenseKeys.js';

// Every way a license key can be wrong lands on the free plan with a reason —
// never a crash, never a lockout — and only a key signed by the licensor
// raises the seat count.

const NOW = new Date('2026-09-23T12:00:00Z');

describe('readLicenseKey', () => {
  const keys = testKeys();

  test('a key signed by the licensor grants its seats', () => {
    const state = readLicenseKey(
      licenseFor(keys.privateKey, { org: 'Acme', seats: 12 }),
      keys.publicKey,
      NOW
    );
    expect(state).toMatchObject({
      kind: 'licensed',
      seats: 12,
      license: { org: 'Acme' },
    });
  });

  test('a key never covers fewer people than the free plan', () => {
    const state = readLicenseKey(
      licenseFor(keys.privateKey, { seats: 1 }),
      keys.publicKey,
      NOW
    );
    expect(state.seats).toBe(FREE_SEATS);
  });

  test('an expired key falls back to the free plan, saying so', () => {
    const state = readLicenseKey(
      licenseFor(keys.privateKey, {
        seats: 40,
        expiresAt: '2026-09-01T00:00:00.000Z',
      }),
      keys.publicKey,
      NOW
    );
    expect(state).toMatchObject({ kind: 'expired', seats: FREE_SEATS });
    expect(seatLimitMessage(state.seats, state)).toContain(
      'expired on 2026-09-01'
    );
  });

  test('a key signed by anyone else is not a license', () => {
    const forged = licenseFor(testKeys().privateKey, { seats: 999 });
    expect(readLicenseKey(forged, keys.publicKey, NOW)).toEqual({
      kind: 'invalid',
      seats: FREE_SEATS,
      reason: 'the signature does not match',
    });
  });

  test('editing the payload of a real key breaks its signature', () => {
    const [prefix, , signature] = licenseFor(keys.privateKey, {
      seats: 5,
    }).split('.');
    const inflated = Buffer.from(
      JSON.stringify({
        org: 'Acme',
        seats: 5000,
        issuedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: null,
      })
    ).toString('base64url');
    expect(
      readLicenseKey(`${prefix}.${inflated}.${signature}`, keys.publicKey, NOW)
        .kind
    ).toBe('invalid');
  });

  test('garbage, and a build with no public key, read as the free plan', () => {
    for (const junk of ['', 'hello', 'dispatch1.a', 'dispatch1.!!.??']) {
      expect(readLicenseKey(junk, keys.publicKey, NOW)).toMatchObject({
        kind: 'invalid',
        seats: FREE_SEATS,
      });
    }
    expect(
      readLicenseKey(licenseFor(keys.privateKey), null, NOW)
    ).toMatchObject({ kind: 'invalid', seats: FREE_SEATS });
  });
});

describe('LicenseManager', () => {
  const keys = testKeys();
  const dir = () => mkdtempSync(join(tmpdir(), 'dispatch-license-'));

  test('with nothing installed it is the free plan', () => {
    const m = new LicenseManager({
      path: join(dir(), 'license.key'),
      publicKey: keys.publicKey,
    });
    expect(m.state()).toEqual({ kind: 'free', seats: FREE_SEATS });
  });

  test('installing a good key writes it 0600 and applies at once', () => {
    const path = join(dir(), 'license.key');
    const m = new LicenseManager({ path, publicKey: keys.publicKey });
    const key = licenseFor(keys.privateKey, { seats: 8 });
    expect(m.install(key).kind).toBe('licensed');
    expect(m.seats()).toBe(8);
    expect(readFileSync(path, 'utf8').trim()).toBe(key);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('a bad key is refused and the working one stays', () => {
    const path = join(dir(), 'license.key');
    const m = new LicenseManager({ path, publicKey: keys.publicKey });
    m.install(licenseFor(keys.privateKey, { seats: 8 }));
    expect(m.install('dispatch1.nope.nope').kind).toBe('invalid');
    expect(m.seats()).toBe(8);
  });

  test('a key from the environment wins over the file', () => {
    const path = join(dir(), 'license.key');
    writeFileSync(path, licenseFor(keys.privateKey, { seats: 8 }));
    const m = new LicenseManager({
      path,
      publicKey: keys.publicKey,
      envKey: licenseFor(keys.privateKey, { seats: 20 }),
    });
    expect(m.seats()).toBe(20);
  });

  test('an expiry passing takes effect without a restart', () => {
    let now = new Date('2026-09-23T12:00:00Z');
    const m = new LicenseManager({
      path: join(dir(), 'license.key'),
      publicKey: keys.publicKey,
      clock: () => now,
    });
    m.install(
      licenseFor(keys.privateKey, {
        seats: 8,
        expiresAt: '2026-10-01T00:00:00.000Z',
      })
    );
    expect(m.seats()).toBe(8);
    now = new Date('2026-10-02T00:00:00Z');
    expect(m.state().kind).toBe('expired');
    expect(m.seats()).toBe(FREE_SEATS);
  });
});

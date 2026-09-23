import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { License } from '../../src/team/license.js';
import { LicenseManager, signLicense } from '../../src/team/license.js';

// Licenses for tests, signed with a key pair made here — never the real one,
// whose private half only the licensor holds.

export function testKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function licenseFor(
  privateKey: string,
  overrides: Partial<License> = {}
): string {
  return signLicense(
    {
      org: 'Acme',
      seats: 10,
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      ...overrides,
    },
    privateKey
  );
}

/** A license manager that trusts `publicKey`, with `seats` installed. */
export function licensedManager(seats: number): LicenseManager {
  const keys = testKeys();
  const manager = new LicenseManager({
    path: join(mkdtempSync(join(tmpdir(), 'dispatch-license-')), 'license.key'),
    publicKey: keys.publicKey,
  });
  manager.install(licenseFor(keys.privateKey, { seats }));
  return manager;
}

#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { signLicense } from '../packages/server/src/team/license.js';

/**
 * Signs a license key for a customer:
 *
 *   bun scripts/license-issue.ts --key ~/secure/dispatch-license-signing.pem \
 *     --org "Acme Inc" --seats 10 --expires 2027-09-23
 *
 * Prints the key, which the customer pastes into Settings → License or runs
 * `dispatch license set <key>` with. `--expires` is optional; without it the
 * key never expires. Signing lives in the team module (license.ts) so what is
 * issued here is exactly what the daemon verifies.
 */

const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    org: { type: 'string' },
    seats: { type: 'string' },
    expires: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  console.error(
    'usage: bun scripts/license-issue.ts --key <private.pem> --org <name> --seats <n> [--expires YYYY-MM-DD]'
  );
  process.exit(2);
}

if (values.key === undefined) fail('--key is required');
const org = values.org?.trim();
if (org === undefined || org === '') fail('--org is required');
const seats = Number(values.seats);
if (!Number.isInteger(seats) || seats < 1) {
  fail('--seats must be a whole number, at least 1');
}
let expiresAt: string | null = null;
if (values.expires !== undefined) {
  const at = Date.parse(`${values.expires}T00:00:00Z`);
  if (Number.isNaN(at)) fail('--expires must be a date, YYYY-MM-DD');
  expiresAt = new Date(at).toISOString();
}

console.log(
  signLicense(
    { org, seats, issuedAt: new Date().toISOString(), expiresAt },
    readFileSync(values.key, 'utf8')
  )
);

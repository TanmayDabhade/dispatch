// Railway Infrastructure as Code for the `dispatch-site` project — the marketing
// site and the hosted demo. Replaces the two `railway.json` config-as-code files
// (deprecated by Railway until 2026-12-01). Both services are deployed by
// `railway up`, never from a GitHub source: the site from `apps/site` with its
// prebuilt `dist/`, the demo from the repo root (its Dockerfile's build context).
// Preview with `railway config plan`, apply with `railway config apply`.
import { defineRailway, preserve, project, service } from 'railway/iac';

// One replica in Railway's default region, restarted on failure; shared by both.
//
// `restartPolicyType`/`restartPolicyMaxRetries` are the desired state but do NOT
// persist as service settings: `railway config apply` reports success, yet
// `config pull` reads them back as null, so `config plan` keeps proposing them
// (checked 2026-09-22, CLI 5.58.0). Every other field here applied cleanly. Until
// that round-trips, the per-deployment `railway.json` files are what actually put
// the policy on a deployment — do not delete them, or deploys fall back to
// Railway's default.
const deploy = {
  restartPolicyType: 'ON_FAILURE',
  restartPolicyMaxRetries: 10,
  runtime: 'V2',
  multiRegionConfig: { 'us-east4-eqdc4a': { numReplicas: 1 } },
  ipv6EgressEnabled: false,
  useLegacyStacker: false,
} as const;

export default defineRailway(() => {
  // dispatch.foo — Astro, served by the image in apps/site/Dockerfile on the
  // PORT Railway injects (8080).
  const site = service('dispatch-site', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
      buildEnvironment: 'V3',
    },
    deploy,
    networking: {
      customDomains: { 'dispatch.foo': { port: 8080 } },
      serviceDomains: { 'dispatchagents.up.railway.app': { port: 8080 } },
    },
  });

  // The live sandbox the site embeds — apps/demo/src/server.ts serving the
  // desktop bundle, built by the root-context apps/demo/Dockerfile.
  const demo = service('dispatch-demo', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'apps/demo/Dockerfile',
      buildEnvironment: 'V3',
    },
    deploy,
    networking: {
      serviceDomains: { 'dispatch-demo-production-aed7.up.railway.app': {} },
    },
    // Set in the dashboard; kept as they are rather than restated here.
    env: {
      DEMO_MAX_SESSIONS: preserve(),
      DEMO_SESSION_TTL_MS: preserve(),
      RAILWAY_DOCKERFILE_PATH: preserve(),
    },
  });

  return project('dispatch-site', { resources: [site, demo] });
});

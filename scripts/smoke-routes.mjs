#!/usr/bin/env node
// Post-deploy smoke check. Fails on:
//   - any top-level page route that doesn't return 200, and
//   - a misconfigured session gate: an anonymous GET of a gated proxy/stream
//     path must answer 401 (configured), not 503 (ACDP_UI_CONSOLE_PASSWORD
//     unset) or 2xx (gate open). No secret, no login — see scripts/smoke-checks.mjs.
// Zero dependencies — uses the global fetch. Point it anywhere with
// SMOKE_BASE_URL; defaults to the production console.
//
//   SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-routes.mjs
//
// A `next dev` server without ACDP_UI_CONSOLE_PASSWORD fails the gate probes
// by design (development fail-open); set the variable to smoke a local server.

import { GATE_PROBES, PAGE_ROUTES, runSmoke } from './smoke-checks.mjs';

const base = (process.env.SMOKE_BASE_URL ?? 'https://console.agentcontextdistributionprotocol.io').replace(
  /\/$/,
  '',
);

const total = PAGE_ROUTES.length + GATE_PROBES.length;
const failures = await runSmoke(base);
if (failures > 0) {
  console.error(`\n${failures}/${total} checks failed`);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed`);

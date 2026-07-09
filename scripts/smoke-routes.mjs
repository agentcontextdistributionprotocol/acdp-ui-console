#!/usr/bin/env node
// Post-deploy smoke check: fetch every top-level route and fail on any non-200.
// Zero dependencies — uses the global fetch in Node 18+. Point it anywhere with
// SMOKE_BASE_URL; defaults to the production console.
//
//   SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-routes.mjs

const base = (process.env.SMOKE_BASE_URL ?? 'https://console.agentcontextdistributionprotocol.io').replace(
  /\/$/,
  '',
);

// The static top-level pages. /runs/[runId] is intentionally omitted — it needs
// a concrete run id and is exercised by the run workbench, not this crawl.
const routes = [
  '/',
  '/dashboard',
  '/scenarios',
  '/runs',
  '/events',
  '/contexts',
  '/lineage',
  '/trust',
  '/security',
  '/registries',
  '/agents',
  '/observability',
  '/config',
];

console.log(`Smoke-checking ${routes.length} routes against ${base}\n`);

let failures = 0;
for (const route of routes) {
  const url = base + route;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (res.status !== 200) {
      failures++;
      console.error(`FAIL  ${route} -> ${res.status}`);
    } else {
      console.log(`ok    ${route}`);
    }
  } catch (err) {
    failures++;
    console.error(`FAIL  ${route} -> ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${routes.length} routes failed`);
  process.exit(1);
}
console.log(`\nAll ${routes.length} routes returned 200`);

#!/usr/bin/env node
// Live scenario smoke: run every playground scenario end-to-end through the
// console's proxy and fail on any that doesn't reach a terminal `complete`.
// Zero dependencies — uses the global fetch in Node 18+. Point it anywhere with
// SMOKE_BASE_URL; defaults to the production console.
//
//   SMOKE_BASE_URL=http://localhost:3000 node scripts/run-scenarios.mjs
//
// Companion to scripts/smoke-routes.mjs (which only checks page routes). This
// one exercises real scenario execution (and, in real mode, real LLM calls) and
// surfaces each run's degraded flag (RFC-ACDP offline-core semantics).

const B = (process.env.SMOKE_BASE_URL ?? 'https://console.agentcontextdistributionprotocol.io').replace(
  /\/$/,
  '',
);

const sres = await fetch(`${B}/api/proxy/playground/scenarios`).then((r) => r.json());
const scenarios = (sres.scenarios ?? []).sort((a, b) =>
  a.id.localeCompare(b.id, undefined, { numeric: true }),
);
console.log(`Running ${scenarios.length} scenarios against ${B}...\n`);

const j = (r) => r.json();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const results = [];
for (const s of scenarios) {
  const started = Date.now();
  const row = { id: s.id, name: s.name, agents: s.agent_count, status: '?', detail: '' };
  try {
    const start = await fetch(`${B}/api/proxy/playground/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario_id: s.id, inputs: s.default_inputs ?? {}, registry_mode: s.registry_mode }),
    });
    if (!start.ok) {
      row.status = 'START_FAIL';
      row.detail = `HTTP ${start.status}: ${(await start.text()).slice(0, 160)}`;
      results.push(row); console.log(line(row)); continue;
    }
    const runId = (await start.json()).run_id;
    row.runId = runId;
    // Poll playground run status until terminal.
    let final = null;
    for (let i = 0; i < 60; i++) {
      const st = await fetch(`${B}/api/proxy/playground/runs/${encodeURIComponent(runId)}`).then(j).catch(() => null);
      if (st && ['complete', 'completed', 'failed', 'cancelled', 'error'].includes(st.status)) { final = st; break; }
      await sleep(1000);
    }
    if (!final) { row.status = 'TIMEOUT'; results.push(row); console.log(line(row)); continue; }
    row.status = final.status;
    const sum = final.result?.summary ?? final.summary ?? {};
    const err = final.result?.error ?? final.error;
    const nCtx = (final.result?.contexts ?? final.contexts ?? []).length;
    const nNodes = (final.result?.lineage_graph?.nodes ?? final.lineage_graph?.nodes ?? []).length;
    row.degraded = sum?.degraded === true;
    row.detail = `ctx=${nCtx} nodes=${nNodes}` + (err ? ` ERR=${String(err).slice(0, 80)}` : '') +
      (Object.keys(sum).length ? ` sum=${JSON.stringify(sum).slice(0, 120)}` : '');
  } catch (e) {
    row.status = 'EXC'; row.detail = String(e).slice(0, 160);
  }
  row.ms = Date.now() - started;
  results.push(row);
  console.log(line(row));
}

function line(r) {
  const ok = ['complete', 'completed'].includes(r.status) ? '✅' : '❌';
  const deg = r.degraded ? ' ⚠️degraded' : '';
  return `${ok} ${r.id.padEnd(26)} ${String(r.status).padEnd(11)}${deg} ${r.detail ?? ''}`;
}

const pass = results.filter((r) => ['complete', 'completed'].includes(r.status)).length;
const degraded = results.filter((r) => r.degraded).map((r) => r.id);
console.log(`\n=== ${pass}/${results.length} scenarios reached complete ===`);
if (degraded.length) console.log(`degraded (offline core verified, live round-trip unavailable): ${degraded.join(', ')}`);
const bad = results.filter((r) => !['complete', 'completed'].includes(r.status));
if (bad.length) console.log('NON-COMPLETE:\n' + bad.map((r) => `  ${r.id}: ${r.status} — ${r.detail}`).join('\n'));

// Non-zero exit if any scenario failed to complete, so this is CI-usable.
process.exitCode = bad.length ? 1 : 0;

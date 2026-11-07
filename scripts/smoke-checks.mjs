// Pure check logic for scripts/smoke-routes.mjs, split out so
// test/__tests__/smoke-checks.test.ts can drive it with a stubbed fetch.
// Zero dependencies — global fetch only.

// Every top-level page route. /runs/[runId] is intentionally omitted — it
// needs a concrete run id and is exercised by the run workbench, not this crawl.
export const PAGE_ROUTES = [
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

// Pages are client-rendered and return 200 even when every data call behind
// them fails — which is how prod shipped a 503 on every /api/proxy call while
// this smoke stayed green. So we also probe the gated surface ANONYMOUSLY and
// require middleware.ts's "configured but not signed in" answer: a 401 whose
// JSON body names the sign-in requirement. Both paths are refused by the
// middleware before any upstream is contacted, so no secret and no login is
// needed, and a backend outage cannot turn this red.
//
//   401 Unauthorized  → gate configured (pass)
//   503               → ACDP_UI_CONSOLE_PASSWORD missing in production (fail)
//   200 / anything    → gate open or something else answered (fail)
export const GATE_PROBES = ['/api/proxy/control-plane/healthz', '/api/stream/events'];

/**
 * Classify an anonymous response from a gated path.
 * @param {number} status
 * @param {string} bodyText
 * @returns {{ ok: boolean, reason: string }}
 */
export function classifyGateResponse(status, bodyText) {
  let error;
  try {
    error = JSON.parse(bodyText)?.error;
  } catch {
    error = undefined;
  }
  if (status === 401) {
    if (typeof error === 'string' && /unauthorized/i.test(error)) {
      return { ok: true, reason: 'gate configured (401 Unauthorized)' };
    }
    return { ok: false, reason: '401 without the session gate\'s JSON body — something other than middleware.ts answered' };
  }
  if (status === 503) {
    const detail = typeof error === 'string' ? `: ${error}` : '';
    return { ok: false, reason: `503 — session gate unconfigured${detail}` };
  }
  if (status >= 200 && status < 300) {
    return { ok: false, reason: `${status} to an anonymous request — the session gate is OPEN` };
  }
  return { ok: false, reason: `expected 401 from the session gate, got ${status}` };
}

/**
 * @param {string} base
 * @param {string} route
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function checkPage(base, route, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(base + route, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return res.status === 200 ? { ok: true, reason: '200' } : { ok: false, reason: String(res.status) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {string} base
 * @param {string} path
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function checkGate(base, path, fetchImpl = fetch) {
  try {
    // redirect: 'manual' — a 3xx (e.g. to a login page) is not the gate's answer.
    const res = await fetchImpl(base + path, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
    // An open gate on /api/stream/* would hand back a never-ending SSE body;
    // don't wait on it — the status alone already fails the check.
    const text = isStream ? (await res.body?.cancel(), '') : await res.text();
    return classifyGateResponse(res.status, text);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run every check; returns the failure count. `log`/`error` are injectable for tests.
 * @param {string} base
 * @param {{ fetchImpl?: typeof fetch, log?: (s: string) => void, error?: (s: string) => void }} [opts]
 * @returns {Promise<number>}
 */
export async function runSmoke(base, { fetchImpl = fetch, log = console.log, error = console.error } = {}) {
  let failures = 0;
  log(`Smoke-checking ${PAGE_ROUTES.length} routes and ${GATE_PROBES.length} gate probes against ${base}\n`);
  for (const route of PAGE_ROUTES) {
    const r = await checkPage(base, route, fetchImpl);
    if (r.ok) log(`ok    ${route}`);
    else {
      failures++;
      error(`FAIL  ${route} -> ${r.reason}`);
    }
  }
  for (const path of GATE_PROBES) {
    const r = await checkGate(base, path, fetchImpl);
    if (r.ok) log(`ok    ${path} (${r.reason})`);
    else {
      failures++;
      error(`FAIL  ${path} -> ${r.reason}`);
    }
  }
  return failures;
}

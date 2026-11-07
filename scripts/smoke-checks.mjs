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

// ── Public mode (ACDP_UI_PUBLIC_MODE on) ──────────────────────────────
// With public mode on there is no anonymous 401 to look for: public routes
// answer, admin routes answer the console's own 403, and anything off the
// allow-list is refused. Each probe below checks one of those three facts.
// The mode is read from GET /api/auth/session ({publicMode, signedIn}).

// Anonymous reads that must succeed (2xx): one per upstream, plus the CP
// event stream (headers only).
export const PUBLIC_OPEN_PROBES = [
  '/api/proxy/control-plane/healthz',
  '/api/proxy/playground/scenarios',
  '/api/proxy/registry-a/healthz',
  '/api/stream/events',
];

// Operator-only routes: must answer 403 CONSOLE_OPERATOR_SESSION_REQUIRED.
export const PUBLIC_ADMIN_PROBES = [
  '/api/proxy/control-plane/metrics',
  '/api/proxy/control-plane/webhooks',
  '/api/proxy/control-plane/auth/revocations',
];

// Off the allow-list: an unknown path and an unknown service. Any refusal
// (400/403/404) passes; a 2xx fails.
export const PUBLIC_DENY_PROBES = ['/api/proxy/control-plane/admin/x', '/api/proxy/not-a-service/healthz'];

// A traversal the URL parser leaves alone: `%2E%2E%2F` inside ONE segment
// (a bare `%2e%2e` segment is normalised away by fetch before it is sent,
// and would only probe whatever path it collapses to). It rides on the public
// `/contexts/.+` pattern, so only the route's traversal guard can refuse it,
// and only that guard's own 403 passes.
export const PUBLIC_TRAVERSAL_PROBE = '/api/proxy/control-plane/contexts/%2E%2E%2Fmetrics';

/** @param {number} status */
export function classifyPublicOpen(status) {
  if (status >= 200 && status < 300) return { ok: true, reason: `${status} (public route open)` };
  return { ok: false, reason: `expected 2xx for an anonymous public read, got ${status}` };
}

/** @param {number} status @param {string} bodyText */
export function classifyAdminDenied(status, bodyText) {
  let code;
  try {
    code = JSON.parse(bodyText)?.errorCode;
  } catch {
    code = undefined;
  }
  if (status === 403 && code === 'CONSOLE_OPERATOR_SESSION_REQUIRED') {
    return { ok: true, reason: '403 CONSOLE_OPERATOR_SESSION_REQUIRED' };
  }
  if (status >= 200 && status < 300) return { ok: false, reason: `${status} — an operator-only route is OPEN to anonymous visitors` };
  return { ok: false, reason: `expected 403 CONSOLE_OPERATOR_SESSION_REQUIRED, got ${status}${code ? ` ${code}` : ''}` };
}

/** @param {number} status */
export function classifyDenied(status) {
  if (status === 400 || status === 403 || status === 404) return { ok: true, reason: `${status} (refused)` };
  if (status >= 200 && status < 300) return { ok: false, reason: `${status} — a route off the allow-list answered` };
  return { ok: false, reason: `expected 400/403/404, got ${status}` };
}

/** @param {number} status @param {string} bodyText */
export function classifyTraversal(status, bodyText) {
  let error;
  try {
    error = JSON.parse(bodyText)?.error;
  } catch {
    error = undefined;
  }
  if (status === 403 && typeof error === 'string' && /traversal/i.test(error)) {
    return { ok: true, reason: '403 (path traversal refused)' };
  }
  if (status >= 200 && status < 300) return { ok: false, reason: `${status} — a traversal was forwarded` };
  return { ok: false, reason: `expected the traversal guard's 403, got ${status}` };
}

/**
 * The deployment's mode. `expect` ('on'/'off', from SMOKE_EXPECT_PUBLIC_MODE)
 * pins it: a mismatch with what the deployment reports is a failure. Without
 * it, an unreadable /api/auth/session (a deployment that predates it) counts
 * as off, which keeps the original gate probes.
 * @param {string} base
 * @param {typeof fetch} fetchImpl
 * @param {string | undefined} expect
 * @returns {Promise<{ publicMode: boolean, ok: boolean, reason: string }>}
 */
export async function detectMode(base, fetchImpl = fetch, expect = undefined) {
  let reported;
  try {
    const res = await fetchImpl(`${base}/api/auth/session`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const body = res.ok ? JSON.parse(await res.text()) : undefined;
    if (body && typeof body.publicMode === 'boolean') reported = body.publicMode;
  } catch {
    reported = undefined;
  }
  const want = expect === undefined || expect === '' ? undefined : /^(on|true|1)$/i.test(expect);
  if (want !== undefined && reported !== undefined && want !== reported) {
    return { publicMode: reported, ok: false, reason: `expected public mode ${want ? 'on' : 'off'}, deployment reports ${reported ? 'on' : 'off'}` };
  }
  const publicMode = reported ?? want ?? false;
  const how = reported !== undefined ? 'reported' : want !== undefined ? 'expected' : 'assumed (no /api/auth/session)';
  return { publicMode, ok: true, reason: `public mode ${publicMode ? 'on' : 'off'} (${how})` };
}

/**
 * One anonymous probe, classified. Never waits on an SSE body.
 * @param {string} base @param {string} path @param {(status: number, body: string) => { ok: boolean, reason: string }} classify
 * @param {typeof fetch} fetchImpl
 */
export async function probe(base, path, classify, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(base + path, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
    const text = isStream ? (await res.body?.cancel(), '') : await res.text();
    return classify(res.status, text);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The probes for a mode: the original gate probes (off), or the three public
 * sets (on).
 * @param {boolean} publicMode
 * @returns {{ path: string, classify: (status: number, body: string) => { ok: boolean, reason: string } }[]}
 */
export function probesFor(publicMode) {
  if (!publicMode) return GATE_PROBES.map((path) => ({ path, classify: classifyGateResponse }));
  return [
    ...PUBLIC_OPEN_PROBES.map((path) => ({ path, classify: classifyPublicOpen })),
    ...PUBLIC_ADMIN_PROBES.map((path) => ({ path, classify: classifyAdminDenied })),
    ...PUBLIC_DENY_PROBES.map((path) => ({ path, classify: classifyDenied })),
    { path: PUBLIC_TRAVERSAL_PROBE, classify: classifyTraversal },
  ];
}

/**
 * Optional: each direct backend base URL (SMOKE_DIRECT_BACKEND_URLS) must
 * refuse a keyless `GET /scenarios` with 401. Only meaningful once the
 * playground enforces its key (PLAYGROUND_REQUIRE_API_KEY).
 * @param {string} url @param {typeof fetch} fetchImpl
 */
export async function checkDirectBackend(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/scenarios`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return res.status === 401
      ? { ok: true, reason: '401 without a key' }
      : { ok: false, reason: `expected 401 without a key, got ${res.status}` };
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
export async function runSmoke(
  base,
  { fetchImpl = fetch, log = console.log, error = console.error, expectPublicMode = undefined, directBackendUrls = [] } = {},
) {
  let failures = 0;
  const mode = await detectMode(base, fetchImpl, expectPublicMode);
  if (mode.ok) log(`mode  ${mode.reason}`);
  else {
    failures++;
    error(`FAIL  mode -> ${mode.reason}`);
  }
  const probes = probesFor(mode.publicMode);
  log(`Smoke-checking ${PAGE_ROUTES.length} routes and ${probes.length} access probes against ${base}\n`);
  for (const route of PAGE_ROUTES) {
    const r = await checkPage(base, route, fetchImpl);
    if (r.ok) log(`ok    ${route}`);
    else {
      failures++;
      error(`FAIL  ${route} -> ${r.reason}`);
    }
  }
  for (const { path, classify } of probes) {
    const r = mode.publicMode ? await probe(base, path, classify, fetchImpl) : await checkGate(base, path, fetchImpl);
    if (r.ok) log(`ok    ${path} (${r.reason})`);
    else {
      failures++;
      error(`FAIL  ${path} -> ${r.reason}`);
    }
  }
  for (const url of directBackendUrls) {
    const r = await checkDirectBackend(url, fetchImpl);
    if (r.ok) log(`ok    direct ${url}/scenarios (${r.reason})`);
    else {
      failures++;
      error(`FAIL  direct ${url}/scenarios -> ${r.reason}`);
    }
  }
  return failures;
}

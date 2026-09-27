// ══════════════════════════════════════════════════════════════════════
// The federation proxy's two binding codes are not the same thing, and the
// console used to say they were.
//
// `acdp-control-plane/src/errors/error-codes.ts:20-26` keeps them apart on
// purpose and states the reason in the source: `CONTEXT_ID_MISMATCH` means "we
// DID check, and the upstream served a different context… The registry may be
// hostile"; `CONTEXT_BINDING_UNVERIFIABLE` means "we COULD NOT check… No
// mismatch was ever established, so claiming one here would be a lie."
//
// Both call sites collapsed the two into one boolean and rendered the mismatch
// sentence for both — so an operator who pasted a ctx_id with an over-long
// authority (a real path into `sdk_could_not_verify`, documented at
// `contexts.controller.ts:233-238`) was told a registry was serving
// substituted contexts.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/fetcher';
import {
  CONTEXT_ERROR_MESSAGES,
  contextErrorFallback,
  contextErrorMessage,
  errorDiagnostic,
  operatorErrorMessage,
  REGISTRY_ERROR_CODES,
} from '@/lib/utils/api-error-messages';
import type { ProxyService } from '@/lib/types';

/**
 * An `ApiError` built the way `fetchJson` builds one: from a raw body string.
 *
 * `fromUpstream` defaults to TRUE here because every test in this file is
 * simulating a real backend answering — which is precisely the case the
 * messages are written for. The console-minted case gets its own helper below,
 * so a test can never reach the blame-an-upstream copy by accident.
 */
function apiError(status: number, body: unknown, fromUpstream = true): ApiError {
  return new ApiError(status, typeof body === 'string' ? body : JSON.stringify(body), 'control-plane', '/contexts/x', fromUpstream);
}

/** An envelope this console minted itself — no `x-acdp-ui-proxy` stamp. */
function consoleError(status: number, body: unknown = ''): ApiError {
  return apiError(status, body, false);
}

const mismatch = apiError(502, { errorCode: 'CONTEXT_ID_MISMATCH', message: '…' });
const unverifiable = apiError(502, { errorCode: 'CONTEXT_BINDING_UNVERIFIABLE', message: '…' });

describe('the two binding codes say different things', () => {
  it('CRITERION 1: they do not render the same string', () => {
    expect(contextErrorMessage(mismatch)).not.toBe(contextErrorMessage(unverifiable));
  });

  it('CRITERION 2: the unverifiable message makes NO claim that anything mismatched', () => {
    // Read this against `error-codes.ts:20-26`. Asserted on the rendered
    // string rather than on the map key, because the defect was in the string.
    const msg = contextErrorMessage(unverifiable);
    // A VOCABULARY, not two keywords. An earlier cut of this test forbade only
    // "mismatch" and "cannot be trusted", which a substitution claim phrased in
    // fresh words ("the registry may have served a substituted context, so this
    // response cannot be relied on") walked straight past. The guard has to
    // cover the claim, not one phrasing of it.
    for (const forbidden of [
      /doesn't match|does not match/i,
      /mismatch(?! was established)/i,
      /cannot be trusted|cannot be relied|should not be relied/i,
      /substitut/i,
      /served a different|wrong context|different context/i,
      /hostile|malicious|tamper|spoof|forged/i,
      /may have served|might have served/i,
    ]) {
      expect(msg).not.toMatch(forbidden);
    }
    // …and it says the affirmative thing instead: the check could not run.
    expect(msg).toMatch(/could not be checked/i);
    expect(msg).toMatch(/no mismatch was established/i);
  });

  it("CRITERION 2: it keeps upstream's PRIOR, and does not send the operator after a typed id", () => {
    // `error-codes.ts:23-24` says "The registry is most likely misconfigured."
    // A draft of this string closed with "Check the id you entered before
    // suspecting the registry" — which inverted that prior AND pointed at an
    // action no surface offers: `/contexts` opens the modal from a CLICKED
    // search hit (`app/contexts/page.tsx`), and `ContextInspector` takes its
    // ctxId from a clicked DAG node or run event. Nothing in this console
    // accepts a ctx_id typed by hand. Asserting a message the code cannot
    // support is exactly the defect this phase removes, so it must not be
    // reintroduced facing the other way.
    const msg = contextErrorMessage(unverifiable);
    expect(msg).toMatch(/registry is most likely misconfigured/i);
    expect(msg).not.toMatch(/you entered|you typed|the id you/i);
  });

  it('DISCRIMINATES: the mismatch message DOES make that claim — it has earned it', () => {
    // The pairing. Softening both would satisfy criterion 2 while destroying
    // the one signal that matters: a registry serving a context nobody asked
    // for is the loudest thing the proxy can report.
    const msg = contextErrorMessage(mismatch);
    expect(msg).toMatch(/doesn't match its own claimed id/);
    expect(msg).toMatch(/cannot be trusted/);
  });

  it('CRITERION 3: the rate limit is distinct and actionable', () => {
    // `safe-federation-client.ts:139-145` throws this at HTTP 503 when the
    // upstream answered 429. It is the one failure here an operator can act on,
    // and it used to fall through to "Could not load context."
    const msg = contextErrorMessage(apiError(503, { errorCode: 'FEDERATION_UPSTREAM_RATE_LIMITED' }));
    expect(msg).toMatch(/rate limiting/i);
    expect(msg).toMatch(/[Ww]ait and retry/);
    expect(msg).not.toBe('Could not load context.');
    expect(msg).not.toBe(contextErrorMessage(mismatch));
    expect(msg).not.toBe(contextErrorMessage(unverifiable));
    // It must not imply a trust failure — nothing was verified either way.
    expect(msg).toMatch(/nothing about this context has failed verification/i);
  });

  it('every mapped code renders a distinct string', () => {
    const rendered = [...CONTEXT_ERROR_MESSAGES.keys()].map((code) =>
      contextErrorMessage(apiError(502, { errorCode: code })),
    );
    expect(new Set(rendered).size).toBe(rendered.length);
  });
});

describe('CRITERION 4: the fallbacks', () => {
  it('an UNKNOWN errorCode falls back on status, never on a mapped message', () => {
    // A newer control plane, or a direct registry call — this console must not
    // guess what a code it has never seen means.
    const unknown = apiError(502, { errorCode: 'CONTEXT_WAS_EATEN_BY_A_BEAR' });
    expect(contextErrorMessage(unknown)).toBe(contextErrorFallback(apiError(502, '')));
    expect(contextErrorMessage(unknown)).not.toBe(contextErrorMessage(mismatch));
  });

  it('an ABSENT errorCode (a non-JSON body) falls back on status', () => {
    const html = apiError(502, '<html>502 Bad Gateway</html>');
    expect(html.errorCode).toBeUndefined();
    expect(contextErrorMessage(html)).toBe(contextErrorFallback(apiError(502, '')));
  });

  it('never renders blank, for any status', () => {
    for (const status of [400, 403, 404, 418, 429, 500, 502, 503, 504]) {
      expect(contextErrorMessage(apiError(status, ''))).toBeTruthy();
    }
  });

  it('each named status branch says its own actionable thing, not just something', () => {
    // A truthiness loop cannot tell these apart, so deleting a branch and
    // letting it fall through to "Could not load context." stayed green. Each
    // branch exists for a reason recorded in the plan's divergence note — a
    // registry answering 429 directly, or a 403 from the admin-gated routes —
    // so each reason gets an assertion.
    const up = (s: number) => contextErrorFallback(apiError(s, ''));
    expect(up(403)).toMatch(/not authorized/i);
    expect(up(429)).toMatch(/rate limiting/i);
    expect(up(503)).toMatch(/rate limiting|unavailable/i);
    expect(up(500)).toMatch(/did not return this context/i);
    expect(up(400)).toBe('Could not load context.');
    // …and they are genuinely distinct, not four aliases of the default.
    const named = [403, 404, 429, 500].map(up);
    expect(new Set(named).size).toBe(named.length);
    for (const msg of named) expect(msg).not.toBe('Could not load context.');
  });

  it('a 404 is not-found, not a failure — and says nothing failed verification', () => {
    // The page renders this through `EmptyState` rather than `ErrorPanel`, but
    // the words are the map's, so both surfaces agree about what a 404 means.
    const msg = contextErrorMessage(apiError(404, { errorCode: 'CONTEXT_NOT_FOUND' }));
    expect(msg).toMatch(/nothing here has failed verification/i);
    // A bare 404 with no code reaches exactly the same sentence.
    expect(contextErrorMessage(apiError(404, ''))).toBe(msg);
  });

  it('an EMPTY-STRING errorCode falls through to status rather than missing the map', () => {
    // `{"errorCode":""}` parses, so `ApiError.errorCode` is `''` — falsy, and
    // therefore skipped by the `if (error.errorCode)` guard before the lookup.
    // That is the right outcome (an empty code identifies nothing), but it is
    // reached by falsiness rather than by a decision, so pin it.
    const blank = apiError(502, { errorCode: '' });
    expect(blank.errorCode).toBe('');
    expect(contextErrorMessage(blank)).toBe(contextErrorFallback(apiError(502, '')));
  });

  it('a code-bearing NON-404 is still classified by its code, not by 404-ness', () => {
    // `app/contexts/page.tsx` picks its not-found affordance from
    // `ApiError.isNotFound` (status), while the message comes from the code.
    // The two axes are independent by design; assert the message axis does not
    // quietly acquire a status dependency.
    const oddball = apiError(502, { errorCode: 'CONTEXT_NOT_FOUND' });
    expect(contextErrorMessage(oddball)).toBe(CONTEXT_ERROR_MESSAGES.get('CONTEXT_NOT_FOUND'));
  });

  it("demo mode's own 404 producer lands on the mapped message", async () => {
    // Driven through the REAL demo producer rather than a hand-copied shape:
    // `lib/api/client.ts`'s demo `getContext` throws this for a search hit with
    // no backing body (the synthetic interim-form revocation hit), and demo
    // mode is the default, so this is the 404 most people will ever see. A test
    // that re-types the error object would keep passing if the producer's
    // `errorCode` drifted — which is precisely the seam worth pinning.
    const { getContext } = await import('@/lib/api/client');
    const thrown = await getContext('acdp://registry-a.playground.local/does-not-exist', true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(404);
    expect(contextErrorMessage(thrown)).toBe(CONTEXT_ERROR_MESSAGES.get('CONTEXT_NOT_FOUND'));
  });

  it('a non-ApiError (a transport throw) keeps the generic message', () => {
    // React Query hands back whatever the queryFn threw; the helper takes
    // `unknown` precisely so each call site does not re-derive this narrowing.
    expect(contextErrorMessage(new Error('network down'))).toBe('Could not load context.');
    expect(contextErrorMessage(undefined)).toBe('Could not load context.');
    expect(contextErrorMessage('a string')).toBe('Could not load context.');
  });
});

describe('a console-minted envelope does not blame an upstream', () => {
  // The branch this file exists to protect, one layer out. `middleware.ts`
  // answers 503 when `ACDP_UI_CONSOLE_PASSWORD` is unset, the proxy route mints
  // its own 403 for a path off the allow-list, and Next answers 500 for an
  // unset `*_BASE_URL`. None of those bytes ever reached a registry. Keyed on
  // the status alone, each told the operator to wait and retry, or that they
  // were not authorized to read a context — blaming a service never contacted
  // and prescribing an action that can never resolve it. `fromUpstream` (the
  // `x-acdp-ui-proxy` stamp) is what separates them.

  it('CRITERION: the console-side copy names THIS console, not a registry', () => {
    const msg = contextErrorFallback(consoleError(503));
    expect(msg).toMatch(/this console/i);
    expect(msg).not.toMatch(/registry|control plane/i);
    // …and it is actionable in the place the fix actually lives.
    expect(msg).toMatch(/configuration|sign in/i);
  });

  it('DISCRIMINATES: the SAME status from upstream still blames upstream', () => {
    // The whole point of the discriminator. If this pair ever collapses to one
    // string, the branch has stopped doing anything and the test above would
    // keep passing on the wrong copy.
    for (const status of [403, 429, 500, 502, 503, 504]) {
      expect(contextErrorFallback(consoleError(status))).not.toBe(
        contextErrorFallback(apiError(status, '')),
      );
    }
    expect(contextErrorFallback(apiError(503, ''))).toMatch(/registry/i);
    expect(contextErrorFallback(apiError(403, ''))).toMatch(/not authorized/i);
  });

  it('404 stays ungated, because not-found is not a blame claim', () => {
    // Demo mode throws its 404 with `fromUpstream: false`, so gating 404 on the
    // stamp would have replaced the whole demo not-found experience with a
    // misconfiguration warning. Asserted here so the ordering of the two guards
    // inside `contextErrorFallback` cannot be swapped silently.
    expect(contextErrorFallback(consoleError(404))).toBe(
      CONTEXT_ERROR_MESSAGES.get('CONTEXT_NOT_FOUND'),
    );
    expect(contextErrorFallback(consoleError(404))).toBe(contextErrorFallback(apiError(404, '')));
  });

  it('a mapped errorCode still wins over the console-side branch', () => {
    // `contextErrorMessage` consults the map first. A console-minted envelope
    // that somehow carries a known code is answered by the code — the branch is
    // a fallback, not an override.
    const msg = contextErrorMessage(consoleError(502, { errorCode: 'CONTEXT_ID_MISMATCH' }));
    expect(msg).toBe(CONTEXT_ERROR_MESSAGES.get('CONTEXT_ID_MISMATCH'));
  });

  it('never renders blank on the console side either, for any status', () => {
    for (const status of [400, 403, 404, 418, 429, 500, 502, 503, 504]) {
      expect(contextErrorMessage(consoleError(status))).toBeTruthy();
    }
  });
});

describe('the lookup is defensive about where a code came from', () => {
  it('does NOT case-fold — registry codes are snake_case and must not alias', () => {
    // `fetcher.ts`'s `error.code` fallback also matches the registry's
    // RFC-ACDP-0007 §5 envelope, so lowercase codes do arrive here. Folding
    // case would manufacture the collision the two vocabularies avoid today.
    const registryStyle = apiError(502, { error: { code: 'context_id_mismatch' } });
    expect(registryStyle.errorCode).toBe('context_id_mismatch');
    expect(contextErrorMessage(registryStyle)).toBe(contextErrorFallback(apiError(502, '')));
    expect(contextErrorMessage(registryStyle)).not.toBe(contextErrorMessage(mismatch));
  });

  it('a prototype-chain key cannot leak a function into the UI', () => {
    // An upstream error code is attacker-influenced input from this console's
    // point of view. A plain-object map would resolve these through the
    // prototype chain and hand a *function* to a surface rendering an error.
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const msg = contextErrorMessage(apiError(502, { errorCode: code }));
      expect(typeof msg).toBe('string');
      expect(msg).toBe(contextErrorFallback(apiError(502, '')));
    }
  });

  it('a registry rate_limited envelope still reaches an actionable message by status', () => {
    // Not via the map — the registry's code is not in it — but a 429 must not
    // read as "could not load", which tells the operator nothing to do.
    const msg = contextErrorMessage(apiError(429, { error: { code: 'rate_limited' } }));
    expect(msg).toMatch(/rate limiting/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The surface-independent half of the module.
//
// `contextErrorMessage` above answers for one domain. `operatorErrorMessage`
// answers for the other seventeen surfaces that were rendering `String(error)`
// — i.e. an upstream's raw bytes, or `ApiError: <body>`, as the operator's
// primary message.
//
// Asserted in PAIRS throughout, per this file's own recorded anti-pattern
// below: a truthiness loop cannot tell a correct message from a different
// wrong one, so each case asserts the string that SHOULD render AND that the
// string that should not is absent.
// ══════════════════════════════════════════════════════════════════════
describe('operatorErrorMessage — the generic surface copy', () => {
  const LEAD = 'Could not load the agent inventory';

  /** An `ApiError` from an arbitrary service, not just the control plane. */
  function svcError(
    status: number,
    service: ProxyService,
    body: unknown = '',
    fromUpstream = true,
  ): ApiError {
    return new ApiError(
      status,
      typeof body === 'string' ? body : JSON.stringify(body),
      service,
      '/agents',
      fromUpstream,
    );
  }

  it('every return value begins with the lead', () => {
    const cases: unknown[] = [
      new TypeError('Failed to fetch'),
      svcError(401, 'control-plane'),
      svcError(403, 'registry-a'),
      svcError(404, 'playground'),
      svcError(429, 'registry-b'),
      svcError(500, 'control-plane'),
      svcError(418, 'playground'),
      svcError(503, 'registry-a', '', false),
    ];
    for (const e of cases) expect(operatorErrorMessage(e, LEAD).startsWith(LEAD)).toBe(true);
    // …including the codes arm, which the list above cannot reach.
    const codes = new Map([['rate_limited', 'The registry is rate limiting this console.']]);
    const coded = operatorErrorMessage(
      svcError(429, 'registry-a', { error: { code: 'rate_limited' } }),
      LEAD,
      { codes },
    );
    expect(coded.startsWith(LEAD)).toBe(true);
  });

  it('a non-ApiError names no service and no status', () => {
    const msg = operatorErrorMessage(new TypeError('Failed to fetch'), LEAD);
    expect(msg).toBe(`${LEAD}.`);
    // The pair. A bare `toBe` would pass if the function returned the lead and
    // then silently dropped a service name in some other build.
    for (const forbidden of ['the control plane', 'registry A', 'the playground', '500', 'TypeError'])
      expect(msg).not.toContain(forbidden);
  });

  // The whole point of the provenance gate. A status alone cannot tell an
  // upstream's envelope from one this console minted, and blaming a service
  // that was never contacted is the over-claim this module exists to remove.
  it.each([401, 404, 500, 503])(
    'an unstamped %i blames no upstream and gives the console sentence',
    (status) => {
      const msg = operatorErrorMessage(svcError(status, 'registry-a', 'boom', false), LEAD);
      expect(msg).toContain('This console could not complete the request');
      for (const forbidden of ['registry A', 'the control plane', 'the playground', 'registry B'])
        expect(msg).not.toContain(forbidden);
    },
  );

  it('names CONTROL_PLANE_API_KEY on a control-plane 401 but not a registry 401', () => {
    const cp = operatorErrorMessage(svcError(401, 'control-plane'), LEAD);
    const reg = operatorErrorMessage(svcError(401, 'registry-a'), LEAD);
    expect(cp).toContain('CONTROL_PLANE_API_KEY');
    expect(cp).toContain('the control plane');
    expect(cp).toContain("rejected this console's credentials");
    // 401 is an authentication failure; "grant admin scope" is the 403 remedy.
    expect(cp).toContain('check that it is set and current');
    expect(cp).not.toContain('admin scope');
    // A registry carries no injected credential, so pointing the operator at
    // that variable would send them to fix the wrong thing.
    expect(reg).not.toContain('CONTROL_PLANE_API_KEY');
    expect(reg).toContain('registry A');
  });

  // The console sends a registry nothing: `integrations.ts` returns auth
  // material for `control-plane` alone, and the proxy strips the browser's own
  // cookie and `authorization`. So a registry 401 cannot be a REJECTION — there
  // was nothing to reject. Saying otherwise blames a service for refusing
  // something it was never offered, and implies a fix (repair the console's
  // registry credential) that does not exist in this product.
  it.each(['registry-a', 'registry-b', 'playground'] as const)(
    'does not claim %s rejected credentials it was never sent',
    (service) => {
      const msg = operatorErrorMessage(svcError(401, service), LEAD);
      expect(msg).toContain('requires credentials this console does not send');
      expect(msg).not.toContain('rejected');
      expect(msg).not.toContain('CONTROL_PLANE_API_KEY');
    },
  );

  it('gives each status arm a distinct string naming the right service', () => {
    const msgs = [403, 404, 429, 503, 500, 418].map((s) =>
      operatorErrorMessage(svcError(s, 'registry-b'), LEAD),
    );
    // Distinct as a set — 429 and 503 share wording deliberately, so compare
    // the four that must differ plus the shared pair as one.
    expect(new Set(msgs).size).toBe(5);
    for (const m of msgs) expect(m).toContain('registry B');
    expect(msgs[0]).toContain('not authorized');
    expect(msgs[1]).toContain('has no record of it');
    expect(msgs[2]).toBe(msgs[3]);
    expect(msgs[2]).toContain('unavailable or rate limiting');
    expect(msgs[4]).toContain('did not answer successfully (500)');
    expect(msgs[5]).toContain('answered 418');
  });

  it('opts.notFound replaces the 404 clause and is ignored for every other status', () => {
    const notFound = 'No run with id r1 exists on this control plane.';
    expect(operatorErrorMessage(svcError(404, 'control-plane'), LEAD, { notFound })).toContain(
      notFound,
    );
    for (const status of [403, 429, 500, 503, 418])
      expect(operatorErrorMessage(svcError(status, 'control-plane'), LEAD, { notFound })).not.toContain(
        notFound,
      );
  });

  it('opts.codes wins over the status arms, and an absent code falls through', () => {
    const codes = new Map([['cursor_expired', 'That page of results expired — search again.']]);
    const hit = operatorErrorMessage(
      svcError(400, 'registry-a', { error: { code: 'cursor_expired' } }),
      LEAD,
      { codes },
    );
    expect(hit).toContain('search again');
    // A code is a statement about WHAT went wrong; a status only that it did.
    expect(hit).not.toContain('answered 400');

    const miss = operatorErrorMessage(
      svcError(400, 'registry-a', { error: { code: 'something_new' } }),
      LEAD,
      { codes },
    );
    expect(miss).toContain('answered 400');
    expect(miss).not.toContain('search again');
  });

  // Codes beat PROVENANCE too, not just the status arms — and this is the arm
  // that is easy to get backwards. Demo mode is the product default and throws
  // code-bearing errors that are unstamped by construction (`client.ts` raises
  // CONTEXT_NOT_FOUND and REGISTRY_NOT_FOUND with `fromUpstream` false, because
  // no request was made). Check provenance first and every one of those demo
  // surfaces renders "this console looks misconfigured or signed out" — in the
  // mode CLAUDE.md says works with zero backends.
  it('a code wins over the console-fault arm on an UNSTAMPED error', () => {
    const codes = new Map([['REGISTRY_NOT_FOUND', 'No registry is enrolled under that authority.']]);
    const msg = operatorErrorMessage(
      svcError(404, 'control-plane', { errorCode: 'REGISTRY_NOT_FOUND' }, false),
      LEAD,
      { codes },
    );
    expect(msg).toContain('No registry is enrolled under that authority');
    expect(msg).not.toContain('This console could not complete the request');
  });

  // The module's header rule is "no normalisation of the incoming code". A
  // *fallback* fold — exact match first, case-insensitive scan on a miss —
  // looks harmless and still merges the two vocabularies whenever only one
  // spelling is in the map, which is the normal case. The three-pair test below
  // cannot catch it because it seeds BOTH spellings.
  it('does not fall back to a case-insensitive match when the exact key is absent', () => {
    const codes = new Map([['INVALID_SIGNATURE', "The control plane could not verify its own signature."]]);
    const msg = operatorErrorMessage(
      svcError(400, 'registry-a', { error: { code: 'invalid_signature' } }),
      LEAD,
      { codes },
    );
    expect(msg).not.toContain('could not verify its own signature');
    expect(msg).toContain('answered 400');
  });

  it('assembles a readable sentence for a code clause — no capital mid-dash', () => {
    const codes = new Map([['cursor_expired', 'That page of results expired — search again.']]);
    const msg = operatorErrorMessage(
      svcError(400, 'registry-a', { error: { code: 'cursor_expired' } }),
      LEAD,
      { codes },
    );
    // A `codes` value is a full sentence, so it joins with ". " — splicing it
    // after an em dash gives a capital mid-sentence and a nested dash.
    expect(msg).toBe(`${LEAD}. That page of results expired — search again.`);
  });

  // The rule at the top of this module ("no normalisation of the incoming
  // code") was written when the count of near-collisions was ZERO. It is now
  // three: the control plane has INVALID_SIGNATURE / INVALID_LOG_PROOF /
  // INVALID_WITNESS_COSIGNATURE and the registry has the same three words in
  // lowercase snake_case. Case-folding the lookup would merge them.
  it.each([
    ['INVALID_SIGNATURE', 'invalid_signature'],
    ['INVALID_LOG_PROOF', 'invalid_log_proof'],
    ['INVALID_WITNESS_COSIGNATURE', 'invalid_witness_cosignature'],
  ])('does not case-fold %s against %s', (upper, lower) => {
    const codes = new Map([
      [upper, 'The control plane could not verify a signature it produced.'],
      [lower, 'The registry rejected a signature on the submitted document.'],
    ]);
    const a = operatorErrorMessage(svcError(400, 'control-plane', { errorCode: upper }), LEAD, {
      codes,
    });
    const b = operatorErrorMessage(svcError(400, 'registry-a', { errorCode: lower }), LEAD, {
      codes,
    });
    expect(a).not.toBe(b);
    expect(a).toContain('could not verify a signature it produced');
    expect(b).toContain('rejected a signature on the submitted document');
  });

  it('shares one console-fault sentence with contextErrorFallback', () => {
    const e = consoleError(503, 'boom');
    // Identical string, not merely similar — the two functions must not be
    // able to drift.
    expect(operatorErrorMessage(e, LEAD)).toBe(`${LEAD}. ${contextErrorFallback(e)}`);
  });
});

describe("contextErrorFallback gains #91's other half", () => {
  it('a stamped 401 names the key instead of falling through to the generic string', () => {
    const msg = contextErrorFallback(apiError(401, ''));
    expect(msg).toContain('CONTROL_PLANE_API_KEY');
    expect(msg).not.toBe('Could not load context.');
    // A 401 means the key did not authenticate. Telling the operator to grant
    // it admin scope prescribes an action that cannot resolve a missing or
    // rotated key — the very fault this module exists to remove.
    expect(msg).toContain('check that it is set and current');
    expect(msg).not.toContain('admin scope');
  });

  // Both of today's callers fetch from the control plane, so this arm is
  // correct without a gate — but `/contexts` already talks to registries for
  // search, and an ungated arm would silently tell an operator that a registry
  // rejected credentials this console never sends it.
  it('does not claim a registry rejected credentials, if one ever reaches this function', () => {
    const regErr = new ApiError(401, '', 'registry-a', '/contexts/x', true);
    const msg = contextErrorFallback(regErr);
    expect(msg).toContain('requires credentials this console does not send');
    expect(msg).not.toContain('rejected');
    expect(msg).not.toContain('CONTROL_PLANE_API_KEY');
  });

  it('an unstamped 401 still gets the console sentence, not the key sentence', () => {
    const msg = contextErrorFallback(consoleError(401));
    expect(msg).toContain('This console could not complete the request');
    expect(msg).not.toContain('CONTROL_PLANE_API_KEY');
  });
});

describe('errorDiagnostic', () => {
  it('is undefined for a non-ApiError — nothing worth disclosing', () => {
    expect(errorDiagnostic(new TypeError('Failed to fetch'))).toBeUndefined();
    expect(errorDiagnostic('a string')).toBeUndefined();
    expect(errorDiagnostic(undefined)).toBeUndefined();
  });

  it('carries status, service and path, plus the body when there is one', () => {
    const d = errorDiagnostic(apiError(502, '{"error":{"code":"schema_violation"}}'))!;
    expect(d).toContain('502');
    expect(d).toContain('control-plane');
    expect(d).toContain('/contexts/x');
    expect(d).toContain('schema_violation');
  });

  it('omits the separator entirely for an empty body rather than dangling one', () => {
    const d = errorDiagnostic(apiError(500, ''))!;
    expect(d).toBe('500 from control-plane /contexts/x');
    expect(d.endsWith('—')).toBe(false);
  });

  // Truncation was in the first draft and removed: the disclosure bounds the
  // visual cost with max-height + overflow, and a character cap costs the
  // operator the tail of a body that may be the part that matters.
  it('returns a 40 000-character body IN FULL', () => {
    const body = 'x'.repeat(40_000);
    const d = errorDiagnostic(apiError(500, body))!;
    expect(d).toContain(body);
    expect(d.length).toBeGreaterThan(40_000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The registry's own vocabulary.
//
// Copy correctness for `REGISTRY_ERROR_CODES` lives here, against upstream's
// source, exactly as the control-plane map above is checked against
// `error-codes.ts`. `error-copy-sweep.test.tsx` asserts the WIRING — that
// `/lineage`'s chain lookup passes the map at all — and deliberately asserts
// nothing about the strings.
//
// Every key below is quoted from
// `acdp-registry-rs/crates/acdp-registry-types/src/error.rs:152-200`
// (`wire_code()`), with the HTTP status from `http_status_for_acdp` at `:204`.
// ══════════════════════════════════════════════════════════════════════
describe('REGISTRY_ERROR_CODES', () => {
  /** A registry answering directly — lowercase snake_case, per RFC-ACDP-0007 §5. */
  function registryError(status: number, code: string): ApiError {
    return new ApiError(
      status,
      JSON.stringify({ error: { code, message: '…' } }),
      'registry-a',
      '/lineages/lin-1',
      true,
    );
  }

  // The eight read-path codes, each with the status `http_status_for_acdp`
  // assigns it. A code dropped from the map fails here rather than silently
  // falling back to a status arm that says less.
  const READ_PATH: [string, number][] = [
    ['not_found', 404],
    ['not_authorized', 403],
    ['invalid_cursor', 400],
    ['cursor_expired', 400],
    ['rate_limited', 429],
    ['cross_registry_resolution_failed', 502],
    ['key_resolution_failed', 400],
    ['key_resolution_unreachable', 502],
  ];

  it.each(READ_PATH)('maps %s, and it beats the %d status arm', (code, status) => {
    const mapped = REGISTRY_ERROR_CODES.get(code);
    expect(mapped).toBeDefined();
    const msg = operatorErrorMessage(registryError(status, code), 'Could not resolve this lineage_id', {
      codes: REGISTRY_ERROR_CODES,
    });
    expect(msg).toBe(`Could not resolve this lineage_id. ${mapped}`);
  });

  // The `it.each` above computes its expectation FROM the map, so it cannot
  // catch a wrong string — it proves wiring, not copy. These pin the content.
  // Two of the eight originally had no content assertion at all, and one of
  // those two shipped an over-claim past every test in the file.
  it('does not claim a deployment-wide sweep for `not_found`', () => {
    // Every path that reaches this string queries ONE authority:
    // `authToService` takes a single `RegistryAuthority`, and both surfaces put
    // that choice behind a Registry A / Registry B picker. The first cut said
    // "No registry in this deployment has published anything under that id",
    // which is false and suppresses the likeliest fix — flip the picker.
    const msg = REGISTRY_ERROR_CODES.get('not_found')!;
    expect(msg).toContain('the registry this console asked');
    expect(msg).toContain('try the other registry');
    expect(msg).not.toMatch(/no registry|this deployment|any registry/i);
  });

  it('says `rate_limited` is retryable and not a rejection on the merits', () => {
    const msg = REGISTRY_ERROR_CODES.get('rate_limited')!;
    expect(msg).toContain('Wait and retry');
    expect(msg).toContain('nothing about this request was rejected on its merits');
  });

  it('holds no publish-side code, because this console has no publish surface', () => {
    // A mapped code that no surface can reach is untestable copy — the same
    // vacuous-fixture problem `#101` is about, in prose. These are all real
    // `wire_code()` values; none is reachable from a read.
    for (const code of [
      'duplicate_publish',
      'immutable_field',
      'superseded_target',
      'schema_violation',
      'invalid_signature',
      'not_implemented',
    ]) {
      expect(REGISTRY_ERROR_CODES.has(code)).toBe(false);
    }
  });

  it('names the same recovery for both cursor codes without collapsing them', () => {
    // RFC-ACDP-0007 keeps `invalid_cursor` (never parsed) and `cursor_expired`
    // (parsed, aged out) apart, so the map does too — but the operator's action
    // is identical and is the whole point of mapping them at all.
    const invalid = REGISTRY_ERROR_CODES.get('invalid_cursor')!;
    const expired = REGISTRY_ERROR_CODES.get('cursor_expired')!;
    expect(invalid).not.toBe(expired);
    expect(invalid).toContain('Search again from the start');
    expect(expired).toContain('Search again from the start');
    // Neither blames the query, which is what a bare 400 implies.
    expect(invalid).toContain('nothing is wrong with the query itself');
    expect(expired).toContain('nothing is wrong with the query itself');
  });

  it('keeps key resolution a could-not-check, never a failed verification', () => {
    // `error.rs:157-158` is the registry's own mirror of the
    // `CONTEXT_ID_MISMATCH` / `CONTEXT_BINDING_UNVERIFIABLE` split this module
    // exists to preserve. Neither of these establishes anything about a
    // signature, and saying otherwise is this file's oldest documented defect.
    for (const code of ['key_resolution_failed', 'key_resolution_unreachable']) {
      const msg = REGISTRY_ERROR_CODES.get(code)!;
      expect(msg).toContain('No signature has been judged either way');
      expect(msg).not.toMatch(/invalid signature|signature is bad|failed verification/i);
    }
    // …and they are told apart on the axis that matters to an operator:
    // permanent (400, the reference is unusable) vs transient (502, retry).
    expect(REGISTRY_ERROR_CODES.get('key_resolution_unreachable')).toContain('retry');
    expect(REGISTRY_ERROR_CODES.get('key_resolution_failed')).not.toContain('retry');
  });

  it('does not accuse a registry of refusing credentials it was never offered', () => {
    // The 403 arm. This console sends the registries nothing
    // (`integrations.ts` returns auth material for `control-plane` alone), so
    // the fix is a grant on the registry, not a key on this side.
    const msg = REGISTRY_ERROR_CODES.get('not_authorized')!;
    expect(msg).toContain('this console sends it no credential');
    expect(msg).not.toContain('CONTROL_PLANE_API_KEY');
  });

  it('points a federated 502 at the far registry, not the near one', () => {
    const msg = REGISTRY_ERROR_CODES.get('cross_registry_resolution_failed')!;
    expect(msg).toContain('is healthy');
    expect(msg).toContain('federated hop');
  });

  it('is prototype-safe, like the control-plane map', () => {
    // An upstream error code is attacker-influenced input from here.
    expect(REGISTRY_ERROR_CODES.get('constructor')).toBeUndefined();
    expect(REGISTRY_ERROR_CODES.get('toString')).toBeUndefined();
    expect(REGISTRY_ERROR_CODES.get('__proto__')).toBeUndefined();
  });

  it('shares no key with the control-plane map, so neither can shadow the other', () => {
    for (const k of REGISTRY_ERROR_CODES.keys()) {
      expect(CONTEXT_ERROR_MESSAGES.has(k)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// `contextErrorMessage` reaches the registry's vocabulary too.
//
// Both context surfaces call a registry DIRECTLY — `searchContexts` goes
// through `authToService(authority)` (`client.ts:645`), not the control plane —
// so a registry code arrives at that function as readily as a control-plane
// one. Without this lookup the two cursor strings were unreachable: `/contexts`
// "Load more" is the ONLY path in this console that sends a cursor
// (`app/contexts/page.tsx:62`, `client.ts:632`), and it renders
// `contextErrorMessage`, so an expired cursor fell through to the GENERIC
// sentence while the copy naming the recovery sat in a map wired to a route
// that takes no cursor parameter at all.
// ══════════════════════════════════════════════════════════════════════
describe('contextErrorMessage consults the registry map', () => {
  function registrySearchError(status: number, code: string): ApiError {
    return new ApiError(
      status,
      JSON.stringify({ error: { code, message: '…' } }),
      'registry-a',
      '/contexts/search?cursor=abc',
      true,
    );
  }

  it.each([
    ['cursor_expired', 400],
    ['invalid_cursor', 400],
  ])('names the re-search recovery for %s instead of the generic sentence', (code, status) => {
    const msg = contextErrorMessage(registrySearchError(status, code));
    expect(msg).toBe(REGISTRY_ERROR_CODES.get(code));
    expect(msg).toContain('Search again from the start');
    // The sentence this displaced. It is what the surface rendered before, and
    // it told an operator with a recoverable state precisely nothing.
    expect(msg).not.toBe('Could not load context.');
  });

  it('lets a control-plane code win over a registry one', () => {
    // Not a real collision — the vocabularies are disjoint and a sibling test
    // asserts it — but the ordering is a decision, so it is pinned rather than
    // left to whichever lookup happens to be written first.
    const err = new ApiError(
      502,
      JSON.stringify({ errorCode: 'CONTEXT_BINDING_UNVERIFIABLE' }),
      'registry-a',
      '/contexts/search',
      true,
    );
    expect(contextErrorMessage(err)).toBe(
      CONTEXT_ERROR_MESSAGES.get('CONTEXT_BINDING_UNVERIFIABLE'),
    );
  });

  it('still falls through to the status arms for an unmapped registry code', () => {
    // `schema_violation` is a real registry code that this console cannot
    // reach from a read, so it is deliberately in neither map.
    const msg = contextErrorMessage(registrySearchError(400, 'schema_violation'));
    expect(msg).toBe('Could not load context.');
  });

  it('does not let a registry 401 become "rejected this console\'s credentials"', () => {
    // The lookup misses, so this lands in `contextErrorFallback`'s 401 arm —
    // which is service-gated for exactly this reason. Asserted here because
    // routing registry errors into this function is what made a registry 401
    // reachable on a context surface for the first time.
    const msg = contextErrorMessage(registrySearchError(401, 'not_authenticated'));
    expect(msg).toBe('registry A requires credentials this console does not send.');
    expect(msg).not.toContain('rejected');
  });
});

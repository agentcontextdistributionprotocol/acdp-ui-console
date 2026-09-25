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
} from '@/lib/utils/api-error-messages';

/** An `ApiError` built the way `fetchJson` builds one: from a raw body string. */
function apiError(status: number, body: unknown): ApiError {
  return new ApiError(status, typeof body === 'string' ? body : JSON.stringify(body), 'control-plane', '/contexts/x');
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
    expect(contextErrorMessage(unknown)).toBe(contextErrorFallback(502));
    expect(contextErrorMessage(unknown)).not.toBe(contextErrorMessage(mismatch));
  });

  it('an ABSENT errorCode (a non-JSON body) falls back on status', () => {
    const html = apiError(502, '<html>502 Bad Gateway</html>');
    expect(html.errorCode).toBeUndefined();
    expect(contextErrorMessage(html)).toBe(contextErrorFallback(502));
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
    expect(contextErrorFallback(403)).toMatch(/not authorized/i);
    expect(contextErrorFallback(429)).toMatch(/rate limiting/i);
    expect(contextErrorFallback(503)).toMatch(/rate limiting|unavailable/i);
    expect(contextErrorFallback(500)).toMatch(/did not return this context/i);
    expect(contextErrorFallback(400)).toBe('Could not load context.');
    // …and they are genuinely distinct, not four aliases of the default.
    const named = [403, 404, 429, 500].map(contextErrorFallback);
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
    expect(contextErrorMessage(blank)).toBe(contextErrorFallback(502));
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

describe('the lookup is defensive about where a code came from', () => {
  it('does NOT case-fold — registry codes are snake_case and must not alias', () => {
    // `fetcher.ts`'s `error.code` fallback also matches the registry's
    // RFC-ACDP-0007 §5 envelope, so lowercase codes do arrive here. Folding
    // case would manufacture the collision the two vocabularies avoid today.
    const registryStyle = apiError(502, { error: { code: 'context_id_mismatch' } });
    expect(registryStyle.errorCode).toBe('context_id_mismatch');
    expect(contextErrorMessage(registryStyle)).toBe(contextErrorFallback(502));
    expect(contextErrorMessage(registryStyle)).not.toBe(contextErrorMessage(mismatch));
  });

  it('a prototype-chain key cannot leak a function into the UI', () => {
    // An upstream error code is attacker-influenced input from this console's
    // point of view. A plain-object map would resolve these through the
    // prototype chain and hand a *function* to a surface rendering an error.
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const msg = contextErrorMessage(apiError(502, { errorCode: code }));
      expect(typeof msg).toBe('string');
      expect(msg).toBe(contextErrorFallback(502));
    }
  });

  it('a registry rate_limited envelope still reaches an actionable message by status', () => {
    // Not via the map — the registry's code is not in it — but a 429 must not
    // read as "could not load", which tells the operator nothing to do.
    const msg = contextErrorMessage(apiError(429, { error: { code: 'rate_limited' } }));
    expect(msg).toMatch(/rate limiting/i);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The fail-closed definition itself. Every revocation surface derives from
// these helpers, so a mistake here is a mistake on all of them at once — which
// is exactly why the definition was centralised instead of being re-expressed
// per surface.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  failClosedEntries,
  hasFailClosedRevocation,
  isFailClosed,
  isHistoricallyAuthorized,
  preCompromiseEntries,
  revocationChipClass,
  failClosedCount,
  undetailedFailClosedCount,
  hasTrustViolation,
  violationCount,
  runRevocationReported,
  dashboardRevocationReported,
  isKeyRevocationFacet,
  KEY_REVOCATION_TYPE_ALIASES,
  type RevocationEntry,
} from '@/lib/utils/revocation';

function entry(status: string, eventId = status): RevocationEntry {
  return {
    eventId,
    ctxId: null,
    status,
    boundary: '2026-08-01 00:00:00+00',
    trustClass: 'producer_signed',
    sources: [],
  };
}

describe('isFailClosed', () => {
  it('pre_compromise is NOT a violation — it is historically authorized', () => {
    // The control plane's own docs define this as the receipt-attested
    // created_at verifying strictly BEFORE the compromise boundary. Counting
    // it as a violation is the over-claim this module exists to prevent.
    expect(isFailClosed('pre_compromise')).toBe(false);
    expect(isHistoricallyAuthorized('pre_compromise')).toBe(true);
  });

  it('revoked_at_or_after and revoked_time_unverifiable are both violations', () => {
    expect(isFailClosed('revoked_at_or_after')).toBe(true);
    // RFC-ACDP-0014 §7: an unprovable ordering is not an authorization.
    expect(isFailClosed('revoked_time_unverifiable')).toBe(true);
  });

  it('an UNKNOWN status fails closed, not open', () => {
    // Upstream's column is varchar(32) with no CHECK constraint, so a newer
    // control plane can emit a status this console has never seen. The safe
    // reading of a trust verdict we do not understand is "this may be a
    // violation" — never "this is authorized". This is the assertion that
    // makes the allow-list implementation load-bearing rather than stylistic.
    expect(isFailClosed('revoked_quantum_resistant_something')).toBe(true);
    expect(isFailClosed('')).toBe(true);
    expect(isHistoricallyAuthorized('totally_new_status')).toBe(false);
  });
});

describe('counting', () => {
  const mixed = [
    entry('pre_compromise'),
    entry('revoked_at_or_after'),
    entry('revoked_time_unverifiable'),
    entry('something_new'),
  ];

  it('separates the authorized entry from the three violations', () => {
    expect(failClosedEntries(mixed)).toHaveLength(3);
    expect(preCompromiseEntries(mixed)).toHaveLength(1);
    // The union is the whole array — nothing is dropped or double-counted.
    expect(failClosedEntries(mixed).length + preCompromiseEntries(mixed).length).toBe(mixed.length);
  });

  it('a pre_compromise-only run carries NO violation', () => {
    // The inverse criterion, and as important as the positive one: fixing the
    // under-claim must not introduce a false alarm on an authorized event.
    const authorizedOnly = [entry('pre_compromise', 'a'), entry('pre_compromise', 'b')];
    expect(hasFailClosedRevocation(summary({ revoked: authorizedOnly }))).toBe(false);
    expect(failClosedEntries(authorizedOnly)).toHaveLength(0);
  });

  it('tolerates undefined and empty without pretending either is a clean result', () => {
    // NB: "no fail-closed entries" is not the same claim as "revocation was
    // checked and found nothing" — that distinction is Phase 3's, and these
    // helpers deliberately do not speak to it.
    expect(hasFailClosedRevocation(summary({ revoked: undefined }))).toBe(false);
    expect(hasFailClosedRevocation(summary({ revoked: [] }))).toBe(false);
    expect(failClosedEntries(undefined)).toEqual([]);
    expect(preCompromiseEntries(undefined)).toEqual([]);
  });

  it('hasFailClosedRevocation CANNOT disagree with the number rendered beside it', () => {
    // It could, and did. The predicate took `revoked[]` and nothing else, so on
    // the exact payload the counter hardening exists for it answered "clean"
    // while `failClosedCount` answered 2. It survived review because it had
    // zero callers — every real one had already moved to `failClosedCount` —
    // behind a docblock that named three. A boolean and a count derived from
    // one payload must not be able to contradict each other, so it now
    // delegates rather than re-deriving the rule.
    const counterOnly = summary({
      revoked: [],
      keyRevocationRevokedAtOrAfter: 2,
      keyRevocationRevokedTimeUnverifiable: 0,
    });
    expect(failClosedCount(counterOnly)).toBe(2);
    expect(hasFailClosedRevocation(counterOnly)).toBe(true);

    // …and the agreement is total, not a single lucky fixture.
    const payloads = [
      summary({ revoked: [] }),
      summary({ revoked: [entry('pre_compromise')] }),
      summary({ revoked: [entry('revoked_at_or_after')] }),
      summary({ revoked: [entry('something_new')] }),
      summary({ revoked: [], keyRevocationRevokedTimeUnverifiable: 1 }),
      summary({ revoked: [], keyRevocationPreCompromise: 3 }),
      summary({ revoked: [entry('pre_compromise')], keyRevocationRevokedAtOrAfter: 1 }),
    ];
    for (const p of payloads) {
      expect(hasFailClosedRevocation(p)).toBe(failClosedCount(p) > 0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// The one place the two phases modelled the same payload differently.
//
// Phase 3 taught "was revocation reported?" to read the aggregate COUNTERS.
// Phase 2's "is this a violation?" still read only the per-event ARRAY. So a
// payload with `revokedAtOrAfter: 2` and an empty `revoked[]` had the newer
// half saying "we checked" and the older half saying "clean" — a green
// check-mark beside a rendered `Revoked 0`, which is the exact outcome Phase 2
// exists to prevent, reached through Phase 3's own gate.
//
// Upstream cannot currently emit it (both derive from one row set), but this
// module already hardens the status VOCABULARY against a newer control plane;
// leaving the payload SHAPE unhardened in the fail-OPEN direction contradicted
// its own stated posture.
// ══════════════════════════════════════════════════════════════════════
describe('failClosedCount — neither source is trusted to be complete', () => {
  const counterOnly = summary({
    revoked: [],
    keyRevocationRevokedAtOrAfter: 2,
    keyRevocationRevokedTimeUnverifiable: 0,
  });

  it('counts fail-closed verdicts the counters report but the array omits', () => {
    expect(failClosedCount(counterOnly)).toBe(2);
    expect(undetailedFailClosedCount(counterOnly)).toBe(2);
  });

  it('DISCRIMINATES: such a run is a violation, not a green check-mark', () => {
    expect(hasTrustViolation(counterOnly)).toBe(true);
    expect(violationCount(counterOnly)).toBe(2);
  });

  it('counts entries the counters omit, in the other direction', () => {
    // An older control plane populating only the array.
    const arrayOnly = summary({ revoked: [entry('revoked_at_or_after'), entry('revoked_time_unverifiable')] });
    expect(failClosedCount(arrayOnly)).toBe(2);
    expect(undetailedFailClosedCount(arrayOnly)).toBe(0);
  });

  it('does not double-count when the two sources agree, as upstream always makes them', () => {
    const agreed = summary({
      revoked: [entry('revoked_at_or_after'), entry('pre_compromise')],
      keyRevocationRevokedAtOrAfter: 1,
      keyRevocationPreCompromise: 1,
    });
    expect(failClosedCount(agreed)).toBe(1);
    expect(undetailedFailClosedCount(agreed)).toBe(0);
  });

  it('never counts pre_compromise, from either source', () => {
    const authorized = summary({ revoked: [entry('pre_compromise')], keyRevocationPreCompromise: 9 });
    expect(failClosedCount(authorized)).toBe(0);
    expect(hasTrustViolation(authorized)).toBe(false);
  });
});

describe('revocationChipClass', () => {
  it('styles the three known statuses by severity', () => {
    expect(revocationChipClass('pre_compromise')).toBe('chip ok');
    expect(revocationChipClass('revoked_time_unverifiable')).toBe('chip warn');
    expect(revocationChipClass('revoked_at_or_after')).toBe('chip bad');
  });

  it('an unknown status gets the fail-closed style, never an unstyled chip', () => {
    // Previously `REVOKED_STATUS_CHIP[status]` returned `undefined` here, so
    // the chip rendered unstyled — visually neutral, which is the most
    // misleading possible rendering of a verdict we cannot interpret.
    expect(revocationChipClass('brand_new_status')).toBe('chip bad');
    expect(revocationChipClass('brand_new_status')).not.toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Was revocation checked AT ALL? A different question from "is this verdict a
// violation", and the payload cannot answer it directly: the counters are
// always numbers (`?? 0`) and `revoked` is always present (`[]` when the check
// is disabled), while `KEY_REVOCATION_CHECK_ENABLED` — default false — reaches
// no run-scoped surface. (acdp-control-plane#176 shipped a `features` flag, but
// on `/dashboard/overview` only — see lib/utils/revocation.ts.)
// ══════════════════════════════════════════════════════════════════════
function summary(over: Partial<Parameters<typeof runRevocationReported>[0]> = {}) {
  return {
    audited: 4,
    verified: 4,
    verifiedHistorical: 0,
    structural: 0,
    noReceipt: 0,
    errors: 0,
    flagged: [],
    ...over,
  } as Parameters<typeof runRevocationReported>[0];
}

describe('runRevocationReported', () => {
  it('PROOF ARM: audited === 0 is not-reported even with non-zero counters', () => {
    // Upstream enforces that the revocation check REQUIRES receipt audit, so
    // zero audited events is evidence, not a guess. Counters that disagree are
    // a payload to distrust, not a reason to render.
    expect(
      runRevocationReported(
        summary({
          audited: 0,
          keyRevocationPreCompromise: 5,
          keyRevocationRevokedAtOrAfter: 2,
        }),
      ),
    ).toBe(false);
  });

  it('HEURISTIC ARM: all-zero counters with nothing in `revoked` is not-reported', () => {
    expect(
      runRevocationReported(
        summary({
          revoked: [],
          keyRevocationPreCompromise: 0,
          keyRevocationRevokedAtOrAfter: 0,
          keyRevocationRevokedTimeUnverifiable: 0,
        }),
      ),
    ).toBe(false);
  });

  it('any single non-zero counter makes the whole payload trustworthy', () => {
    // Including the zeros beside it: something was classified, so the zeros
    // are a measurement rather than an unexamined default.
    for (const k of [
      'keyRevocationPreCompromise',
      'keyRevocationRevokedAtOrAfter',
      'keyRevocationRevokedTimeUnverifiable',
    ] as const) {
      expect(runRevocationReported(summary({ [k]: 1 }))).toBe(true);
    }
  });

  it('a non-empty `revoked` array reports even when the counters are absent', () => {
    // The array is the detail and the counters are the aggregate; against an
    // older control plane only one of them may be populated.
    expect(runRevocationReported(summary({ revoked: [entry('pre_compromise')] }))).toBe(true);
  });

  it('entries outrank the defensive zero — a listed verdict is never denied', () => {
    // `audited: 0` with entries is an impossible payload, but the panel renders
    // those entries regardless of this predicate, so ordering the guard ahead
    // of them made the UI contradict itself. Ordering matters; assert it.
    expect(runRevocationReported(summary({ audited: 0, revoked: [entry('revoked_at_or_after')] }))).toBe(true);
  });

  it('missing counters are not read as zeros that prove anything', () => {
    expect(runRevocationReported(summary())).toBe(false);
  });
});

describe('dashboardRevocationReported', () => {
  it('a pre-Phase-14 backend that omits the field is not-reported', () => {
    expect(dashboardRevocationReported(undefined)).toBe(false);
  });

  it('all-zero is not-reported; any non-zero reports', () => {
    expect(
      dashboardRevocationReported({ preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 }),
    ).toBe(false);
    expect(
      dashboardRevocationReported({ preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 1 }),
    ).toBe(true);
  });
});

describe('isKeyRevocationFacet', () => {
  it('both RFC-ACDP-0014 §10 spellings select the union', () => {
    expect(KEY_REVOCATION_TYPE_ALIASES).toEqual(['key-revocation', 'acdp:key-revocation']);
    for (const t of KEY_REVOCATION_TYPE_ALIASES) expect(isKeyRevocationFacet(t)).toBe(true);
  });

  it('no other value does — the fan-out and its cursor loss are opt-in', () => {
    for (const t of ['analysis', 'data_snapshot', 'key_revocation', '', undefined]) {
      expect(isKeyRevocationFacet(t)).toBe(false);
    }
  });
});

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
    expect(hasFailClosedRevocation(authorizedOnly)).toBe(false);
    expect(failClosedEntries(authorizedOnly)).toHaveLength(0);
  });

  it('tolerates undefined and empty without pretending either is a clean result', () => {
    // NB: "no fail-closed entries" is not the same claim as "revocation was
    // checked and found nothing" — that distinction is Phase 3's, and these
    // helpers deliberately do not speak to it.
    expect(hasFailClosedRevocation(undefined)).toBe(false);
    expect(hasFailClosedRevocation([])).toBe(false);
    expect(failClosedEntries(undefined)).toEqual([]);
    expect(preCompromiseEntries(undefined)).toEqual([]);
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
// is disabled), while `KEY_REVOCATION_CHECK_ENABLED` — default false — is on
// no HTTP surface. Provisional until acdp-control-plane#176.
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

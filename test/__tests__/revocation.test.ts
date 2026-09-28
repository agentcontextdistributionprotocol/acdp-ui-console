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
  dashboardRevocationState,
  type DashboardRevocationState,
  isKeyRevocationFacet,
  KEY_REVOCATION_TYPE_ALIASES,
  type RevocationEntry,
} from '@/lib/utils/revocation';
import type { CpDashboardFeatures, DashboardRevocation } from '@/lib/types';

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

// MIGRATED, not deleted (#97). `dashboardRevocationReported` no longer exists;
// each of its two tests maps onto a named `kind` of its replacement, and the
// mapping is the point of the change:
//
//   "a backend that omits the field is not-reported"
//     -> `dashboardRevocationState(undefined, undefined).kind === 'unknown'`
//        The old name said "not reported", which the dashboard then rendered as
//        a claim about the deployment. `unknown` is what the evidence supports.
//
//   "all-zero is not-reported; any non-zero reports"
//     -> all-zero now SPLITS on whether the deployment says it ran the check:
//        `checked-clean` when it did, `disabled` when it says it did not,
//        `unknown` when it cannot say. Any non-zero is still `reported`, and is
//        still reported even when the flags disagree, because a count is
//        self-evidencing.
//
// Every one of those four is asserted in the block above, which is why nothing
// is lost by this removal.

// ══════════════════════════════════════════════════════════════════════
// The tri-state that replaces the boolean (#97).
//
// The boolean above collapses "ran the check, found nothing" and "never looked"
// into one rendering, so an operator could not tell a clean estate from an
// unmonitored one. Every arm below is a thing the console could not previously
// say, or a thing it was saying without warrant.
// ══════════════════════════════════════════════════════════════════════
describe('dashboardRevocationState', () => {
  const ALL_ON: CpDashboardFeatures = {
    receiptAudit: true,
    keyRevocationCheck: true,
    logWitness: true,
    logInclusionAudit: true,
    witnessCosigning: true,
    witnessQuorum: true,
  };
  const CLEAN = { preCompromise: 0, revokedAtOrAfter: 0, revokedTimeUnverifiable: 0 };
  const SOME = { preCompromise: 0, revokedAtOrAfter: 2, revokedTimeUnverifiable: 0 };

  it('counters with something in them are reported, and carry the counts through', () => {
    const state = dashboardRevocationState(SOME, ALL_ON);
    expect(state.kind).toBe('reported');
    // The narrowing that replaces the type predicate: `counts` is reachable
    // without a `!` because the discriminant guarantees it.
    if (state.kind === 'reported') expect(state.counts).toBe(SOME);
  });

  it('EVERY counter is self-evidencing on its own, including revokedTimeUnverifiable', () => {
    // The gate's finding, and a real hole: the migration of
    // `dashboardRevocationReported` dropped the one probe its predecessor
    // carried ({0,0,1}), and no fixture in any of the three touched test files
    // set `revokedTimeUnverifiable` non-zero afterwards. Deleting that disjunct
    // survived all 980 tests, and under the mutant a payload carrying five
    // time-unverifiable findings rendered "classified nothing" — a false
    // all-clear on a trust surface.
    //
    // One case per disjunct, each with the other two at zero, so no one of them
    // can carry another.
    const only = (k: keyof DashboardRevocation): DashboardRevocation => ({
      preCompromise: 0,
      revokedAtOrAfter: 0,
      revokedTimeUnverifiable: 0,
      [k]: 1,
    });
    for (const k of ['preCompromise', 'revokedAtOrAfter', 'revokedTimeUnverifiable'] as const) {
      expect(dashboardRevocationState(only(k), ALL_ON).kind, k).toBe('reported');
      // …and with no flags at all, which is the route the counters have to
      // stand up on their own.
      expect(dashboardRevocationState(only(k), undefined).kind, k).toBe('reported');
    }
  });

  it('reports non-zero counters even when the flag disagrees', () => {
    // Self-evidencing: a non-zero count means the check ran and found that,
    // whatever the deployment claims about itself. Rendering "disabled" over
    // live figures would be the worse error.
    expect(dashboardRevocationState(SOME, { ...ALL_ON, keyRevocationCheck: false }).kind).toBe('reported');
    expect(dashboardRevocationState(SOME, undefined).kind).toBe('reported');
  });

  it('zeros WITH the check enabled is checked-clean — the state #97 exists for', () => {
    expect(dashboardRevocationState(CLEAN, ALL_ON).kind).toBe('checked-clean');
  });

  it('the check explicitly off is disabled, not clean', () => {
    expect(dashboardRevocationState(CLEAN, { ...ALL_ON, keyRevocationCheck: false }).kind).toBe('disabled');
    // And `null` counters — what upstream actually sends when it is off.
    expect(dashboardRevocationState(null, { ...ALL_ON, keyRevocationCheck: false }).kind).toBe('disabled');
  });

  it('distinguishes WHY it is unknown, because the three license different copy', () => {
    // The gate's second finding, then its second round's first finding. The arm
    // first inherited the pre-#178 hedge ("the check is disabled by default")
    // on the argument that it IS a pre-#178 backend — true of one route only.
    // Splitting it in two was not enough either: the merged
    // flag-says-on/flag-unreadable reason carried copy describing the first,
    // which is false on the second. A `because` names a fact that holds on
    // EVERY route carrying it, so there are three.
    expect(dashboardRevocationState(CLEAN, undefined)).toEqual({
      kind: 'unknown',
      because: 'no-flags',
    });

    // Flag reads exactly `true`, but no counters arrived at all. Both halves of
    // this route's copy are checkable facts here and nowhere else.
    expect(dashboardRevocationState(null, ALL_ON)).toEqual({
      kind: 'unknown',
      because: 'flag-on-no-counters',
    });
    expect(dashboardRevocationState(undefined, ALL_ON)).toEqual({
      kind: 'unknown',
      because: 'flag-on-no-counters',
    });

    // A features object arrived with an unreadable flag. NOT `no-flags`: we are
    // demonstrably not talking to a backend that predates the field. And NOT
    // the route above: the counters here are PRESENT and zero, so copy saying
    // "sent no counters at all" would be false.
    const stringy = { ...ALL_ON, keyRevocationCheck: 'true' } as unknown as CpDashboardFeatures;
    expect(dashboardRevocationState(CLEAN, stringy)).toEqual({
      kind: 'unknown',
      because: 'flag-unreadable',
    });
    // Same reason with the counters ABSENT — the route is about the flag, not
    // the counters, so it must not fork on them.
    expect(dashboardRevocationState(null, stringy)).toEqual({
      kind: 'unknown',
      because: 'flag-unreadable',
    });

    // All three are reachable, so no arm is dead code. Read through a narrowing
    // helper rather than asserting on literals, so this fails if any two routes
    // ever start returning the same reason.
    const reasonOf = (x: DashboardRevocationState) => (x.kind === 'unknown' ? x.because : null);
    const reasons = [
      reasonOf(dashboardRevocationState(CLEAN, undefined)),
      reasonOf(dashboardRevocationState(null, ALL_ON)),
      reasonOf(dashboardRevocationState(CLEAN, stringy)),
    ];
    expect(new Set(reasons).size).toBe(3);
    expect(reasons).not.toContain(null);
  });

  it('a null or non-object `features` is `no-flags`, and does not throw', () => {
    // Found by round 2 of this change's gate: `features === undefined` is false
    // for `null`, and the next line dereferenced it — crashing the whole
    // `/dashboard` route, which calls this inline in its render tree. `/trust`
    // was already null-safe through `?.`, so the two surfaces disagreed about
    // the same wire payload.
    const nully = null as unknown as CpDashboardFeatures;
    expect(() => dashboardRevocationState(CLEAN, nully)).not.toThrow();
    expect(dashboardRevocationState(CLEAN, nully)).toEqual({
      kind: 'unknown',
      because: 'no-flags',
    });
    // Not an object at all. `flag-unreadable` would claim a feature report
    // arrived; a string is not one, so the honest reason is the same as sending
    // nothing.
    for (const junk of ['true', 42, false] as unknown as CpDashboardFeatures[]) {
      expect(() => dashboardRevocationState(CLEAN, junk)).not.toThrow();
      expect(dashboardRevocationState(CLEAN, junk)).toEqual({
        kind: 'unknown',
        because: 'no-flags',
      });
    }
    // DISCRIMINATING: a real object with an unreadable flag is still the OTHER
    // reason, so the guard above did not just swallow everything.
    const stringy = { ...ALL_ON, keyRevocationCheck: 'true' } as unknown as CpDashboardFeatures;
    expect(dashboardRevocationState(CLEAN, stringy)).toEqual({
      kind: 'unknown',
      because: 'flag-unreadable',
    });
  });

  it('no features at all is unknown — a pre-#178 control plane', () => {
    // NOT `checked-clean`, and not `disabled`. Zeros from a backend that cannot
    // tell us whether it looked are exactly the legacy heuristic's blind spot,
    // and the honest answer is that we do not know.
    expect(dashboardRevocationState(CLEAN, undefined).kind).toBe('unknown');
    expect(dashboardRevocationState(undefined, undefined).kind).toBe('unknown');
    expect(dashboardRevocationState(null, undefined).kind).toBe('unknown');
  });

  it('null counters WITH the check enabled is unknown — a state upstream cannot produce', () => {
    // Both derive from one config value (`dashboard.service.ts:39` and `:240`),
    // so this combination means something is wrong. Asserting `checked-clean`
    // here would be claiming a clean estate on the strength of a contradiction.
    expect(dashboardRevocationState(null, ALL_ON).kind).toBe('unknown');
    expect(dashboardRevocationState(undefined, ALL_ON).kind).toBe('unknown');
  });

  it('reads the flag as === true / === false, never for truthiness', () => {
    // A wire payload with the flag missing or non-boolean gets past the type but
    // not past the function. Truthiness would send `undefined` to `disabled`,
    // which asserts the operator turned the check off — a claim from an absence.
    const partial = { ...ALL_ON, keyRevocationCheck: undefined } as unknown as CpDashboardFeatures;
    expect(dashboardRevocationState(CLEAN, partial).kind).toBe('unknown');
    const stringy = { ...ALL_ON, keyRevocationCheck: 'true' } as unknown as CpDashboardFeatures;
    expect(dashboardRevocationState(CLEAN, stringy).kind).toBe('unknown');
    // The mirror image: a string 'false' must not read as disabled either.
    const stringyFalse = { ...ALL_ON, keyRevocationCheck: 'false' } as unknown as CpDashboardFeatures;
    expect(dashboardRevocationState(CLEAN, stringyFalse).kind).toBe('unknown');
  });

  it('every arm is reachable and they are four distinct kinds', () => {
    // Without this, three arms could collapse onto one name and the tests above
    // would each still pass in isolation.
    const kinds = [
      dashboardRevocationState(SOME, ALL_ON).kind,
      dashboardRevocationState(CLEAN, ALL_ON).kind,
      dashboardRevocationState(CLEAN, { ...ALL_ON, keyRevocationCheck: false }).kind,
      dashboardRevocationState(CLEAN, undefined).kind,
    ];
    expect(new Set(kinds).size).toBe(4);
    expect(kinds).toEqual(['reported', 'checked-clean', 'disabled', 'unknown']);
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

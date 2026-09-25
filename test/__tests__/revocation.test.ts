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

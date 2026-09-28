/**
 * A literal mirror of `REGISTRY_ADVERTISABLE_PROFILES` from
 * `acdp-registry-rs/crates/acdp-registry-types/src/config.rs:332-340` — the set
 * `acdp-registry-server/src/main.rs:415-431` enforces at STARTUP, so a registry
 * advertising anything outside it does not run.
 *
 * ONE mirror, two claims. It lived in two test files, copied. `mock-data.test.ts`
 * bounds what the FIXTURES may advertise; `registry-card-profiles.test.tsx`
 * bounds what the component must have tooltip COPY for. Those are different
 * claims about the same set, and while each copy had its own guards, only one
 * of them pinned the list exactly — so an entry could be dropped from the other
 * and nothing went red. A mirror that is allowed to disagree with itself is not
 * a mirror. It is shared from here so that both claims are made against the
 * same seven strings, and so the guards below hold for both.
 *
 * Mirrored rather than imported on purpose. A cross-repo import is not
 * available here and would be wrong if it were: this repo must not take a
 * dependency on a Rust crate's source layout.
 *
 * BE PRECISE ABOUT WHAT THE MIRROR CAN AND CANNOT DETECT, because the first
 * version of this comment got it backwards. A hand-copied list has no coupling
 * to its source, so nothing here observes upstream at all. The two staleness
 * directions are not symmetric:
 *
 *   Upstream ADDS an eighth profile → the mirror is now STRICTER than reality.
 *     A fixture advertising the new id fails the subset check. That is a false
 *     red, which is loud and self-explaining — annoying, not dangerous.
 *
 *   Upstream REMOVES or RENAMES one → the mirror is now MORE PERMISSIVE than
 *     reality. A fixture advertising the dead id passes while a real registry
 *     refuses to boot on it — the exact defect #95 was. Nothing in this repo
 *     can see that happen. A length assertion does not help: the removal
 *     changes a number upstream and no number here.
 *
 * So the guards make NO claim about upstream. What they pin is the local
 * failure mode, which is the likely one: the cheapest way to make an invalid
 * fixture or an unreachable tooltip pass is to edit THIS list, in either
 * direction.
 *
 * The mitigation for the unguarded direction is not a test, it is provenance:
 * the file:line above is where to re-check, and upstream keeps ITS copy honest
 * with a conformance test (`registry_advertisable_profiles_matches_spec_derived_set`)
 * that recomputes the set from the pinned spec's `registries/profiles.json`, so
 * the const cannot drift from the SPEC without upstream CI going red first. A
 * machine-readable list this repo could actually consume is requested in
 * `acdp-registry-rs#347`; until one exists, a mirror plus a citation is the
 * honest ceiling.
 */
export const REGISTRY_ADVERTISABLE_PROFILES = [
  'acdp-registry-core',
  'acdp-registry-discovery',
  'acdp-registry-federated',
  'acdp-registry-receipts',
  'acdp-registry-head-receipts',
  'acdp-registry-transparency-log',
  'acdp-registry-lifecycle',
];

/**
 * The ids a registry may NOT advertise, kept by name so both consumers can
 * assert they stay gone without re-stating them.
 *
 * THREE, and only two of them are "the ids #95 removed" — this docblock said
 * "the two ids #95 removed" for a commit after the third was added, above a
 * three-element list. `acdp-log-witness` was never in the fixtures and so was
 * never removed from them; it is here because upstream excludes it BY NAME and
 * calls confusing it for a registry the most likely operator mistake. A guard
 * named after the issue that prompted it, rather than after the set it
 * defends, goes stale the moment the set grows — which is what happened.
 *
 *   `acdp-consumer`  — a real spec id, but a CONSUMER profile. The doc comment
 *                      on `REGISTRY_ADVERTISABLE_PROFILES` excludes it by name:
 *                      a registry is forbidden to advertise it.
 *   `acdp-federated` — not a spec id at all. The real one is
 *                      `acdp-registry-federated`.
 *   `acdp-log-witness` — a real spec id that upstream excludes BY NAME
 *                      (`config.rs:318`: "a witness is NOT a registry"), and
 *                      the one `acdp-registry-server/src/main.rs:417-424`
 *                      gives its own bail message to, because "a well-meaning
 *                      operator confusing 'runs a witness' with 'is a registry'
 *                      is the most likely mistake here". #95 did not surface it
 *                      because the demo fixtures never advertised it — but a
 *                      guard that covers the two ids one issue happened to find
 *                      and not the one upstream calls most likely is guarding
 *                      the wrong set.
 */
export const NOT_ADVERTISABLE = ['acdp-consumer', 'acdp-federated', 'acdp-log-witness'];

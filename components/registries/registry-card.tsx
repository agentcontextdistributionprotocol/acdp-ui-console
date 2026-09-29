'use client';

import { StatusDot } from '@/components/ui/status-dot';
import { Badge } from '@/components/ui/badge';
import { formatNumber, timeAgo } from '@/lib/utils/format';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';

/**
 * The ids a registry may advertise — a local mirror of
 * `REGISTRY_ADVERTISABLE_PROFILES`
 * (`acdp-registry-rs/crates/acdp-registry-types/src/config.rs:332-340`), the
 * set `acdp-registry-server/src/main.rs:415-431` enforces at STARTUP, so a
 * registry advertising anything outside it does not boot.
 *
 * It is `as const` and it types the copy table below, which is the point:
 * "`PROFILE_INFO` has copy for exactly these seven ids" then stops being a
 * claim a test has to police and becomes a condition `tsc` enforces. An eighth
 * key is an excess-property error; a missing one is a missing-property error.
 * Six successive test-shaped guards failed to hold that line (the list, and the
 * authoritative count, are in `test/support/profile-copy-table.ts`'s header —
 * restating either here is how five files came to disagree about it); the type
 * system holds it for free.
 *
 * It is mirrored rather than imported because the shared mirror lives under
 * `test/`, and production code must not import from the test tree.
 * `registry-card-profiles.test.tsx` asserts the two mirrors are identical, so
 * they cannot drift.
 */
const ADVERTISABLE_PROFILE_IDS = [
  'acdp-registry-core',
  'acdp-registry-discovery',
  'acdp-registry-federated',
  'acdp-registry-receipts',
  'acdp-registry-head-receipts',
  'acdp-registry-transparency-log',
  'acdp-registry-lifecycle',
] as const;

type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];

/**
 * Tooltip copy for known registry profiles (registries/profiles.md). The
 * 0.3.0 trust profiles get an accent chip so they stand out in the list.
 *
 * Entries for `acdp-consumer` and `acdp-federated` were removed with #95: the
 * first is a profile a registry is forbidden to advertise and the second is not
 * a spec id at all, so copy for either was unreachable text that ratified two
 * invalid ids for whoever read it next. An id with no entry here still renders
 * — see `glossFor` and the fallback below — so removing them costs nothing if
 * one somehow reappears.
 *
 * **Not exported, and that is a fix rather than an oversight.** Exporting it so
 * a test could read `Object.keys` OPENED A ROUTE THAT DID NOT EXIST BEFORE: any
 * module could then `import { PROFILE_INFO }` and assign a key at module scope,
 * and because Vitest isolates module graphs per test file the guard went on
 * seeing a pristine seven while the app rendered the copy #95 deleted.
 *
 * WHAT GUARDS THIS, honestly, because five earlier versions of this comment
 * each over-claimed and the over-claim is how the next hole got missed:
 *
 *   - `tsc` bounds THE KEYS OF THIS OBJECT, via the type above. Exactly seven,
 *     exactly these — an eighth key is an excess-property error and a missing
 *     one a missing-property error.
 *
 *     "Nothing else is needed for that claim" is what this bullet used to say,
 *     and round 13 was right to call it the fifth over-claim in a comment about
 *     over-claiming. The type bounds the keys only for as long as the ANNOTATION
 *     says `Record<AdvertisableProfileId, …>`; widening it to `Record<string, …>`
 *     is a one-word edit that tsc is then perfectly happy with. What holds that
 *     line is `assertEveryStringLiteralIsLicensed()` (a new key is a string
 *     literal, and an unlicensed one is refused) plus the gloss-table equality
 *     in `registry-card-profiles.test.tsx`, which compares this whole table
 *     against a hand copy under `test/support/`.
 *   - `assertNoCopyOutsideTable()` bounds THE REST OF THIS FILE: it walks the
 *     whole file, not just module scope, and refuses any other object literal
 *     carrying a `title`. A second lookup table, a gloss built inside the
 *     component, a parameter default, a nested component with its own table
 *     and a JSX-spread `{...{title}}` are all that shape. A module-scope-only
 *     guard shipped once and lost five kills the version before it had.
 *   - `assertModuleShape()` bounds WHAT MAY BE IMPORTED — by binding name, not
 *     just by module specifier. Allow-listing a specifier alone left four
 *     unbounded suppliers of copy: `import { PROFILE_GLOSS } from
 *     '@/lib/utils/format'` was on the allow-list. Binding names narrow WHICH
 *     suppliers remain unbounded; they do not close the channel, because a
 *     name says nothing about the value behind it. `timeAgo` could be edited
 *     to return copy. The render probes are what catch that.
 *   - `assertNoRuntimeCopyForms()` bounds the VERBS that attach copy with no
 *     property literal to find — `Object.assign`/`create`/`defineProperty`/
 *     `setPrototypeOf`, `Reflect.*`, `new Proxy`. A check like this existed
 *     two revisions ago and was deleted by a "fix"; an in-body Proxy get-trap
 *     went red to green on that commit.
 *   - `assertNoAlternateDisclosureChannel()` bounds `aria-*`, `data-*` and
 *     `dangerouslySetInnerHTML`. A comment used to assert the render probes
 *     read those, then a correction claimed they read only `title`,
 *     `className` and `textContent`. Both were wrong in turn: `attributesOf()`
 *     reads EVERY attribute and the probes assert the exact key set.
 *   - The render probes bound WHAT REACHES THE SCREEN, across a matrix of both
 *     props. Neither prop axis may be fixed: copy conditioned on
 *     `registry.authority` was invisible to a probe that always passed
 *     registry-b, and that is exactly the defect #95 is — copy for an id one
 *     deployment cannot advertise. POSITION within `capabilities.profiles` is
 *     the third axis and was fixed for two rounds after the other two were
 *     varied: every probe rendered a one-element array, so a gloss gated on
 *     `i > 0` disclosed freely.
 *
 *     "All three vary now" was the previous sentence here, and it was the
 *     wrong idea rather than an incomplete one. Widening the matrix moved the
 *     escape rather than closing it — `i > 2` cleared the new position axis,
 *     and `registry.lastSeen`, `capabilities.anonymous_public_reads` and
 *     `registry.eventCount` cleared it by using fields the fixtures hold
 *     constant. The input space is infinite; no finite matrix closes it.
 *   - `assertGlossIsPureOfId()` closes it by construction instead: the map
 *     callback is denied the index parameter and `info` may only ever be
 *     `glossFor(p)`, so the gloss is a function of the profile id at every
 *     index and every field value, with nothing enumerated. It now also
 *     refuses a SECOND `.map(...)` of ANY receiver — it bound only the last
 *     `capabilities.profiles.map` in source order, and an earlier one carrying
 *     `i > 2` was green; then it recognised a second map by comparing receiver
 *     TEXT, and `capabilities.profiles.filter(() => true).map(...)` carrying
 *     `i > 8` was green too (round 15's B3, 975/975). Round 16 inverted the
 *     enumeration — collect every `.map` in the file, require each one's
 *     receiver to be exactly `capabilities.profiles` — and round 17 beat THAT
 *     with `capabilities.profiles.flatMap(…)`, which is not a `.map` at all and
 *     so was collected by nothing.
 *
 *     What is bounded now is the SUPPLY rather than the uses: the expression
 *     `capabilities.profiles` may be dereferenced EXACTLY ONCE in this file,
 *     and that one dereference must be the receiver of a `.map` that is called.
 *     There is no second iteration to spell, under any method name, because
 *     there is no second read of the array to spell it on.
 *   - `assertGlossIsPureOfId()` also bounds THE PATH FROM THIS COMPONENT'S
 *     RETURN DOWN TO THAT MAP: the only condition allowed to stand between them
 *     is `capabilities`. Round 15's B2 wrapped the whole Profiles row in
 *     `{registry.authority.length < 40 && ( … )}` — 975/975 green, typecheck
 *     clean, and every chip, id and gloss gone for any registry whose authority
 *     name is forty characters or longer, which is a production deployment name
 *     rather than a contrivance. Nothing inside the row had changed, so every
 *     guard that reads the row was satisfied; the escape was in the JSX above
 *     it, which nothing was looking at.
 *
 *     Round 16 answered that by walking the ancestry and refusing the
 *     conditional FORMS it knew — `&&`, `?:`, `if` — which is an enumeration,
 *     and round 17 spelled a fourth: `||`. So the walk is inverted too. Every
 *     ancestor between the map and this component's declaration must be a
 *     member of `PATH_NODE_KINDS` — JSX, a parenthesis, a return, a block — or
 *     an `&&` whose left side is on `CONDITION_ALLOW_LIST`, which holds one
 *     entry. An unfamiliar construct on that path is refused for being
 *     unfamiliar, not for being recognised.
 *
 *     An ancestor walk cannot see a gate that is not an ancestor, and round 17
 *     used one: `if (registry.authority.length > 40) return <div className=
 *     "card" />;` above the real return leaves the map's ancestry untouched and
 *     drops the whole card. `assertComponentBodyIsOneReturn()` closes that —
 *     this component's body is one statement and it is a `return` — which is
 *     also what makes `PATH_NODE_KINDS` a bound on the whole render rather than
 *     on one branch of it.
 *   - `assertNoProseOutsideLabelTable()` bounds the STRING LITERALS IN JSX
 *     CHILD POSITIONS and the `JsxText`, read from the source rather than the
 *     DOM. It was described here as bounding "the SET OF STRINGS this card may
 *     render", which it does not: a string reaching the screen through an
 *     identifier or a function call is invisible to it, and round 9's gate got
 *     `acdp-log-witness` onto every card that way, twice.
 *   - `assertEveryStringLiteralIsLicensed()` bounds THE SUPPLY. Every string
 *     literal AND every piece of `JsxText` in this file must be one of FIVE
 *     licensed sets: an allow-listed import specifier, one of the seven ids, one
 *     of the seven glosses hand-copied under `test/`, a structural token
 *     (`STRUCTURAL_LITERALS` — a class name, a CSS variable, a `Badge`
 *     variant), or an inline copy token (`INLINE_COPY_LITERALS` — `—`,
 *     `enabled`, `disabled`). A template literal with substitutions is refused
 *     outright. This is the bound that does not care HOW a string reaches the
 *     screen: an identifier, an attribute, a call and a gated branch are all
 *     closed by the same check. It is also what makes the gloss text itself
 *     bounded, since every other guard licensed the gloss by reading it off
 *     this card.
 *
 *     "A sentence has to be spelled somewhere" is how this bullet used to
 *     justify itself, and round 15 falsified it twice over — both halves being
 *     the same defect, an enumeration under a closed-set sentence.
 *
 *     B4: `JsxText` is source, is a sentence, and is not a string literal.
 *     Neither this guard nor `assertNoForeignProfileId` visited that node kind,
 *     so `<span className="metric-val">acdp-consumer advertised</span>` was
 *     975/975 green. Both walks visit `JsxText` now, each with its own
 *     anti-vacuity floor so a walk that stops finding any is red rather than
 *     quiet.
 *
 *     B1: a sentence spelled in a licensed SET is licensed. Two of the five
 *     sets had no pin and no shape rule — `grep` found `STRUCTURAL_LITERALS`
 *     and `INLINE_COPY_LITERALS` read by nothing but their own module — so
 *     appending 'Any profile id may be advertised here; the console does not
 *     check them.' to one of them and rendering it from the component was
 *     975/975 green, where the component edit alone was 11 red. All five sets
 *     are now pinned exactly and bounded in SHAPE (under three words, at most
 *     sixteen characters, and no entry may match `PROFILE_ID_SHAPE`), which is
 *     the half that survives the next person editing a list.
 *   - `assertGlossChokePoint()`, `assertGlossIsGated()` and
 *     `assertNoForeignProfileId()` bound, respectively, the ONE expression that
 *     may reach a rendered `title`, both of `glossFor`'s statements, and any
 *     profile-id-shaped string literal, template literal or piece of `JsxText`
 *     naming an id outside the seven (case-insensitively matched, compared
 *     exactly as written).
 *
 *     Round 17: that shape was `acdp[-_]…` and RFC-ACDP-0014 §10 gives a third
 *     separator this repository already ships — `lib/utils/revocation.ts` fans
 *     the Contexts facet out over `key-revocation` AND `acdp:key-revocation`.
 *     So `acdp:consumer` was a profile id by the spec's own spelling and not
 *     one by this guard's, and it walked past every check here. The separator
 *     set is `[-_:]` now, which is all three the RFC permits; the comparison
 *     afterwards is still exact, so matching loosely costs nothing.
 *   - the RENDERED closed world (`registry-card-profiles.test.tsx`) is what
 *     bounds what is on the screen. Over a fixture matrix, every text node and
 *     every announced attribute must be derivable FROM THE FIXTURE — so it asks
 *     what is on the screen and never how it got there, and an identifier, a
 *     call, a second `.map` and an `alt` fail it identically.
 *
 * THIS LIST IS PROSE AND PROSE DRIFTS. The authoritative list is
 * `RUN_ON_READ` in `test/support/profile-copy-table.ts`, whose length is
 * asserted, whose membership is asserted by name, and every one of whose refusal
 * BRANCHES has a subject that reaches it — the count in that module's docblocks
 * had drifted three ways by round 13, which is why no number is written in any
 * of them any more, this one included.
 *
 * Their honest residual, and it has three parts:
 *
 *   - No test can quantify over every possible id string, so the probe universe
 *     is a sample (the seven, the three forbidden ones, shape variants, and the
 *     `Object.prototype` names). That gap is why the type bound and the file
 *     bound exist, and why none of them is described as complete.
 *   - SUPPRESSION is not bounded by any render. Copy that stops appearing on a
 *     deployment the tests do not run on — `glossFor` returning `undefined`
 *     when `window.location.hostname` ends in `.prod`, say — is invisible to
 *     every probe here, because jsdom's hostname is `localhost`.
 *
 *     "That direction rests entirely on `assertGlossIsGated`" is what this said,
 *     and round 11 falsified it: suppression has a SECOND home, the map
 *     callback's return, and a `capabilities.limits.max_search_limit > 500` gate
 *     dropped every tooltip on every affected registry with `glossFor`
 *     untouched and 963 tests green. So the next version named two homes — that
 *     guard, plus `assertGlossIsPureOfId()` pinning the callback to two
 *     statements whose second returns one JSX element with a pinned attribute
 *     set — and round 15's B2 falsified THAT by finding a THIRD: the JSX above
 *     the callback. A row that is never rendered needs no gate inside it.
 *
 *     Counting homes is the error the three rounds have in common, so this no
 *     longer counts them. Suppression is bounded by a PATH: `glossFor`'s two
 *     statements, the callback's two statements, and — since B2 — every
 *     condition on the ancestry from `RegistryCard`'s return down to the map,
 *     which may only be `capabilities`. A conditional anywhere on that path,
 *     however spelled, is refused rather than recognised — and, since round 17,
 *     an early `return` ABOVE that path is refused too, because the body is
 *     required to be one return. What remains outside it is genuinely outside
 *     this file: `glossFor` reading a global, and the CSS channel, which
 *     `test/support/stylesheet-text.ts` bounds separately — in BOTH directions
 *     as of round 17, which it did not before; see the CSS bullet below.
 *   - COMMENTS are exempt from the source walks — a guard that banned discussing
 *     the problem would be uncomfortable enough to get deleted — and a string
 *     can still be DERIVED at runtime from licensed parts (a `.slice`, a
 *     `.toUpperCase`, a concatenation). That residual is much narrower than it
 *     was, because every part has to be licensed and a template substitution is
 *     refused, but it is not empty.
 *
 *     What is NOT true is the framing the previous version of this paragraph
 *     used: that the source walks and the rendered world have "complementary
 *     holes", as if what one missed the other caught. Round 13 got two
 *     coordinate-gated escapes past both in the same round. They are two partial
 *     bounds that overlap, not a cover, and each new round has closed a hole by
 *     widening what a guard is ABOUT rather than by adding a case to it.
 *   - NEITHER WORLD CAN SEE CSS, and round 15's B5 is the measurement: a second
 *     stylesheet carrying `.chip::after { content: ' (see acdp-consumer)'; }`,
 *     imported from `app/layout.tsx`, put that id on every chip on every card
 *     in every real browser at 975/975 green. Generated content is not in this
 *     file, so no source walk sees it, and `textContent` never includes it in
 *     any browser, so no DOM walk sees it either. That channel is bounded in
 *     `test/support/stylesheet-text.ts`, over the union of the stylesheets this
 *     repository HOLDS and the ones the app LOADS — the second set is larger,
 *     and finding out that it was larger is what the enumeration was for.
 *
 *     Round 17 got past that bound three more ways, and each fix is a widening
 *     rather than a case:
 *
 *     CASE. Every scanner was case-sensitive and CSS property and at-rule names
 *     are not, so `CONTENT:` was invisible — and so was the "independent" count
 *     meant to catch exactly that, because it shared the blind spot and agreed
 *     loudly. The scanners are case-insensitive now and the count is taken by
 *     tokenising rather than by matching the same word a second way.
 *
 *     INDIRECTION. A `style` element was found by a text scan, under a comment
 *     arguing that a tag name is a fixed string. A JSX tag name is an
 *     IDENTIFIER: `const Tag = 'style'` in `app/layout.tsx` was 977/977 green,
 *     and so was `createElement('style', …)`, which that same comment named as
 *     the case an AST walk would miss. Both mechanisms run now, over the same
 *     files, and the module no longer claims either is the bound.
 *
 *     (The literal tag spelling is not written in this file, deliberately: the
 *     text half cannot tell prose from an element, which is the cost its own
 *     docblock records and the reason the AST half exists. Writing it here
 *     turned this comment red, which is the guard behaving correctly.)
 *
 *     SUPPRESSION. Everything above asks how CSS can ADD a character; nothing
 *     asked how it can take one away, while this bullet said the channel was
 *     "bounded". `@media (max-width: 640px) { .metric-row .chip { display:
 *     none; } }` was 977/977 green and removed every profile id from every card
 *     at phone width. What is bounded now is the PRODUCT — every rule in the
 *     app's stylesheets whose selector names a class this card renders, pinned
 *     selector and declaration block — because a denylist of suppressing
 *     properties is the open set this gate has now been beaten by six times.
 */
const PROFILE_INFO: Record<AdvertisableProfileId, { title: string; accent?: boolean }> = {
  'acdp-registry-core': { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-discovery': { title: 'Search / discovery endpoints (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-federated': { title: 'Cross-registry federation (RFC-ACDP-0001 §9.1)' },
  'acdp-registry-receipts': {
    title: 'Signed registry receipts at publish time (RFC-ACDP-0010, acdp 0.2.0)',
  },
  'acdp-registry-head-receipts': {
    title: 'Lineage-head receipts: signed serve-time head attestations (RFC-ACDP-0011, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-transparency-log': {
    title: 'Append-only transparency log with inclusion proofs (RFC-ACDP-0012, acdp 0.3.0)',
    accent: true,
  },
  'acdp-registry-lifecycle': {
    title: 'Signed lifecycle events: retraction / republication (RFC-ACDP-0013, acdp 0.3.0)',
    accent: true,
  },
};

/**
 * The ONE place a profile chip's gloss may come from.
 *
 * A single choke point rather than an inline `PROFILE_INFO[p]`, for three
 * reasons.
 *
 * It gates on the ID LIST, not on the table, so the advertisable set decides
 * what may be glossed in the running app as well as at typecheck time. The two
 * cannot disagree — the list is the table's key type — but the gate is where a
 * future edit that breaks that would show up.
 *
 * It refuses an inherited property. `PROFILE_INFO['toString']` walks the
 * prototype chain and returns a FUNCTION, which is truthy, so a registry
 * advertising a profile called `constructor` or `toString` would have reached
 * `info.accent` on an object that is not copy at all.
 *
 * And a named lookup gives the render probes and `assertNoCopyOutsideTable()`
 * one thing to bound. A gloss appearing from anywhere else is then a visible,
 * checkable second source rather than one more expression among many.
 */
function glossFor(p: string): { title: string; accent?: boolean } | undefined {
  // `as readonly string[]` only to widen the `as const` tuple for `.includes`,
  // which otherwise refuses an arbitrary string — the runtime check is the
  // point and is not weakened by it.
  if (!(ADVERTISABLE_PROFILE_IDS as readonly string[]).includes(p)) return undefined;
  return PROFILE_INFO[p as AdvertisableProfileId];
}

export function RegistryCard({
  registry,
  capabilities,
}: {
  registry: KnownRegistry;
  capabilities?: RegistryCapabilities;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="ok" />
          <h2>{registry.authority}</h2>
        </div>
        <Badge variant="complete">● healthy</Badge>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="metric-row">
          <span className="metric-name">Event count</span>
          <span className="metric-val">{formatNumber(registry.eventCount)}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Base URL</span>
          <span className="did">{registry.baseUrl ?? '—'}</span>
        </div>
        <div className="metric-row">
          <span className="metric-name">Last seen</span>
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{timeAgo(registry.lastSeen)}</span>
        </div>
        {capabilities && (
          <>
            <div className="metric-row">
              <span className="metric-name">ACDP version</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>{capabilities.acdp_version}</span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Algorithms</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {capabilities.supported_signature_algorithms.join(', ')}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Profiles</span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {capabilities.profiles.map((p) => {
                  const info = glossFor(p);
                  return (
                    <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>
                      {p}
                    </span>
                  );
                })}
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Max payload</span>
              <span style={{ color: 'var(--text)', fontSize: 11 }}>
                {Math.round(capabilities.limits.max_payload_bytes / 1024)} KB
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-name">Anon reads</span>
              <Badge variant={capabilities.anonymous_public_reads ? 'pub' : 'neutral'}>
                {capabilities.anonymous_public_reads ? 'enabled' : 'disabled'}
              </Badge>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// The profile chips an operator actually sees on /registries (#95).
//
// `mock-data.test.ts` pins the DATA — that no demo registry advertises a
// profile a real one would refuse to boot with. That says nothing about the
// render, and the render is where the second half of #95 lives: two entries in
// `PROFILE_INFO` existed solely to describe the two invalid ids. Tooltip copy
// for an id nothing emits is unreachable text, and worse than unreachable — it
// ratified both ids for the next person who read the file looking for what a
// profile id is supposed to look like.
//
// So these tests are about the fallback as much as the happy path. Deleting the
// two entries is only safe if an id with NO entry still renders its own text,
// which is the assertion that makes the deletion a non-event rather than a
// regression waiting for a future profile.
//
// WHY THIS FILE ASSERTS ON `title`, against CLAUDE.md's rule. The rule — "assert
// on rendered text, never on a `title` tooltip" — exists because a trust
// surface that discloses only on hover is invisible to touch, to the keyboard
// and to a screen reader, so it is not disclosing. Nothing here is a trust
// verdict: the chip's own TEXT is the profile id, which is the fact, and the
// tooltip is a gloss on it. What is asserted is that the gloss exists and is
// reachable for every advertisable id — the opposite failure from the one the
// rule guards. The tooltip predates this change; whether it should be a tooltip
// at all is a separate question, and it is filed rather than settled here.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, afterEach } from 'vitest';
import ts from 'typescript';
import { render, cleanup, within } from '@testing-library/react';
import { RegistryCard } from '@/components/registries/registry-card';
import { formatNumber, timeAgo } from '@/lib/utils/format';
import { MOCK_CAPABILITIES } from '@/lib/data/mock-data';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';
import {
  REGISTRY_ADVERTISABLE_PROFILES,
  NOT_ADVERTISABLE,
  PROFILE_GLOSS_TEXT,
} from '../support/advertisable-profiles';
import { contentDeclarations, contentOccurrences } from '../support/stylesheet-text';
import * as PCT from '../support/profile-copy-table';
import {
  profileCopyTable,
  assertModuleShape,
  assertNoCopyOutsideTable,
  assertGlossChokePoint,
  assertGlossIsGated,
  assertNoRuntimeCopyForms,
  assertNoAlternateDisclosureChannel,
  advertisableIdsInComponent,
  assertGlossIsPureOfId,
  assertNoProseOutsideLabelTable,
  PROHIBITED_RUNTIME_FORMS,
  ALLOWED_IMPORTS,
  GLOSS_EXPRESSION,
  GLOSS_GATE_CONDITION,
  GLOSS_RETURN_EXPRESSION,
} from '../support/profile-copy-table';

/**
 * Every visible string `RegistryCard` is allowed to render.
 *
 * The CLOSED SET, and the reason it is a list of labels rather than a pattern:
 * asking "does this sentence disclose a non-advertisable profile" is an
 * open-world question over English, and eight rounds of answering it with
 * patterns and probes were defeated by a coordinate or a phrasing nobody had
 * enumerated. A closed set has nothing to evade.
 *
 * THE SCOPE, corrected in round 10: this list bounds the string LITERALS that
 * appear syntactically in JSX child positions, plus the `JsxText`. It does not
 * bound "every string in the file" — that is what it claimed, and a string
 * reaching the screen through an identifier or a call is invisible to the
 * source walk. The RENDERED closed world further down this file is what bounds
 * the strings, by asking what is on screen rather than how it got there.
 *
 * Adding an entry is the review step. It should be a label a reviewer can point
 * to on the rendered card, not a sentence about a profile.
 */
const CARD_LABELS = [
  '● healthy',
  'Event count',
  'Base URL',
  '—',
  'Last seen',
  'ACDP version',
  'Algorithms',
  // Compared TRIMMED, because JSX text nodes carry the surrounding source
  // indentation. So the join separator `', '` and the unit `' KB'` appear here
  // without their padding.
  ',',
  'Profiles',
  'Max payload',
  'KB',
  'Anon reads',
  'enabled',
  'disabled',
] as const as readonly string[];

afterEach(cleanup);

const REGISTRY_B: KnownRegistry = {
  authority: 'registry-b.playground.local',
  baseUrl: 'http://localhost:8200',
  firstSeen: '2026-08-01T00:00:00Z',
  lastSeen: '2026-08-01T01:00:00Z',
  eventCount: 12,
};

function chips(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.chip')].map((c) => c.textContent ?? '');
}

/**
 * The seven ids a real registry may advertise, in the order upstream declares
 * them. THE SAME OBJECT `mock-data.test.ts` uses, not a second copy of it: the
 * claim differs — there it bounds what the FIXTURES may say, here it bounds
 * what the component must have COPY for — but the set does not, and two copies
 * of a mirror can drift apart. Provenance and limits live at its definition.
 */
const ADVERTISABLE = REGISTRY_ADVERTISABLE_PROFILES;

describe('registry-b renders the profiles it now advertises', () => {
  it('shows exactly two chips, and the two valid ids', () => {
    const { container } = render(
      <RegistryCard registry={REGISTRY_B} capabilities={MOCK_CAPABILITIES.b} />,
    );
    expect(chips(container)).toEqual(['acdp-registry-core', 'acdp-registry-discovery']);
  });

  it('shows neither of the two ids #95 removed', () => {
    const { container } = render(
      <RegistryCard registry={REGISTRY_B} capabilities={MOCK_CAPABILITIES.b} />,
    );
    expect(container.textContent).not.toContain('acdp-consumer');
    expect(container.textContent).not.toContain('acdp-federated');
  });

  it('does not reject the VALID federation id, whose name contains the invalid one', () => {
    // `'acdp-federated'` is not a substring of `'acdp-registry-federated'`, so
    // the assertion above is safe — but that is a fact about two string
    // literals, and the first version of this file asserted it as
    // `expect('acdp-registry-federated').toContain('federated')`, which is a
    // tautology over two constants and could not fail for any reason.
    //
    // Asserted through a render instead: a card advertising the real federation
    // id passes the same exclusion the test above applies. Now it is a claim
    // about the component and the matcher, and it breaks if either the id or
    // the exclusion is rewritten into something that overlaps.
    const { container } = render(
      <RegistryCard
        registry={REGISTRY_B}
        capabilities={{ ...MOCK_CAPABILITIES.b, profiles: ['acdp-registry-federated'] }}
      />,
    );
    expect(chips(container)).toEqual(['acdp-registry-federated']);
    expect(container.textContent).not.toContain('acdp-consumer');
    expect(container.textContent).not.toContain('acdp-federated');
  });

  it('still renders registry-a with all six of its chips', () => {
    // The sibling that keeps the assertions above from passing on a card that
    // renders no chips at all.
    const { container } = render(
      <RegistryCard
        registry={{ ...REGISTRY_B, authority: 'registry-a.playground.local' }}
        capabilities={MOCK_CAPABILITIES.a}
      />,
    );
    expect(chips(container)).toEqual(MOCK_CAPABILITIES.a.profiles);
    expect(chips(container).length).toBe(6);
  });
});

describe('an unknown profile id still reaches the screen', () => {
  it('renders its raw text with no tooltip, rather than blank', () => {
    // The fallback that makes deleting two `PROFILE_INFO` entries safe.
    // `PROFILE_INFO[p]` is `undefined` and the chip renders `{p}` regardless —
    // so an id this console has never heard of is shown to the operator instead
    // of being silently dropped, which for a capability advertisement is the
    // only honest behaviour.
    const caps: RegistryCapabilities = {
      ...MOCK_CAPABILITIES.b,
      profiles: ['acdp-registry-core', 'acdp-registry-quantum'],
    };
    const { container } = render(<RegistryCard registry={REGISTRY_B} capabilities={caps} />);
    const rendered = chips(container);
    expect(rendered).toContain('acdp-registry-quantum');
    const unknown = [...container.querySelectorAll('.chip')].find(
      (c) => c.textContent === 'acdp-registry-quantum',
    )!;
    expect(unknown.getAttribute('title')).toBeNull();
    // And it is not accented — the accent is reserved for the 0.3.0 trust
    // profiles, and an unknown id must not borrow that signal.
    expect(unknown.className).toBe('chip');
  });

  it('accents a known 0.3.0 trust profile and not the baseline ones', () => {
    const { container } = render(
      <RegistryCard
        registry={{ ...REGISTRY_B, authority: 'registry-a.playground.local' }}
        capabilities={MOCK_CAPABILITIES.a}
      />,
    );
    const byText = new Map(
      [...container.querySelectorAll('.chip')].map((c) => [c.textContent, c.className]),
    );
    expect(byText.get('acdp-registry-transparency-log')).toContain('ok');
    expect(byText.get('acdp-registry-core')).toBe('chip');
  });
});

/**
 * The ids a real registry refuses to boot with, rendered as if one advertised
 * them. THREE of them; this said "the two ids #95 removed" for a commit after
 * the third was added, which is how a guard's description drifts from the set
 * it defends.
 *
 * A RENDER probe, not a source read. It is the only check here immune to
 * syntax: however an entry is written into `PROFILE_INFO` — on its own line, on
 * someone else's line, under a computed key, through a spread, by a
 * post-literal `Object.assign` — the chip either gets a tooltip or it does not,
 * and that is what an operator sees. Several rounds of this gate were lost to
 * source readers that each missed a different subset of those forms; the count
 * and the full list live in ONE place, `test/support/profile-copy-table.ts`'s
 * header, because five separate restatements of that history had drifted to
 * five different numbers.
 */
/**
 * The capability fixtures every render probe runs against.
 *
 * More than one, deliberately. `MOCK_CAPABILITIES.a` and `.b` differ in
 * `acdp_version` among other things, and a tooltip fallback gated on that
 * version disclosed deleted copy on one while staying invisible on the other —
 * with the full suite green. A probe that renders one fixture bounds one
 * context, not the component.
 */
const CAPABILITY_FIXTURES: RegistryCapabilities[] = [
  MOCK_CAPABILITIES.b as RegistryCapabilities,
  MOCK_CAPABILITIES.a as RegistryCapabilities,
];

/**
 * The REGISTRY fixtures every render probe runs against — the second prop, and
 * the one round 6 left fixed.
 *
 * `chipFor` pinned `registry` to registry-b and varied only `capabilities`, so
 * the whole authority axis was unprobed. Two mutations went through it with the
 * suite green, and they are opposite halves of #95:
 *
 *   `registry.authority === 'registry-a…' ? { 'acdp-consumer': {title} } : {}`
 *       — the exact copy #95 deleted, back on screen for one registry.
 *   `title={registry.authority === 'registry-b…' ? info?.title : undefined}`
 *       — every tooltip silently gone for every registry but one, and
 *         `app/registries/page.tsx` renders a card per OBSERVED registry, each
 *         with its own authority.
 *
 * A gloss is a function of both props. A probe that fixes one of them bounds
 * half the component. The third entry is deliberately an authority neither demo
 * fixture uses, so "any real deployment" is covered rather than the two names
 * that happen to be in the mock data.
 */
const REGISTRY_FIXTURES: KnownRegistry[] = [
  REGISTRY_B,
  { ...REGISTRY_B, authority: 'registry-a.playground.local', baseUrl: 'http://localhost:8100' },
  { ...REGISTRY_B, authority: 'registry-z.example.test', baseUrl: undefined, eventCount: 0 },
];

/**
 * Where in `capabilities.profiles` a probed id is placed.
 *
 * THE THIRD AXIS, and the one #95 is actually about. `chipFor` rendered
 * `profiles: [profileId]` — one id, always at index 0, never beside another —
 * so no test in this repo ever rendered a forbidden id anywhere but first or in
 * company. A gloss gated on `i > 0` therefore disclosed the copy #95 deleted
 * with the whole suite green, and `app/registries/page.tsx` feeds this
 * component a live capability document where a multi-profile array is the
 * normal case: `MOCK_CAPABILITIES.a` already carries six.
 *
 * Successive rounds fixed one prop axis each (`capabilities`, then `registry`)
 * and the copy moved to the axis still held constant. This is that axis.
 */
const POSITIONS = ['alone', 'first', 'last', 'middle'] as const;

/**
 * ANTI-VACUITY for the position axis, and the fifth time this file has needed
 * one for an array it had just added.
 *
 * `CAPABILITY_FIXTURES` and `REGISTRY_FIXTURES` have had a pin since round 6;
 * `PROBES` got one in round 7, after deleting every adversarial entry was
 * measured leaving the suite green. `POSITIONS` shipped in that same commit
 * with no pin, and the commit message claimed narrowing it to `['alone']` was
 * killed. It is not: that narrowing produces three `tsc` errors, but only as a
 * side effect of `switch` exhaustiveness in `profilesWith` — no guard fires.
 * Rewriting `profilesWith` to return `[profileId]` for every case achieves the
 * identical silencing with tsc clean, lint clean and the whole suite green.
 *
 * With the axis silenced, round 8's `i > 2` escape widens back to round 7's
 * `i > 0`. So the pin is on the RENDERED ARRAY LENGTHS, which is what
 * `profilesWith` is actually for — a version that ignores `position` fails
 * here rather than quietly flattening the axis.
 *
 * The axis itself is no longer the guarantee: `assertGlossIsPureOfId` denies
 * the callback an index at all, at every N. This keeps the behavioural probe
 * honest alongside it.
 */
function assertPositionAxisIsReal(): void {
  const lengths = POSITIONS.map((p) => profilesWith('x', p).length);
  expect(lengths, 'profilesWith no longer varies the array length by position').toEqual([1, 3, 3, 3]);
  expect(profilesWith('x', 'first').indexOf('x'), 'first').toBe(0);
  expect(profilesWith('x', 'middle').indexOf('x'), 'middle').toBe(1);
  expect(profilesWith('x', 'last').indexOf('x'), 'last').toBe(2);
}

function profilesWith(profileId: string, position: (typeof POSITIONS)[number]): string[] {
  const filler = ['acdp-registry-core', 'acdp-registry-discovery'];
  switch (position) {
    case 'alone':
      return [profileId];
    case 'first':
      return [profileId, ...filler];
    case 'last':
      return [...filler, profileId];
    case 'middle':
      return [filler[0], profileId, filler[1]];
  }
}

function chipFor(
  profileId: string,
  capabilities: RegistryCapabilities,
  registry: KnownRegistry,
  position: (typeof POSITIONS)[number] = 'alone',
): HTMLElement {
  const { container } = render(
    <RegistryCard
      registry={registry}
      capabilities={{ ...capabilities, profiles: profilesWith(profileId, position) } as RegistryCapabilities}
    />,
  );
  const chip = [...container.querySelectorAll('.chip')].find((c) => c.textContent === profileId);
  expect(chip, `no chip rendered for ${profileId} at ${position}`).toBeTruthy();
  return chip as HTMLElement;
}

/**
 * Every attribute the chip carries, so a gloss cannot arrive through a channel
 * no assertion reads.
 *
 * The probes read `title`, `className` and `textContent`. An `aria-label`
 * carrying the deleted copy — announced to a screen reader IN PLACE OF the
 * text, where a `title` may not be announced at all — passed the whole suite.
 */
function attributesOf(el: HTMLElement): Record<string, string> {
  return Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));
}

/**
 * The id universe the disclosure probe samples.
 *
 * MODULE SCOPE so its own anti-vacuity pin can reach it. It was local, and it
 * was the one array here with no pin: deleting every adversarial entry left the
 * suite green, because the set-equality below only needs `ADVERTISABLE ⊆ PROBES`.
 */
const PROBES: string[] = [
  ...ADVERTISABLE,
  ...NOT_ADVERTISABLE,
  // Shape variants: near-misses of a real id, and the affix patterns a
  // synthesised gloss is cheapest to write against (`p.startsWith`,
  // `p.endsWith`, a case fold). An id-derived title survived when the
  // universe held no id of the shape its predicate tested.
  'acdp-agent-core',
  'acdp-registry-quantum',
  'acdp-registry',
  'acdp-registry-receipts-v2',
  'acdp-registry-core-mirror',
  'acdp-registry-CORE',
  'ACDP-REGISTRY-CORE',
  ' acdp-registry-core',
  'acdp-registry-core ',
  'registry-core',
  'core',
  'x',
  '',
  // `Object.prototype` names. `PROFILE_INFO[p]` without an own-property
  // check returns a FUNCTION for these, which is truthy — so the chip
  // reached `info.accent` on something that is not copy at all.
  'toString',
  'constructor',
  'valueOf',
  'hasOwnProperty',
  '__proto__',
];

describe('the dead tooltip copy is gone', () => {
  it('has copy for EXACTLY the advertisable seven — no more, no fewer', () => {
    // Read with the TYPESCRIPT COMPILER, not a regex and not `Object.keys`.
    //
    // Earlier versions of this assertion each failed differently (the list is
    // in the support module's header, kept in one place because restating it
    // produced five different counts). The worst imported the object and
    // compared `Object.keys`,
    // which meant any OTHER module could import the same object and add a key
    // at module scope — Vitest isolates module graphs per test file, so this
    // guard went on seeing a pristine seven while the app rendered the deleted
    // copy. Reading the object vouches for the object; the claim is about what
    // the component renders copy for. So: parse the file, and collect the keys
    // of EVERY copy table in it (a literal whose entries carry a `title`), not
    // just the one constant's. A second lookup object is the realistic way this
    // regresses, and it is the form `Object.keys` structurally cannot see.
    //
    // `copyTableKeys` FAILS CLOSED — it throws on a spread, a computed key, an
    // accessor, a shorthand or a non-string key rather than skipping it. That
    // is the property both regex versions got backwards: they saw nothing and
    // reported success.
    const { entries, tables } = profileCopyTable();
    const keys = [...entries.keys()];
    expect(tables, 'exactly one copy table — a second one can shadow the first').toBe(1);
    expect(tables, 'no copy table found — the parser lost its subject').toBeGreaterThan(0);
    expect(new Set(keys)).toEqual(new Set(ADVERTISABLE));
    // Stated separately so a failure names the direction rather than reporting
    // two unequal sets.
    for (const id of NOT_ADVERTISABLE) expect(keys).not.toContain(id);
    // The valid federation id is untouched — the removal must not have taken it.
    expect(keys).toContain('acdp-registry-federated');
    // Anti-vacuity: `Set` equality of two empty sets is also true.
    expect(keys).toHaveLength(ADVERTISABLE.length);
  });

  it('pins NOT_ADVERTISABLE itself, so the guard cannot be silenced by emptying it', () => {
    // `NOT_ADVERTISABLE` is the iteration set for the render probes below.
    // Emptying it turns those into silent no-ops, and adding to it or dropping
    // an id changes what this file vouches for — all three were green before
    // this assertion. The same "second copy that may disagree" shape the rest
    // of this file exists to remove, in the file doing the removing.
    expect(NOT_ADVERTISABLE).toEqual(['acdp-consumer', 'acdp-federated', 'acdp-log-witness']);
  });

  it('the gloss an operator reads is the gloss somebody WROTE DOWN', () => {
    // ROUND 13's N1, and the third time this branch has found the same shape.
    // Every check on this card's gloss CONTENT derived the permitted content
    // from the card: `allowedAnnounced()` builds its licensed set by calling
    // `profileCopyTable()`, which parses `registry-card.tsx`. A copy guard that
    // shares a source with its subject cannot reject the subject. Measured:
    // replacing `acdp-registry-core`'s title with "Consumer deployment profile —
    // a registry is forbidden to advertise this; contact ops@example.test
    // (RFC-ACDP-0001 §9.1)" left all 969 tests green.
    //
    // `PROFILE_GLOSS_TEXT` is a hand copy in a file the component does not
    // import, so changing operator-facing copy is a two-file diff with a reason.
    // It is compared with `toEqual` on the whole map rather than
    // id-by-id-`toContain`, because a substring pin cannot bound what else a
    // string says — an appended sentence walks straight through one.
    const { entries } = profileCopyTable();
    expect(Object.fromEntries(entries)).toEqual(PROFILE_GLOSS_TEXT);
    // Anti-vacuity in both directions: two empty maps are also equal, and a
    // gloss emptied to `''` on both sides would still match.
    expect(Object.keys(PROFILE_GLOSS_TEXT)).toHaveLength(ADVERTISABLE.length);
    for (const [id, gloss] of Object.entries(PROFILE_GLOSS_TEXT)) {
      expect(gloss.length, `${id}'s gloss is too short to be a gloss`).toBeGreaterThan(20);
    }
  });

  it('the label allow-list is a list of LABELS, not a place to put a sentence', () => {
    // ROUND 13's N2. `CARD_LABELS` is what licenses every string this card may
    // render in a child position, and nothing pinned it: adding one entry
    // licenses one sentence, which is precisely round 9's escape ("Log witness
    // cosignatures are recorded here."). Pinned exactly, so an addition is a
    // visible diff…
    expect([...CARD_LABELS]).toEqual([
      '● healthy',
      'Event count',
      'Base URL',
      '—',
      'Last seen',
      'ACDP version',
      'Algorithms',
      ',',
      'Profiles',
      'Max payload',
      'KB',
      'Anon reads',
      'enabled',
      'disabled',
    ]);
    // …and bounded in SHAPE, which is the half that survives someone editing
    // the list above. A label is at most two words; prose is not. This is what
    // makes the allow-list structurally unable to license a sentence, rather
    // than merely currently not licensing one.
    for (const label of CARD_LABELS) {
      expect(label.trim().split(/\s+/).length, `\`${label}\` reads as prose, not a label`).toBeLessThan(3);
    }
  });

  it('no stylesheet rule can put a character on this card', () => {
    // The channel both closed worlds are blind to. `.chip::after { content:
    // 'acdp-consumer'; }` is invisible to every source walk (it is not in the
    // component) and to every DOM walk (`textContent` never includes generated
    // content, and jsdom does not compute it at all) — so the rendered closed
    // world and the source closed world can both be green while the card names
    // an id no registry may advertise.
    //
    // Provenance of the bound is in `test/support/stylesheet-text.ts`. Here:
    // every declaration is empty, and the scanner is neither over- nor
    // under-matching.
    const decls = contentDeclarations();
    for (const value of decls) {
      expect(value, `a CSS rule generates the text ${value}`).toMatch(/^(''|"")$/);
    }
    // Anti-vacuity, two ways. A scanner that matched nothing would pass the loop
    // above; one that swallowed `justify-content` would find eight more.
    expect(decls.length, 'the stylesheet scanner found no content declarations').toBeGreaterThan(1);
    expect(decls.length, 'the scanner disagrees with an independent count').toBe(contentOccurrences());
    // …and the trap itself, stated as a case rather than as a comment.
    expect(contentDeclarations('.a { justify-content: center; }')).toEqual([]);
    expect(contentDeclarations(".a::after { content: 'x'; }")).toEqual(["'x'"]);
  });

  it('contains NOTHING at module scope but its imports, the table and the component', () => {
    // The guard, inverted. Previous versions hunted for copy and each
    // missed a construct its author had not anticipated — a second
    // `Record<string, string>` table, a `Map`, a prototype getter, an aliased
    // `Object.defineProperty`, and (the one that stung) a plain
    // `PROFILE_INFO['x'] = { title }` assignment, which the `Object.keys`
    // version it replaced had caught. A fix that loses coverage is the defect
    // this file shipped twice.
    //
    // So this refuses everything NOT on a short allow-list — any extra
    // variable, assignment, call, class or import — and an unanticipated
    // construct is therefore a loud failure rather than a silent pass.
    // Its limit is stated where it lives: it bounds MODULE scope and the
    // BINDING NAMES of every import — an allow-listed module is not a bounded
    // one, and for a revision it was treated as if it were.
    expect(() => assertModuleShape()).not.toThrow();
  });

  it('carries NO copy anywhere else in the file, component body included', () => {
    // The bound round 6 gave up. Whitelisting module scope moved the blind spot
    // into `RegistryCard`'s body and traded away five kills the version before
    // it had — an in-body `Object.assign`, an in-body second table, an in-body
    // authority-gated entry, a copy default in the parameter list, and a nested
    // component with its own table were all red one revision earlier and green
    // after. Every one of them is an object literal carrying a `title`, and
    // this walks the whole file for exactly that.
    expect(() => assertNoCopyOutsideTable()).not.toThrow();
  });

  it('builds no copy through a runtime form that leaves no property literal', () => {
    // RESTORED. An earlier revision of this file had exactly this check,
    // walking the whole file, and the module-scope rewrite deleted it. The
    // measurement is unambiguous: an in-body `Proxy` get-trap synthesising the
    // `acdp-consumer` title was RED before that rewrite and GREEN after. That
    // is the fourth time a fix on this claim removed coverage the version
    // before it had, which is why the support module now lists its bounds
    // separately instead of describing one guard that covers everything.
    expect(() => assertNoRuntimeCopyForms()).not.toThrow();
  });

  it('discloses through no attribute a probe does not read', () => {
    // `aria-*`, `data-*`, `dangerouslySetInnerHTML`. The choke-point check's
    // own docblock claimed "the render probes are what read those"; they never
    // did — every probe read `title`, `className` and `textContent` — so a
    // single added `aria-label` carrying the deleted copy, on every registry
    // with no gating at all, passed the whole suite. By CLAUDE.md's own
    // reasoning that is the LOUDER channel: a `title` may not be announced,
    // an `aria-label` is announced in place of the text.
    expect(() => assertNoAlternateDisclosureChannel()).not.toThrow();
  });

  it('routes every rendered gloss through the one lookup', () => {
    // The literal walk above cannot see `title={registry.authority === 'x' ?
    // info?.title : undefined}` — there is no literal to find — and that
    // mutation dropped the tooltip from every registry but one with the whole
    // suite green. The render matrix catches it behaviourally; this catches it
    // structurally, and a claim worth one layer of defence on a surface that
    // has regressed as often as this one is worth two.
    expect(() => assertGlossChokePoint()).not.toThrow();
  });

  it('gates that lookup on the advertisable list, and has only one lookup site', () => {
    // Structural rather than rendered, and the distinction is the point. The
    // mutation this kills — dropping the membership gate and indexing
    // PROFILE_INFO raw — CANNOT be killed by a render probe today: the only ids
    // whose answer changes are `Object.prototype` names, and for those the raw
    // lookup returns a function whose `.title` is `undefined`, so no tooltip
    // appears either way. It was measured surviving the whole suite before this
    // assertion existed.
    //
    // It is still worth forbidding: `info` becomes truthy for `toString` and
    // `constructor`, and the next thing rendered on `info` being truthy turns a
    // latent difference into a visible one. Asserting it structurally and
    // saying why beats a probe that would only appear to cover it.
    expect(() => assertGlossIsGated()).not.toThrow();
  });

  // ══════════════════════════════════════════════════════════════════
  // The two structural guards that replace "add one more probe axis".
  //
  // Rounds 6, 7 and 8 each answered a gloss escape by widening the fixture
  // matrix — a `registry` axis, then a POSITION axis — and each time the copy
  // moved to a coordinate the widened matrix still did not reach. Round 8's
  // findings were `i > 2` (the position axis reaches 0, 1 and 2), and three
  // gates on fields the fixtures hold constant (`registry.lastSeen`,
  // `capabilities.anonymous_public_reads`, `registry.eventCount`).
  //
  // The input space is infinite: every field of both props, crossed with every
  // index. No finite matrix closes it. These two close it by construction
  // instead — one bounds the EXPRESSION the gloss may be, the other bounds the
  // SET OF STRINGS the card may render.
  // ══════════════════════════════════════════════════════════════════

  it('the gloss is a function of the profile id and nothing else', () => {
    // Kills every index gate at every N, and every gate on any field of either
    // prop, without enumerating any of them: the callback is denied the index
    // parameter, and `info` may only ever be `glossFor(p)`.
    expect(() => assertGlossIsPureOfId()).not.toThrow();
  });

  it('renders no prose outside the pinned label list', () => {
    // An unconditional `<div className="metric-row">` naming `acdp-log-witness`
    // passed every other guard in this file — the probes read `.chip` elements
    // and nothing else, and the only thing in the way was two literal
    // `not.toContain` assertions naming two ids on one fixture.
    //
    // Source-level, because a render assertion is only as good as its
    // fixtures: prose gated on `registry.lastSeen > '2026-09-01'` renders under
    // none of them.
    expect(() => assertNoProseOutsideLabelTable(CARD_LABELS)).not.toThrow();
  });

  it('GUARDS THE GUARD: the label list is not a wildcard', () => {
    // A list containing the empty string, or one long enough to have stopped
    // being read, is the shape this check goes vacuous in. Every entry is a
    // label a reviewer can point to on screen.
    expect(CARD_LABELS.length).toBeLessThan(25);
    for (const l of CARD_LABELS) expect(l.trim()).not.toBe('');
    expect(new Set(CARD_LABELS).size).toBe(CARD_LABELS.length);
  });

  it('the component’s own id mirror matches the shared one, entry for entry', () => {
    // There are two copies of this list and there have to be: the component
    // types `PROFILE_INFO` off its own `as const` array (which is what makes an
    // eighth key a tsc error rather than a test assertion), and production code
    // must not import from `test/`. Two copies of a mirror drift; this is what
    // stops them. Order included — the component's array is the type's source,
    // so a reorder there is a real change.
    expect(advertisableIdsInComponent()).toEqual(ADVERTISABLE);
  });

  it('renders NO tooltip for any id a real registry refuses to boot with, on ANY registry', () => {
    // The operator-visible form of the assertion above, and the one that holds
    // however a future entry is written. A forbidden chip must still RENDER —
    // the component must never drop a profile it does not recognise — but it
    // must carry no gloss, because glossing an id nothing can advertise is what
    // ratified those ids for the next reader.
    //
    // Crossed over BOTH props. Fixed to registry-b, this passed against a
    // component that re-added the `acdp-consumer` gloss for registry-a.
    for (const id of NOT_ADVERTISABLE) {
      for (const registry of REGISTRY_FIXTURES) {
        for (const capabilities of CAPABILITY_FIXTURES) {
          for (const position of POSITIONS) {
            const where = `${id} on ${registry.authority} @ ${capabilities.acdp_version} (${position})`;
            const chip = chipFor(id, capabilities, registry, position);
            expect(chip.textContent).toBe(id);
            // NOT just `title`. Every attribute but `class` must be absent, so
            // copy cannot arrive through `aria-label`, `aria-describedby` or a
            // `data-*` the probes were never reading.
            expect(attributesOf(chip), `${where} carries more than a class`).toEqual({
              class: 'chip',
            });
            cleanup();
          }
        }
      }
    }
  });

  it('discloses a tooltip for the advertisable ids and for NOTHING else on screen', () => {
    // The behavioural half, and the one that survives anything the component
    // does at RUNTIME — a `Proxy` get-trap, a non-enumerable key, a second
    // lookup object, a synthesised title. The parser above reads the file; this
    // reads the DOM.
    //
    // BE EXACT ABOUT WHAT THE TWO LAYERS DO AND DO NOT COVER. This comment used
    // to say they "cover each other's blind spot: … a render this probe does
    // not cover still has to be written into the file". That was false, and it
    // was the sentence that let the next hole through: what has to be written
    // into the file is not the same as what the parser SEES, and for one
    // revision the parser saw module scope only, so copy written into the
    // component body was in the file and invisible to both layers.
    //
    // The true division of labour:
    //   - `tsc` bounds the copy table's key set. Not a test, not evadable.
    //   - `assertNoCopyOutsideTable` bounds the rest of the FILE — whole-file,
    //     which is what makes the sentence above true now rather than then.
    //   - this probe bounds what REACHES THE SCREEN, for the ids it renders,
    //     across both props.
    //   - nothing bounds an arbitrary id string. The universe below is a
    //     sample, and is written to be an adversarial one.
    //
    // Both prop axes vary. A probe pinned to one capability fixture cannot see
    // copy conditioned on `acdp_version`; a probe pinned to one registry cannot
    // see copy conditioned on `authority`, which is how the deleted
    // `acdp-consumer` gloss came back for registry-a with the suite green.
    const expected = profileCopyTable().entries;
    const disclosing: string[] = [];
    for (const id of PROBES) {
      for (const registry of REGISTRY_FIXTURES) {
        for (const fixture of CAPABILITY_FIXTURES) {
          for (const position of POSITIONS) {
            const where = `${id} on ${registry.authority} @ ${fixture.acdp_version} (${position})`;
            const chip = chipFor(id, fixture, registry, position);
            const attrs = attributesOf(chip);
            // Nothing but `class` and (for the seven) `title`. A gloss arriving
            // through `aria-label` or a `data-*` is a disclosure no previous
            // version of this loop could see, and for a screen-reader user it
            // is the LOUDER channel of the two.
            expect(Object.keys(attrs).sort(), `${where}: unexpected attributes`).toEqual(
              expected.has(id) ? ['class', 'title'] : ['class'],
            );
            // And where a gloss is allowed, it is the TABLE's, character for
            // character. `toBeTruthy()` and an RFC regex both accept copy
            // synthesised anywhere in the component; equality does not, which
            // is what bounds the value behind an allow-listed import.
            if (expected.has(id)) expect(attrs.title, `${where}: gloss is not the table's`).toBe(expected.get(id));
            if (attrs.title !== undefined && !disclosing.includes(id)) disclosing.push(id);
            cleanup();
          }
        }
      }
    }
    expect(new Set(disclosing)).toEqual(new Set(ADVERTISABLE));
    // Anti-vacuity: a component that had lost every tooltip would also produce
    // an empty `disclosing`, and set-equality against an empty ADVERTISABLE
    // would be true.
    expect(disclosing).toHaveLength(ADVERTISABLE.length);
    // The probe renders `PROBES.length * REGISTRIES.length` cards one at a
    // time and measures ~2.7s unloaded; it crossed vitest's 5s default and went
    // red once under CPU contention from a parallel suite. A wide matrix is the
    // point of this test, so it gets a timeout it cannot plausibly reach rather
    // than fewer coordinates — a red here has to mean the card disclosed the
    // wrong thing, not that the machine was busy.
  }, 60_000);

  it('pins the adversarial id universe, so the probe above cannot be narrowed to the easy cases', () => {
    // `PROBES` was the one array here with no anti-vacuity pin, while
    // `NOT_ADVERTISABLE`, `CAPABILITY_FIXTURES` and `REGISTRY_FIXTURES` all had
    // one. Deleting every adversarial entry — the affix variants, the case
    // folds, the whitespace, the empty string, the `Object.prototype` names —
    // left the suite green, because the set-equality only needs
    // `ADVERTISABLE ⊆ PROBES`. The one array the design notes call deliberately
    // adversarial could be silently reduced to the seven ids that pass easily.
    expect(PROBES).toEqual(expect.arrayContaining([...ADVERTISABLE, ...NOT_ADVERTISABLE]));
    const advertisable = ADVERTISABLE as readonly string[];
    const notAdvertisable = NOT_ADVERTISABLE as readonly string[];
    const adversarial = PROBES.filter(
      (p) => !advertisable.includes(p) && !notAdvertisable.includes(p),
    );
    expect(adversarial.length).toBeGreaterThanOrEqual(15);
    // The classes, named — a count alone is satisfied by fifteen copies of 'x'.
    expect(adversarial).toEqual(expect.arrayContaining(['toString', 'constructor', '__proto__']));
    expect(adversarial.some((p) => p !== p.toLowerCase())).toBe(true); // a case fold
    expect(adversarial.some((p) => p !== p.trim())).toBe(true); // whitespace
    expect(adversarial).toContain(''); // the empty string
    expect(adversarial.some((p) => ADVERTISABLE.some((a) => p.startsWith(a) && p !== a))).toBe(true);
    expect(new Set(adversarial).size).toBe(adversarial.length);
  });

  it('pins the POSITION axis, the one array added without a pin', () => {
    // See `assertPositionAxisIsReal`. Narrowing `POSITIONS` to `['alone']` was
    // claimed killed in the commit that added it; it is killed only by `tsc`
    // switch-exhaustiveness, and the tsc-clean form of the same silencing
    // (return `[profileId]` for every case) passes every gate.
    assertPositionAxisIsReal();
  });

  it('every advertisable id keeps its gloss on EVERY registry, not just the demo two', () => {
    // The opposite direction from the probe above, and the one a set-equality
    // check cannot make: `disclosing` records an id that glossed on ANY
    // fixture, so a component that glossed each id on exactly one registry
    // would satisfy it. `app/registries/page.tsx` renders a card per observed
    // registry with its own authority, so "tooltips work on registry-b" is not
    // the claim an operator needs.
    for (const registry of REGISTRY_FIXTURES) {
      for (const capabilities of CAPABILITY_FIXTURES) {
        for (const id of ADVERTISABLE) {
          for (const position of POSITIONS) {
            const chip = chipFor(id, capabilities, registry, position);
            expect(
              chip.getAttribute('title'),
              `${id} has no gloss on ${registry.authority} @ ${capabilities.acdp_version} (${position})`,
            ).toMatch(/RFC-ACDP-\d{4}/);
            cleanup();
          }
        }
      }
    }
  });

  it('pins BOTH fixture axes, so neither probe loop can be silenced by emptying one', () => {
    // `CAPABILITY_FIXTURES` had no such pin while `NOT_ADVERTISABLE` did:
    // dropping it back to a single fixture was green, and it is the axis a
    // version-gated gloss hides behind. Emptying either array turns every
    // cross-product loop above into a no-op that asserts nothing.
    expect(CAPABILITY_FIXTURES).toHaveLength(2);
    expect(new Set(CAPABILITY_FIXTURES.map((c) => c.acdp_version)).size).toBe(2);
    expect(REGISTRY_FIXTURES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(REGISTRY_FIXTURES.map((r) => r.authority)).size).toBe(REGISTRY_FIXTURES.length);
    // …and one of them is an authority no demo fixture uses, so the matrix is
    // not just "the two names that happen to be in the mock data".
    expect(REGISTRY_FIXTURES.some((r) => !r.authority.endsWith('.playground.local'))).toBe(true);
  });

  it('DISCRIMINATES: a real profile rendered the same way DOES get its tooltip', () => {
    // Without this, the probe above would pass against a component that had
    // lost its tooltips entirely.
    const chip = chipFor(
      'acdp-registry-lifecycle',
      MOCK_CAPABILITIES.b as RegistryCapabilities,
      REGISTRY_B,
    );
    expect(chip.getAttribute('title')).toContain('RFC-ACDP-0013');
    cleanup();
  });

  it('keeps REACHABLE copy for every advertisable profile, not just a line in the file', () => {
    // The other direction: having removed two, the seven that a registry CAN
    // advertise must all still have copy, or the tooltip goes missing for a real
    // profile.
    //
    // This was a source grep for `'<id>':`, and a grep cannot tell copy that the
    // component reads from copy that merely exists. Moving an entry into a second,
    // unreferenced object satisfied the grep and killed no test — while the chip
    // silently lost its tooltip. `acdp-registry-federated` was the exposed one:
    // it is the only advertisable profile NO demo fixture advertises, so nothing
    // else rendered it.
    //
    // A registry may legitimately advertise all seven, so rendering all seven is
    // not a synthetic shape.
    const { container } = render(
      <RegistryCard registry={REGISTRY_B} capabilities={{ ...MOCK_CAPABILITIES.b, profiles: [...ADVERTISABLE] }} />,
    );
    const rendered = [...container.querySelectorAll('.chip')];
    expect(rendered.map((c) => c.textContent)).toEqual(ADVERTISABLE);
    for (const chip of rendered) {
      const title = chip.getAttribute('title');
      expect(title, `${chip.textContent} renders no tooltip copy`).toBeTruthy();
      // `toBeTruthy()` alone accepts `'x'`. Gutting a title to a single
      // character was green, so "has copy" was really "has a non-empty
      // attribute". Every entry names the RFC it comes from, and the version
      // cross-check in `mock-data.test.ts` defends the version half — this
      // defends the half nothing else reaches.
      expect(title, `${chip.textContent}: tooltip names no RFC`).toMatch(/RFC-ACDP-\d{4}/);
      expect(title!.length, `${chip.textContent}: tooltip is too short to say anything`).toBeGreaterThan(24);
    }
  });

  it('accents exactly the three 0.3.0 trust profiles', () => {
    // `accent: true` on two of the three killed no test, because only
    // `acdp-registry-transparency-log` was ever asserted. The accent is a signal
    // an operator reads as "this is one of the new trust profiles", so getting it
    // right for one of three and wrong for two is the same defect as getting it
    // wrong for all three — and the set is asserted as a set for that reason.
    const { container } = render(
      <RegistryCard registry={REGISTRY_B} capabilities={{ ...MOCK_CAPABILITIES.b, profiles: [...ADVERTISABLE] }} />,
    );
    const accented = [...container.querySelectorAll('.chip.ok')].map((c) => c.textContent);
    expect(accented).toEqual([
      'acdp-registry-head-receipts',
      'acdp-registry-transparency-log',
      'acdp-registry-lifecycle',
    ]);
    // And the complement, so "accent everything" cannot pass either.
    const plain = [...container.querySelectorAll('.chip')]
      .filter((c) => c.className === 'chip')
      .map((c) => c.textContent);
    expect(plain).toEqual([
      'acdp-registry-core',
      'acdp-registry-discovery',
      'acdp-registry-federated',
      'acdp-registry-receipts',
    ]);
  });
});

describe('every profile the demo advertises has copy for it', () => {
  it.each(Object.keys(MOCK_CAPABILITIES))('%s', (authority) => {
    // The join between the two files, asserted through the RENDER rather than
    // through the source — a chip with no tooltip is the observable symptom of
    // a missing entry, and it is what an operator would actually hit.
    const caps = MOCK_CAPABILITIES[authority as keyof typeof MOCK_CAPABILITIES];
    const { container } = render(<RegistryCard registry={REGISTRY_B} capabilities={caps} />);
    const profileRow = container.querySelector('.chip')!.parentElement as HTMLElement;
    for (const p of caps.profiles) {
      const chip = within(profileRow)
        .getAllByText(p)
        .find((c) => c.classList.contains('chip'))!;
      expect(chip.getAttribute('title'), `${p} has no tooltip copy`).toBeTruthy();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// THE RENDERED CLOSED WORLD (round 10).
//
// ── Why the source guards were not enough, in the gate's own words ────
//
// Round 9 shipped two structural guards: `assertGlossIsPureOfId` (bound the
// map callback's EXPRESSION) and `assertNoProseOutsideLabelTable` (bound the
// STRING SET, read from source). Both were right in kind. Both bound a
// SYNTACTIC FORM rather than a VALUE FLOW, and round 9's gate walked past them
// three different ways, each `tsc`-clean, `eslint`-clean and green:
//
//   N1b  a `const WITNESS_NOTE = 'acdp-log-witness — …'` in the component body,
//        rendered as `{WITNESS_NOTE}` inside an existing row. The string never
//        appears in a JSX child position, so the string-set walk never sees it.
//
//   N2b  a nested `function witnessNote(): string { return '…' }`, rendered as
//        `<Badge>{witnessNote()}</Badge>`. Same hole, through a call.
//
//   N3b  a SECOND `capabilities.profiles.map(…)` placed BEFORE the real one,
//        with `{i > 2 ? note(q) : null}`. `assertGlossIsPureOfId` binds the
//        LAST such call in the file, so the earlier one is unexamined and
//        round 7/8's index gate is live again. The identical mutation placed
//        AFTER the real map is killed — order alone decided.
//
// Each rendered tooltip-grade copy naming `acdp-log-witness` — the id
// `acdp-registry-server/src/main.rs:417-424` refuses to boot on — on every
// registry card, through the loudest channel there is: visible body text.
//
// ── What this does instead ────────────────────────────────────────────
//
// It stops asking HOW a string got to the screen and asks only WHAT is on it.
// Over a fixture matrix, every text node the card renders and every announced
// attribute it sets must be DERIVABLE FROM THE FIXTURE — a label from the
// pinned list, a value the fixture supplied, or a gloss from the copy table for
// an id the fixture actually advertises.
//
// A string that is not derivable from the fixture cannot reach the screen,
// whatever expression produced it. An identifier, a call, a second `.map`, a
// `Proxy` get-trap, an `alt` attribute, a template literal: all of them fail
// identically here, because none of them can make the rendered text match a set
// computed from the input.
//
// ── What it does NOT cover, stated plainly ────────────────────────────
//
// SUPPRESSION. This guard bounds what appears; it cannot see copy that
// silently STOPS appearing on a deployment the test does not run on. Round 9's
// gate proved that too: making `glossFor`'s second statement return `undefined`
// when `window.location.hostname.endsWith('.prod')` drops every tooltip on
// every registry in production, and jsdom's hostname is `localhost`, so every
// render probe in this file — including the one that demands a gloss for all
// seven advertisable ids — is satisfied. That direction is `assertGlossIsGated`
// and `assertGlossExpressionIsExactly`'s subject, and only theirs.
//
// And it bounds only what a FIXTURE can reach. Copy behind a condition no
// fixture satisfies is invisible to it — which is why the source-level guards
// above are kept rather than replaced.
// ══════════════════════════════════════════════════════════════════════
describe('the rendered card is a closed world over its fixture', () => {
  /**
   * The fixture matrix. Wide on purpose: the guard is only as strong as the
   * states a render can reach, and every previous escape on this branch lived
   * at a coordinate the then-current fixtures did not visit.
   */
  const REGISTRIES: KnownRegistry[] = [
    REGISTRY_B,
    {
      ...REGISTRY_B,
      authority: 'registry-a.playground.local',
      eventCount: 0,
      // ROUND 11's B2: `firstSeen` was held CONSTANT across every fixture, and
      // a row gated on `registry.firstSeen > '2026-09-01'` was therefore never
      // rendered. It died only incidentally, because the prose walk happened to
      // see the comparison's string operand; the same gate written against a
      // NUMBER walked through. A field no fixture varies is a coordinate the
      // closed world does not visit, whatever its docblock says.
      firstSeen: '2020-01-01T00:00:00.000Z',
      lastSeen: '2020-01-02T00:00:00.000Z',
    },
    {
      ...REGISTRY_B,
      baseUrl: null as unknown as string,
      eventCount: 1234567,
      firstSeen: '2099-12-31T00:00:00.000Z',
    },
  ];

  const CAPABILITY_SHAPES: RegistryCapabilities[] = [
    MOCK_CAPABILITIES.a,
    MOCK_CAPABILITIES.b,
    // Zero profiles — the map renders nothing, so anything still on screen came
    // from somewhere other than a chip.
    { ...MOCK_CAPABILITIES.b, profiles: [] },
    // One.
    { ...MOCK_CAPABILITIES.b, profiles: ['acdp-registry-core'] },
    // All seven, which is both the widest legal advertisement and the only way
    // `acdp-registry-federated` renders at all.
    { ...MOCK_CAPABILITIES.b, profiles: [...REGISTRY_ADVERTISABLE_PROFILES] },
    // An id with no copy — the fallback, and the shape an index gate keys on.
    {
      ...MOCK_CAPABILITIES.b,
      profiles: [...REGISTRY_ADVERTISABLE_PROFILES, 'acdp-registry-quantum'],
    },
    // Anonymous reads off, and a different payload size, so both arms of each
    // ternary are visited.
    {
      ...MOCK_CAPABILITIES.b,
      anonymous_public_reads: false,
      limits: { ...MOCK_CAPABILITIES.b.limits, max_payload_bytes: 2048 },
    },
    // ROUND 11's B2, the other half. `max_search_limit` and
    // `max_embedded_bytes` were identical in every shape, and the escape was
    // `capabilities.limits.max_search_limit > 500` — an ordinary registry
    // configuration value, not an exotic one. The `varies EVERY field` test
    // below is what keeps this from regressing by inspection.
    {
      ...MOCK_CAPABILITIES.b,
      registry_did: 'did:web:registry-c.playground.local',
      supported_signature_algorithms: ['Ed25519'],
      limits: {
        ...MOCK_CAPABILITIES.b.limits,
        max_search_limit: 1000,
        max_embedded_bytes: 4096,
      },
    },
  ];

  /**
   * The SECOND axis of the prop space, and round 11's B1.
   *
   * `capabilities` is optional. Not one test in the repo rendered the card
   * without it, so the whole `{capabilities && …}` branch — and everything
   * outside it — was unvisited by the closed world, while the docblock above
   * said "a string that is not derivable from the fixture cannot reach the
   * screen". A `<div className="metric-row">` naming `acdp-log-witness`,
   * rendered under `{!capabilities && …}`, passed 963/963.
   *
   * It is not an exotic coordinate. `app/registries/page.tsx:20-23` builds
   * `capsByHost` from two React Query results and indexes it by short
   * authority, so `undefined` is what every card gets on first paint, what any
   * card gets when either query errors, and what an observed registry that is
   * neither `registry-a` nor `registry-b` gets always — a case that page's own
   * comment anticipates. It is the first thing an operator sees.
   */
  const CAPABILITY_AXIS: (RegistryCapabilities | undefined)[] = [
    undefined,
    ...CAPABILITY_SHAPES,
  ];

  /** Every non-empty text node under `el`, trimmed. */
  function textNodes(el: HTMLElement): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? '').trim();
      if (t) out.push(t);
    }
    return out;
  }

  /**
   * Attributes that carry NO operator-facing text — presentation, geometry and
   * structure. EVERYTHING ELSE is treated as carrying text and must be
   * licensed.
   *
   * ── The inversion, and why round 11 forced it ────────────────────────
   *
   * This was a list of announcing attributes: `title`, `alt`, `placeholder`,
   * `aria-*`. Under a docblock that said "Every attribute that ANNOUNCES
   * text". It is an ENUMERATION OF AN OPEN SET under a closed-set claim, which
   * is the single defect this branch has now rediscovered in eleven
   * consecutive rounds — and round 11 walked through it with
   *
   *   <input readOnly className="metric-val"
   *          value="acdp-log-witness: log witness cosignatures (RFC-ACDP-0015)" />
   *
   * added UNCONDITIONALLY to the card body. `value` renders as visible text
   * and is announced; it is not a text node, so `textNodes()` missed it; it
   * was not on the list, so `announced()` missed it. 963/963 green. `srcDoc`,
   * `download`, `label`, `abbr` and `aria-errormessage` are all the same
   * shape, and enumerating them would leave the next one.
   *
   * So the allow-list is the NON-text side, which really is closed and really
   * is short: the card renders `class`, `style`, `title`, and the SVG
   * presentation attributes its two icons set. A maintainer who adds an
   * attribute that carries text must now either license its value from the
   * fixture or add its name here, in a diff, with a reason.
   */
  const NON_TEXT_ATTRS = new Set([
    'class',
    'style',
    'id',
    'role',
    'tabindex',
    // `aria-hidden` announces nothing by definition — that is its entire job.
    'aria-hidden',
    // SVG: `lucide-react` icons and `StatusDot`.
    'xmlns',
    'width',
    'height',
    'viewbox',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'd',
    'points',
    'cx',
    'cy',
    'r',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'rx',
    'ry',
    'transform',
  ]);

  /**
   * Every attribute value on the card that is not structural — which is what
   * the card ANNOUNCES or SHOWS through an attribute rather than a text node.
   */
  function announced(el: HTMLElement): string[] {
    const out: string[] = [];
    for (const node of [el, ...el.querySelectorAll<HTMLElement>('*')]) {
      for (const a of node.attributes) {
        if (NON_TEXT_ATTRS.has(a.name.toLowerCase())) continue;
        if (a.value.trim()) out.push(a.value.trim());
      }
    }
    return out;
  }

  /**
   * Everything the card is allowed to SAY, computed from the fixture it was
   * given.
   *
   * This is the whole instrument. The set is not a list someone maintains
   * alongside the component — it is derived from the inputs, so a string can
   * only be permitted by being one of the card's labels or by being something
   * the caller actually passed in.
   */
  function allowedText(r: KnownRegistry, c: RegistryCapabilities | undefined): Set<string> {
    const base = [
      ...CARD_LABELS,
      String(r.authority),
      r.baseUrl ?? '—',
      // `formatNumber` and `timeAgo` are the card's two formatters; their
      // OUTPUT is allowed, which is a much narrower permission than allowing
      // any call.
      formatNumber(r.eventCount),
      timeAgo(r.lastSeen),
    ];
    // With no capabilities the card renders strictly less — so the licence is
    // strictly smaller, and the `!capabilities` branch cannot borrow a string
    // the capabilities branch would have made legal.
    if (!c) return new Set<string>(base);
    return new Set<string>([
      ...base,
      c.acdp_version,
      c.supported_signature_algorithms.join(', '),
      ...c.supported_signature_algorithms,
      ...c.profiles,
      String(Math.round(c.limits.max_payload_bytes / 1024)),
    ]);
  }

  /** And everything it is allowed to ANNOUNCE: a gloss, for an id it advertises. */
  function allowedAnnounced(c: RegistryCapabilities | undefined): Set<string> {
    if (!c) return new Set<string>();
    // Read through `profileCopyTable()` — the PARSED copy table — rather than
    // by importing `PROFILE_INFO`, which is not exported, and rather than by
    // hand-listing the seven glosses here. A hand list would be a second copy
    // of the table that drifts; the parse is the same source of truth the
    // structural guards use.
    const { entries } = profileCopyTable();
    return new Set<string>(
      c.profiles.map((p) => entries.get(p)).filter((t): t is string => typeof t === 'string'),
    );
  }

  /**
   * The assertion itself, NAMED — so it can be exercised against a DOM that
   * must fail it.
   *
   * Inlined in the loop, disabling it (`true || allowed.has(t)`) is a silent,
   * green edit: nothing else in the suite notices, because every other guard
   * here reads the source rather than the render. Measured. A guard whose
   * failure mode is "somebody deletes it" needs the deletion to be red, and
   * the only way to get that is to call it somewhere it must throw.
   */
  function expectAllTextLicensed(container: HTMLElement, allowed: Set<string>, where: string) {
    for (const t of textNodes(container)) {
      expect(
        allowed.has(t),
        `the card rendered ${JSON.stringify(t)}, which nothing in its fixture licenses (${where})`,
      ).toBe(true);
    }
  }

  function expectAllAnnouncedLicensed(
    container: HTMLElement,
    allowed: Set<string>,
    where: string,
  ) {
    for (const a of announced(container)) {
      expect(
        allowed.has(a),
        `the card announced ${JSON.stringify(a)} through an attribute, which nothing in its ` +
          `fixture licenses (${where})`,
      ).toBe(true);
    }
  }

  const coord = (r: KnownRegistry, c: RegistryCapabilities | undefined) =>
    `registry ${r.authority}, ${c ? `${c.profiles.length} profiles` : 'NO capabilities'}`;

  it('renders no text node that its fixture does not license', () => {
    let rendered = 0;
    let withoutCaps = 0;
    for (const r of REGISTRIES) {
      for (const c of CAPABILITY_AXIS) {
        cleanup();
        const { container } = render(<RegistryCard registry={r} capabilities={c} />);
        expectAllTextLicensed(container, allowedText(r, c), coord(r, c));
        rendered += 1;
        if (!c) withoutCaps += 1;
      }
    }
    // Anti-vacuity: the matrix actually ran, and ran wide.
    expect(rendered).toBe(REGISTRIES.length * CAPABILITY_AXIS.length);
    expect(rendered).toBeGreaterThan(15);
    // …and it visited the half of the prop space that had never been rendered.
    // Named separately rather than folded into the product, because the
    // product grew for other reasons too and would have hidden its loss.
    expect(withoutCaps, 'the `capabilities: undefined` arm is unvisited again').toBe(
      REGISTRIES.length,
    );
  });

  it('announces no string its fixture does not license, through ANY attribute', () => {
    for (const r of REGISTRIES) {
      for (const c of CAPABILITY_AXIS) {
        cleanup();
        const { container } = render(<RegistryCard registry={r} capabilities={c} />);
        expectAllAnnouncedLicensed(container, allowedAnnounced(c), coord(r, c));
      }
    }
  });

  it('the non-text allow-list is a CLOSED list, pinned member by member', () => {
    // ROUND 12's G30. Adding `value` to `NON_TEXT_ATTRS` was green: nothing in
    // the fixture carries a `value`, so the widening had no subject — and
    // `value` is precisely the attribute whose absence from the OLD (positive)
    // list let round 11's M4 put a whole unlicensed sentence on the card.
    //
    // Inverting the list made it closed in principle. Pinning it makes it
    // closed in fact: the only way to license another attribute is a diff to
    // both places, which is the diff a reviewer is supposed to read. Every
    // member below is either structural (announces nothing) or SVG geometry.
    expect([...NON_TEXT_ATTRS].sort()).toEqual(
      [
        'aria-hidden',
        'class',
        'cx',
        'cy',
        'd',
        'fill',
        'height',
        'id',
        'points',
        'r',
        'role',
        'rx',
        'ry',
        'stroke',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-width',
        'style',
        'tabindex',
        'transform',
        'viewbox',
        'width',
        'x',
        'x1',
        'x2',
        'xmlns',
        'y',
        'y1',
        'y2',
      ].sort(),
    );
    // The four that carry text and must never be on it, named so that a
    // widening cannot pass by looking plausible: each of these is an escape the
    // gate has actually landed on this branch.
    for (const announcing of ['value', 'alt', 'title', 'aria-label', 'placeholder']) {
      expect(NON_TEXT_ATTRS.has(announcing), `\`${announcing}\` announces text`).toBe(false);
    }
  });

  it('the matrix keeps the SHAPES that are there for a reason', () => {
    // A shape can be deleted silently: `rendered > 15` still holds at 3x6, and
    // `varies every field` still holds if another shape happens to vary the
    // same field. The three below are not there for variance — each is a
    // structural case whose absence removes a whole branch from the render.
    expect(CAPABILITY_SHAPES.length, 'a capability shape was deleted').toBe(8);
    expect(REGISTRIES.length, 'a registry fixture was deleted').toBe(3);
    // Zero profiles: the map renders nothing, so anything still on screen came
    // from somewhere other than a chip.
    expect(CAPABILITY_SHAPES.some((c) => c.profiles.length === 0)).toBe(true);
    // All seven: the widest legal advertisement, and the only way
    // `acdp-registry-federated` renders at all.
    expect(
      CAPABILITY_SHAPES.some((c) => c.profiles.length === REGISTRY_ADVERTISABLE_PROFILES.length),
    ).toBe(true);
    // An id with no copy: the fallback, and the shape an index gate keys on.
    expect(
      CAPABILITY_SHAPES.some((c) =>
        c.profiles.some((p) => !(REGISTRY_ADVERTISABLE_PROFILES as readonly string[]).includes(p)),
      ),
    ).toBe(true);
    // Both arms of the anonymous-reads ternary.
    expect(new Set(CAPABILITY_SHAPES.map((c) => c.anonymous_public_reads)).size).toBe(2);
  });

  it('the matrix VARIES every field of both props', () => {
    // ROUND 11's B2, as a guard rather than as three more fixtures.
    //
    // Round 8 found three fields held constant and the escape used one of
    // them. They were varied; three DIFFERENT fields were still constant, and
    // round 11's escape used one of those. Adding fixtures fixes the instance;
    // this fixes the class, by making "a field nothing varies" a red test.
    //
    // A constant field is a coordinate the closed world never visits, and the
    // docblock above claims it visits all of them.
    const leaves = (o: unknown, prefix = ''): Array<[string, string]> => {
      if (o === null || typeof o !== 'object') return [[prefix, JSON.stringify(o) ?? 'undefined']];
      if (Array.isArray(o)) return [[prefix, JSON.stringify(o)]];
      return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, prefix ? `${prefix}.${k}` : k),
      );
    };
    const constantFields = (objs: unknown[]): string[] => {
      const byPath = new Map<string, Set<string>>();
      for (const o of objs) {
        for (const [path, val] of leaves(o)) {
          if (!byPath.has(path)) byPath.set(path, new Set());
          byPath.get(path)!.add(val);
        }
      }
      return [...byPath].filter(([, vals]) => vals.size < 2).map(([path]) => path);
    };

    expect(constantFields(REGISTRIES), 'these registry fields never vary').toEqual([]);
    expect(
      constantFields(CAPABILITY_SHAPES),
      'these capability fields never vary',
    ).toEqual([]);
    // Anti-vacuity on the detector itself: it must be able to SAY a field is
    // constant, or the two assertions above pass by finding nothing.
    expect(constantFields([{ a: 1, b: 1 }, { a: 1, b: 2 }])).toEqual(['a']);
    expect(constantFields([{ n: { deep: 'x' } }, { n: { deep: 'x' } }])).toEqual(['n.deep']);
  });

  it('GUARDS THE GUARD: both checks REJECT a card that says something unlicensed', () => {
    // The escapes, injected into a real rendered card rather than described.
    // `expectAllTextLicensed` and `expectAllAnnouncedLicensed` must throw on
    // each — disabling either loop's condition is otherwise a green edit, and
    // was measured as one.
    cleanup();
    const c = MOCK_CAPABILITIES.b;
    const { container } = render(<RegistryCard registry={REGISTRY_B} capabilities={c} />);
    const allowedT = allowedText(REGISTRY_B, c);
    const allowedA = allowedAnnounced(c);

    // Clean as rendered…
    expectAllTextLicensed(container, allowedT, 'clean');
    expectAllAnnouncedLicensed(container, allowedA, 'clean');

    // …a visible text node naming the id upstream refuses to boot on. This is
    // N1b and N2b's observable result, whatever expression produced it.
    const prose = document.createElement('span');
    prose.textContent = 'acdp-log-witness — append-only log witness cosignatures (RFC-ACDP-0015)';
    container.querySelector('.card-body')!.appendChild(prose);
    expect(() => expectAllTextLicensed(container, allowedT, 'injected prose')).toThrow();
    // …and the announced half is NOT what caught it, so the two are separable.
    expectAllAnnouncedLicensed(container, allowedA, 'injected prose');
    prose.remove();

    // …an announced attribute carrying the same sentence. This is P6's `alt`
    // and P5's second `title`, reduced to what they have in common.
    const announcedEl = document.createElement('img');
    announcedEl.setAttribute('alt', 'acdp-log-witness cosignatures (RFC-ACDP-0015)');
    container.querySelector('.card-body')!.appendChild(announcedEl);
    expect(() => expectAllAnnouncedLicensed(container, allowedA, 'injected alt')).toThrow();
    // …and the text half is NOT what caught THAT one.
    expectAllTextLicensed(container, allowedT, 'injected alt');
    announcedEl.remove();

    // `aria-label` too, since its whole argument for being on the list is that
    // it is announced.
    const aria = document.createElement('span');
    aria.setAttribute('aria-label', 'acdp-consumer profile');
    container.querySelector('.card-body')!.appendChild(aria);
    expect(() => expectAllAnnouncedLicensed(container, allowedA, 'injected aria-label')).toThrow();
    aria.remove();

    // And `value` on a read-only input — round 11's M4 verbatim, the escape
    // that beat the positive allow-list this guard replaced. It renders as
    // VISIBLE text and is announced, and it is not a text node, so it is the
    // one case where the announced half is the only half that can catch it.
    const valued = document.createElement('input');
    valued.readOnly = true;
    valued.setAttribute('value', 'acdp-log-witness: log witness cosignatures (RFC-ACDP-0015)');
    container.querySelector('.card-body')!.appendChild(valued);
    expect(() => expectAllAnnouncedLicensed(container, allowedA, 'injected value')).toThrow();
    // …and the text half is blind to it, which is the whole reason M4 shipped.
    expectAllTextLicensed(container, allowedT, 'injected value');
    valued.remove();

    // And back to clean, so the injections really were the cause.
    expectAllTextLicensed(container, allowedT, 'restored');
    expectAllAnnouncedLicensed(container, allowedA, 'restored');
  });

  it('DISCRIMINATES: the card renders and announces something at all', () => {
    // Without this, both tests above pass on a component that renders nothing —
    // a universal over an empty set is vacuously true, which is the same defect
    // class this branch's sibling (#97) exists to remove, one level up.
    cleanup();
    const { container } = render(
      <RegistryCard
        registry={REGISTRY_B}
        capabilities={{ ...MOCK_CAPABILITIES.b, profiles: [...REGISTRY_ADVERTISABLE_PROFILES] }}
      />,
    );
    const texts = textNodes(container);
    expect(texts.length, 'the card rendered no text at all').toBeGreaterThan(12);
    expect(texts).toContain('Profiles');
    expect(texts).toContain('acdp-registry-federated');
    // …and every advertisable id carries a gloss, so the announced check above
    // is running against a non-empty set.
    expect(announced(container)).toHaveLength(REGISTRY_ADVERTISABLE_PROFILES.length);
  });

  it('GUARDS THE GUARD: the closed world REJECTS each escape that beat the source walks', () => {
    // The three mutations round 9's gate landed, reproduced as RENDERS rather
    // than as source edits — because what this guard bounds is the rendered
    // output, and a source edit would be testing the wrong instrument.
    //
    // Each string below is one the gate actually got onto the card with the
    // whole suite green. Every one is now rejected by `allowedText` for the
    // only reason that matters: nothing in the fixture produced it.
    const r = REGISTRY_B;
    const c = MOCK_CAPABILITIES.b;
    const allowed = allowedText(r, c);
    for (const escape of [
      'acdp-log-witness — append-only log witness cosignatures (RFC-ACDP-0015)',
      'acdp-log-witness — log witness cosignature aggregation (RFC-ACDP-0015)',
      'acdp-registry-core is a witness-class profile (acdp-log-witness)',
      'acdp-consumer',
      'acdp-federated',
      'Witness',
    ]) {
      expect(allowed.has(escape), `the closed world admits ${JSON.stringify(escape)}`).toBe(false);
    }
    // …and it genuinely admits what the card legitimately renders, so it is
    // not rejecting everything.
    for (const legitimate of ['Profiles', 'Base URL', r.authority, ...c.profiles]) {
      expect(allowed.has(legitimate), `the closed world refuses ${JSON.stringify(legitimate)}`).toBe(
        true,
      );
    }
    // The announced set behaves the same way in both directions.
    const ann = allowedAnnounced(c);
    expect(ann.has('acdp-log-witness — append-only log witness cosignatures')).toBe(false);
    expect(ann.size, 'no gloss is licensed at all').toBe(c.profiles.length);
  });
});

// ══════════════════════════════════════════════════════════════════════
// GUARDS ON THE GUARDS (rounds 10 and 12).
//
// Round 9's gate emptied eight of this file's instruments one at a time and the
// whole suite stayed green for every one: the JSX-child-literal branch of the
// prose walk, `PROHIBITED_RUNTIME_FORMS`, both of `assertGlossIsPureOfId`'s
// substantive checks, `assertNoProseOutsideLabelTable`'s permitted-set test,
// its anti-vacuity trio, and `ALLOWED_IMPORTS`.
//
// That is the sixth time a newly-added guard on this branch shipped without a
// vacuity pin, and the shape is always the same: the guard is exercised only by
// source that already satisfies it, so an emptied guard and a passing guard are
// indistinguishable.
//
// ROUND 12 CORRECTION. The header above said "round 10" and the paragraph below
// said this section "exercises each instrument" — both were written when the
// four hand-written rejection tests were all there was. Round 11 then counted
// the instruments: the hand-written four covered 8 of ~14, and four guards had
// no rejecting subject at all. The `GUARDS` table further down is what actually
// makes "each" true, and it is true only because a missing entry is now a
// compile error rather than a claim in a comment. The four tests immediately
// below predate it and overlap it; they are kept because each pins something
// the table cannot — a BRANCH of a walk, the contents of a list, the text of a
// pinned expression — and deleting them was measured green in round 9.
//
// So: what follows exercises the instruments this file's guards are BUILT from,
// and the `GUARDS` table exercises every exported guard itself. Neither makes
// any of them adequate — the rendered closed world above is the guarantee for
// what appears, and `assertGlossIsGated` for what stops appearing. Together
// they make "someone emptied it" a red test rather than a silent change, which
// is the only thing a vacuity pin can do.
// ══════════════════════════════════════════════════════════════════════
describe('the source guards are not vacuous', () => {
  it('the prose walk REJECTS a label that is missing from the permitted set', () => {
    // The rejection path, exercised by narrowing the permitted set rather than
    // by editing the component — so it tests the guard, not the card.
    expect(() => assertNoProseOutsideLabelTable([])).toThrow();

    // Once per BRANCH of the walk. `Profiles` is `JsxText`; `—` and `enabled`
    // are string literals in JSX child positions, reached by the other branch.
    // Disabling that second branch entirely was green before round 10, because
    // no required string exercised it.
    for (const dropped of ['Profiles', '—', 'enabled']) {
      expect(
        () => assertNoProseOutsideLabelTable(CARD_LABELS.filter((l) => l !== dropped)),
        `the prose walk does not reach ${JSON.stringify(dropped)}`,
      ).toThrow();
    }

    // …and it accepts the real list, so it is not simply throwing always.
    expect(() => assertNoProseOutsideLabelTable(CARD_LABELS)).not.toThrow();
  });

  it('the prohibited-runtime-form list is not empty', () => {
    // The pin this list HAD at `a628b7f`, deleted with the check at `7c92af3`,
    // and not restored when `8e27c84` restored the check. Round 8 named the
    // loss; round 9 did not restore it; emptying the list to `[]` was green
    // through both.
    //
    // Without it, `assertNoRuntimeCopyForms` checks nothing and the in-body
    // `Proxy` get-trap its docblock describes — RED at `a628b7f`, green one
    // revision later — becomes green again the moment anyone trims the list.
    expect(PROHIBITED_RUNTIME_FORMS.length).toBeGreaterThan(4);
    // The four that matter most, named so a trim cannot pass by leaving the
    // cheap ones in. Each is a way to give an object a `title` with no property
    // literal for the object walk to find.
    for (const form of ['Object.assign', 'Object.defineProperty', 'Object.setPrototypeOf', 'Proxy']) {
      expect(PROHIBITED_RUNTIME_FORMS as readonly string[]).toContain(form);
    }
  });

  it('the import allow-list is not a wildcard', () => {
    // Widening one entry — adding `PROFILE_GLOSS` to `@/lib/utils/format` —
    // was green, because nothing asserts what the map contains. The map's job
    // is to stop copy arriving from a module nobody reviewed, so an entry
    // nobody looks at is the whole failure mode.
    const bindings = Object.values(ALLOWED_IMPORTS).flat();
    expect(Object.keys(ALLOWED_IMPORTS).length).toBeGreaterThan(2);
    expect(bindings.length).toBeGreaterThan(3);
    // No entry may be an empty list standing in for "anything from here".
    for (const [mod, names] of Object.entries(ALLOWED_IMPORTS)) {
      expect(names.length, `\`${mod}\` allows no named binding, which reads as a wildcard`).toBeGreaterThan(0);
    }
    // ROUND 11: the two lines below used to be the whole of it — a DENYLIST of
    // two names, under a test titled "is not a wildcard". Adding any third
    // binding to any entry was green. A denylist of two is a wildcard with two
    // holes in it.
    //
    // So the table is pinned EXACTLY. It is four modules and six bindings; it
    // has not changed in eleven rounds; and the one thing it must never do is
    // grow without anyone reading the diff, because each new binding is a
    // module that may carry copy.
    expect(ALLOWED_IMPORTS).toEqual({
      '@/components/ui/status-dot': ['StatusDot'],
      '@/components/ui/badge': ['Badge'],
      '@/lib/utils/format': ['formatNumber', 'timeAgo'],
      '@/lib/types': ['KnownRegistry', 'RegistryCapabilities'],
    });
    expect(bindings).not.toContain('PROFILE_GLOSS');
    expect(bindings).not.toContain('PROFILE_INFO');
  });

  it('the three pinned expressions are pinned to something real', () => {
    // `GLOSS_EXPRESSION`, `GLOSS_GATE_CONDITION` and `GLOSS_RETURN_EXPRESSION`
    // are compared for exact equality against the component's source. Emptying
    // any of them turns its comparison into `'' !== ''`, which never fails —
    // the same vacuity as an emptied list, one level down.
    //
    // `GLOSS_RETURN_EXPRESSION` is the one round 10 added: `glossFor`'s second
    // statement was unbounded while three docblocks said otherwise, and a
    // hostname check in front of the lookup dropped every tooltip on every
    // registry in production with every test green.
    expect(GLOSS_EXPRESSION).toBe('{info?.title}');
    expect(GLOSS_GATE_CONDITION).toContain('ADVERTISABLE_PROFILE_IDS');
    expect(GLOSS_GATE_CONDITION).toContain('includes(p)');
    expect(GLOSS_RETURN_EXPRESSION).toBe('PROFILE_INFO[pasAdvertisableProfileId]');
    // Whitespace-collapsed, which is what the comparison does to the source —
    // a spelling with spaces in it could never match and would pin nothing.
    for (const pinned of [GLOSS_GATE_CONDITION, GLOSS_RETURN_EXPRESSION]) {
      expect(pinned, 'a pinned expression contains whitespace and can never match').not.toMatch(/\s/);
      expect(pinned.length).toBeGreaterThan(10);
    }
  });

  // ── Guards whose trigger `registry-card.tsx` is never in ──────────────
  //
  // A multiplicity check needs a file with two maps; an anti-vacuity check
  // needs a file with no JSX; an attribute check needs the attribute present.
  // The component is in none of those states, so running each guard against it
  // proves only that it does not throw. Each of the three below was emptied and
  // the whole suite stayed green.
  //
  // They are therefore fed a synthetic subject through `sourceFile`'s `source`
  // override. The strings are small, deliberately minimal components — enough
  // TSX for the walk to have something to find, and no more.

  const TWO_MAPS = `
    export function RegistryCard({ capabilities }: { capabilities: any }) {
      return (
        <div>
          {capabilities.profiles.map((q: string, i: number) => (
            <span key={q}>{i > 2 ? q : null}</span>
          ))}
          {capabilities.profiles.map((p: string) => {
            const info = glossFor(p);
            return <span key={p} title={info?.title}>{p}</span>;
          })}
        </div>
      );
    }
  `;

  it('the map guard REFUSES a second capabilities.profiles.map', () => {
    // Round 9's escape: the collector reassigned a single variable, so the LAST
    // map in source order won and an earlier one carrying `{i > 2 ? note(q) :
    // null}` was never inspected — `tsc` clean, `eslint` clean, suite green.
    // The identical mutation placed AFTER the real map was killed. Order alone
    // decided.
    expect(() => assertGlossIsPureOfId(TWO_MAPS)).toThrow(/2 .*map/i);
    // …and one map is still accepted, so it is not refusing everything.
    expect(() => assertGlossIsPureOfId()).not.toThrow();
  });

  it('the prose walk REFUSES to pass vacuously on a file with no JSX', () => {
    // The anti-vacuity list can be emptied silently — measured green. Fed a
    // component that renders nothing, the walk must report that it found none
    // of the labels the card definitely shows, rather than passing.
    expect(() =>
      assertNoProseOutsideLabelTable(CARD_LABELS, 'export const X = 1;'),
    ).toThrow(/vacuous|did not find/i);
  });

  it('the alternate-channel guard REFUSES every channel it names', () => {
    // `alt` and `placeholder` joined the list in round 10 — round 9's gate got a
    // sentence naming `acdp-log-witness` onto the card through an `alt`, and
    // this guard covered only `aria-*`, `data-*` and `dangerouslySetInnerHTML`.
    // Removing any ONE of the five is otherwise completely silent, because the
    // component contains none of them.
    //
    // So each is named and exercised alone. A single combined subject would be
    // satisfied by any one arm still firing — the same masking that hid a
    // loosened block equality in PR K.
    const CHANNELS: ReadonlyArray<readonly [string, string]> = [
      ['alt', '<img alt="acdp-log-witness cosignatures (RFC-ACDP-0015)" />'],
      ['placeholder', '<input placeholder="acdp-consumer profile" />'],
      ['aria-label', '<span aria-label="acdp-consumer profile">x</span>'],
      ['data-*', '<span data-profile="acdp-log-witness">x</span>'],
      [
        'dangerouslySetInnerHTML',
        '<span dangerouslySetInnerHTML={{ __html: "acdp-producer" }} />',
      ],
    ];
    // The array can be EMPTIED, and a `for` over `[]` runs no assertions at
    // all — round 11 measured exactly that. Pinned to its length, and the
    // canonical coverage now lives in the derived table at the end of this
    // file, which asserts every guard has at least one rejecting subject.
    expect(CHANNELS.length, 'the channel table emptied out').toBe(5);
    for (const [name, jsx] of CHANNELS) {
      expect(
        () =>
          assertNoAlternateDisclosureChannel(
            `export function RegistryCard() { return ${jsx}; }`,
          ),
        `the guard admits copy through \`${name}\``,
      ).toThrow();
    }
    // …and a clean file passes, so it is not refusing everything.
    expect(() =>
      assertNoAlternateDisclosureChannel('export function RegistryCard() { return <span>x</span>; }'),
    ).not.toThrow();
  });

  it('the runtime-forms walk REFUSES each prohibited construct', () => {
    // The list is pinned non-empty above; this pins that the WALK reading it
    // still fires. Both can be emptied independently.
    for (const form of ['Object.assign({}, {})', 'new Proxy({}, {})', 'Object.setPrototypeOf({}, {})']) {
      expect(
        () => assertNoRuntimeCopyForms(`export const X = ${form};`),
        `the walk admits \`${form}\``,
      ).toThrow();
    }
    expect(() => assertNoRuntimeCopyForms('export const X = 1;')).not.toThrow();
  });

  it('the id SHAPE matches a mis-cased id and not a spec citation', () => {
    const shaped = (s: string) => [...s.matchAll(PCT.PROFILE_ID_SHAPE)].map((m) => m[0]);
    // ROUND 13's B3, both directions in one place because the fix for one broke
    // the other. The case-SENSITIVE pattern missed these two, and putting them
    // in a gloss left 969/969 green…
    expect(shaped('also advertised as acdp-Federated or ACDP-consumer')).toEqual([
      'acdp-Federated',
      'ACDP-consumer',
    ]);
    expect(shaped('acdp_log_witness')).toEqual(['acdp_log_witness']);
    // …and the naive case-INSENSITIVE fix matched the spec citation that every
    // gloss in the table ends with, so the guard refused the real component and
    // took six tests down with it. Requiring a letter after the separator is
    // what separates an id from a citation and from a version marker.
    expect(shaped('Mandatory registry baseline (RFC-ACDP-0001 §9.1)')).toEqual([]);
    expect(shaped('Signed registry receipts at publish time (RFC-ACDP-0010, acdp 0.2.0)')).toEqual([]);
  });

  it('the two guards profileCopyTable() does NOT run still run, here', () => {
    // `assertNoProseOutsideLabelTable` and `assertGlossIsPureOfId` are not
    // invoked by `profileCopyTable()` — it runs `RUN_ON_READ`, which holds every
    // guard but those two — so `mock-data.test.ts`, which calls it twice, gets
    // those bounds and not these. The numbers that used to be written here and
    // in two docblocks in the guard module had drifted to three different
    // values by round 13; the set is named instead, and `RUN_ON_READ.length` is
    // asserted once, above.
    //
    // Not a defect today: this file calls both directly, above and here. It is
    // written down and re-asserted because "the helper runs everything" is
    // exactly the assumption under which deleting a call site would be
    // invisible, and because a guard with ONE call site is one edit from
    // having none.
    expect(() => assertGlossIsPureOfId()).not.toThrow();
    expect(() => assertNoProseOutsideLabelTable(CARD_LABELS)).not.toThrow();
    // …and `profileCopyTable()` genuinely does not subsume them: it returns a
    // populated table without either bound being consulted, which is the fact
    // the paragraph above depends on.
    expect(profileCopyTable().entries.size).toBe(REGISTRY_ADVERTISABLE_PROFILES.length);
  });
});

// ══════════════════════════════════════════════════════════════════════
// EVERY guard, against a subject it MUST reject.
//
// Round 11's B5, B6 and B7, and they are one finding with three faces.
//
// The describe above is titled "the source guards are not vacuous" and its
// own comment said "What follows exercises EACH INSTRUMENT against input that
// MUST be rejected." It exercised eight of about fourteen. The six it did not
// were individually disable-able with the whole suite green — including
// `assertGlossChokePoint`, `assertModuleShape`, `assertNoCopyOutsideTable`,
// and the `GLOSS_RETURN_EXPRESSION` comparison that `profile-copy-table.ts`
// calls "the only instrument" defending the suppression direction.
//
// The two self-tests that DID cover the pinned expressions covered them in the
// wrong direction: they asserted properties of the CONSTANT (non-empty, no
// whitespace) and never fed a subject that violates it, so they proved the
// string was well-formed and nothing about whether any code compares against
// it. Injecting into the expected side is the mistake this repo has now made
// in three separate PRs.
//
// ── Why a TABLE, and why its coverage is derived ─────────────────────
//
// A hand-written list of self-tests is the same open enumeration as a
// hand-written list of forbidden phrasings: it is complete on the day it is
// written and silently incomplete afterwards. So the set of guards this table
// must cover is read off the MODULE'S OWN EXPORTS. Adding an `assert*` export
// without a rejecting subject is a failing test, not an oversight somebody has
// to notice in review.
//
// Each entry also asserts the guard ACCEPTS the real component, so a guard
// that has been made to throw unconditionally — which would pass every
// rejection case — is red too.
// ══════════════════════════════════════════════════════════════════════
describe('every source guard is exercised against a subject it must reject', () => {
  /** A module-scope assignment: `assertModuleShape`'s stated subject. */
  const BARE_EXPRESSION = `
    const PROFILE_INFO = { 'acdp-registry-core': { title: 'x' } };
    PROFILE_INFO['acdp-registry-core'] = { title: 'y' };
    function RegistryCard() { return <span>x</span>; }
  `;

  /** A second copy table inside the component: `assertNoCopyOutsideTable`'s. */
  const COPY_OUTSIDE_TABLE = `
    const PROFILE_INFO = { 'acdp-registry-core': { title: 'x' } };
    function RegistryCard() {
      const local = { title: 'log witness cosignatures' };
      return <span title={local.title}>x</span>;
    }
  `;

  /** Two `title` attributes: `assertGlossChokePoint`'s. */
  const TWO_TITLES = `
    const PROFILE_INFO = { 'acdp-registry-core': { title: 'x' } };
    function RegistryCard() {
      return <div title="one"><span title="two">x</span></div>;
    }
  `;

  /** A JSX spread, which can introduce `title` with no attribute node. */
  const JSX_SPREAD = `
    const PROFILE_INFO = { 'acdp-registry-core': { title: 'x' } };
    function RegistryCard({ extra }: { extra: object }) {
      return <span {...extra}>x</span>;
    }
  `;

  /** `glossFor` with its membership gate removed. */
  const UNGATED_GLOSS = `
    function glossFor(p: string) {
      return PROFILE_INFO[p as AdvertisableProfileId];
    }
  `;

  /** `glossFor` returning something other than the pinned lookup. */
  const SUPPRESSING_GLOSS = `
    function glossFor(p: string) {
      if (!(ADVERTISABLE_PROFILE_IDS as readonly string[]).includes(p)) return undefined;
      return window.location.hostname.endsWith('.prod') ? undefined : PROFILE_INFO[p as AdvertisableProfileId];
    }
  `;

  /** A second `PROFILE_INFO` read outside `glossFor`. */
  const SECOND_LOOKUP = `
    function glossFor(p: string) {
      if (!(ADVERTISABLE_PROFILE_IDS as readonly string[]).includes(p)) return undefined;
      return PROFILE_INFO[p as AdvertisableProfileId];
    }
    function RegistryCard() {
      const x = (PROFILE_INFO as Record<string, { title: string }>)['acdp-registry-core'];
      return <span>{x.title}</span>;
    }
  `;

  /** No `capabilities.profiles.map` at all: the map guard's anti-vacuity. */
  const NO_MAP = `
    function RegistryCard() { return <span>x</span>; }
  `;

  /** The index parameter, bound again. */
  const INDEXED_CALLBACK = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string, i: number) => {
        const info = glossFor(p);
        return <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{p}</span>;
      })}</>;
    }
  `;

  /** `info` computed from something other than the profile id. */
  const IMPURE_INFO = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p) ?? { title: 'log witness cosignatures' };
        return <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{p}</span>;
      })}</>;
    }
  `;

  /**
   * ROUND 11's B3, verbatim: the tooltip dropped behind a condition no fixture
   * satisfies. `glossFor` is untouched, exactly one `title` attribute survives
   * the count, and every render probe is satisfied.
   */
  const CONDITIONAL_SUPPRESSION = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p);
        if (capabilities.limits.max_search_limit > 500) {
          return <span key={p} className={info?.accent ? 'chip ok' : 'chip'}>{p}</span>;
        }
        return <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{p}</span>;
      })}</>;
    }
  `;

  /** A gloss rendered as the chip's own CHILD — visible body copy. */
  const GLOSS_AS_CHILD = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p);
        return <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{info?.title}</span>;
      })}</>;
    }
  `;

  /** ROUND 11's B4 and B8: an id no registry may advertise, named in a literal. */
  const FOREIGN_ID = `
    const a = 'one'; const b = 'two'; const c = 'three'; const d = 'four';
    const witnessNote = 'acdp-log-witness — append-only log witness cosignatures (RFC-ACDP-0015)';
    function RegistryCard() { return <span className="metric-val">{witnessNote}</span>; }
  `;

  /** The same id carried by an `<input value>` — round 11's M4. */
  const FOREIGN_ID_IN_VALUE = `
    const a = 'one'; const b = 'two'; const c = 'three'; const d = 'four';
    function RegistryCard() {
      return <input readOnly value="acdp-consumer: a consumer of contexts (not a registry)" />;
    }
  `;

  const CLEAN_TSX = 'export function RegistryCard() { return <span>x</span>; }';

  // ══════════════════════════════════════════════════════════════════
  // ROUND 13's B4: SUBJECTS THAT REACH A GUARD'S *LATER* BRANCHES.
  //
  // Round 12 gave every exported guard a rejecting subject and called the
  // coverage question closed. Round 13 measured that NINE load-bearing checks
  // inside those guards still had none, and diagnosed why: every synthetic
  // subject dies at the guard's FIRST branch, so each branch after it is still
  // only ever run against source that satisfies it. An emptied later branch and
  // a working one are indistinguishable — the same argument `sourceFile`'s
  // docblock makes for the `source` seam existing at all, one level down.
  //
  // Writing a synthetic file that reaches a late branch means hand-writing a
  // file that satisfies every earlier branch. For `assertGlossIsPureOfId`'s
  // attribute checks that is most of the component; for `profileCopyTable`'s
  // own refusals it is the whole component, because it runs all eight
  // `RUN_ON_READ` guards first.
  //
  // So a late-branch subject is the REAL source with ONE textual edit. Every
  // earlier branch is satisfied by construction, the edit is the only
  // difference, and the failure names the branch. The anchor-uniqueness
  // assertion is what keeps a subject from silently becoming a no-op when the
  // component is reformatted: a mutation that matches nothing, or matches
  // twice, fails here rather than quietly testing the unmutated file — which is
  // how six sweep runs in this session applied no mutation at all and reported
  // green.
  // ══════════════════════════════════════════════════════════════════
  function mutate(...edits: readonly (readonly [from: string, to: string])[]): string {
    let src = PCT.componentSource();
    for (const [from, to] of edits) {
      const parts = src.split(from);
      expect(
        parts.length - 1,
        `the mutation anchor ${JSON.stringify(from.slice(0, 60))} does not occur exactly once in ` +
          'registry-card.tsx — this subject would otherwise test the UNMUTATED file',
      ).toBe(1);
      src = parts.join(to);
    }
    return src;
  }

  /** Anchors used by more than one subject, so a reformat moves one line. */
  const CORE_ENTRY = "'acdp-registry-core': { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },";
  const CHIP_TAG = "<span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>";
  const GATE_LINE = 'if (!(ADVERTISABLE_PROFILE_IDS as readonly string[]).includes(p)) return undefined;';
  const CHIP_CLOSE = '                    </span>\n                  );\n                })}';
  const CHIP_CHILD = '                      {p}\n                    </span>';

  /** A table with no component: `assertModuleShape`'s second anti-vacuity arm. */
  const TABLE_ONLY = "const PROFILE_INFO = { 'acdp-registry-core': { title: 'x' } };";

  /** Two `PROFILE_INFO` initializers — the shared table reader's shadowing arm. */
  const TWO_TABLES =
    "const PROFILE_INFO = { 'a': { title: 'x' } };\n" +
    "function RegistryCard() { const PROFILE_INFO = { 'b': { title: 'y' } }; return <span>{PROFILE_INFO.b.title}</span>; }";

  /** A spread outside the table: keys not knowable from this file. */
  const SPREAD_OUTSIDE = `${TABLE_ONLY}\nconst extra = { ...(globalThis as Record<string, never>) };`;

  /** A computed key outside the table whose expression is not a literal. */
  const COMPUTED_KEY_OUTSIDE = `${TABLE_ONLY}\nconst extra = { [String(Math.random())]: 1 };`;

  /** `glossFor` whose second statement is not a return. */
  const NON_RETURN_GLOSS = `
    function glossFor(p: string) {
      ${GATE_LINE}
      PROFILE_INFO[p as AdvertisableProfileId];
    }
  `;

  /** The chip callback passed by reference: its parameters are unbounded. */
  const CALLBACK_BY_REFERENCE = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map(renderChip)}</>;
    }
  `;

  /** A concise-body callback: there are no statements to pin. */
  const CONCISE_CALLBACK = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => (
        <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={(() => { const info = glossFor(p); return info?.title; })()}>{p}</span>
      ))}</>;
    }
  `;

  /** Two statements, the second not a `return`. */
  const NO_RETURN_CALLBACK = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p);
        void info;
      })}</>;
    }
  `;

  /** A conditional return: two elements, so neither is the pinned one. */
  const CONDITIONAL_RETURN = `
    function RegistryCard({ capabilities }: { capabilities: any }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p);
        return info ? <span key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{p}</span> : <span key={p} className="chip">{p}</span>;
      })}</>;
    }
  `;

  /** A spread on the chip: its props are unbounded. */
  const SPREAD_CHIP = `
    function RegistryCard({ capabilities, rest }: { capabilities: any; rest: object }) {
      return <>{capabilities.profiles.map((p: string) => {
        const info = glossFor(p);
        return <span {...rest} key={p} className={info?.accent ? 'chip ok' : 'chip'} title={info?.title}>{p}</span>;
      })}</>;
    }
  `;

  type Case = { label: string; source: string };

  /**
   * The names of the guards, taken from the module's own exports BY THE TYPE
   * SYSTEM rather than by a runtime filter.
   *
   * ROUND 12: the runtime derivation below (`Object.keys(PCT).filter(…)`) was
   * the only thing making the table cover every guard, and loosening its
   * assertion to `expect.arrayContaining([])` was green — a coverage check is
   * an assertion like any other, and an assertion cannot guard itself without
   * regress. So coverage is a `Record<GuardName, …>` obligation instead: a
   * missing entry is TS2741 and an extra one TS2353, both of which `npm run
   * typecheck` fails on. The runtime assertion stays as a second opinion, but
   * it is no longer the guarantee.
   */
  type GuardName = Extract<keyof typeof PCT, `assert${string}`>;

  /**
   * One entry per exported `assert*`. The `not.toThrow()` at the end of the
   * loop says the guard must pass the REAL component — every one of them must,
   * and asserting it is what makes a guard rewritten to `throw`
   * unconditionally fail rather than sail through every rejection case below.
   */
  const GUARDS: Record<GuardName, { run: (source?: string) => void; rejects: Case[] }> = {
    assertModuleShape: {
      run: (src) => PCT.assertModuleShape(src),
      rejects: [
        { label: 'a module-scope assignment', source: BARE_EXPRESSION },
        {
          label: 'an unlisted import',
          source: `import { anything } from 'some-other-module';\n${CLEAN_TSX}`,
        },
        { label: 'a namespace import', source: `import * as fmt from '@/lib/utils/format';\n${CLEAN_TSX}` },
        { label: 'no PROFILE_INFO at all', source: CLEAN_TSX },
        { label: 'no RegistryCard at all', source: TABLE_ONLY },
        {
          label: 'a default import',
          source: mutate([
            "import { StatusDot } from '@/components/ui/status-dot';",
            "import StatusDot from '@/components/ui/status-dot';",
          ]),
        },
        {
          // An allow-listed MODULE is not a bounded one: this is the binding
          // allow-list's own branch, and nothing reached it before round 14.
          label: 'an unlisted binding from an allow-listed module',
          source: mutate([
            "import { formatNumber, timeAgo } from '@/lib/utils/format';",
            "import { formatNumber, timeAgo, PROFILE_GLOSS } from '@/lib/utils/format';",
          ]),
        },
        {
          label: 'an unlisted module-scope variable',
          source: mutate([
            'type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];',
            "type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];\nconst FALLBACK_GLOSS = 'x';",
          ]),
        },
        {
          label: 'an exported PROFILE_INFO',
          source: mutate([
            'const PROFILE_INFO: Record<AdvertisableProfileId, { title: string; accent?: boolean }> = {',
            'export const PROFILE_INFO: Record<AdvertisableProfileId, { title: string; accent?: boolean }> = {',
          ]),
        },
        {
          label: 'an unlisted module-scope function',
          source: mutate([
            'function glossFor(p: string): { title: string; accent?: boolean } | undefined {',
            'function fallbackTitle(p: string) {\n  return p;\n}\n' +
              'function glossFor(p: string): { title: string; accent?: boolean } | undefined {',
          ]),
        },
        {
          label: 'a module-scope class',
          source: mutate([
            'type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];',
            'type AdvertisableProfileId = (typeof ADVERTISABLE_PROFILE_IDS)[number];\nclass Chip {}',
          ]),
        },
      ],
    },
    assertNoCopyOutsideTable: {
      run: (src) => PCT.assertNoCopyOutsideTable(src),
      rejects: [
        { label: 'a second copy table in the component', source: COPY_OUTSIDE_TABLE },
        // The shared table reader's two arms. Both are refusals of
        // `copyTableNode`, which every other guard in the module depends on
        // finding exactly one of.
        { label: 'no PROFILE_INFO object literal at all', source: 'export const X = 1;' },
        { label: 'two PROFILE_INFO initializers', source: TWO_TABLES },
        { label: 'a spread into an object literal outside the table', source: SPREAD_OUTSIDE },
        { label: 'a computed key outside the table', source: COMPUTED_KEY_OUTSIDE },
      ],
    },
    assertNoRuntimeCopyForms: {
      run: (src) => PCT.assertNoRuntimeCopyForms(src),
      rejects: PCT.PROHIBITED_RUNTIME_FORMS.map((form) => ({
        label: form,
        // Built FROM the guard's own list, so a form removed from it is a
        // missing case here rather than a silently untested one.
        source: `export const X = ${form.includes('(') ? form : `${form}({}, {})`};`,
      })),
    },
    assertNoAlternateDisclosureChannel: {
      run: (src) => PCT.assertNoAlternateDisclosureChannel(src),
      rejects: [
        { label: 'alt', source: `export function R() { return <img alt="acdp-log-witness x" />; }` },
        { label: 'placeholder', source: `export function R() { return <input placeholder="acdp-consumer" />; }` },
        { label: 'aria-label', source: `export function R() { return <span aria-label="acdp-consumer">x</span>; }` },
        { label: 'data-*', source: `export function R() { return <span data-profile="acdp-log-witness">x</span>; }` },
        {
          label: 'dangerouslySetInnerHTML',
          source: `export function R() { return <span dangerouslySetInnerHTML={{ __html: 'x' }} />; }`,
        },
      ],
    },
    assertGlossChokePoint: {
      run: (src) => PCT.assertGlossChokePoint(src),
      rejects: [
        { label: 'two title attributes', source: TWO_TITLES },
        { label: 'a JSX spread', source: JSX_SPREAD },
        {
          // `GLOSS_EXPRESSION`'s docblock cites this exact mutation as the
          // reason it is pinned to one spelling, and until round 14 the branch
          // that enforces it had no subject: every other case died at the
          // `title`-count check one line above.
          label: 'a coordinate-gated gloss expression',
          source: mutate([
            'title={info?.title}',
            "title={registry.authority === 'registry-a.playground.local' ? info?.title : undefined}",
          ]),
        },
      ],
    },
    assertGlossIsGated: {
      run: (src) => PCT.assertGlossIsGated(src),
      rejects: [
        { label: 'the membership gate removed', source: UNGATED_GLOSS },
        { label: 'a host-conditional suppression in the return', source: SUPPRESSING_GLOSS },
        { label: 'a second PROFILE_INFO lookup site', source: SECOND_LOOKUP },
        { label: 'no glossFor at all', source: CLEAN_TSX },
        {
          // The gate's own docblock names `if (false && …)` as the mutation
          // that defeated the substring version of this check. It kept the
          // shape — two statements, first an `if` — so it reached the
          // condition-text branch and nothing was there to exercise it.
          label: 'a short-circuited gate that keeps the shape',
          source: mutate([GATE_LINE, `if (false && ${GATE_LINE.slice('if ('.length)}`]),
        },
        { label: "glossFor's second statement is not a return", source: NON_RETURN_GLOSS },
      ],
    },
    assertGlossIsPureOfId: {
      run: (src) => PCT.assertGlossIsPureOfId(src),
      rejects: [
        { label: 'no profiles map at all', source: NO_MAP },
        { label: 'the index parameter bound', source: INDEXED_CALLBACK },
        { label: 'an impure `info` initialiser', source: IMPURE_INFO },
        { label: 'a conditional return that drops the tooltip', source: CONDITIONAL_SUPPRESSION },
        { label: 'the gloss rendered as the chip child', source: GLOSS_AS_CHILD },
        { label: 'the callback passed by reference', source: CALLBACK_BY_REFERENCE },
        { label: 'a concise-body callback', source: CONCISE_CALLBACK },
        { label: 'a callback whose second statement is not a return', source: NO_RETURN_CALLBACK },
        { label: 'a conditional return of two chips', source: CONDITIONAL_RETURN },
        { label: 'a spread on the chip', source: SPREAD_CHIP },
        {
          label: 'a second profiles map',
          source: mutate([
            CHIP_CLOSE,
            `${CHIP_CLOSE}\n                {capabilities.profiles.map((q: string) => (\n` +
              '                  <span key={q}>{q}</span>\n                ))}',
          ]),
        },
        {
          // A second `info`, bound inside the returned JSX, where the
          // two-statement pin cannot see it.
          label: 'a second `info` binding inside the chip',
          source: mutate([
            'title={info?.title}',
            'title={(() => { const info = glossFor(p); return info?.title; })()}',
          ]),
        },
        {
          // The two attribute checks. A DROPPED `title` suppresses every gloss
          // on the card and leaves the name set one short; a REWRITTEN
          // `className` keeps the name set and changes what the chip is a
          // function of. Neither had a subject: every earlier case died before
          // the attribute comparison.
          label: 'the chip with its title dropped',
          source: mutate([CHIP_TAG, "<span key={p} className={info?.accent ? 'chip ok' : 'chip'}>"]),
        },
        {
          label: 'the chip className made a function of the id',
          source: mutate([
            CHIP_TAG,
            "<span key={p} className={p === 'acdp-registry-core' ? 'chip ok' : 'chip'} title={info?.title}>",
          ]),
        },
      ],
    },
    assertNoProseOutsideLabelTable: {
      run: (src) => PCT.assertNoProseOutsideLabelTable(CARD_LABELS, src),
      rejects: [
        {
          label: 'unlisted prose',
          source: `export function R() { return <span>Log witness cosignatures are recorded here.</span>; }`,
        },
        { label: 'a file with no JSX at all (vacuity)', source: 'export const X = 1;' },
        {
          // A child the label list cannot bound, because what it renders is
          // decided at runtime. Refused rather than skipped.
          label: 'a template literal in a child position',
          source: mutate([CHIP_CHILD, '                      {`${p} — see the profile notes`}\n                    </span>']),
        },
      ],
    },
    assertEveryStringLiteralIsLicensed: {
      run: (src) => PCT.assertEveryStringLiteralIsLicensed(src),
      rejects: [
        {
          // ROUND 13's N1 made concrete: the gloss the operator reads, rewritten
          // to ratify the id #95 deleted. Round 13 measured this exact edit
          // green across 969 tests, because the only thing bounding gloss
          // CONTENT was a check that read the gloss off the card.
          label: 'a rewritten gloss',
          source: mutate([
            CORE_ENTRY,
            "'acdp-registry-core': { title: 'Consumer deployment profile — see acdp-consumer' },",
          ]),
        },
        {
          label: 'a template literal with substitutions',
          source: mutate([CHIP_CHILD, '                      {`${p} — see the profile notes`}\n                    </span>']),
        },
        { label: 'a file with almost no literals (vacuity)', source: 'export const X = 1;' },
      ],
    },
    assertNoForeignProfileId: {
      run: (src) => PCT.assertNoForeignProfileId(src),
      rejects: [
        { label: 'a non-advertisable id in a string literal', source: FOREIGN_ID },
        { label: 'the same id in an `<input value>`', source: FOREIGN_ID_IN_VALUE },
        {
          label: 'the same id in a template literal',
          source:
            "const a='1'; const b='2'; const c='3'; const d='4';\n" +
            'export const X = `see ${a} acdp-log-witness notes`;',
        },
        { label: 'a file with almost no literals (vacuity)', source: 'export const X = 1;' },
      ],
    },
  };

  /**
   * The two READERS, which are not `assert*` and so are not in `GUARDS`.
   *
   * ROUND 14: both refuse rather than skip — a spread, a computed key, an
   * accessor, a non-string key, a missing `title`, a duplicate id, a
   * non-literal id list — and not one of those refusals had ever been run.
   * They could not be: neither took a `source`, so both always read the real
   * file, which satisfies all of them. Round 14 gave them the same self-test
   * seam every guard already had, and `profileCopyTable` passes it THROUGH to
   * the eight `RUN_ON_READ` guards, so a subject here has to be a whole valid
   * card with one thing wrong — which is exactly what `mutate` produces.
   */
  const READERS: Record<'profileCopyTable' | 'advertisableIdsInComponent', { run: (source?: string) => void; rejects: Case[] }> = {
    profileCopyTable: {
      run: (src) => void PCT.profileCopyTable(src),
      rejects: [
        {
          label: 'an accessor in the copy table',
          source: mutate([
            CORE_ENTRY,
            "get 'acdp-registry-core'() { return { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' }; },",
          ]),
        },
        {
          label: 'a computed key in the copy table',
          source: mutate([
            CORE_ENTRY,
            "['acdp-registry-core']: { title: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },",
          ]),
        },
        {
          label: 'an entry that is not an object literal',
          source: mutate([CORE_ENTRY, "'acdp-registry-core': 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)',"]),
        },
        {
          label: 'an entry with no string-literal title',
          source: mutate([
            CORE_ENTRY,
            "'acdp-registry-core': { label: 'Mandatory registry baseline (RFC-ACDP-0001 §9.1)' },",
          ]),
        },
        {
          label: 'a duplicated id',
          source: mutate([CORE_ENTRY, `${CORE_ENTRY}\n  ${CORE_ENTRY}`]),
        },
      ],
    },
    advertisableIdsInComponent: {
      run: (src) => void PCT.advertisableIdsInComponent(src),
      rejects: [
        {
          label: 'an id list that is not an array literal',
          source: "const ADVERTISABLE_PROFILE_IDS = Object.freeze(['acdp-registry-core']);",
        },
        {
          label: 'two id lists',
          source:
            "const ADVERTISABLE_PROFILE_IDS = ['acdp-registry-core'] as const;\n" +
            "const ADVERTISABLE_PROFILE_IDS = ['acdp-registry-discovery'] as const;",
        },
        {
          label: 'a non-literal element in the id list',
          source: 'const ADVERTISABLE_PROFILE_IDS = [CORE_ID] as const;',
        },
        { label: 'no id list at all', source: 'export const X = 1;' },
      ],
    },
  };

  /** Every `{ run, rejects }` pair in this file, guards and readers alike. */
  const SUBJECTS = [...Object.entries(GUARDS), ...Object.entries(READERS)] as const;

  it('the table covers EVERY exported guard, derived from the module', () => {
    // The anti-drift mechanism's second opinion. A new `assert*` export with no
    // rejecting subject fails at COMPILE time — `GUARDS` is a
    // `Record<GuardName, …>` and TS refuses a literal with a missing or an
    // extra key — so this assertion is a cross-check on the derivation, not the
    // guarantee. Round 12 measured that loosening it was green, which is
    // exactly why the obligation was moved into the type.
    const exported = Object.keys(PCT)
      .filter((k) => k.startsWith('assert'))
      .sort();
    expect(Object.keys(GUARDS).sort()).toEqual(exported);
    // …and the list is the length it is. ROUND 13's N6: `toBeGreaterThan(7)`
    // was satisfied by deleting a guard, which is the direction that matters —
    // the derivation cannot notice its own subject going missing. A hard number
    // makes a deletion a two-file diff with a reason, and it is checked against
    // `RUN_ON_READ` below rather than restated in prose, because five
    // restatements of this count in this repo drifted to five different numbers.
    expect(exported.length, 'a guard was added or removed').toBe(10);
    expect(PCT.RUN_ON_READ.length, 'the read-time list was shortened').toBe(8);
  });

  it('every guard REJECTS each of its subjects, and ACCEPTS the real component', () => {
    // Every rejection must be the GUARD's rejection. `.toThrow()` alone accepts
    // any throw, and round 11's G7b exploited exactly that: with
    // `assertGlossIsPureOfId`'s `mapCalls.length === 0` vacuity check
    // short-circuited, `mapCalls[0]` was `undefined` and `call.arguments[0]`
    // threw a `TypeError` — so the guard's own anti-vacuity pin could be
    // deleted with this test still green. Requiring `fail()`'s prefix means an
    // incidental crash no longer counts as a refusal.
    const said = new RegExp(`^${PCT.GUARD_FAILURE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    let cases = 0;
    for (const [name, guard] of SUBJECTS) {
      expect(guard.rejects.length, `${name} has no rejecting subject`).toBeGreaterThan(0);
      for (const c of guard.rejects) {
        expect(() => guard.run(c.source), `${name} ADMITS ${c.label}`).toThrow(said);
        cases += 1;
      }
      // The other direction. Without it, a guard rewritten to `throw` on
      // everything passes every case above.
      expect(() => guard.run(), `${name} refuses the real component`).not.toThrow();
    }
    // Anti-vacuity on the loop itself: `Object.entries` of an emptied table
    // runs no assertion at all, and `PROHIBITED_RUNTIME_FORMS` feeds one of the
    // entries, so the count moves if that list is trimmed too.
    //
    // The floor is DERIVED rather than written down: there are at least as many
    // subjects as there are refusal branches in the guard module, because the
    // test below demands one per branch. A magic number here would have to be
    // edited every time a guard grows a branch, which is how the counts in this
    // file's docblocks came to disagree with each other three ways.
    expect(cases, 'the rejection table lost subjects').toBeGreaterThanOrEqual(failSites().length);
  });

  it('the read-time guard list is not silently shortened', () => {
    // `profileCopyTable()` runs a list of guards before trusting the table, and
    // round 11 measured that DELETING two of those calls was green — which
    // matters because `mock-data.test.ts` reads that table for the data half of
    // #95 and would lose those bounds without a red test anywhere.
    const names = PCT.RUN_ON_READ.map((g) => g.name).sort();
    expect(names).toEqual(
      [
        'assertEveryStringLiteralIsLicensed',
        'assertGlossChokePoint',
        'assertGlossIsGated',
        'assertModuleShape',
        'assertNoAlternateDisclosureChannel',
        'assertNoCopyOutsideTable',
        'assertNoForeignProfileId',
        'assertNoRuntimeCopyForms',
      ].sort(),
    );
    // Every one of them is in the rejection table above, so "runs on read" and
    // "is known to reject something" are the same set here.
    for (const g of PCT.RUN_ON_READ) {
      expect(
        Object.prototype.hasOwnProperty.call(GUARDS, g.name),
        `${g.name} runs on every read and has no rejecting subject`,
      ).toBe(true);
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // THE COVERAGE OBLIGATION, AT THE GRANULARITY OF THE REFUSAL.
  //
  // ROUND 13's B4 in one sentence: "round 12's fix was applied at GUARD
  // granularity; its own diagnosis is at CHECK granularity." A hand-written
  // list of nine missing subjects would have the same shape as the thing it is
  // fixing — a closed list of the cases somebody thought of — and would go
  // stale the first time a guard grew a tenth branch.
  //
  // So the obligation is DERIVED from the guard module: every `fail(...)` call
  // site in `test/support/profile-copy-table.ts` must be reached by at least
  // one subject in this file. A new refusal branch with no subject fails this
  // test, naming the function and the message. That is the same move as
  // `Record<GuardName, …>` one level down: the module's own source decides what
  // coverage means, rather than an assertion that can be loosened.
  //
  // HOW A MESSAGE IS ATTRIBUTED TO A SITE. Each site's static text — the string
  // literals and template quasis of its `fail(...)` argument — is extracted
  // from the AST and matched IN ORDER against the observed message, anchored at
  // the start when the message begins with a literal. Interpolations are the
  // gaps between fragments. Two sites that differ only in their interpolations
  // are still distinguished, because the ordered fragments differ: `declares \``
  // and `declares function \`` are not substrings of one another at position 0.
  //
  // MEASURED (round 14), 20 mutations applied one at a time under `tsc --noEmit`
  // plus this file and `mock-data.test.ts`, each reverted before the next:
  //
  //   killed  17 — the supply guard dropped from `RUN_ON_READ`, emptied, its
  //                licence check short-circuited and its anti-vacuity removed;
  //                unlicensed prose, mis-cased ids and an APPENDED sentence in a
  //                gloss (the first two were green before this round); the id
  //                shape reverted to case-sensitive and its letter rule dropped;
  //                the chip name-set and spelling checks emptied; this matcher
  //                loosened to `return true`; a mutation anchor broken so it
  //                matches nothing; a late-branch subject deleted; a sentence
  //                added to `CARD_LABELS`; a stylesheet rule given text; the
  //                `content:` scanner widened to swallow `justify-content`.
  //   survived  3 — deleting THIS test's `uncovered` assertion, deleting the
  //                `CARD_LABELS` exact pin (the two-word shape rule still bounds
  //                any future entry), and loosening the guard-count pin (the
  //                `Record<GuardName, …>` obligation fails at compile time).
  //                All three are the same base case: an assertion cannot guard
  //                itself, and is a survivor once its guarantee lives elsewhere.
  // ══════════════════════════════════════════════════════════════════
  type FailSite = {
    fn: string;
    /**
     * The message's opening static text, when it has one. Matched with
     * `startsWith`, and kept SEPARATE from the needles below even when it is
     * short: the duplicate-id refusal opens with `` id ` `` — four characters,
     * below the noise floor — and folding it into the needle list made the
     * anchor the SECOND fragment, which reported a covered branch as uncovered.
     */
    head?: string;
    /** The rest of the static text, in source order. */
    needles: string[];
  };

  function failSites(): FailSite[] {
    const text = PCT.guardModuleSource();
    const sf = ts.createSourceFile('profile-copy-table.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const sites: FailSite[] = [];

    const enclosing = (node: ts.Node): string => {
      for (let n: ts.Node | undefined = node; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      }
      return '<module scope>';
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fail') {
        const arg = node.arguments[0];
        const raw: string[] = [];
        const collect = (n: ts.Node): void => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
            raw.push(n.text);
          } else if (ts.isTemplateExpression(n)) {
            raw.push(n.head.text);
            for (const span of n.templateSpans) raw.push(span.literal.text);
          }
          ts.forEachChild(n, collect);
        };
        if (arg) collect(arg);
        sites.push({
          fn: enclosing(node),
          head: raw.length > 0 && raw[0] !== '' ? raw[0] : undefined,
          // Short fragments (`, `, `` ` ``) are separators rather than identity.
          needles: raw.slice(1).filter((f) => f.trim().length >= 6),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return sites;
  }

  function reaches(site: FailSite, message: string): boolean {
    let at = 0;
    if (site.head !== undefined) {
      const opening = PCT.GUARD_FAILURE_PREFIX + site.head;
      if (!message.startsWith(opening)) return false;
      at = opening.length;
    }
    for (const fragment of site.needles) {
      const found = message.indexOf(fragment, at);
      if (found < 0) return false;
      at = found + fragment.length;
    }
    return true;
  }

  /** Every refusal the tables above actually produce. */
  function observedRefusals(): string[] {
    const out: string[] = [];
    for (const [name, guard] of SUBJECTS) {
      for (const c of guard.rejects) {
        try {
          guard.run(c.source);
          throw new Error(`${name} ADMITTED ${c.label}`);
        } catch (e) {
          const m = (e as Error).message;
          // A subject that stopped being refused is the other test's business;
          // here it must not silently become a message in the pool.
          expect(m.startsWith(PCT.GUARD_FAILURE_PREFIX), `${name}/${c.label}: ${m.slice(0, 120)}`).toBe(true);
          out.push(m);
        }
      }
    }
    return out;
  }

  it('every REFUSAL BRANCH in the guard module is reached by a subject', () => {
    const sites = failSites();
    // Anti-vacuity, three ways. The enumeration must find the sites; every site
    // must have text to be identified by; and the pool must not be empty.
    expect(sites.length, 'the fail-site enumeration collapsed').toBeGreaterThan(50);
    expect(
      sites.filter((s) => s.head === undefined && s.needles.length === 0).map((s) => s.fn),
      'a fail() message has no static text, so it cannot be attributed to its site',
    ).toEqual([]);
    const messages = observedRefusals();
    expect(messages.length, 'the subject tables produced no refusals').toBeGreaterThan(50);

    const uncovered = sites
      .filter((s) => !messages.some((m) => reaches(s, m)))
      .map((s) => `${s.fn}: ${(s.head ?? s.needles[0]).slice(0, 60)}`);
    // No exemption list. Every refusal in that module is reachable from a
    // source string, and round 14 wrote a subject for each — the two readers
    // gained a `source` parameter precisely so that stayed true.
    expect(uncovered, 'these refusal branches have no subject that reaches them').toEqual([]);
  });

  it('GUARDS THE GUARD: the branch-coverage check is not satisfied by any message', () => {
    // The base case of the regress, stated for this mechanism. `reaches` is a
    // subsequence match, so the question is whether it can be satisfied by a
    // message from a DIFFERENT site. Two probes: a sentence no guard prints,
    // and the two `assertModuleShape` sites whose messages differ only at their
    // heads (`declares \`x\`` vs `declares function \`x\``) — the pair that
    // motivated ordered, anchored matching rather than a single longest needle.
    const messages = observedRefusals();
    const invented: FailSite = {
      fn: 'nobody',
      head: 'this sentence is not in any guard in this repository',
      needles: [],
    };
    expect(messages.some((m) => reaches(invented, m))).toBe(false);

    const variableSite: FailSite = {
      fn: 'assertModuleShape',
      head: 'declares `',
      needles: ['` at module scope; only'],
    };
    const functionSite: FailSite = {
      fn: 'assertModuleShape',
      head: 'declares function `',
      needles: ['` at module scope; only'],
    };
    const forVariable = messages.filter((m) => reaches(variableSite, m));
    const forFunction = messages.filter((m) => reaches(functionSite, m));
    // Each is reached, and by DISJOINT messages: if the matcher were loose the
    // function message would satisfy the variable site as well.
    expect(forVariable.length, 'the unlisted-variable branch is unreached').toBeGreaterThan(0);
    expect(forFunction.length, 'the unlisted-function branch is unreached').toBeGreaterThan(0);
    expect(forVariable.filter((m) => forFunction.includes(m))).toEqual([]);
  });
});

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
import { render, cleanup, within } from '@testing-library/react';
import { RegistryCard } from '@/components/registries/registry-card';
import { MOCK_CAPABILITIES } from '@/lib/data/mock-data';
import type { KnownRegistry, RegistryCapabilities } from '@/lib/types';
import {
  REGISTRY_ADVERTISABLE_PROFILES,
  NOT_ADVERTISABLE,
} from '../support/advertisable-profiles';
import {
  profileCopyTable,
  assertModuleShape,
  assertNoCopyOutsideTable,
  assertGlossChokePoint,
  assertGlossIsGated,
  assertNoRuntimeCopyForms,
  assertNoAlternateDisclosureChannel,
  advertisableIdsInComponent,
} from '../support/profile-copy-table';

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
  });

  it('pins the adversarial id universe, so the probe above cannot be narrowed to the easy cases', () => {
    // `PROBES` was the one array here with no anti-vacuity pin, while
    // `NOT_ADVERTISABLE`, `CAPABILITY_FIXTURES` and `REGISTRY_FIXTURES` all had
    // one. Deleting every adversarial entry — the affix variants, the case
    // folds, the whitespace, the empty string, the `Object.prototype` names —
    // left the suite green, because the set-equality only needs
    // `ADVERTISABLE ⊆ PROBES`. The one array the design notes call deliberately
    // adversarial could be silently reduced to the seven ids that pass easily.
    expect(PROBES).toEqual(expect.arrayContaining([...ADVERTISABLE, ...NOT_ADVERTISABLE]));
    const adversarial = PROBES.filter((p) => !ADVERTISABLE.includes(p) && !NOT_ADVERTISABLE.includes(p));
    expect(adversarial.length).toBeGreaterThanOrEqual(15);
    // The classes, named — a count alone is satisfied by fifteen copies of 'x'.
    expect(adversarial).toEqual(expect.arrayContaining(['toString', 'constructor', '__proto__']));
    expect(adversarial.some((p) => p !== p.toLowerCase())).toBe(true); // a case fold
    expect(adversarial.some((p) => p !== p.trim())).toBe(true); // whitespace
    expect(adversarial).toContain(''); // the empty string
    expect(adversarial.some((p) => ADVERTISABLE.some((a) => p.startsWith(a) && p !== a))).toBe(true);
    expect(new Set(adversarial).size).toBe(adversarial.length);
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
      <RegistryCard registry={REGISTRY_B} capabilities={{ ...MOCK_CAPABILITIES.b, profiles: ADVERTISABLE }} />,
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
      <RegistryCard registry={REGISTRY_B} capabilities={{ ...MOCK_CAPABILITIES.b, profiles: ADVERTISABLE }} />,
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

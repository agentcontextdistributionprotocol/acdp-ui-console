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
  prohibitedRuntimeFormsUsed,
  PROHIBITED_RUNTIME_FORMS,
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
 * The two ids #95 removed, rendered as if a registry advertised them.
 *
 * A RENDER probe, not a source read. It is the only check here immune to
 * syntax: however an entry is written into `PROFILE_INFO` — on its own line, on
 * someone else's line, under a computed key, through a spread, by a
 * post-literal `Object.assign` — the chip either gets a tooltip or it does not,
 * and that is what an operator sees. Two rounds of this gate were lost to
 * source-regex readers that each missed a different subset of those forms.
 */
function chipFor(profileId: string): HTMLElement {
  const { container } = render(
    <RegistryCard
      registry={REGISTRY_B}
      capabilities={{ ...MOCK_CAPABILITIES.b, profiles: [profileId] } as RegistryCapabilities}
    />,
  );
  const chip = [...container.querySelectorAll('.chip')].find((c) => c.textContent === profileId);
  expect(chip, `no chip rendered for ${profileId}`).toBeTruthy();
  return chip as HTMLElement;
}

describe('the dead tooltip copy is gone', () => {
  it('has copy for EXACTLY the advertisable seven — no more, no fewer', () => {
    // Read with the TYPESCRIPT COMPILER, not a regex and not `Object.keys`.
    //
    // Three earlier versions of this assertion each failed differently, and the
    // third failed worst: it imported the object and compared `Object.keys`,
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
    expect(NOT_ADVERTISABLE).toEqual(['acdp-consumer', 'acdp-federated']);
  });

  it('builds its copy table with plain syntax a parser can account for', () => {
    // The structural companion to the parse above. `Object.defineProperty` with
    // `enumerable: false`, a `Proxy` `get` trap and `Object.assign` all put a
    // tooltip on screen without adding a key any static read can see — two of
    // them defeat `Object.keys` as well. None of them has a reason to exist in
    // a file whose entire job is a static lookup table, so their ABSENCE is the
    // guard, and it is a cheap one with an honest failure mode: a false red
    // that a human resolves by explaining why the file now needs one.
    // Detected through the AST, not by scanning text — the docblocks in that
    // file NAME these forms in prose while explaining why they are forbidden, so
    // a text scan would fire on the explanation rather than on the problem.
    expect(prohibitedRuntimeFormsUsed()).toEqual([]);
    // Anti-vacuity: the detector must actually be looking for something.
    expect(PROHIBITED_RUNTIME_FORMS.length).toBeGreaterThan(0);
  });

  it('renders NO tooltip for either id a real registry refuses to boot with', () => {
    // The operator-visible form of the assertion above, and the one that holds
    // however a future entry is written. An `acdp-consumer` chip must still
    // RENDER — the component must never drop a profile it does not recognise —
    // but it must carry no gloss, because glossing an id nothing can advertise
    // is what ratified both ids for the next reader.
    for (const id of NOT_ADVERTISABLE) {
      const chip = chipFor(id);
      expect(chip.textContent).toBe(id);
      expect(chip.getAttribute('title')).toBeNull();
      cleanup();
    }
  });

  it('discloses a tooltip for the advertisable ids and for NOTHING else on screen', () => {
    // The behavioural half, and the one that survives anything the component
    // does at RUNTIME — a `Proxy` get-trap, a non-enumerable key, a second
    // lookup object, a synthesised title. The parser above reads the file; this
    // reads the DOM. Between them the two cover each other's blind spot: a
    // key the parser cannot see still has to render, and a render this probe
    // does not cover still has to be written into the file.
    //
    // Its honest limit is its universe — it can only judge ids it renders. So
    // the universe is every id the pinned spec knows about, plus the two #95
    // removed, plus names in the shape a future author would plausibly reach
    // for. An id outside it would escape this probe but not the parser.
    const PROBES = [
      ...ADVERTISABLE,
      ...NOT_ADVERTISABLE,
      'acdp-agent-core',
      'acdp-registry-quantum',
      'acdp-registry',
      'acdp-registry-receipts-v2',
      'registry-core',
      '',
    ];
    const disclosing: string[] = [];
    for (const id of PROBES) {
      if (id === '') continue; // an empty id renders no chip to read
      const chip = chipFor(id);
      if (chip.getAttribute('title') !== null) disclosing.push(id);
      cleanup();
    }
    expect(new Set(disclosing)).toEqual(new Set(ADVERTISABLE));
    // Anti-vacuity: a component that had lost every tooltip would also produce
    // an empty `disclosing`, and set-equality against an empty ADVERTISABLE
    // would be true.
    expect(disclosing).toHaveLength(ADVERTISABLE.length);
  });

  it('DISCRIMINATES: a real profile rendered the same way DOES get its tooltip', () => {
    // Without this, the probe above would pass against a component that had
    // lost its tooltips entirely.
    const chip = chipFor('acdp-registry-lifecycle');
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

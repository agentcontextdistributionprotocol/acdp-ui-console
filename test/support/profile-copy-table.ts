// ══════════════════════════════════════════════════════════════════════
// Bounding what `registry-card.tsx` can render profile copy from.
//
// Shared by `registry-card-profiles.test.tsx` (the key set) and
// `mock-data.test.ts` (the version each tooltip names).
//
// SIX guards have now failed on this one claim, and the failures rhyme. Each
// was a reader with an ENUMERATED notion of what counts, so anything outside
// the enumeration read as success:
//
//   1. two exact substring checks — an eighth key under any other name passed.
//   2. a line-anchored literal-only regex — strictly worse: a key sharing a
//      line, a computed `[DEAD]:` key, a `...spread` and a post-literal
//      `Object.assign` all passed.
//   3. `export const PROFILE_INFO` + `Object.keys`. That CREATED a hole: any
//      module could import and mutate the table at module scope, and Vitest's
//      per-file module isolation meant the guard saw a pristine seven while the
//      app rendered the deleted copy.
//   4. a parser that hunted for "object literals whose entries carry a `title`".
//      It could not see a `Record<string, string>` second table, a `Map`, a
//      prototype getter, or — the embarrassing one — a plain
//      `PROFILE_INFO['x'] = { title }` assignment, which the `Object.keys`
//      version it replaced had caught.
//   5. an inverted MODULE-SCOPE whitelist. It closed module scope properly and
//      moved the blind spot into the component body, where it TRADED AWAY FIVE
//      KILLS the version before it had: an in-body `Object.assign`, an in-body
//      second copy table, an in-body authority-gated entry, a copy default in
//      the parameter list, and a nested component with its own table were all
//      red at (4) and green at (5). It also allow-listed four module
//      SPECIFIERS without bounding what could be imported FROM them, so
//      `import { GLOSS } from '@/lib/utils/format'` was a supported route.
//   6. the first attempt at the split below. It moved the key set into the type
//      system (which holds) and split the rest into four checks — and each of
//      the four was narrower than its own docblock said. The object walk read
//      names off `PropertyAssignment` and shorthand only, so a computed
//      `{ ['title']: … }`, a getter, a setter, a method and a spread were all
//      invisible; the render matrix varied both PROPS but never POSITION within
//      `capabilities.profiles`, so a gloss gated on `i > 0` disclosed freely;
//      and the choke-point check asserted in prose that "the render probes are
//      what read" `aria-label` and `data-*`, which none of them ever did. It
//      also deleted the whole-file runtime-forms detector (4) had, so an
//      in-body `Proxy` get-trap went from red to green.
//
// The through-line of all six: each bounded a REGION (two names, one line, one
// object, one statement list, one property form, one prop axis) and the copy
// moved to the next region over. THE COUNT AND THIS LIST LIVE HERE AND ONLY
// HERE — five separate restatements of this history in three files had drifted
// to five different numbers, which is the same defect one level up.
//
// So the claim is no longer defended by region at all. It is split into the
// bounds below, each narrow enough to be true:
//
//   `tsc`                          the KEYS of PROFILE_INFO. The component
//                                  types it `Record<AdvertisableProfileId, …>`
//                                  off an `as const` mirror, so an eighth key
//                                  is an excess-property error and a missing
//                                  one is a missing-property error. (This
//                                  read "No test polices this". False: the
//                                  key-set parser below kills an eighth key
//                                  before tsc ever runs. Widening the
//                                  annotation to `Record<string, …>` deletes
//                                  the tsc bound with every gate green — the
//                                  parser is what actually holds it.)
//   `assertNoCopyOutsideTable()`   any OTHER object literal in the file — the
//                                  whole file, not its statement list —
//                                  carrying `title` or `accent`, under ANY
//                                  property form: assignment, shorthand,
//                                  computed name, getter, setter, method. A
//                                  spread is refused rather than inspected.
//   `assertNoRuntimeCopyForms()`   `Object.assign` / `create` /
//                                  `defineProperty` / `setPrototypeOf`,
//                                  `Reflect.*`, `new Proxy` — the verbs that
//                                  attach copy with no property literal to find.
//   `assertNoAlternateDisclosure…` `aria-*`, `data-*` and
//                                  `dangerouslySetInnerHTML`. (This read
//                                  "none of which any render probe reads".
//                                  False since `attributesOf()` landed: the
//                                  probes assert the chip's EXACT attribute
//                                  key set. Two layers, not one.)
//   `assertGlossChokePoint()`      the one expression that may reach a rendered
//                                  `title` attribute, and no JSX spread.
//   `assertGlossIsGated()`         the shape of the membership gate, and that
//                                  PROFILE_INFO has exactly one lookup site.
//   `assertModuleShape()`          the module-scope statement list AND the
//                                  BINDING NAMES of every import.
//
// Two things none of them does, stated because every previous version of this
// comment claimed more than it delivered and the over-claim is how the next
// hole survived review:
//
//   1. Bound what the component renders for an ARBITRARY id string. No test can
//      quantify over all strings. The render probes sample a universe; the
//      bounds above are what make the sample meaningful.
//   2. Bound the VALUE behind an allow-listed import. `ALLOWED_IMPORTS` pins
//      the binding NAME; `timeAgo` could be edited to return copy and be called
//      here legitimately. Narrowing the four names narrowed which suppliers
//      remain unbounded — it did not close the channel.
//
//      This used to add "and the render probes are what actually catch a gloss
//      arriving that way". Round 19's BL-8 falsified it: a supplier gated on a
//      GLOBAL is not a prop combination, and
//      `window.location.hostname.endsWith('.prod')` inside
//      `components/ui/status-dot.tsx` put `acdp-consumer` in visible body text
//      on every registry card in production with 977/977 green, because jsdom's
//      hostname is `localhost`. That is round 9's `.prod` finding, defended for
//      `glossFor` and undefended one import away.
//
//      So `foreignProfileIdsIn` runs over `importClosure()` — the card plus the
//      five modules it transitively reaches — which is the same "bound the
//      supply" move applied to the supply's supply. What is left unbounded is
//      what a supplier may return that is NOT id-shaped, which the render
//      probes do cover for the ids and prop combinations they reach.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PROFILE_GLOSS_TEXT, REGISTRY_ADVERTISABLE_PROFILES } from './advertisable-profiles';
import { memberReads, unwrapExpression } from './ts-reads';
import { compiledExtensions } from './stylesheet-text';

// Anchored to THIS FILE, not to `process.cwd()`. The guard should not depend on
// which directory the runner was invoked from. Not exported: nothing outside
// this module needs the path, and an unused export is one more thing to keep.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY_CARD_PATH = join(REPO_ROOT, 'components/registries/registry-card.tsx');

/**
 * What `registry-card.tsx` may import, BY BINDING and not merely by module.
 *
 * Round 6 of this gate allow-listed the four specifiers and checked nothing
 * else, which left every one of them an unbounded supplier: a `title` string
 * exported from `@/lib/utils/format` and imported here rendered the copy #95
 * deleted, with the suite green. The module a symbol comes from says nothing
 * about what the symbol is.
 */
export const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  '@/components/ui/status-dot': ['StatusDot'],
  '@/components/ui/badge': ['Badge'],
  '@/lib/utils/format': ['formatNumber', 'timeAgo'],
  '@/lib/types': ['KnownRegistry', 'RegistryCapabilities'],
};

/** The only value declarations the module may contain, at module scope. */
const ALLOWED_VARIABLES = ['ADVERTISABLE_PROFILE_IDS', 'PROFILE_INFO'];
const ALLOWED_FUNCTIONS = ['glossFor', 'RegistryCard'];

/**
 * The only expression that may reach a rendered `title`.
 *
 * Compared as source text after whitespace collapse. Brittle on purpose: the
 * failure is loud and names the construct, and the alternative — accepting any
 * expression — is the hole `title={registry.authority === 'a' ? info?.title :
 * undefined}` went through, which silently dropped every tooltip on every
 * registry but one.
 */
export const GLOSS_EXPRESSION = '{info?.title}';

/**
 * The only condition `glossFor` may gate on, whitespace-collapsed.
 *
 * Pinned as a shape rather than as a substring for the reason this whole file
 * exists: a `body.includes('ADVERTISABLE_PROFILE_IDS')` check is satisfied by
 * `if (false && !ADVERTISABLE_PROFILE_IDS.includes(p))`, which gates nothing.
 * Guards (1) and (2) in the header above were lost exactly this way: they
 * matched TEXT where the claim is about STRUCTURE.
 */
export const GLOSS_GATE_CONDITION = '!(ADVERTISABLE_PROFILE_IDSasreadonlystring[]).includes(p)';

/**
 * The only expression `glossFor` may RETURN, whitespace-collapsed.
 *
 * The gate condition above decides which ids get a gloss; this decides what a
 * gloss IS. Round 9's gate found the second unbounded while three separate
 * docblocks said otherwise, and put a hostname check in front of the lookup:
 * every tooltip on every registry gone in production, every test green,
 * because jsdom's hostname is `localhost`.
 *
 * A render probe cannot reach that, and neither can the rendered closed world
 * in `registry-card-profiles.test.tsx` — both bound what APPEARS, and this is
 * copy that stops appearing somewhere they do not run. One allowed spelling is
 * the only instrument that does.
 */
export const GLOSS_RETURN_EXPRESSION = 'PROFILE_INFO[pasAdvertisableProfileId]';

/**
 * The chip element the profiles `.map` callback is allowed to return, as an
 * exact attribute-name -> whitespace-stripped-spelling map.
 *
 * Parameterised on the callback's parameter name so renaming `p` is a
 * mechanical edit rather than a guard failure; everything else is a literal
 * spelling, because a spelling is the only thing that can be compared without
 * re-implementing the component.
 *
 * `title` is here for the direction a render cannot see. Round 11 dropped it
 * behind a condition no fixture satisfies and every tooltip vanished on the
 * affected deployments with the suite green — the same defect
 * `GLOSS_EXPRESSION`'s docblock cites as the reason it exists, arriving
 * through the one door that docblock said was shut.
 */
export function CHIP_ATTRIBUTES(param: string): Record<string, string> {
  return {
    key: `{${param}}`,
    className: "{info?.accent?'chipok':'chip'}",
    title: '{info?.title}',
  };
}

/**
 * The profile ids this component's source may name, and the shape of the ones
 * it may not.
 *
 * ROUND 11's B8. `f37ae31` deleted a comment-stripped whole-file check that the
 * strings `'acdp-consumer'` and `'acdp-federated'` appear nowhere in
 * `registry-card.tsx`, and argued its replacement (key-set equality over the
 * parsed `PROFILE_INFO`) was a pure improvement. It is stronger against an
 * eighth table key under any spelling and strictly WEAKER against the id string
 * appearing anywhere else in the file — which is precisely where four of round
 * 11's five injections lived:
 *
 *   const witnessNote = 'acdp-log-witness — …';   rendered under `!capabilities`
 *   const consumerNote = 'acdp-consumer: …';      gated on max_search_limit
 *   <input readOnly value="acdp-log-witness: …" />        unconditional
 *
 * The deleted check enumerated two bad strings, which is why it was easy to
 * argue away. This one is CLOSED instead: a profile id is `acdp` then a
 * separator then word characters, the advertisable set is exactly seven, and no
 * other string of that shape may appear in a string literal or a template
 * literal anywhere in the file. Nothing has to guess which id somebody will
 * name next.
 *
 * ROUND 13 CORRECTION — "CLOSED" WAS NOT TRUE OF A CASE-SENSITIVE PATTERN. It
 * required `acdp-` in lower case followed by a lower-case class (no `i` flag),
 * so `ACDP-consumer` and `acdp-Federated` both walked straight past it.
 * Measured: putting
 * `'Cross-registry federation; also advertised as acdp-Federated or
 * ACDP-consumer (RFC-ACDP-0001 §9.1)'` in `acdp-registry-federated`'s own
 * gloss left all 969 tests green, and every card advertising that profile then
 * named two ids a real registry refuses to boot with — #95's stated harm
 * ("ratified two invalid ids for whoever read it next") back through the very
 * surface #95 is about, in the tooltip #95 rewrote.
 *
 * It is now case-INSENSITIVE and accepts `_` as the separator, and the match is
 * compared to the allow-list EXACTLY AS WRITTEN — `allowed.has(m[0])` on the
 * raw match, with no normalisation of any kind. Match loosely, compare
 * strictly: a spelling the allow-list does not hold character for character is
 * refused whatever case it arrives in.
 *
 * ROUND 15's N4 — THIS PARAGRAPH SAID THE OPPOSITE OF THE CODE. It read "the
 * match is lower-cased before comparison", which would have made the guard
 * ACCEPT `ACDP-REGISTRY-CORE` and contradicted the very next clause. The code
 * was right and the sentence was wrong, which is the more dangerous of the two
 * directions: the next reader reconciles a guard against its docblock, so a
 * sentence describing a weaker guard is an invitation to "simplify" the real one
 * down to it. A profile id is case-sensitive upstream (`config.rs` compares raw
 * `&str`), so `ACDP-consumer` is not a valid id at all, and a string that
 * merely LOOKS like one is exactly what misleads a reader.
 *
 * THE SEGMENT AFTER THE SEPARATOR MUST START WITH A LETTER, and that is load
 * bearing rather than tidy. Dropping case sensitivity made `RFC-ACDP-0001`
 * match — the spec citation every gloss in the table ends with — so the first
 * version of this widening refused the real component and took six tests down
 * with it. Every spec id is `acdp-<word>`; every citation is `RFC-ACDP-<digits>`
 * and every version marker is `acdp <semver>`. Requiring a letter separates
 * them without a denylist, and a citation is not a thing anyone can mistake for
 * an id anyway. `acdp_version` — a real property name on the capabilities
 * payload — would match, which is why the walks that use this pattern read the
 * nodes that carry TEXT (string literals, template literals, and since round
 * 16's B4, `JsxText`) and never identifiers or property names.
 *
 * ── ROUND 17's BL-5: THE SEPARATOR CLASS MISSED THE SPELLING THIS ────
 * ── REPOSITORY ITSELF SHIPS ──────────────────────────────────────────
 *
 * `[-_]` omitted `:`, and `acdp:` is a live ACDP id spelling right here:
 * `lib/utils/revocation.ts` exports `KEY_REVOCATION_INTERIM_TYPE =
 * 'acdp:key-revocation'` for RFC-ACDP-0014 §10, and `lib/data/mock-data.ts`
 * emits it. So `acdp:consumer` is a string an operator would read as a real
 * id, and no guard in this file could see one.
 *
 * Measured: round 13's harm, re-spelled with a colon — appending "not
 * acdp:consumer or acdp:federated" to the federation gloss, edited in the two
 * files that gloss copy is DESIGNED to be edited in — left 977/977 green,
 * while the hyphen spelling of the identical edit is 11 red. The separator was
 * the entire difference, and bounding the content of exactly that two-file
 * diff is this guard's whole job.
 *
 * It also silently weakened round 16's own B1/B4 backstop, which is the part
 * worth noticing: `CARD_LABELS` and `STRUCTURAL_LITERALS` are shape-bounded by
 * `not.toMatch(PROFILE_ID_SHAPE)`, so `'acdp:consumer'` — thirteen characters,
 * one word — passed all three shape rules and could have licensed itself as a
 * card label. A pattern that under-matches does not merely miss things; it
 * hands every rule derived from it the same blind spot.
 *
 * ── ROUND 19's BL-4: THERE IS NO SEPARATOR LIST ──────────────────────
 *
 * Round 17 answered the colon by widening the class to `[-_:]` and writing
 * "the separator set is `[-_:]` now, which is all three the RFC permits".
 * Both halves of that sentence are wrong, and the gate measured the first: the
 * same two-file gloss edit with a FULL STOP —
 *
 *     'Cross-registry federation (…) — not acdp.consumer or acdp.federated'
 *
 * — was 977/977 green where the hyphen spelling is 11 red. And `acdp.<word>`
 * is not a contrivance here: `lib/types.ts` declares `'acdp.publish' |
 * 'acdp.retrieve' | 'acdp.search' | 'acdp.verify' | 'acdp.retract' |
 * 'acdp.republish'`, `lib/data/mock-data.ts` emits them and
 * `components/dashboard/event-ticker.tsx` renders `acdp.publish` on the
 * dashboard. An operator reads that dotted form on this console more often
 * than the colon form.
 *
 * The second half was a mis-citation. `acdp-spec-pinned/registries/profiles.md`
 * gives the profile-id grammar as `^acdp-[a-z][a-z0-9-]*$` — ONE separator,
 * the hyphen. `_` and `:` are not profile-id separators at all;
 * `acdp:key-revocation` is a context TYPE (RFC-ACDP-0014 §10), not a profile
 * id. So the sentence over-claimed closure AND got the authority it leaned on
 * backwards, which is the pairing this file keeps finding.
 *
 * Two shapes, and they are different questions:
 *
 *   {@link SPEC_PROFILE_ID_GRAMMAR} — what the spec permits, taken verbatim
 *   from the pinned spec. Used to check the advertisable set itself.
 *
 *   `PROFILE_ID_SHAPE` — what an OPERATOR would read as an ACDP identifier,
 *   which is the question this guard actually asks, and which has never been
 *   a spec question. The separator is now "any run of non-alphanumeric
 *   NON-WHITESPACE characters", so `-`, `_`, `:`, `.`, `/`, `//` and U+2010
 *   are one rule with no list left to keep complete. `RFC-ACDP-0001` and
 *   `acdp 0.3.0` are still refused, because both continue with a digit.
 *
 * Whitespace is excluded from the separator run, and that is a measurement
 * rather than a preference: this card renders the metric label `ACDP version`,
 * and an identifier does not contain a space. Admitting whitespace turned a
 * label the card has always shown into a forbidden id — a guard that fires on
 * ordinary prose is a guard that gets widened back by the next author, which
 * is how `f37ae31` deleted the previous version of this rule.
 */
export const PROFILE_ID_SHAPE = /acdp[^\sA-Za-z0-9]+[a-z][A-Za-z0-9_:.-]*/gi;

/**
 * The profile-id grammar, quoted from the pinned spec.
 *
 * `acdp-spec-pinned/registries/profiles.md`: "Identifiers are lowercase ASCII
 * matching `^acdp-[a-z][a-z0-9-]*$`." Every advertisable id is checked against
 * this where the set is pinned, so the mirror cannot drift from the grammar
 * the registries validate against.
 */
export const SPEC_PROFILE_ID_GRAMMAR = /^acdp-[a-z][a-z0-9-]*$/;

/**
 * A FRESH matcher, because `PROFILE_ID_SHAPE` carries `/g`.
 *
 * ROUND 17's NB-4. A `/g` regex holds `lastIndex`, and this constant is used
 * two ways: `matchAll` (which per spec clones the regex, so it is safe) and
 * `expect(...).not.toMatch(...)`, which calls `.test()` and MUTATES
 * `lastIndex` on a match. Three files share the constant. Nothing is
 * exploitable today — a `.test()` that matches is itself a failing assertion,
 * so the mutated state never outlives a green run — but a live cross-test
 * coupling in the one pattern every id rule derives from is not a thing to
 * leave standing on the argument that today's call order is lucky.
 */
export function profileIdMatcher(): RegExp {
  return new RegExp(PROFILE_ID_SHAPE.source, PROFILE_ID_SHAPE.flags);
}

/**
 * The component's AST — or, when `text` is given, an arbitrary one.
 *
 * The override exists ONLY so these guards can be exercised against source
 * that must fail them, and it is worth the seam. Round 9's gate emptied eight
 * of them one at a time and the suite stayed green for every one, because each
 * is only ever run against a file that already satisfies it: an emptied guard
 * and a working guard are indistinguishable when the input is always clean.
 *
 * Three of those emptyings cannot be caught any other way. A multiplicity
 * check needs a file with two maps; an anti-vacuity check needs a file with no
 * JSX; an attribute check needs a file with the attribute. None of those is a
 * state `registry-card.tsx` is ever in, so the only honest self-test is to
 * hand the guard a different file.
 *
 * Production code never passes `text`. `assertModuleShape` and the rest are
 * called with no argument everywhere outside `registry-card-profiles.test.tsx`'s
 * "the source guards are not vacuous" block.
 */
function sourceFile(text?: string): ts.SourceFile {
  return ts.createSourceFile(
    REGISTRY_CARD_PATH,
    text ?? readFileSync(REGISTRY_CARD_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

/**
 * The component's own source text, for a self-test that needs to MUTATE it.
 *
 * ROUND 13's B4, and the reason it is here rather than in the test file: round
 * 12 gave every exported guard a rejecting subject, and round 13 measured that
 * nine load-bearing CHECKS inside those guards still had none — because every
 * synthetic subject dies at the guard's FIRST branch, so the later branches were
 * still only ever run against source that satisfies them. Writing a synthetic
 * file that reaches a late branch means hand-writing a file that satisfies every
 * earlier branch of every guard, which for the read-time readers means
 * hand-writing the whole card.
 *
 * So the subjects for late branches are the REAL source with ONE textual
 * mutation applied, which satisfies every earlier branch by construction. The
 * path is not exported — a test has no business reading the component by path —
 * but the text is.
 */
export function componentSource(): string {
  return readFileSync(REGISTRY_CARD_PATH, 'utf8');
}

/**
 * Every module `registry-card.tsx` reaches, transitively, as repo-relative
 * paths — the component itself first.
 *
 * ── ROUND 19's BL-8: THE SUPPLY'S SUPPLY ─────────────────────────────
 *
 * `ALLOWED_IMPORTS` pins the four specifiers and the binding names, and this
 * file already says in its header that it pins "the binding NAME" and not the
 * value. It then says the render probes are what catch a gloss arriving that
 * way — and that is false for anything a probe cannot reach. Measured in
 * `components/ui/status-dot.tsx`, which the card renders unconditionally:
 *
 *   const note =
 *     typeof window !== 'undefined' && window.location.hostname.endsWith('.prod')
 *       ? ' acdp-consumer: a consumer of contexts, not a registry (RFC-ACDP-0001 §9.1)'
 *       : '';
 *
 * 977/977 green, typecheck and lint clean, because jsdom's hostname is
 * `localhost` — and on the production deployment every registry card names
 * `acdp-consumer` in visible body text. That is #95's exact harm, arriving
 * one import away from every guard that was watching for it, and it is round
 * 9's `.prod` finding re-run against a supplier instead of against `glossFor`.
 *
 * The instrument was right and its SCOPE was wrong. `assertNoForeignProfileId`
 * is run over this closure where it is used, so the supply's supply is bounded
 * by the same rule as the supply.
 *
 * ── THE SHIP-GATE REVIEW ON #95: THE CLOSURE DIDN'T CLOSE ────────────
 *
 * The claim above — "the supply's supply is bounded" — was false for a
 * supplier reached by a RELATIVE specifier. Only `@/`-prefixed specifiers were
 * walked; `./`/`../` were silently `continue`d past the same as an npm
 * package, and this repository uses relative sibling imports in fourteen
 * places (`components/layout/app-shell.tsx`'s `./sidebar`, for one). A new
 * module wired in that way — `components/ui/status-dot.tsx` importing a
 * relative sibling that names `acdp-consumer` in body text gated on
 * `NEXT_PUBLIC_ACDP_UI_DEMO_MODE` — was measured 979/979 green: round 19's
 * BL-8 again, one hop further out than the fix reached.
 *
 * Two smaller gaps rode along with it. The extension list was the literal
 * `['.tsx', '.ts']`, hardcoded exactly where `test/support/stylesheet-text.ts`
 * had already learned not to (that file's own docblock records round 19's
 * NB-2 finding the same mistake); it is derived from `tsconfig.json` via
 * `compiledExtensions()` now, shared with that module, so an `.mts` supplier
 * is walked too. And a specifier that resolved to nothing was `continue`d
 * past rather than refused — the docblock claimed this "is reported by the
 * caller… via the closure's own membership pin", which is false: the pin is
 * an exact-membership `toEqual`, and a MISSING module leaves it unchanged and
 * green, not red. It is `fail()`, now, matching every other refusal in this
 * module.
 */
export function importClosure(entrySource?: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const exts = compiledExtensions();
  const resolve = (fromRel: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) {
      base = spec.slice(2);
    } else if (spec.startsWith('./') || spec.startsWith('../')) {
      base = relative(REPO_ROOT, join(REPO_ROOT, dirname(fromRel), spec));
    } else {
      // A dependency, bounded by the lockfile and by `ALLOWED_IMPORTS`'
      // specifier pin, not by reading its source.
      return null;
    }
    for (const ext of exts) {
      try {
        readFileSync(join(REPO_ROOT, base + ext), 'utf8');
        return base + ext;
      } catch {
        // Try the next compiled extension.
      }
    }
    fail(
      `the import '${spec}' from ${fromRel} resolves to no compiled source file under any of ` +
        `${exts.join(', ')} — a first-party module this closure cannot see is a supplier this ` +
        `rule cannot bound`,
    );
  };
  const visit = (rel: string, content?: string): void => {
    if (seen.has(rel)) return;
    seen.add(rel);
    order.push(rel);
    const src = content ?? readFileSync(join(REPO_ROOT, rel), 'utf8');
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const resolved = resolve(rel, stmt.moduleSpecifier.text);
      if (resolved) visit(resolved);
    }
  };
  visit('components/registries/registry-card.tsx', entrySource);
  return order;
}

/** The source of one module in the closure, for a guard that must read it. */
export function closureSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * The protocol event names, read off `lib/types.ts`'s own `StepEventType`
 * union.
 *
 * Six of them are `acdp.<verb>` — `acdp.publish`, `acdp.retrieve`,
 * `acdp.search`, `acdp.verify`, `acdp.retract`, `acdp.republish` — and with
 * round 19's BL-4 widening the separator to include `.`, every one of them is
 * id-shaped. They are not profile ids, they are the names of protocol
 * operations, and `lib/colors.ts` — which is in this card's import closure —
 * legitimately writes all six as `startsWith` arguments.
 *
 * So they are licensed for the CLOSURE scan and for nothing else: the
 * component's own guard still refuses them, because the component has no
 * reason to name an event type and a sentence about `acdp.retract` on a
 * registry card would be exactly the defect #95 is about.
 *
 * Derived from the union rather than listed, so a seventh operation is
 * licensed the moment the protocol has one and not before.
 */
export function protocolEventNames(source?: string): string[] {
  const src = source ?? readFileSync(join(REPO_ROOT, 'lib/types.ts'), 'utf8');
  const sf = ts.createSourceFile('lib/types.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== 'StepEventType') continue;
    if (!ts.isUnionTypeNode(stmt.type)) continue;
    for (const member of stmt.type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        out.push(member.literal.text);
      }
    }
  }
  if (out.length === 0) {
    fail(
      'could not read `StepEventType` out of `lib/types.ts` — the licence this closure scan ' +
        'grants to protocol event names is derived from that union, and a licence derived from ' +
        'nothing is a licence for everything',
    );
  }
  return out.sort();
}

/**
 * Every id-shaped string in a module that is not one of the seven advertisable
 * ids, in VALUE position — the foreign-id rule, run over an arbitrary file.
 *
 * `assertNoForeignProfileId` is the component's own guard and carries the
 * component's census and the component's failure prefix. This is the same
 * RULE with neither, so it can be pointed at the import closure.
 *
 * A string literal inside a `LiteralTypeNode` is a TYPE, not a value: it is
 * erased before anything renders, and `lib/types.ts` legitimately declares
 * `'acdp.publish' | 'acdp.retrieve' | …` as the protocol's event names. That
 * exclusion is structural, not a name on a list, and it is asserted as a case
 * where this is used so it cannot quietly become a hole.
 */
function scanForeign(
  src: string,
  label: string,
  extraAllowed: readonly string[],
): { found: { id: string; where: string }[]; census: LiteralCensus } {
  const sf = ts.createSourceFile(label, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const allowed = new Set<string>([...REGISTRY_ADVERTISABLE_PROFILES, ...extraAllowed]);
  const found: { id: string; where: string }[] = [];
  const census: LiteralCensus = { stringLiterals: 0, templateParts: 0, jsxTexts: 0 };
  const check = (text: string, node: ts.Node): void => {
    for (const m of text.matchAll(profileIdMatcher())) {
      if (!allowed.has(m[0])) found.push({ id: m[0], where: node.getText(sf).slice(0, 80) });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // Counted BEFORE the type-node exclusion: the census answers "did this
      // arm run", not "did it report". A `LiteralTypeNode` child is erased
      // before anything renders and is legitimately not checked, but an arm
      // that stopped visiting string literals altogether must still be red.
      census.stringLiterals += 1;
      if (!node.parent || !ts.isLiteralTypeNode(node.parent)) check(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      census.templateParts += 1 + node.templateSpans.length;
      check(node.head.text, node);
      for (const span of node.templateSpans) check(span.literal.text, node);
    } else if (ts.isJsxText(node)) {
      if (node.text.trim() !== '') {
        census.jsxTexts += 1;
        check(node.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { found, census };
}

export function foreignProfileIdsIn(
  src: string,
  label = 'module',
  extraAllowed: readonly string[] = [],
): { id: string; where: string }[] {
  return scanForeign(src, label, extraAllowed).found;
}

/**
 * What the closure walk actually VISITED, per string-bearing node kind.
 *
 * ── ROUND 21's NB-1: A RULE WITH NO WITNESS ────────────────────
 *
 * `assertNoForeignProfileId` — the component's own copy of this rule — has a
 * per-kind anti-vacuity floor, and deleting it is 3 red. This copy, generalised
 * from it for round 19's import closure, had none: deleting the `JsxText` arm
 * outright was SILENT, because all four of its guard-the-guard cases pass
 * string literals. The discipline existed and was not carried across when the
 * rule was moved, which is round 11's B4 in a third place.
 *
 * Adding a JsxText witness would fix the one arm somebody noticed. Instead the
 * walk reports its own census, and the caller pins it against
 * {@link literalCensus} — an independent TOKEN descent of the same source,
 * which cannot stop visiting a kind because it switches on `SyntaxKind` over
 * `getChildren()` rather than on an `if`/`else if` chain of `ts.isX`. An arm
 * that stops visiting is then red AT THE KIND IT STOPPED AT, and a new arm is
 * covered the day it is written rather than the day somebody writes a case for
 * it.
 *
 * The residual is the same one `literalCensus` names: both descents come from
 * one `ts.createSourceFile`, so a parse that stopped producing `JsxText` moves
 * both.
 */
export function foreignScanCensus(src: string, label = 'module'): LiteralCensus {
  return scanForeign(src, label, []).census;
}

/** How many string-bearing nodes of each kind a file holds. */
export type LiteralCensus = {
  /** `StringLiteral` + `NoSubstitutionTemplateLiteral`. */
  stringLiterals: number;
  /** `TemplateHead` + `TemplateMiddle` + `TemplateTail` — one per `check()` call. */
  templateParts: number;
  /** Non-blank `JsxText`. */
  jsxTexts: number;
};

/**
 * A full TOKEN descent over a file, counting the node kinds the two supply
 * walks below visit. This is what their anti-vacuity floors are derived from.
 *
 * ── ROUND 17's NB-1: THE FLOORS WERE HAND-WRITTEN NUMBERS ────────────
 *
 * They were `scanned < 60` and `jsxTexts < 8`, with `68`, `around seventy` and
 * `ten` written into the messages beside them. Two problems, and the second is
 * the one that would actually bite:
 *
 *   - The prose goes stale silently. Nothing checks that the component still
 *     has 68 literals, so the sentence a maintainer reads while deciding
 *     whether a floor is meaningful is a number from a previous round.
 *   - CLAUDE.md prefers the semantic classes in `app/globals.css` to inline
 *     style objects, and this component has seven inline `style={{…}}` props.
 *     Moving them to classes is the refactor the repository's own rules ask
 *     for, and it deletes roughly twenty string literals — straight through a
 *     floor of 60, turning a correct edit into a red test whose message says
 *     the walk is "looking at the wrong nodes". A guard that cries wolf at the
 *     house style is a guard that gets its floor lowered to 5 again, which is
 *     what round 15 found it at.
 *
 * So the floor is MEASURED from the component instead, every run, by a descent
 * that shares no code with the walk it bounds: `getChildren()` visits the token
 * stream — including the `SyntaxList` and punctuation nodes `forEachChild`
 * skips — where the walks use `forEachChild` and an `if`/`else if` chain over
 * `ts.isX` predicates. A walk that stops visiting a node kind loses ground
 * against a census that cannot, whatever the file has been edited into.
 *
 * The residual, stated rather than papered over: both descents come from ONE
 * `ts.createSourceFile`, so a parse that stopped producing `JsxText` would move
 * both. That is the shared blind spot, and it is why the floor is a PROPORTION
 * of a live measurement rather than an equality — an equality between two
 * descents of the same tree is satisfied by `0 === 0`, and the file this guards
 * is one deletion away from having no JSX at all.
 */
export function literalCensus(sf: ts.SourceFile): LiteralCensus {
  let stringLiterals = 0;
  let templateParts = 0;
  let jsxTexts = 0;
  const descend = (node: ts.Node): void => {
    for (const child of node.getChildren(sf)) {
      switch (child.kind) {
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
          stringLiterals += 1;
          break;
        case ts.SyntaxKind.TemplateHead:
        case ts.SyntaxKind.TemplateMiddle:
        case ts.SyntaxKind.TemplateTail:
          templateParts += 1;
          break;
        case ts.SyntaxKind.JsxText:
          if ((child as ts.JsxText).text.trim() !== '') jsxTexts += 1;
          break;
        default:
          break;
      }
      descend(child);
    }
  };
  descend(sf);
  return { stringLiterals, templateParts, jsxTexts };
}

/**
 * How much of the component's own census a supply walk must still reach.
 *
 * Not `1` — a subject derived from the real source by one textual mutation
 * drops a node or two by construction, and so does an ordinary edit. Not `0.5`
 * either: round 15's N3 is that a floor at a third of the measurement stops
 * measuring the walk. At 0.8 the component's 78 string-bearing nodes give 63
 * and its ten pieces of JSX text give eight, which is where the hand-written
 * floors had drifted to — the number is the same, the way it is obtained is the
 * fix.
 */
export const VACUITY_FRACTION = 0.8;

function vacuityFloor(of: number): number {
  return Math.ceil(of * VACUITY_FRACTION);
}

/**
 * THIS MODULE's own source text, so a self-test can enumerate every `fail()`
 * branch in it and demand a subject for each (round 13's B4).
 *
 * Read through this function rather than by path from the test file because
 * `import.meta.url` is a file URL here and is NOT one in a test module under
 * Vitest's transform — the test file's own attempt threw "The URL must be of
 * scheme file". Nothing semantic is being borrowed: the caller parses the text
 * with its own AST walk and decides for itself what a branch is.
 */
export function guardModuleSource(): string {
  return readFileSync(fileURLToPath(import.meta.url), 'utf8');
}

/**
 * Every refusal in this module goes through `fail()`, and `fail()` puts this in
 * front of the message. Exported so a self-test can require it.
 *
 * ROUND 12: this exists because `expect(() => guard.run(bad)).toThrow()` is
 * satisfied by ANY throw, including one the guard did not mean. Round 11's
 * G7b short-circuited `assertGlossIsPureOfId`'s `mapCalls.length === 0`
 * vacuity check; `mapCalls[0]` was then `undefined`, `call.arguments[0]` threw
 * a `TypeError`, and the rejection case passed — so the guard's own anti-vacuity
 * pin could be disabled with the suite green. A rejection is only a rejection
 * if the guard said so, which means the message has to come from `fail()`.
 */
export const GUARD_FAILURE_PREFIX = 'registry-card.tsx: ';

function fail(what: string): never {
  throw new Error(
    `${GUARD_FAILURE_PREFIX}${what}. Profile copy in this file is bounded to the PROFILE_INFO table ` +
      `(whose keys tsc pins to the advertisable seven) reached through glossFor(), because five ` +
      `previous guards each bounded a region and the copy moved to the region next door. If this ` +
      `file genuinely needs the construct, widen the allow-list in ` +
      `test/support/profile-copy-table.ts and say why — do not delete the check.`,
  );
}

/** The `PROFILE_INFO` initializer, which every other check treats as the subject. */
function copyTableNode(sf: ts.SourceFile): ts.ObjectLiteralExpression {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === 'PROFILE_INFO' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      if (found) fail('has two PROFILE_INFO initializers — a second one can shadow the first');
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) fail('no PROFILE_INFO object literal found — the guard lost its subject');
  return found;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/**
 * Refuse any module-scope construct other than the ones named above, and any
 * import binding not on the allow-list.
 *
 * Type-alias declarations ARE allowed: a type has no runtime value, so it
 * cannot carry copy, and forbidding them was pressure to widen the IMPORT
 * allow-list instead — which is the one direction that genuinely opens a hole.
 */
export function assertModuleShape(source?: string): void {
  const sf = sourceFile(source);
  let sawTable = false;
  let sawComponent = false;

  for (const st of sf.statements) {
    // The `'use client'` directive, and nothing else expression-shaped. A bare
    // expression statement is how `PROFILE_INFO['x'] = { title }`,
    // `Object.assign(...)` and `Object.setPrototypeOf(...)` all enter a module.
    if (ts.isExpressionStatement(st)) {
      if (ts.isStringLiteral(st.expression)) continue;
      fail(`module-scope expression statement \`${st.getText(sf).slice(0, 60)}\``);
    }

    // A type alias carries no value. `AdvertisableProfileId` is what makes the
    // key set a tsc error rather than a test assertion.
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;

    if (ts.isImportDeclaration(st)) {
      const spec = (st.moduleSpecifier as ts.StringLiteral).text;
      const allowed = ALLOWED_IMPORTS[spec];
      if (!allowed) {
        fail(`imports from \`${spec}\`, which is not on the allow-list (copy could come from it)`);
      }
      const clause = st.importClause;
      if (clause?.name) fail(`default-imports from \`${spec}\`; only named bindings are bounded`);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        fail(`namespace-imports \`* as ${bindings.name.text}\` from \`${spec}\`, which is unbounded`);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = el.propertyName?.text ?? el.name.text;
          if (!allowed.includes(name)) {
            fail(
              `imports \`${name}\` from \`${spec}\`, which is not on that module's binding ` +
                `allow-list (${allowed.join(', ')}) — an allow-listed MODULE is not a bounded one`,
            );
          }
        }
      }
      continue;
    }

    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        const name = decl.name.getText(sf);
        if (!ALLOWED_VARIABLES.includes(name)) {
          fail(`declares \`${name}\` at module scope; only ${ALLOWED_VARIABLES.join(', ')} may exist`);
        }
        if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          fail(
            `exports \`${name}\`. PROFILE_INFO was exported once so a test could read Object.keys, ` +
              'and that let any other module mutate the table at module scope — invisible to the ' +
              'guard because Vitest isolates module graphs per test file',
          );
        }
        if (name === 'PROFILE_INFO') sawTable = true;
      }
      continue;
    }

    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.getText(sf) ?? '<anonymous>';
      if (!ALLOWED_FUNCTIONS.includes(name)) {
        fail(`declares function \`${name}\` at module scope; only ${ALLOWED_FUNCTIONS.join(', ')} may exist`);
      }
      if (name === 'RegistryCard') sawComponent = true;
      continue;
    }

    fail(`contains a ${ts.SyntaxKind[st.kind]} at module scope`);
  }

  // Anti-vacuity in both directions: an empty or renamed module must not pass.
  if (!sawTable) fail('no PROFILE_INFO declaration found — the guard lost its subject');
  if (!sawComponent) fail('no RegistryCard declaration found — the guard lost its subject');
}

/**
 * Refuse a `title` anywhere in the file outside the copy table.
 *
 * THE WHOLE FILE, not its statement list. This is the bound round 6 gave up:
 * it whitelisted module scope and left the component body open, so a second
 * lookup table declared inside `RegistryCard`, a gloss synthesised from the id,
 * a copy default in the parameter list, a nested `Chip` component with its own
 * table and a JSX-spread `{...(p === 'x' ? { title } : {})}` were all green —
 * five of them red one revision earlier. Every one of those forms is an object
 * literal with a `title` property, which is what this walks for.
 *
 * Entries of `PROFILE_INFO` are exempt because they ARE the table; membership
 * is tested by ancestry, not by name, so declaring a same-named local does not
 * buy an exemption.
 */
export function assertNoCopyOutsideTable(source?: string): void {
  const sf = sourceFile(source);
  const table = copyTableNode(sf);

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && !isWithin(node, table)) {
      for (const prop of node.properties) {
        // EVERY property form, not just `PropertyAssignment`. The first version
        // of this walk read the name off assignments and shorthands only and
        // returned `undefined` for everything else, so a getter, a setter, a
        // method and a spread were each invisible — and a COMPUTED name came
        // back as the literal text `['title']`, which the quote-strip
        // (`/^['"]|['"]$/`) does not touch. Two of those shipped as live
        // escapes: `{ ['title']: … }` and `{ get title() { … } }` both put the
        // deleted copy on screen with the whole suite green.
        //
        // A spread is refused outright rather than inspected: its contents are
        // not knowable from this file.
        if (ts.isSpreadAssignment(prop)) {
          fail(
            `spreads \`${prop.getText(sf).slice(0, 40)}\` into an object literal outside ` +
              'PROFILE_INFO — the resulting keys are not knowable from here',
          );
        }
        const nameNode = prop.name;
        if (!nameNode) continue;
        // A computed name is only readable when its expression is a literal;
        // anything else is unbounded and is refused rather than skipped, which
        // is the property every previous reader got backwards.
        let name: string;
        if (ts.isComputedPropertyName(nameNode)) {
          const expr = nameNode.expression;
          if (!ts.isStringLiteral(expr) && !ts.isNoSubstitutionTemplateLiteral(expr)) {
            fail(
              `uses a computed property name \`${nameNode.getText(sf).slice(0, 40)}\` outside ` +
                'PROFILE_INFO — this reader cannot say what key it produces',
            );
          }
          name = expr.text;
        } else {
          name = nameNode.getText(sf).replace(/^['"`]|['"`]$/g, '');
        }
        if (name === 'title' || name === 'accent') {
          fail(
            `has an object literal carrying \`${name}\` (as ${ts.SyntaxKind[prop.kind]}) outside ` +
              `PROFILE_INFO (\`${node.getText(sf).slice(0, 60).replace(/\s+/g, ' ')}\`) — ` +
              'a second source of copy',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * The runtime forms that can attach copy to an object without writing a
 * property into a literal — restored, and this time walking the whole file.
 *
 * The restoration DROPPED the anti-vacuity pin the original carried
 * (`expect(PROHIBITED_RUNTIME_FORMS.length).toBeGreaterThan(0)` at `a628b7f`),
 * and round 8 named that loss without it being fixed. Emptying this list to
 * `[]` was green through two more rounds — the check then walks the file and
 * compares every callee against nothing. The pin is back, in
 * `registry-card-profiles.test.tsx`'s "the prohibited-runtime-form list is not
 * empty", and it names four entries so a trim cannot pass by leaving the cheap
 * ones in.
 *
 * `a628b7f` had exactly this check and the module-scope rewrite deleted it. The
 * measurement is unambiguous: an in-body `Proxy` get-trap synthesising the
 * `acdp-consumer` title was RED at `a628b7f` and GREEN one revision later. That
 * is the fourth time a fix on this claim has removed coverage the version
 * before it had, and it is the reason this file's header now lists the bounds
 * separately instead of describing one guard that supposedly covers everything.
 *
 * `Object.create` and `Object.setPrototypeOf` are on the list too, which the
 * original was missing: a prototype carrying `title` is the same escape with a
 * different verb, and a prototype getter is how round 5's parser was beaten.
 */
export const PROHIBITED_RUNTIME_FORMS = [
  'Object.assign',
  'Object.create',
  'Object.defineProperty',
  'Object.defineProperties',
  'Object.setPrototypeOf',
  'Reflect.set',
  'Reflect.defineProperty',
  'Proxy',
] as const;

export function assertNoRuntimeCopyForms(source?: string): void {
  const sf = sourceFile(source);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      for (const form of PROHIBITED_RUNTIME_FORMS) {
        if (callee === form) {
          fail(
            `calls \`${form}\` — a copy table can be extended, wrapped or given a prototype ` +
              'this way without any property literal for the object walk to find',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Refuse a gloss delivered through an announced attribute.
 *
 * Scoped to `aria-*`, `data-*` and `dangerouslySetInnerHTML` rather than an
 * allow-list of every permitted attribute. A blanket allow-list was written
 * first and immediately went red on `tone` and `variant` — ordinary props of
 * this file's own `StatusDot` and `Badge` — which is the shape of brittleness
 * that pressures a future maintainer into widening a check rather than reading
 * it. These three are the channels that carry text to an operator without any
 * probe reading them; the rendered-attribute equality in
 * `registry-card-profiles.test.tsx` bounds the chip itself exactly.
 *
 * `assertGlossChokePoint`'s own docblock claimed "the render probes are what
 * read those" of `aria-label` and `data-*`. They do not: every probe reads
 * `title`, `className` and `textContent` and nothing else, so a single added
 * `aria-label` carrying the deleted copy — on every registry, with no gating at
 * all — passed the whole suite. By this repo's own reasoning that is the
 * STRONGER disclosure channel: `CLAUDE.md` treats a `title` as not disclosing
 * at all because a screen reader may not announce it, while an `aria-label` is
 * announced in its place.
 */
export function assertNoAlternateDisclosureChannel(source?: string): void {
  const sf = sourceFile(source);
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      // `alt` and `placeholder` joined the list in round 10. An `alt` is
      // announced by a screen reader and rendered as VISIBLE TEXT when the
      // image fails — which is the exact property this guard's own argument
      // uses to put `aria-label` on the list, and round 9's gate got a sentence
      // naming `acdp-log-witness` onto the card through one with everything
      // green. It is now also caught by the rendered closed world in
      // `registry-card-profiles.test.tsx`; both are kept, because that one
      // bounds a FIXTURE-reachable render and this one bounds the file.
      if (/^(aria-|data-)/.test(name) || name === 'dangerouslySetInnerHTML' || name === 'alt' || name === 'placeholder') {
        fail(
          `renders a \`${name}\` attribute. Copy reaches the operator through it as surely as ` +
            'through `title` — more surely, for a screen-reader user, since a `title` may not ' +
            'be announced at all — and no render probe reads it. If the component genuinely ' +
            'needs one, add a probe that reads it and then widen this check',
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * Refuse any rendered `title` that is not the single allowed expression.
 *
 * The object-literal walk above cannot see `title={registry.authority === 'x'
 * ? info?.title : undefined}` — there is no literal — and that mutation removed
 * the tooltip from every registry but one with the whole suite green. A JSX
 * attribute is where copy becomes something an operator can see, so it is
 * worth bounding on its own.
 *
 * Its limit, stated correctly this time: it bounds the `title` ATTRIBUTE and
 * nothing else. The previous wording claimed "the render probes are what read"
 * `aria-label` and `data-*`. They do not — every probe reads `title`,
 * `className` and `textContent` — so that sentence was the whole of the
 * argument for leaving a channel open, and it was false. That channel is now
 * closed by `assertNoAlternateDisclosureChannel` rather than by a claim.
 */
export function assertGlossChokePoint(source?: string): void {
  const sf = sourceFile(source);
  const attrs: ts.JsxAttribute[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'title') attrs.push(node);
    // A spread of unknown shape onto a JSX element can introduce `title`
    // without an attribute node at all.
    if (ts.isJsxSpreadAttribute(node)) {
      fail(`spreads \`${node.getText(sf).slice(0, 60)}\` onto an element — the props are unbounded`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (attrs.length !== 1) {
    fail(`renders ${attrs.length} \`title\` attributes, expected exactly 1 — the gloss choke point`);
  }
  const expr = attrs[0].initializer?.getText(sf).replace(/\s+/g, '') ?? '';
  if (expr !== GLOSS_EXPRESSION) {
    fail(`renders \`title=${expr}\`, but the only allowed gloss expression is \`${GLOSS_EXPRESSION}\``);
  }
}

/**
 * Refuse a `PROFILE_INFO` lookup outside `glossFor`, and a `glossFor` that does
 * not gate on the advertisable list first.
 *
 * STRUCTURAL ON PURPOSE, and the reason is worth stating because "there is no
 * test for it" is how the last five holes were argued into existence. Deleting
 * the membership gate — `return (PROFILE_INFO as Record<string, …>)[p]` — is
 * invisible at the DOM today: the table's keys are the seven, so the only ids
 * whose answer changes are `Object.prototype` names, and for those the raw
 * lookup returns a FUNCTION whose `.title` is `undefined`, so no tooltip
 * appears either way. A render probe cannot kill that mutation, and saying so
 * is more useful than shipping a probe that pretends to.
 *
 * It is still worth forbidding. `info` becomes truthy for `toString`,
 * `constructor` and `valueOf`, and the next thing rendered on `info` being
 * truthy — a badge, an icon, a class — turns a latent difference into a visible
 * one. The gate is cheap; the second lookup site is what must not appear.
 */
export function assertGlossIsGated(source?: string): void {
  const sf = sourceFile(source);
  let gloss: ts.FunctionDeclaration | undefined;
  const findFn = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(sf) === 'glossFor') gloss = node;
    ts.forEachChild(node, findFn);
  };
  findFn(sf);
  if (!gloss) fail('no glossFor declaration found — the guard lost its subject');
  const glossFn: ts.FunctionDeclaration = gloss;

  // The SHAPE of the gate, not a substring of it. `body.includes(
  // 'ADVERTISABLE_PROFILE_IDS')` was the first version of this check and it was
  // the same mistake the whole file exists to record: `if (false && !…includes(p))`
  // contains the string and gates nothing. Measured surviving before this.
  const stmts = glossFn.body?.statements ?? ts.factory.createNodeArray<ts.Statement>();
  const first = stmts[0];
  if (stmts.length !== 2 || !first || !ts.isIfStatement(first)) {
    fail('glossFor is no longer `if (<not advertisable>) return undefined;` followed by the lookup');
  }
  const cond = first.expression.getText(sf).replace(/\s+/g, '');
  const then = first.thenStatement.getText(sf).replace(/\s+/g, '');
  if (cond !== GLOSS_GATE_CONDITION || then !== 'returnundefined;') {
    fail(
      `glossFor gates on \`${cond}\` returning \`${then}\`, but the only allowed gate is ` +
        `\`${GLOSS_GATE_CONDITION}\` returning \`return undefined;\`. Indexing PROFILE_INFO ` +
        'ungated returns an inherited Object.prototype member for ids like `toString`, which is truthy',
    );
  }

  // ── The SECOND statement, which is the one that produces the gloss ──
  //
  // Round 9's gate found this unbounded, and the omission was papered over by
  // `assertGlossIsPureOfId`'s "What it does NOT cover" paragraph, which
  // deflected to "that is `assertGlossIsGated` and `assertNoCopyOutsideTable`'s
  // subject". Neither held it: this function pinned statement ONE, and
  // `assertNoCopyOutsideTable` only sees object literals. Between them the
  // return expression was free, and this survived with everything green:
  //
  //   return typeof window !== 'undefined' &&
  //     window.location.hostname.endsWith('.prod')
  //     ? undefined
  //     : PROFILE_INFO[p as AdvertisableProfileId];
  //
  // On the real deployment every profile chip on every registry silently loses
  // its tooltip. jsdom's hostname is `localhost`, so every render probe in this
  // repo — including the one that demands a gloss for all seven advertisable
  // ids — is satisfied, and the RENDERED closed world in
  // `registry-card-profiles.test.tsx` cannot see it either: that guard bounds
  // what APPEARS, and this is copy that stops appearing somewhere the tests do
  // not run.
  //
  // SUPPRESSION is a direction this branch explicitly claims to defend —
  // `GLOSS_EXPRESSION`'s docblock cites a mutation that "silently dropped every
  // tooltip on every registry but one" as the reason it is pinned so tightly —
  // so the return expression is pinned the same way the `title` attribute is:
  // exactly one allowed spelling, compared whitespace-insensitively.
  const ret = stmts[1];
  if (!ret || !ts.isReturnStatement(ret) || !ret.expression) {
    fail("glossFor's second statement is not a `return <expression>;`");
  }
  const retText = (ret as ts.ReturnStatement).expression!.getText(sf).replace(/\s+/g, '');
  if (retText !== GLOSS_RETURN_EXPRESSION) {
    fail(
      `glossFor returns \`${retText}\`, but the only allowed lookup is ` +
        `\`${GLOSS_RETURN_EXPRESSION}\`. Anything else can suppress the gloss on a ` +
        'condition no test environment reproduces — which is invisible to every render probe',
    );
  }

  const visit = (node: ts.Node): void => {
    // Unwrap parentheses and `as` before comparing. `(PROFILE_INFO as
    // Record<string, …>)[p]` is the natural way to write a second lookup site
    // and its `.expression` text is the whole parenthesised cast, not the
    // identifier — so a naive name comparison missed it. Measured surviving.
    let target: ts.Node | undefined =
      ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)
        ? node.expression
        : undefined;
    while (target && (ts.isParenthesizedExpression(target) || ts.isAsExpression(target))) {
      target = target.expression;
    }
    const reads = !!target && ts.isIdentifier(target) && target.text === 'PROFILE_INFO';
    if (reads && !isWithin(node, glossFn)) {
      fail(
        `reads PROFILE_INFO outside glossFor (\`${node.getText(sf).slice(0, 50)}\`) — the gloss ` +
          'has exactly one lookup site so that the render probes and this file bound one thing',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

/**
 * The gloss must be a function of the PROFILE ID AND NOTHING ELSE.
 *
 * ── Why this is structural and not a render probe ────────────────────
 *
 * Eight gate rounds have now found the same escape with a different gate on it.
 * Every previous answer was to widen the probe matrix — add a `capabilities`
 * axis, add a `registry` axis, add a POSITION axis — and every time the copy
 * moved to a coordinate the widened matrix still did not reach:
 *
 *   round 6  `registry.authority === 'registry-a…' ? {gloss} : undefined`
 *            — the probes fixed `registry`.
 *   round 7  `i > 0 ? {gloss} : undefined`
 *            — the probes rendered one id, always at index 0.
 *   round 8  `i > 2 ? {gloss} : undefined`
 *            — the position axis reached indices 0, 1 and 2. The fix for round
 *              7 moved the boundary from 0 to 2; it did not remove it.
 *            `registry.lastSeen > '2026-09-01' ? {gloss} : undefined`
 *            `capabilities.anonymous_public_reads === false ? …`
 *            `registry.eventCount > 100 ? …`
 *            — three fields the fixtures hold CONSTANT. `REGISTRY_FIXTURES`
 *              varies authority, baseUrl and eventCount; `firstSeen` and
 *              `lastSeen` are identical in all three.
 *
 * A fixture matrix bounds the coordinates it enumerates. The input space is
 * infinite — every field of both props, crossed with every index — so no finite
 * matrix closes it, and "add one more axis" has failed three times running.
 *
 * So bound the EXPRESSION instead. If `info` can only ever be `glossFor(p)`,
 * and the callback has no other parameter to gate on, then there is no index to
 * compare and no second branch to take: the gloss is a pure function of `p` by
 * construction, and every mutation above is a syntax error against this guard
 * rather than a coordinate the probes happened to miss.
 *
 * ── The seam, and why this paragraph exists ──────────────────────────
 *
 * That is true of THE MAP THIS GUARD BINDS. Round 9's gate found it binding
 * only one — the collector reassigned a single variable, so the LAST
 * `capabilities.profiles.map(...)` in source order won and an earlier one was
 * never inspected. A second map placed BEFORE the real one carried `{i > 2 ?
 * note(q) : null}` with everything green; the identical mutation placed AFTER
 * it was killed. Order alone decided, which is the signature of a guard that
 * binds a position rather than a property.
 *
 * It now FAILS on multiplicity, the way `copyTableNode` in this file already
 * refused a second `PROFILE_INFO` initializer. "Bound the expression" only
 * closes anything if the guard is looking at every expression of that shape,
 * and a guard that silently picks one of several is an enumeration of one.
 *
 * ── ROUND 15's B3: "MULTIPLICITY" HELD ONLY FOR ONE SPELLING ─────────
 *
 * The sentence above was true of the guard and false of the claim, because the
 * collector recognised a second map by comparing its RECEIVER TEXT to
 * `capabilities.profiles`. `capabilities.profiles.filter(() => true).map(...)`
 * has receiver text `capabilities.profiles.filter(()=>true)`, so it was not a
 * second map — it was not a map at all. Measured: that call, carrying
 * `{i > 8 ? glossFor(q)?.title : null}` as visible body text, left 975/975
 * green, `tsc` clean and `eslint` clean, restoring round 7/8's index-gated
 * per-profile copy surface through a guard whose own docblock claimed to have
 * closed it. (`i > 8` because the closed world's widest shape carries eight
 * profiles, so no fixture renders the branch.)
 *
 * A receiver spelling is an open set: `.filter()`, `.slice()`, `.toSorted()`,
 * `[...capabilities.profiles]`, a local alias. So the enumeration is INVERTED,
 * the same move every other guard in this file has had to make: collect EVERY
 * `.map(...)` call in the file, whatever its receiver, and require each one's
 * receiver to be exactly `capabilities.profiles`. The closed side is now "there
 * is one map and it is over the profiles array", not "there is one call whose
 * receiver I recognised".
 *
 * ── What it does NOT cover ───────────────────────────────────────────
 *
 * It says nothing about what `glossFor` itself does, and nothing about the
 * chip's className or its text, which the render probes read.
 *
 * This paragraph used to DEFLECT — "that is `assertGlossIsGated` and
 * `assertNoCopyOutsideTable`'s subject" — and neither held the claim.
 * `assertGlossIsGated` pinned `glossFor`'s FIRST statement; `assertNoCopyOutsideTable`
 * only sees object literals. Between them the return expression was free, and
 * round 9's gate put a `window.location.hostname.endsWith('.prod')` check in
 * front of the lookup: every tooltip on every registry gone in production,
 * every test green. `assertGlossIsGated` now pins the second statement too
 * (`GLOSS_RETURN_EXPRESSION`), so the deflection is accurate — but a docblock
 * that points at another guard is only as good as that guard, and pointing is
 * how this one went a full round without anybody checking.
 */
/**
 * The node kinds allowed to stand between `RegistryCard`'s return and the
 * profiles map.
 *
 * EXPORTED and pinned by the test file, which is round 17's BL-2c: round 16
 * answered "two licensing lists are unpinned" by pinning five and creating a
 * sixth in the same commit — `CONDITION_ALLOW_LIST`, local, read by nothing.
 * Widening it by one entry plus one component edit was 977/977 green. A
 * licensing list that no test reads is not a bound, whatever its docblock says,
 * and that is true of the list a fix introduces as much as of the ones it
 * pins.
 *
 * These are structure, not decisions: an element, a fragment, the `{…}` that
 * holds an expression, parentheses, the return and its block. None of them can
 * choose whether the row renders. Every kind that CAN — a conditional, a
 * logical operator, a statement — is absent, and the single exception is
 * written as an exception in the walk rather than added here.
 */
export const PATH_NODE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxAttribute,
  ts.SyntaxKind.JsxAttributes,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.SyntaxList,
]);

/** The one condition allowed on that path. Exported so a test pins it. */
export const CONDITION_ALLOW_LIST: readonly string[] = ['capabilities'];

/**
 * `RegistryCard`'s body is exactly one statement, and it is a `return`.
 *
 * ROUND 17's BL-2b. A path bound cannot see a statement that is not on the
 * path, and the sharpest escape round 17 found was exactly that:
 *
 *   if (registry.authority.length >= 40) return <div className="card" />;
 *
 * inserted above the real return. The ancestor walk breaks at the
 * `FunctionDeclaration`, and this `if` is a SIBLING of the return it
 * short-circuits, so nothing on the path was different and 977 tests stayed
 * green while every capability on the card vanished for any authority of forty
 * characters or more. The alias variant (`const capabilities =
 * registry.authority.length < 64 ? caps : undefined;`) is the same shape.
 *
 * One statement is the closed form of "there is nothing above the return".
 * It refuses an early return, a local alias, a `let` reassigned later, a
 * `useMemo` that gates, and whatever the next one is, without naming any of
 * them. The cost is that a genuine local would have to be justified in a diff
 * that turns this red — which is the correct price for a component whose whole
 * contract is that it renders one thing unconditionally.
 */
export function assertComponentBodyIsOneReturn(source?: string): void {
  const sf = sourceFile(source);
  let fn: ts.FunctionDeclaration | undefined;
  const find = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(sf) === 'RegistryCard') fn = node;
    ts.forEachChild(node, find);
  };
  find(sf);
  if (!fn) fail('declares no `RegistryCard` function — this guard lost its subject');
  const body = fn!.body;
  if (!body) fail('`RegistryCard` has no body');
  const statements = body!.statements;
  if (statements.length !== 1) {
    fail(
      `\`RegistryCard\`'s body has ${statements.length} statements, and it may have exactly one. ` +
        'A statement above the return is invisible to every path bound in this file — an early ' +
        '`return <div className="card" />` behind `registry.authority.length >= 40` emptied the ' +
        'whole card on ordinary regional deployment names with 977 tests green',
    );
  }
  if (!ts.isReturnStatement(statements[0])) {
    fail(
      `\`RegistryCard\`'s only statement is a \`${ts.SyntaxKind[statements[0].kind]}\`, not a ` +
        '`return`. Anything else is a place to compute what the return will be, which is the ' +
        'same suppression channel one step earlier',
    );
  }
}

/**
 * Is this expression, after unwrapping, the identifier `capabilities`?
 *
 * `unwrapExpression` — `(x)`, `x!`, `x as T`, `x satisfies T`, `<T>x` — lives
 * in `test/support/ts-reads.ts` now rather than here. Round 19's BL-1 is why
 * it exists at all: every one of those produces a different source string for
 * the same read, and a guard that compares source strings is an enumeration of
 * spellings wearing the word "structural". Round 21's BL-2 is why it MOVED:
 * the sibling guard in `stylesheet-text.ts`, written the same day, matched one
 * spelling of a `document` read and a destructured alias walked through it.
 * One resolver, two callers, so the next widening lands on both.
 */
function isCapabilitiesBase(expr: ts.Expression): boolean {
  const base = unwrapExpression(expr);
  return ts.isIdentifier(base) && base.text === 'capabilities';
}

/**
 * Every READ of `capabilities.<member>` in the file, resolved structurally:
 * property access, optional access, element access with a literal key, and
 * object destructuring.
 */
export function capabilityReads(sf: ts.SourceFile): { member: string; text: string }[] {
  return memberReads(sf, isCapabilitiesBase).map(({ member, text }) => ({ member, text }));
}

/** The reads of one member of `capabilities`, as nodes, for the count rule. */
function derefsOfCapabilityMember(sf: ts.SourceFile, member: string): ts.Node[] {
  return memberReads(sf, isCapabilitiesBase)
    .filter((r) => r.member === member)
    .map((r) => r.node);
}

/**
 * Every JSX attribute on every element between `RegistryCard`'s return and the
 * profiles map, as `element -> attribute -> spelling`.
 *
 * ── ROUND 19's BL-2: A CONDITIONAL OFF THE PATH IS NOT ON IT ─────────
 *
 * The path bound below walks `call.parent` upwards and refuses any node kind
 * that is not JSX structure. A JSX ATTRIBUTE hangs off that path rather than
 * lying on it — the `style` attribute belongs to the row's
 * `JsxOpeningElement`, which is never an ancestor of the map call — so
 *
 *   <div className="metric-row" style={{ opacity: registry.authority.length >= 40 ? 0 : undefined }}>
 *
 * was 977/977 green, typecheck and lint clean, and made every chip, id and
 * gloss invisible on any registry whose authority is forty characters or
 * longer. That is round 15's B2 verbatim. `opacity` is inherited by the whole
 * subtree and no descendant rule can undo it.
 *
 * The falsified sentence, in `registry-card.tsx`: "a conditional anywhere on
 * that path, however spelled, is refused rather than recognised". The path
 * bound answers "is the row RENDERED"; suppression asks "is it VISIBLE", and
 * those are different questions asked of different nodes.
 *
 * `CHIP_ATTRIBUTES` already proves the shape of the answer: pin the attribute
 * surface. This is that, applied to the whole ancestry, so a new attribute
 * anywhere on the card's render path is a reviewable diff whatever it does —
 * and there is no list of suppressing properties to keep complete.
 */
export function pathAttributes(source?: string): string[] {
  const sf = sourceFile(source);
  const derefs = derefsOfCapabilityMember(sf, 'profiles');
  if (derefs.length !== 1) {
    fail(
      `dereferences \`capabilities.profiles\` ${derefs.length} times, so the render path to the ` +
        'profiles map is not a single path and its attribute surface cannot be enumerated',
    );
  }
  const out: string[] = [];
  for (let n: ts.Node | undefined = derefs[0]; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n)) break;
    const opening = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : undefined;
    if (!opening) continue;
    const tag = opening.tagName.getText(sf);
    for (const attr of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        out.push(`<${tag} {...${attr.expression.getText(sf).replace(/\s+/g, '')}}>`);
        continue;
      }
      const name = attr.name.getText(sf);
      const value = attr.initializer ? attr.initializer.getText(sf).replace(/\s+/g, '') : '(bare)';
      out.push(`<${tag} ${name}=${value}>`);
    }
  }
  return out;
}

export function assertGlossIsPureOfId(source?: string): void {
  const sf = sourceFile(source);
  // EVERY such call, not the last one. This collected into a single variable
  // and reassigned on each match, so with two `capabilities.profiles.map(...)`
  // calls in the file the LAST in source order won and the earlier one was
  // never inspected. Round 9's gate put the round-7/8 index gate back through
  // exactly that door:
  //
  //   {capabilities.profiles.map((q, i) => (
  //     <span key={'n-' + q} className="did">{i > 2 ? note(q) : null}</span>
  //   ))}
  //   {capabilities.profiles.map((p) => { const info = glossFor(p); … })}
  //
  // `tsc` clean, `eslint` clean, whole suite green. The IDENTICAL mutation
  // placed after the real map is killed — order alone decided, which is the
  // signature of a guard that binds a position rather than a property.
  //
  // `copyTableNode` in this same file already refuses a second `PROFILE_INFO`
  // initializer for the same reason; this is that discipline, applied where it
  // was missing.
  // EVERY `.map` in the file, not every `capabilities.profiles.map`.
  //
  // ROUND 15's B3. The collector compared the receiver's TEXT to
  // `capabilities.profiles`, so `capabilities.profiles.filter(() => true).map(…)`
  // had receiver text `capabilities.profiles.filter(()=>true)` and was not
  // counted — and a second, unbounded per-profile surface rendering
  // `i > 8 ? glossFor(q)?.title : null` as visible body text left 975/975
  // green. That falsified this guard's own argument, quoted from the docblock
  // above: "a guard that silently picks one of several is an enumeration of
  // one".
  //
  // An exact-text match is an enumeration of spellings — `.filter().map()`,
  // `.slice().map()`, `.toReversed().map()`, `[...profiles].map()` — so the
  // collection is inverted the way the attribute lists were: collect ALL of
  // them and require the file to contain exactly one, whose receiver is the
  // pinned spelling. The component has one; a second `.map` of any kind over
  // anything is a construct a reviewer should see.
  // ── ROUND 17's BL-1: A METHOD NAME IS AN ENUMERATION TOO ────────────
  //
  // Round 16 inverted the RECEIVER check and left the COLLECTOR keyed on
  // `node.expression.name.getText(sf) === 'map'`. `flatMap` is not `map`, so a
  // second per-profile rendering surface spelled
  //
  //   {capabilities.profiles.flatMap((q, i) => (
  //     <span key={q} className="did">{i > 8 ? glossFor(q)?.title : null}</span>
  //   ))}
  //
  // was never collected, never receiver-checked, and never counted — 977/977
  // green, typecheck clean, lint clean. Round 15's B3 verbatim, one method name
  // over. `Array.prototype.map.call(capabilities.profiles, …)` is the same hole
  // (the callee's name is `call`).
  //
  // Three rounds have now replaced one enumeration with a narrower one here:
  // the LAST map in source order, then the receiver's exact text, then the
  // method's name. So this stops enumerating ways to reach the array and binds
  // the one thing that must be true instead:
  //
  //   `capabilities.profiles` IS DEREFERENCED EXACTLY ONCE IN THE FILE, AND
  //   THAT DEREFERENCE IS THE RECEIVER OF A `.map` CALL.
  //
  // Every escape this guard has ever admitted is a second dereference or a
  // differently-spelled use of the one: `.flatMap`, `.filter().map()`,
  // `.slice()`, `.toSorted()`, `[...capabilities.profiles]`, a local alias, a
  // destructure, `Array.prototype.map.call`. None of them survives a rule that
  // counts dereferences, and none of them needed to be anticipated to be
  // refused. There is no list here for the next author to keep complete.
  //
  // ── ROUND 19's BL-1: A SOURCE-TEXT EQUALITY IS AN ENUMERATION OF ONE ─
  //
  // Round 18 wrote that bound as `node.getText(sf).replace(/\s+/g,'') ===
  // 'capabilities.profiles'`, under a docblock saying "there is no second
  // iteration to spell, under ANY method name, because there is no second
  // READ of the array to spell it on". One character falsified it:
  //
  //   {capabilities?.profiles.map((q, i) => (
  //     <span key={q} className="did">{i > 8 ? glossFor(q)?.title : null}</span>
  //   ))}
  //
  // `capabilities?.profiles` is a different STRING, so `derefs.length` stayed
  // 1, every guard was satisfied, and 977 tests stayed green while a card with
  // eleven profiles put gloss text into visible body copy. `capabilities!.
  // profiles`, `(capabilities).profiles`, `capabilities['profiles']`,
  // `capabilities as X).profiles` and `capabilities./*x*/profiles` are the
  // same hole. That is the FOURTH narrowing of one enumeration in this guard —
  // last map in source order, then receiver text, then method name, then
  // dereference TEXT — and the pattern is always the same: the single thing
  // that must be true gets written down as one SPELLING of that thing.
  //
  // So the access is resolved rather than compared. `derefsOfCapabilityMember`
  // unwraps `?.`, `!`, parentheses and `as`/`satisfies` casts, accepts both
  // property and element access, and counts destructuring too — a
  // `const { profiles } = capabilities` is a read of the array by any honest
  // reading of the sentence above.
  const derefs = derefsOfCapabilityMember(sf, 'profiles');
  if (derefs.length === 0) {
    fail(
      'never dereferences `capabilities.profiles` — either this guard has lost its subject, or ' +
        'the array now reaches the render through an alias or a destructure, which is the same ' +
        'thing with a different name and is refused for the same reason',
    );
  }
  if (derefs.length > 1) {
    fail(
      `dereferences \`capabilities.profiles\` ${derefs.length} times. Exactly one is allowed, ` +
        'because a second dereference is a second place to render per-profile copy however it is ' +
        'spelled — a `.flatMap`, a `.filter().map()`, a spread, an alias. Enumerating the ' +
        'SPELLINGS failed in rounds 9, 15 and 17; the dereference count does not have to be ' +
        'kept complete',
    );
  }
  const deref = derefs[0];
  const access = deref.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name.getText(sf) !== 'map') {
    fail(
      `dereferences \`capabilities.profiles\` for \`${deref.parent.getText(sf).replace(/\s+/g, '').slice(0, 50)}\`, ` +
        'and the one dereference this component may contain must be the receiver of `.map` — not ' +
        'of `.flatMap`, not an argument, not the right-hand side of an assignment',
    );
  }
  if (!ts.isCallExpression(access.parent) || access.parent.expression !== access) {
    fail('`capabilities.profiles.map` is referenced without being called, so nothing here bounds what does call it');
  }
  const call: ts.CallExpression = access.parent;

  // ── SUPPRESSION'S THIRD HOME: the JSX ABOVE the callback ─────────────
  //
  // ROUND 15's B2. Round 10 pinned `glossFor`'s two statements and round 11
  // pinned the callback's two statements, and the docblocks then said
  // suppression "rests on that guard AND on assertGlossIsPureOfId". It does
  // not. Wrapping the whole Profiles row in
  //
  //   {registry.authority.length < 40 && ( …the row, unchanged… )}
  //
  // left 975/975 green, typecheck clean, and dropped every chip, every profile
  // id and every gloss for any registry whose authority is forty characters or
  // longer — a real deployment name, not a contrivance. Every guard was
  // satisfied because nothing INSIDE the row had changed: one `title`, an
  // untouched `glossFor`, one map with the pinned callback and attributes.
  //
  // The escape gates on a DERIVED coordinate (`authority.length`), which is why
  // the rendered closed world cannot see it either: its "every field varies"
  // detector walks JSON leaves, and no leaf changes.
  //
  // So the PATH is bounded, not another coordinate.
  //
  // ── ROUND 17's BL-2: RECOGNISING CONDITIONS IS AN ENUMERATION ───────
  //
  // Round 15's fix walked the ancestry and RECOGNISED three constructs —
  // `ConditionalExpression`, a `&&` `BinaryExpression`, and `IfStatement` —
  // comparing each one's condition text to an allow-list. Its docblock said
  // "anything else … fails here" and the component's said "a conditional
  // anywhere on that path, however spelled, is refused rather than
  // recognised". Both were false, three ways, each at 977/977 green with
  // typecheck and lint clean:
  //
  //   `{capabilities && (registry.authority.length >= 40 || (…))}`
  //       The `||` node is on the chain and `gate` was simply never assigned
  //       for it, so the loop skipped it. Measured on a 44-character regional
  //       deployment name: every chip, every id, every gloss and the entire
  //       capabilities block gone from the card.
  //
  //   `if (registry.authority.length >= 40) return <div className="card" />;`
  //       An early return is a SIBLING of the return, never an ancestor — so
  //       the one construct the docblock named by name was the one construct
  //       the walk could not see.
  //
  //   `CONDITION_ALLOW_LIST` widened by one entry, plus a matching gate.
  //       The same round that pinned five licensing lists created a sixth,
  //       unexported, read by no test. Round 15's B1 one level down.
  //
  // So the enumeration is INVERTED, the move every other guard in this file
  // has had to make. The chain from the map up to `RegistryCard` may contain
  // only NODE KINDS on a closed list — JSX structure, parentheses, the return
  // and its block — plus exactly one `&&` whose left-hand side is
  // `capabilities`. A `||`, a `??`, a ternary, a `switch`, an `if`, and a node
  // kind nobody has thought of are all refused by the same rule, because the
  // rule is what may be there rather than what may not.
  //
  // The early return is closed separately and structurally, by
  // `assertComponentBodyIsOneReturn` — a path bound cannot see a statement
  // that is not on the path.
  for (let n: ts.Node | undefined = call.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n)) break;
    if (PATH_NODE_KINDS.has(n.kind)) continue;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      CONDITION_ALLOW_LIST.includes(n.left.getText(sf).replace(/\s+/g, ''))
    ) {
      continue;
    }
    const what = ts.isBinaryExpression(n)
      ? `the condition \`${n.left.getText(sf).replace(/\s+/g, '').slice(0, 50)}\``
      : `a \`${ts.SyntaxKind[n.kind]}\``;
    fail(
      `renders the profiles row behind ${what}. The path from this component's return down to ` +
        'the profiles map may contain only JSX structure and one `&&` whose left side is ' +
        `\`${CONDITION_ALLOW_LIST.join('`, `')}\`. Anything on that path suppresses every chip, ` +
        'every id and every gloss on whichever deployments fail it, with nothing inside the row ' +
        'changed and every other guard in this file satisfied — and RECOGNISING conditions ' +
        'rather than bounding the path let `||` straight through with 977 tests green',
    );
  }

  const cb = call.arguments[0];
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) {
    fail('the profiles `.map` callback is not a function literal, so its parameters are unbounded');
  }
  const fn = cb as ts.ArrowFunction | ts.FunctionExpression;

  // ONE parameter. The index is the thing every round-7 and round-8 gloss
  // escape reached for, and a callback that never receives it cannot use it.
  if (fn.parameters.length !== 1) {
    fail(
      `the profiles \`.map\` callback takes ${fn.parameters.length} parameters ` +
        `(\`${fn.parameters.map((p) => p.getText(sf)).join(', ')}\`), expected exactly 1. ` +
        'The second parameter is the array index, and a gloss gated on it disclosed copy for a ' +
        'non-advertisable profile id at every position the render probes did not enumerate — ' +
        'first `i > 0`, then `i > 2`. There is no index to gate on if it is never bound.',
    );
  }
  const param = fn.parameters[0].name.getText(sf);

  // …and `info` is EXACTLY `glossFor(<that parameter>)`. Not `glossFor(p) ??
  // anything`, not a conditional, not a spread, not an `Object.assign`.
  const decls: ts.VariableDeclaration[] = [];
  const findInfo = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'info') decls.push(node);
    ts.forEachChild(node, findInfo);
  };
  findInfo(fn);
  if (decls.length !== 1) {
    fail(`the callback declares ${decls.length} \`info\` bindings, expected exactly 1`);
  }
  const init = decls[0].initializer?.getText(sf).replace(/\s+/g, '') ?? '';
  const only = `glossFor(${param})`;
  if (init !== only) {
    fail(
      `\`info\` is initialised to \`${init}\`, but the only allowed initialiser is \`${only}\`. ` +
        'Anything else makes the gloss a function of something other than the profile id — ' +
        'which is how it came to depend on the array index, on `registry.authority`, on ' +
        '`registry.lastSeen` and on `capabilities.anonymous_public_reads` in successive rounds.',
    );
  }

  // ── THE CALLBACK'S WHOLE BODY, not just where `info` comes from ──────
  //
  // Round 11's blocking finding B3, and it falsified this file's stated
  // residual rather than merely widening it. `GLOSS_RETURN_EXPRESSION`'s
  // docblock said suppression "rests entirely on `assertGlossIsGated`" and
  // called one allowed spelling "the only instrument that does". It is not:
  // suppression has a second home, and it is this callback's RETURN.
  //
  //   const info = glossFor(p);
  //   if (capabilities.limits.max_search_limit > 500) {
  //     return <span key={p} className={info?.accent ? 'chip ok' : 'chip'}>{p}</span>;
  //   }
  //   return <span key={p} className={…} title={info?.title}>{p}</span>;
  //
  // tsc clean, eslint clean, 963/963 green — and every profile tooltip
  // disappears on any registry whose capabilities report
  // `max_search_limit > 500`. `assertGlossChokePoint` counts `title`
  // attributes and still found exactly one; `assertGlossIsGated` bounds
  // `glossFor`, which was untouched; and no render probe visits that
  // coordinate, because the fixtures hold that field constant.
  //
  // The fix is not another coordinate. It is to bound the callback's body the
  // way `glossFor`'s body is bounded: TWO statements, the second a bare
  // `return` of ONE JSX element whose attribute set and child are pinned
  // spellings. A conditional return, a second element, a dropped attribute, an
  // added attribute and a changed child all fail the same way, without anyone
  // enumerating which one somebody will try next.
  const body = fn.body;
  if (!body || !ts.isBlock(body)) {
    fail(
      'the profiles `.map` callback is not a block body — this guard pins the two statements it ' +
        'is allowed to contain, and cannot do that for a concise arrow',
    );
  }
  const stmts = (body as ts.Block).statements;
  if (stmts.length !== 2) {
    fail(
      `the profiles \`.map\` callback has ${stmts.length} statements, expected exactly 2 ` +
        '(`const info = glossFor(p);` then `return <chip>;`). Any third statement is an ' +
        'unbounded place to compute, suppress or add per-profile copy',
    );
  }
  const last = stmts[1];
  if (!ts.isReturnStatement(last) || !last.expression) {
    fail("the callback's second statement is not a bare `return <expression>;`");
  }
  // Unwrap the parentheses JSX is conventionally wrapped in. `return (<span
  // …/>)` and `return <span …/>` are the same program, and a guard that
  // refused one of the two spellings would be a formatting rule wearing a
  // security guard's clothes — which is how guards get deleted.
  let returned: ts.Expression = (last as ts.ReturnStatement).expression!;
  while (ts.isParenthesizedExpression(returned)) returned = returned.expression;
  if (!ts.isJsxElement(returned) && !ts.isJsxSelfClosingElement(returned)) {
    fail(
      `the callback returns \`${returned.getText(sf).slice(0, 60)}\`, which is not a single JSX ` +
        'element. A conditional return is how the tooltip was dropped on one deployment with ' +
        'every probe green',
    );
  }
  const opening = ts.isJsxElement(returned) ? returned.openingElement : (returned as ts.JsxSelfClosingElement);
  const attrs = opening.attributes.properties;
  for (const a of attrs) {
    if (!ts.isJsxAttribute(a)) {
      fail('the chip element carries a spread attribute — its props are unbounded');
    }
  }
  const spelled = (attrs as unknown as ts.JsxAttribute[]).map((a) => [
    a.name.getText(sf),
    (a.initializer?.getText(sf) ?? '').replace(/\s+/g, ''),
  ] as const);
  const expected = CHIP_ATTRIBUTES(param);
  const actual = Object.fromEntries(spelled);
  const names = spelled.map(([n]) => n).sort();
  const wanted = Object.keys(expected).sort();
  if (names.join(',') !== wanted.join(',')) {
    fail(
      `the chip's attributes are \`${names.join(', ')}\`, expected exactly ` +
        `\`${wanted.join(', ')}\`. A dropped \`title\` suppresses every gloss; an added one is a ` +
        'second disclosure channel',
    );
  }
  for (const [name, want] of Object.entries(expected)) {
    if (actual[name] !== want) {
      fail(
        `the chip's \`${name}\` is \`${actual[name]}\`, but the only allowed spelling is ` +
          `\`${want}\`. Anything else makes this attribute a function of something other than ` +
          'the profile id',
      );
    }
  }
  const children = ts.isJsxElement(returned) ? returned.children : [];
  const childText = children
    .map((c) => c.getText(sf).trim())
    .filter((t) => t !== '')
    .join('');
  if (childText !== `{${param}}`) {
    fail(
      `the chip's children are \`${childText}\`, expected exactly \`{${param}}\`. The chip's own ` +
        'text is the profile id and nothing else — a gloss rendered as a child is visible body ' +
        'copy, which is the loudest channel there is',
    );
  }
}

/**
 * No profile-id-shaped string in the component's source names an id outside the
 * advertisable seven.
 *
 * ROUND 11's B8, restored as a CLOSED check rather than the two-literal
 * denylist `f37ae31` removed. See `PROFILE_ID_SHAPE`.
 *
 * ── Why this belongs beside the rendered closed world, not instead of it ──
 *
 * The rendered closed world asks what is on the screen and is blind to a
 * coordinate no fixture visits. This asks what is in the file and is blind to
 * a string assembled at runtime. Neither subsumes the other, and round 11 got
 * through both gaps in the same round: `!capabilities` (a coordinate no
 * fixture visited) and a `max_search_limit > 500` gate (a field no fixture
 * varied) each carried a hand-written `'acdp-log-witness — …'` literal, which
 * this refuses without needing a fixture at all.
 *
 * ── Scope, stated narrowly ───────────────────────────────────────────
 *
 * String literals, no-substitution template literals, the literal SPANS of a
 * template with substitutions, AND `JsxText`.
 *
 * ROUND 15's B4: `JsxText` was not read, and the headline above says "in the
 * component's SOURCE". JSX text IS source and is not a string literal —
 * `<span className="metric-val">acdp-consumer advertised</span>` is a `JsxText`
 * node — so the one channel this file calls "the loudest there is" was the one
 * channel this walk did not visit. Measured: that row, behind an
 * `authority.length > 40` gate, left 975/975 green while the card named
 * `acdp-consumer` in visible body text, which is #95's stated harm exactly.
 *
 * Comments are exempt: this file's own docblocks name the forbidden ids
 * constantly, and so do the component's, and a guard that banned discussing the
 * problem would be uncomfortable enough to get deleted. That exemption is also
 * the residual: a comment cannot render, so nothing is lost, but a maintainer
 * who wants to smuggle a string past this can still assemble it from parts —
 * which is what the rendered closed world is for.
 */
export function assertNoForeignProfileId(source?: string): void {
  const sf = sourceFile(source);
  const allowed = new Set<string>(REGISTRY_ADVERTISABLE_PROFILES);
  let scanned = 0;

  const check = (text: string, where: ts.Node): void => {
    scanned += 1;
    for (const m of text.matchAll(profileIdMatcher())) {
      // Matched loosely, compared STRICTLY — see `PROFILE_ID_SHAPE`. An id that
      // differs only in case is not a valid id and is refused, because a string
      // that merely looks like one is what misleads the reader.
      if (!allowed.has(m[0])) {
        fail(
          `names the profile id \`${m[0]}\` in a string literal ` +
            `(\`${where.getText(sf).slice(0, 60)}\`). Only the seven advertisable ids may appear ` +
            'in this component\'s source. Copy naming an id no registry may advertise is #95, ' +
            'and four of round 11\'s five injections were exactly this: a hand-written sentence ' +
            'bound to a name, rendered from a coordinate no fixture visits',
        );
      }
    }
  };

  let jsxTexts = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node.text, node);
    } else if (ts.isTemplateExpression(node)) {
      check(node.head.text, node);
      for (const span of node.templateSpans) check(span.literal.text, node);
    } else if (ts.isJsxText(node)) {
      if (node.text.trim() !== '') {
        jsxTexts += 1;
        check(node.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ANTI-VACUITY, one pin per BRANCH of the walk rather than one for the walk.
  // A count over literals alone was satisfied by a file with no JSX at all, so
  // the `JsxText` arm added in round 15 could have been deleted the day after
  // it was written with this check still green. The component demonstrably has
  // both — every `className` is a literal, every metric label is JSX text.
  //
  // THE FLOORS ARE SET NEAR THE MEASUREMENT, NOT NEAR ZERO, and round 17's NB-1
  // is that "near the measurement" has to mean a measurement taken now rather
  // than a number typed in a previous round. `literalCensus` takes it; see its
  // docblock for why the census is a different descent from this walk, and for
  // what the two still share.
  const census = literalCensus(sourceFile());
  const expected = census.stringLiterals + census.templateParts + census.jsxTexts;
  if (scanned < vacuityFloor(expected)) {
    fail(
      `found only ${scanned} strings in the component — a token census of it finds ${expected}, ` +
        'so this walk is looking at the wrong nodes and is passing vacuously',
    );
  }
  if (jsxTexts < vacuityFloor(census.jsxTexts)) {
    fail(
      `found only ${jsxTexts} pieces of JSX text in the component — a token census of it finds ` +
        `${census.jsxTexts}, so this walk has stopped visiting them`,
    );
  }
}

/**
 * The strings the component may contain that are NOT copy: class names, style
 * values, the JSX runtime directive, and the one join separator.
 *
 * Enumerated rather than shaped, because there are twelve of them and they do
 * not change. A new class name is a one-line diff here and that is the correct
 * cost: every other string in this file is either an import specifier, a
 * profile id, a gloss, or a label, and each of those has its own pinned set.
 */
export const STRUCTURAL_LITERALS = [
  'use client',
  // `className` values.
  'card',
  'card-header',
  'card-body',
  'metric-row',
  'metric-name',
  'metric-val',
  'did',
  'chip',
  'chip ok',
  // Inline-style values.
  'flex',
  'flex-end',
  'center',
  'column',
  'wrap',
  'var(--text)',
  'var(--muted)',
  // `StatusDot` / `Badge` props — a tone and a variant, not sentences.
  'ok',
  'neutral',
  'complete',
  'pub',
  // The separator `Algorithms` joins its list with.
  ', ',
] as const;

/**
 * Small copy that is not a LABEL and so is not in `CARD_LABELS`: the em-dash
 * fallback and the two words the anonymous-reads flag renders as.
 */
export const INLINE_COPY_LITERALS = ['—', 'enabled', 'disabled'] as const;

/**
 * Every visible label `RegistryCard` may render as JSX TEXT.
 *
 * ROUND 15's B4 moved this here from `registry-card-profiles.test.tsx`, and the
 * move is the fix rather than tidying. `JsxText` is source, it is not a string
 * literal, and neither source walk visited it — so
 * `<span className="metric-val">acdp-consumer advertised</span>` behind an
 * `authority.length > 40` gate left 975/975 green while the card named an id no
 * registry may advertise, in visible body text, which is #95's stated harm.
 *
 * Licensing JSX text needs the label list, and the label list lived in the test
 * file, where `assertNoProseOutsideLabelTable` received it as a parameter. One
 * hand-written list in one place, used by the guard and pinned by the test, is
 * what stops a widening in one file from widening the other silently — round
 * 15 measured exactly that: adding two entries to the test's copy widened the
 * source walk AND the render walk in a single edit.
 *
 * Adding an entry is the review step. It should be a label a reviewer can point
 * to on the rendered card, not a sentence about a profile — and the test asserts
 * that shape (at most two words, and nothing that matches `PROFILE_ID_SHAPE`,
 * because `acdp-consumer advertised` is two words).
 */
export const CARD_LABELS = [
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
] as const;

/**
 * EVERY string literal in the file is in a pinned set.
 *
 * ── ROUND 13's B1 and B2, and why one guard closes both ──────────────
 *
 * Round 13's gate got unlicensed operator-facing prose onto the card twice,
 * each time behind a COORDINATE GATE, each time with 969/969 green and
 * typecheck clean:
 *
 *   const note = 'Consumer deployment profile (RFC-ACDP-0001 §9.1)';
 *   {registry.eventCount === 999 && <span className="metric-val">{note}</span>}
 *
 *   {capabilities?.limits.max_search_limit === 250 && (
 *     <input readOnly className="metric-val"
 *            value="Consumer deployment profile, not a registry (RFC-ACDP-0001)" />)}
 *
 * The first reaches JSX through an IDENTIFIER, so `assertNoProseOutsideLabelTable`
 * — which reads literals in child positions — never sees it. The second travels
 * through an ATTRIBUTE, which that walk explicitly does not cover, and `value`
 * is not on `assertNoAlternateDisclosureChannel`'s list. And BOTH are invisible
 * to the rendered closed world, because no fixture has `eventCount === 999` or
 * `max_search_limit === 250`.
 *
 * The docblocks claimed this was covered. `profile-copy-table.ts` said the
 * source walk's hole and the render walk's hole "are complementary"; the
 * component said an identifier, a call, a second `.map` and an `alt` "fail it
 * identically"; `NON_TEXT_ATTRS` said a maintainer "must EITHER license its
 * value from the fixture OR add its name here". All three were false, and there
 * was a third option none of them admitted: put it behind a coordinate.
 *
 * ── The answer is not another walk. It is to bound the SUPPLY ────────
 *
 * Both escapes need a string somewhere in the file, and there is no expression,
 * gate, attribute or indirection that gets around that — a sentence has to be
 * spelled somewhere. So this stops asking WHERE a string is used and asks
 * whether the string EXISTS. Every string literal and every piece of JSX text
 * must be in one of the pinned sets: the allow-listed import specifiers, the
 * seven advertisable ids, the seven hand-pinned glosses, `STRUCTURAL_LITERALS`,
 * `INLINE_COPY_LITERALS`, or `CARD_LABELS`.
 *
 * ROUND 15's N3: a table of set sizes stood here, summing to 43, under the
 * sentence "the file has 43 string literals". Those are different quantities —
 * the file has 68 string-literal NODES, 43 of them distinct, which is the same
 * number by coincidence — and the count in prose was read as the occurrence
 * count it was not. No table now; `npm test` measures it.
 *
 * ROUND 15's B4: `JsxText` was not read at all, and the claim directly above
 * ("a sentence has to be spelled somewhere") was false for the one node kind
 * that renders as body copy. It is read now, licensed against `CARD_LABELS`.
 *
 * A new sentence in this file is a red test whatever it is attached to,
 * whatever gates it, and whether or not any fixture reaches it — PROVIDED the
 * pinned sets are themselves bounded, which round 15's B1 found they were not:
 * `STRUCTURAL_LITERALS` had no pin and no shape rule, so a sentence added to it
 * licensed a sentence on the card. All six sets are now pinned exactly and
 * shape-bounded in `registry-card-profiles.test.tsx`.
 *
 * ── What it does NOT cover, stated so nobody over-reads it again ─────
 *
 * A string ASSEMBLED at runtime from licensed parts (`'acdp-' + 'consumer'`,
 * `.replace()`, `String.fromCharCode`). `assertNoRuntimeCopyForms` bounds some
 * of those forms and the rendered closed world catches any of them that a
 * fixture reaches, but an assembled string behind an unvisited coordinate is
 * genuinely out of reach of every layer here. It is also a great deal harder to
 * write by accident than a literal, and it cannot be written at all without
 * looking deliberate — which is the honest ceiling, not a closed world.
 *
 * Template literals with substitutions are refused outright rather than
 * analysed: the component has none, and the analysis of what a substitution can
 * yield is the runtime-assembly problem above.
 */
export function assertEveryStringLiteralIsLicensed(source?: string): void {
  const sf = sourceFile(source);
  const licensed = new Set<string>([
    ...Object.keys(ALLOWED_IMPORTS),
    ...REGISTRY_ADVERTISABLE_PROFILES,
    ...Object.values(PROFILE_GLOSS_TEXT),
    ...STRUCTURAL_LITERALS,
    ...INLINE_COPY_LITERALS,
    ...CARD_LABELS,
  ]);
  let scanned = 0;
  let jsxTexts = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      scanned += 1;
      if (!licensed.has(node.text)) {
        fail(
          `contains the unlicensed string ${JSON.stringify(node.text.slice(0, 80))}. Every string ` +
            'literal in this file must be an allow-listed import specifier, one of the seven ' +
            'advertisable profile ids, one of the seven pinned glosses, a card label, or a ' +
            'structural token — because a sentence has to be spelled somewhere, and round 13 put ' +
            'operator-facing prose on this card twice through an identifier and an ' +
            '`<input value>`, each behind a coordinate no fixture visits, with every other guard ' +
            'green',
        );
      }
    } else if (ts.isJsxText(node)) {
      // ROUND 15's B4. JSX text is not a string literal, and it is the channel
      // this file calls the loudest there is.
      const text = node.text.trim();
      if (text !== '') {
        jsxTexts += 1;
        if (!licensed.has(text)) {
          fail(
            `renders the unlicensed JSX text ${JSON.stringify(text.slice(0, 80))}. JSX text is ` +
              'body copy — the loudest channel this card has — and it is not a string literal, ' +
              'which is why no source walk here read it until round 15 measured ' +
              '`acdp-consumer advertised` onto the card with 975/975 green',
          );
        }
      }
    } else if (ts.isTemplateExpression(node)) {
      fail(
        `contains a template literal with substitutions (\`${node.getText(sf).slice(0, 60)}\`). ` +
          'This component has none, and what a substitution can yield is exactly the ' +
          'runtime-assembly problem no walk here can bound',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ANTI-VACUITY, one floor per BRANCH, and each has to be a real floor rather
  // than `> 0`. Four of the literals are import specifiers that any version of
  // this file would carry, so a walk that found only those would pass on a file
  // with every other string deleted.
  //
  // ROUND 15's N3: the floor was 20 against a measured 68, so two-thirds of the
  // file's literals could go missing with this green. ROUND 17's NB-1: the 60
  // it was raised to was still a number typed into the source, and the prose
  // beside it ("around seventy", "ten labels") was a claim no test checked. The
  // census is taken now, by a descent that shares no code with this walk.
  const census = literalCensus(sourceFile());
  if (scanned < vacuityFloor(census.stringLiterals)) {
    fail(
      `found only ${scanned} string literals — a token census of this file finds ` +
        `${census.stringLiterals}, so this walk is looking at the wrong nodes and is passing ` +
        'vacuously',
    );
  }
  if (jsxTexts < vacuityFloor(census.jsxTexts)) {
    fail(
      `found only ${jsxTexts} pieces of JSX text — a token census of this file finds ` +
        `${census.jsxTexts}, so the JsxText arm of this walk has stopped visiting them`,
    );
  }
}

/**
 * Every STRING LITERAL in a JSX child position, and every `JsxText`, must be in
 * the pinned label list.
 *
 * READ THAT HEADLINE CAREFULLY, because it used to say "every piece of PROSE
 * the card can render" and that is not what this does. The difference is the
 * whole of round 9's first blocking finding, and it is stated first rather than
 * buried in a limits section, because the over-claim is what got the gap
 * accepted.
 *
 * ── The hole this closes ─────────────────────────────────────────────
 *
 * The render probes read `container.querySelectorAll('.chip')` and then only
 * that element's attributes and text. Text rendered anywhere ELSE in the card
 * was invisible to every layer of this file: `assertNoCopyOutsideTable` walks
 * object literals, `assertNoAlternateDisclosureChannel` covers `aria-*`,
 * `data-*` and `dangerouslySetInnerHTML`, and `assertGlossChokePoint` counts
 * `title` attributes. None of them reads a text node.
 *
 * So a `<div className="metric-row">` added beside Max payload, carrying a
 * gloss for `acdp-log-witness`, passed every gate — UNCONDITIONALLY, with the
 * full suite green, lint clean and tsc clean. That is #95's exact harm through
 * the loudest channel there is: `assertNoAlternateDisclosureChannel`'s own
 * docblock argues an `aria-label` is worse than a `title` because it is
 * announced, and visible body text is louder than both.
 *
 * The only thing standing in the way was two literal
 * `textContent).not.toContain('acdp-consumer' | 'acdp-federated')` assertions
 * on one fixture — two strings, where the branch's own reasoning says
 * `acdp-log-witness` is upstream's most likely mistake.
 *
 * ── Why source-level and not a render assertion ──────────────────────
 *
 * Because a render assertion is only as good as its fixtures, and the same
 * round proved prose gated on `registry.lastSeen` never renders under any
 * fixture this suite has. Reading the SOURCE makes fixture coverage irrelevant
 * FOR THE STRINGS IT READS.
 *
 * ── What it does NOT cover, corrected ────────────────────────────────
 *
 * 1. ANY STRING THAT REACHES THE SCREEN THROUGH AN IDENTIFIER OR A CALL. This
 *    walk collects `ts.isStringLiteral` and `ts.isNoSubstitutionTemplateLiteral`
 *    nodes that sit syntactically in a JSX child position, plus `JsxText`. That
 *    is all. Round 9's gate went through it twice, `tsc`-clean, `eslint`-clean,
 *    whole suite green:
 *
 *      const WITNESS_NOTE = 'acdp-log-witness — …';
 *      …
 *      <span className="metric-val">{WITNESS_NOTE}</span>
 *
 *      function witnessNote(): string { return 'acdp-log-witness — …'; }
 *      …
 *      <Badge variant="neutral">{witnessNote()}</Badge>
 *
 *    The previous version of this section named only attribute values, and the
 *    headline said "every piece of prose". A reviewer reading either concludes
 *    the card's rendered text is bounded here. It is not.
 *
 *    That direction is closed by the RENDERED closed world in
 *    `registry-card-profiles.test.tsx` ("the rendered card is a closed world
 *    over its fixture"), which asks only what is on the screen and never how it
 *    got there — so an identifier, a call, a second `.map` and a `Proxy` all
 *    fail it identically. This guard is kept because that one bounds only what
 *    a FIXTURE can reach, and the two holes are complementary.
 *
 * 2. Attribute values, which is deliberate — `className`, `style`, `tone`,
 *    `variant` and the rest are not prose, and an allow-list over them went red
 *    on legitimate props of `StatusDot` and `Badge` and had to be narrowed. The
 *    disclosure channels among them (`title`, `aria-*`, `data-*`, `alt`) have
 *    their own guards above, and the rendered closed world reads them all.
 *
 * 3. The gloss table's VALUES; those are `profileCopyTable()`'s subject.
 */
export function assertNoProseOutsideLabelTable(allowed: readonly string[], source?: string): void {
  const sf = sourceFile(source);
  const permitted = new Set(allowed);
  const seen = new Set<string>();

  const check = (text: string, node: ts.Node): void => {
    const t = text.trim();
    if (t === '') return;
    seen.add(t);
    if (!permitted.has(t)) {
      fail(
        `renders the prose \`${t.slice(0, 70)}\`, which is not in the pinned label list. ` +
          'Every visible string this card can show is enumerated in that list so that copy ' +
          'cannot be added to a region no probe reads — an unconditional text row naming ' +
          '`acdp-log-witness` passed every other guard in this file. Add it to the list only ' +
          `after arguing it belongs on screen. (at ${ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line + 1})`,
      );
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) check(node.text, node);

    // A string in a CHILD position: `{'...'}`, `{cond ? 'a' : 'b'}`, `{x ?? '—'}`.
    // Attribute initialisers are excluded by construction — a JsxExpression
    // inside a JsxAttribute has that attribute as its parent.
    if (ts.isJsxExpression(node) && node.parent && !ts.isJsxAttribute(node.parent)) {
      const literals: ts.Node[] = [];
      const collect = (n: ts.Node): void => {
        // Do NOT descend into nested JSX or into attributes. `{capabilities &&
        // (<>…</>)}` is a JsxExpression whose subtree contains every attribute
        // of every element inside it, so a naive recursive walk reported
        // `className="metric-row"` as prose. The nested elements' own text and
        // expressions are reached by the outer `visit`; attribute values are
        // deliberately out of scope (see this function's docblock).
        if (
          ts.isJsxElement(n) ||
          ts.isJsxSelfClosingElement(n) ||
          ts.isJsxFragment(n) ||
          ts.isJsxAttributes(n)
        ) {
          return;
        }
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.push(n);
        if (ts.isTemplateExpression(n)) {
          // Fail closed. A template with substitutions cannot be read
          // statically, so it could carry anything at runtime.
          fail(
            `renders a template literal with substitutions as a child ` +
              `(\`${n.getText(sf).slice(0, 60)}\`) — its text cannot be read from here`,
          );
        }
        ts.forEachChild(n, collect);
      };
      collect(node);
      for (const l of literals) check((l as ts.StringLiteral).text, l);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // ANTI-VACUITY. A component that rendered no prose at all — or a walker that
  // stopped finding any — would satisfy every assertion above by finding
  // nothing to check. The card demonstrably shows these.
  //
  // FOUR BRANCHES, FOUR REQUIRED STRINGS, and that is the round-10 correction.
  // The first three are `JsxText`, all reached by the same branch. The walk has
  // a SECOND branch — the JSX-child string literals — and no required string
  // reached it, so disabling that branch entirely (`if (false && ts.isJsx…)`)
  // left the trio satisfied and the whole suite green while half the guard was
  // dead. `'—'` and `'enabled'` are literals in child positions and nothing
  // else: they are the branch's witnesses.
  //
  // The rule this encodes: an anti-vacuity pin must name a string per BRANCH of
  // the walk, not per guard. A pin that only exercises the branch that happens
  // to run first certifies the wrong thing.
  for (const required of ['Event count', 'Profiles', 'Base URL', '—', 'enabled']) {
    if (!seen.has(required)) {
      fail(
        `the prose walk did not find the label \`${required}\`, which the card definitely ` +
          'renders — so this guard is looking at the wrong nodes and is passing vacuously',
      );
    }
  }
}

/**
 * The `ADVERTISABLE_PROFILE_IDS` literal as the component declares it, so the
 * test can assert it against the shared mirror under `test/support/`.
 *
 * The component cannot import that mirror (production code must not depend on
 * the test tree), so there are genuinely two copies of the list; this is what
 * stops them drifting.
 */
export function advertisableIdsInComponent(source?: string): string[] {
  const sf = sourceFile(source);
  let ids: string[] | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'ADVERTISABLE_PROFILE_IDS') {
      const init = node.initializer;
      const arr =
        init && ts.isAsExpression(init) && ts.isArrayLiteralExpression(init.expression)
          ? init.expression
          : init && ts.isArrayLiteralExpression(init)
            ? init
            : undefined;
      if (!arr) fail('ADVERTISABLE_PROFILE_IDS is not an array literal');
      if (ids) fail('ADVERTISABLE_PROFILE_IDS is declared twice');
      ids = arr.elements.map((e) => {
        if (!ts.isStringLiteral(e)) fail(`ADVERTISABLE_PROFILE_IDS contains a non-literal \`${e.getText(sf)}\``);
        return e.text;
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!ids) fail('no ADVERTISABLE_PROFILE_IDS declaration found — the guard lost its subject');
  return ids;
}

/**
 * The bounds `profileCopyTable()` runs before it will vouch for the table.
 *
 * ROUND 13 CORRECTION — THE COUNTS IN THESE DOCBLOCKS HAD DRIFTED, THREE WAYS.
 * This one said "once the other THREE have refused"; the comment inside
 * `profileCopyTable` said "SIX statements cannot"; and the test file said "six
 * of the eight" — three different numbers for one set, none of them current.
 * That is the same defect the header of this file was written to record ("five
 * separate restatements had drifted to five different numbers"), one level up,
 * in the file doing the recording. Round 14 then added a ninth guard and this
 * correction's own replacement count went stale inside one commit, which is the
 * argument for the rule below rather than for a more careful number.
 *
 * So no number is written here any more. `RUN_ON_READ.length` and
 * `Object.keys(GUARDS).length` are what the tests assert against, and a reader
 * who wants a count reads the array.
 *
 * `assertGlossIsPureOfId` and `assertNoProseOutsideLabelTable` are the two that
 * are deliberately NOT here: the first is about the chip callback's shape and
 * the second takes the label list as a parameter, so neither is a precondition
 * for trusting the copy table's contents. Both are exercised by the test file's
 * `GUARDS` table instead.
 */
export const RUN_ON_READ = [
  assertModuleShape,
  assertComponentBodyIsOneReturn,
  assertNoCopyOutsideTable,
  assertNoRuntimeCopyForms,
  assertNoAlternateDisclosureChannel,
  assertGlossChokePoint,
  assertGlossIsGated,
  assertNoForeignProfileId,
  assertEveryStringLiteralIsLicensed,
] as const;

/**
 * The profile-copy entries, as `id -> title`.
 *
 * Fails closed: a spread, a computed key, an accessor, a shorthand, a
 * non-string key or a non-string `title` throws rather than being skipped.
 */
export function profileCopyTable(source?: string): { entries: Map<string, string>; tables: number } {
  // Iterated rather than called one by one, and EXPORTED, because round 11
  // found that dropping two of these call sites was a silent, green edit —
  // `mock-data.test.ts` reads this table for the data half of #95 and would
  // quietly have lost those bounds. A list can be asserted non-empty and
  // asserted to contain each guard; a run of bare statements cannot.
  //
  // `source` is the same self-test seam `sourceFile` documents, and it is passed
  // THROUGH to the guards on purpose: a subject that reaches this reader's own
  // refusals has to satisfy all eight of them first, which is what makes those
  // refusals reachable at all (round 13's B4 — see `componentSource`).
  for (const guard of RUN_ON_READ) guard(source);
  const sf = sourceFile(source);
  const table = copyTableNode(sf);
  const entries = new Map<string, string>();

  for (const prop of table.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      fail(`copy table contains ${ts.SyntaxKind[prop.kind]}, which this reader cannot vouch for`);
    }
    if (!ts.isStringLiteral(prop.name)) {
      fail(`copy-table key \`${prop.name.getText(sf)}\` is not a string literal`);
    }
    if (!ts.isObjectLiteralExpression(prop.initializer)) {
      fail(`entry \`${prop.name.text}\` is not an object literal`);
    }
    const title = prop.initializer.properties.find(
      (q) => ts.isPropertyAssignment(q) && q.name.getText(sf).replace(/^['"]|['"]$/g, '') === 'title',
    );
    if (!title || !ts.isPropertyAssignment(title) || !ts.isStringLiteral(title.initializer)) {
      fail(`entry \`${prop.name.text}\` has no string-literal \`title\``);
    }
    if (entries.has(prop.name.text)) {
      fail(`id \`${prop.name.text}\` appears twice — a later entry would shadow an earlier one`);
    }
    entries.set(prop.name.text, title.initializer.text);
  }

  // `copyTableNode` has already refused a second initializer, so this is 1 by
  // construction. Returned anyway: `mock-data.test.ts` asserts on it, and an
  // assertion that cannot currently fail is cheaper than one that is missing
  // when the construction changes.
  return { entries, tables: 1 };
}

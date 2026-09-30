/**
 * THE CHANNEL NO DOM WALK AND NO SOURCE WALK CAN SEE: `content:`.
 *
 * Both halves of the profile-copy gate (#95) bound what the card may say by
 * asking two questions — what the rendered DOM contains, and what the
 * component's own source spells. A CSS rule answers neither.
 * `.chip::after { content: ' (see acdp-consumer)'; }` puts words on the screen
 * that
 *
 *   - the source walks cannot see, because they are not in the component; and
 *   - the DOM walks cannot see, because `textContent` never includes generated
 *     content in any browser, and jsdom does not compute it at all.
 *
 * So the closed worlds are closed over the wrong universe unless the
 * stylesheets are bounded too.
 *
 * ── ROUND 15's B5: THE PREMISE WAS PROSE ─────────────────────────────
 *
 * The first version of this module read one hardcoded path, `app/globals.css`,
 * under a docblock asserting "there is exactly one stylesheet in this app".
 * Nothing measured that antecedent. Measured by the round-15 gate: a new
 * `app/profile-chips.css` containing the rule above, imported from
 * `app/layout.tsx` beside the existing import, left 975/975 green while every
 * profile chip on every registry card read `acdp-registry-core (see
 * acdp-consumer)` in a real browser.
 *
 * A guard that bounds one member of a set it does not enumerate bounds
 * nothing. So nothing here is hardcoded: `stylesheetPaths()` ENUMERATES every
 * `.css` file in the repository, and the caller pins the membership as well as
 * every member's contents. A second stylesheet is then a red test whether or
 * not the next author remembers this file exists.
 *
 * ── HOW CSS CAN CHANGE WHAT THE CARD SAYS ────────────────────────────
 *
 * Two directions, and for two rounds this module only knew about one.
 *
 * ADDING text:
 *
 *   1. A `content:` declaration in a stylesheet in this repository.
 *      → `stylesheetPaths()` + `contentDeclarations()`, and the rule is
 *        "every declaration is empty", not "every declaration is on a list":
 *        an allow-list of permitted strings is an open set, and the two
 *        declarations this app actually has are both `''` — decorative
 *        `::before`/`::after` boxes. A rule that genuinely needs text is a
 *        design change with a reviewer, which is the point.
 *   2. A stylesheet that is NOT in this repository, pulled in by an import
 *      resolving into `node_modules`. This is not hypothetical and the first
 *      run of the enumeration found it: `components/runs/lineage-dag.tsx`
 *      imports `@xyflow/react/dist/style.css`, 625 lines of vendor CSS that
 *      the repository walk in (1) cannot see. So the specifiers are
 *      enumerated by `cssImportSpecifiers()`, the caller pins that set, and
 *      `loadedStylesheets()` RESOLVES and READS each one — a vendor sheet is
 *      scanned by the same emptiness rule as our own rather than trusted.
 *   3. A stylesheet reached by `@import` from another stylesheet, which no
 *      import scan of the TypeScript sources can see.
 *      → `cssAtImports()`, pinned empty.
 *   4. A `<style>` element rendered by a component (including styled-jsx), by
 *      any spelling: the literal tag, a tag name bound to `'style'`, or
 *      `createElement('style', …)`.
 *      → `htmlInjectionSites()` AND `styleElementAstSites()`, which fail
 *        differently on purpose — see below.
 *   5. `dangerouslySetInnerHTML`.
 *      → `htmlInjectionSites()`. `assertNoAlternateDisclosureChannel` already
 *        refuses this one inside `registry-card.tsx`; this refuses it anywhere
 *        in the compiled source, because an ancestor of the card can inject
 *        into the card's subtree just as effectively.
 *
 * REMOVING text — round 17's BL-6, and the direction this module spent two
 * rounds not having:
 *
 *   6. Any rule that hides, shrinks, clips or blanks what the card renders.
 *      `@media (max-width: 640px) { .metric-row .chip { display: none; } }`
 *      appended to `app/globals.css` was 977/977 green and took every profile
 *      id off every registry card at phone width.
 *      → `cssRules()` plus the DOM. A denylist of suppressing PROPERTIES would
 *        be the open-set mistake this file has now made six times — `display`,
 *        `visibility`, `opacity`, `font-size: 0`, `clip-path`, `color:
 *        transparent`, `content-visibility`, `transform: scale(0)` — so the
 *        set of applicable rules is bounded instead of the set of ways to
 *        write one. Round 18 bounded that set by matching selector TEXT
 *        against the classes the card paints, and round 19 walked past it
 *        twice: `.grid-2 > div > div > div` (a class of the PAGE) and
 *        `div[class*="metric"]` (no class token at all) each took every metric
 *        row off every card at phone width, 977/977 green. "Rules that mention
 *        a class the card renders" is a proper subset of "rules that apply to
 *        the card". So `applicableRules()` asks a selector ENGINE, and a
 *        selector the engine cannot evaluate is RETURNED rather than skipped.
 *
 *        ROUND 21's BL-1 CORRECTION. This used to end "against the card
 *        rendered inside the page ancestry it ships in", and the engine was
 *        never the weak part. What it was asked ABOUT was a two-element probe,
 *        `.page > .grid-2 > .card`, while the shipped ancestry is `html > body
 *        > .shell > .content > .page > .grid-2`. Four rules walked through the
 *        difference at 979/979 green: `.content .metric-row .chip`, `.shell
 *        .chip`, `.grid-2 > .card:nth-child(2) .chip` (which needs a SECOND
 *        card) and `:root { --muted: transparent }` (which needs `html` in the
 *        element universe). The chain is derived from the four files that
 *        build it now — {@link jsxAncestry} — the probe is constructed FROM
 *        that derivation, and the universe is `document.documentElement`.
 *
 * ── WHAT ACTUALLY BOUNDS THE CHANNEL ─────────────────────────────────
 *
 * The list above is a map of the channels somebody has thought of, and for
 * four rounds it was read as a closed enumeration under a residual paragraph
 * saying the only thing left was "outside this repository". Round 19's BL-7
 * falsified that with three lines in a file this module already walks:
 * `new CSSStyleSheet()` + `sheet.replaceSync(…)` + `document.adoptedStyleSheets
 * = […]` was 977/977 green and reaches every chip on every card in a real
 * browser. So the bound is stated separately from the list, in terms of the
 * three things a CSS write cannot do without:
 *
 *   TEXT — a `.css` file, whether this repository holds it or a dependency
 *   does. `stylesheetUniverse()` is the union of what the repository HOLDS and
 *   what the app LOADS, every member parsed and scanned.
 *
 *   AN ELEMENT — a `<style>` element, and it has to be MOUNTED to style
 *   anything. `styleStringLiteralSites()` looks for the string `'style'`,
 *   `styleElementSpellings()` resolves the tag and `htmlInjectionSites()`
 *   scans the text; all three are pinned. ROUND 21's NB-4 CORRECTION: this
 *   used to say a style element "cannot be created without the string
 *   `'style'` appearing", and `const CSS_TAG = ['sty','le'].join('')` in
 *   `app/layout.tsx` creates one that none of the three can see. The
 *   measurement is therefore on the RENDERED TREE — `document.querySelectorAll
 *   ('style, link[rel~=stylesheet]')` over the mounted probe — and the three
 *   source scanners corroborate it instead of standing in for it.
 *
 *   A HANDLE ON THE DOCUMENT — `document.adoptedStyleSheets`,
 *   `document.styleSheets[0].insertRule`, `document.head.appendChild`. A
 *   `CSSStyleSheet` constructed and never adopted styles nothing.
 *   `domHandleSites()` reports every value transitively derived from
 *   `document`, `window`, `globalThis`, `self`, `top` or `frames`, per file,
 *   as the dotted path it was reached BY. ROUND 21's BL-2 CORRECTION: this
 *   used to say it "pins every member name this repository reads off
 *   `document`, `window` or `globalThis`", and what it actually matched was
 *   one SPELLING — `ts.isPropertyAccessExpression(node) && ts.isIdentifier
 *   (node.expression)`. `const { document: doc } = window; doc.adoptedStyleSheets`
 *   was 979/979 green where the identical injection spelled `document.
 *   adoptedStyleSheets` was 1 red. The resolver lives in
 *   `test/support/ts-reads.ts` and is shared with `capabilityReads`, which had
 *   resolved these forms since round 19.
 *
 * The residual, drawn where it can be checked rather than assumed: an element
 * handle that came from neither a browser global nor a tag name — a React
 * `ref`. So `domHandleSites()` pins `useRef` call sites too, and what is
 * genuinely left is a handle obtained some third way, of which this codebase
 * has none today.
 * Outside the repository entirely — a browser extension, an edge worker, a
 * `<link>` added by the host — remains beyond any test process, and that part
 * of the old sentence was the only part that was true.
 *
 * ── TEXT SCANS AND AST WALKS, AND WHY BOTH ───────────────────────────
 *
 * This module used to argue for text scanning OVER AST walking, on the grounds
 * that "an element's tag name is a fixed string, so a substring scan cannot
 * miss one by failing to recurse" — and it named `createElement('style', …)`
 * as a construct an AST walk would have to enumerate. Round 17's BL-4
 * falsified the argument using the very construct it named, plus a second: a
 * JSX tag name is an IDENTIFIER, so `const Tag = 'style'` then `<Tag>{css}</Tag>`
 * in `app/layout.tsx` was 977/977 green.
 *
 * The lesson is not that AST walks win. It is that a tag name is a fixed
 * string only where somebody wrote it as one, and both mechanisms have a blind
 * spot the other does not:
 *
 *   - a text scan cannot miss a literal `<style>` by failing to recurse, and
 *     cannot see one reached through a binding;
 *   - an AST walk resolves the binding, and misses any node kind it does not
 *     visit.
 *
 * So both run, over the same files, and the caller pins both results empty.
 *
 * The closed side underneath them is that the string `'style'` has to be
 * written somewhere for any spelling to work — and for two rounds that
 * sentence stood here as an ARGUMENT while nothing in the file looked for the
 * string. Round 19's BL-5 walked through the gap between the two:
 * `import { createElement as ce }` then `ce('style', …)` was 977/977 green,
 * because the AST half matches an enumeration of CALLEE NAMES. The sentence is
 * now implemented, by `styleStringLiteralSites()`, and is a third half rather
 * than a justification for the other two.
 *
 * The cost of a text scan is prose: two files in `components/` name
 * `dangerouslySetInnerHTML` in a comment saying they do not use it, and
 * refusing those would be a false alarm that teaches the next author to widen
 * the scan. Hence the trailing `=` or `:` — the syntax that makes it a prop
 * rather than a word — which is asserted as a case below rather than trusted as
 * a comment.
 *
 * ── PARSING, NOT PATTERN-MATCHING ────────────────────────────────────
 *
 * Every CSS scanner here reads `normalizeCss()`'s output, not the file.
 *
 * Round 17's BL-3 was case: CSS Syntax L3 makes property and at-rule names
 * ASCII case-insensitive, every regex here was case-sensitive, and
 * `.chip::after { CONTENT: ' (see acdp-consumer)'; }` was 977/977 green.
 * Round 18 answered it with `i` flags plus a tokenising second count, and
 * wrote that the tokeniser reads "the parser's own model of what a declaration
 * is". Round 19's BL-6 falsified that in one character: ident tokens admit
 * ESCAPES, `\63 ontent` lower-cases to itself, `lightningcss` — the engine
 * Next 16 compiles this app with — accepts all three escape forms and
 * normalises every one of them to `content:`, and a `;{}` split cannot see any
 * of them. Two derivations with a NEW shared blind spot agree loudest exactly
 * where they are both wrong.
 *
 * So the compiler runs first, and case, escapes, comments, whitespace,
 * nesting, `@layer`/`@supports`/`@media` syntax and vendor shorthand all stop
 * being cases for a scanner to handle. The two `content` derivations still
 * differ in METHOD — one matches, one tokenises — and they now share one
 * dependency whose failure mode is a throw rather than a silent miss.
 *
 * `justify-content` is the trap in the other direction: the stylesheet has
 * eight of those and two real `content:` declarations, a scanner that confuses
 * them reports eight failures with values like `center`, and one that
 * over-corrects finds none and passes vacuously. Both directions, both cases
 * and all three escape spellings are asserted where this is used.
 */
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { transform } from 'lightningcss';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalReaches } from './ts-reads';

/** Anchored to this file, not to the runner's working directory. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Directories whose contents cannot reach a browser: dependencies, VCS
 * metadata, build output, coverage reports, and this session's gitignored
 * scratch directories. Everything else in the repository is walked.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'out',
  'dist',
  'build',
  '.vercel',
  '.turbo',
  'coverage',
  'temp',
  'scratchpad',
  'plans',
]);

/**
 * Source directories that are compiled into the app.
 *
 * ROUND 19's NB-1. This was exported with a docblock and read by no test, so
 * narrowing it to `['app', 'components']` was 115/115 green — round 17's BL-2c
 * verbatim ("a licensing list that no test reads is not a bound, whatever its
 * docblock says"), left standing in this module while the sibling module fixed
 * it. It is pinned where this is used, and `assertScanCoversCompiledSources()`
 * below checks it against `tsconfig.json` rather than against a memory.
 */
export const RENDERED_DIRS: readonly string[] = ['app', 'components', 'lib'];

/**
 * The file extensions the compiler is configured to compile, read off
 * `tsconfig.json`'s own `include` and `allowJs`.
 *
 * ROUND 19's NB-2. The walk filtered on `.ts`/`.tsx` under a docblock claiming
 * "anywhere in the compiled source", while `tsconfig.json`'s `include` has
 * listed `**\/*.mts` all along: `app/injector.mts` containing the UNALIASED
 * `createElement('style', …)` — the exact spelling the AST half exists to
 * catch — was typecheck-clean and 115/115 green, because the file was never
 * opened. A `.jsx` variant was red, but by `tsc`'s `allowJs: false`, not by
 * this gate, so flipping one compiler option would have opened it silently.
 *
 * Derived rather than listed, so neither can drift: a new `**\/*.<ext>` in
 * `include`, or `allowJs` turning on, widens the walk in the same commit.
 */
export function compiledExtensions(): string[] {
  const cfg = JSON.parse(
    readFileSync(join(REPO_ROOT, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  ) as { include?: string[]; compilerOptions?: { allowJs?: boolean } };
  const out = new Set<string>();
  for (const pattern of cfg.include ?? []) {
    const m = /\*\*\/\*(\.[A-Za-z]+)$/.exec(pattern);
    if (m) out.add(m[1]);
  }
  // `allowJs` is not an extension in `include`, it is a switch that makes four
  // more extensions compile under the SAME `**\/*.ts`-shaped patterns. It is
  // read here rather than assumed because `allowJs: false` is currently doing
  // work this gate is credited with.
  if (cfg.compilerOptions?.allowJs) for (const e of ['.js', '.jsx', '.mjs', '.cjs']) out.add(e);
  return [...out].sort();
}

function walk(dir: string, out: string[], pick: (name: string) => boolean): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, pick);
    else if (entry.isFile() && pick(entry.name)) out.push(relative(REPO_ROOT, full));
  }
}

/** Every stylesheet in the repository, as repo-relative POSIX paths, sorted. */
export function stylesheetPaths(): string[] {
  const out: string[] = [];
  walk(REPO_ROOT, out, (name) => name.endsWith('.css'));
  return out.map((p) => p.split('\\').join('/')).sort();
}

/**
 * Every compiled source file: {@link RENDERED_DIRS} plus the repository ROOT's
 * own modules.
 *
 * ROUND 17's NB-3. The claim here was "anywhere in the compiled source", and
 * the walk covered three directories — so `middleware.ts` and `next.config.ts`,
 * which are compiled into the app and sit at the root, were scanned by neither
 * the injection walk nor the CSS-import walk. No render path from either into
 * the card's subtree was found, so nothing was measured through it; the
 * sentence was still stronger than the code, which is the half this branch
 * treats as the more dangerous one. Root files are walked now and the sentence
 * is true.
 */
export function renderedSourcePaths(): string[] {
  const exts = compiledExtensions();
  const pick = (n: string): boolean => exts.some((e) => n.endsWith(e));
  const out: string[] = [];
  for (const dir of RENDERED_DIRS) walk(join(REPO_ROOT, dir), out, pick);
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && pick(entry.name)) out.push(entry.name);
  }
  return out.map((p) => p.split('\\').join('/')).sort();
}

/**
 * Every compiled source file that is NOT walked, so the gap is a number rather
 * than a belief.
 *
 * `renderedSourcePaths()` walks three directories plus the repository root.
 * `tsconfig.json` compiles `**\/*.ts`, `**\/*.tsx` and `**\/*.mts` ANYWHERE,
 * and a source file that is compiled but not scanned is exactly the shape of
 * round 19's NB-2. This lists them so the caller can pin the set — `test/`,
 * `scripts/` and the config files are compiled and cannot render into the
 * browser, which is a claim worth writing down once and checking, rather than
 * one worth assuming every round.
 */
export function unscannedCompiledPaths(): string[] {
  const scanned = new Set(renderedSourcePaths());
  const exts = compiledExtensions();
  const all: string[] = [];
  walk(REPO_ROOT, all, (n) => exts.some((e) => n.endsWith(e)));
  return all
    .map((p) => p.split('\\').join('/'))
    .filter((p) => !scanned.has(p))
    .sort();
}

export function repoFileSource(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/**
 * The stylesheet as the BROWSER sees it, not as the file spells it.
 *
 * ── ROUND 19's BL-6: A TOKENISER IS NOT A PARSER ─────────────────────
 *
 * Round 17's BL-3 was case — `CONTENT:` was 977/977 green because every regex
 * here was case-sensitive. Round 18 answered it with `i` flags plus a second
 * count that split on `;{}` and lower-cased the property name, and wrote that
 * this reads "the parser's own model of what a declaration is".
 *
 * It does not, and round 19 falsified it in one character. CSS Syntax L3 ident
 * tokens admit escapes: `\63 ontent`, `con\74 ent` and `\0063ontent` are all
 * `content`, all three are ACCEPTED by `lightningcss` — the engine Next 16
 * compiles this app with — and all three are normalised by it to `content:`.
 * `.grid-2 > div::after { \63 ontent: ' (see acdp-consumer)'; }` was 977/977
 * green. A `;{}` split with `.toLowerCase()` cannot see any of them, and
 * neither can a regex, because the blind spot is in the tokenizer both share.
 *
 * So the compiler runs first. Case, escapes, comments, whitespace, nesting,
 * `@layer`/`@supports`/`@media` syntax and vendor shorthand all stop being
 * cases for a scanner to handle, because they have already been resolved by
 * the thing that will resolve them in production.
 *
 * A sheet that does not parse THROWS. An unparseable stylesheet is the one
 * case where silence would be indistinguishable from a clean scan.
 */
export function normalizeCss(css: string, label = 'stylesheet'): string {
  try {
    // `errorRecovery` is deliberately OFF: a sheet lightningcss cannot parse
    // must throw, not be silently half-read. Silence is the one failure mode
    // indistinguishable from a clean scan.
    const { code } = transform({ filename: label, code: Buffer.from(css, 'utf8'), minify: false });
    return Buffer.from(code).toString('utf8');
  } catch (err) {
    throw new Error(
      `the stylesheet \`${label}\` could not be parsed by lightningcss (${String(err)}); ` +
        'it reaches the browser, so it must be scanned as the browser will read it, not skipped',
    );
  }
}

/**
 * Every rule in a stylesheet, selector and declaration block, after
 * normalisation. `@media`/`@supports`/`@layer` wrappers are stepped through:
 * an inner rule is a rule, and the wrapper is a condition on WHEN, which is
 * not a reason to stop looking at WHAT.
 */
export function cssRules(css: string, label = 'stylesheet'): { selector: string; block: string }[] {
  const stripped = normalizeCss(css, label);
  const out: { selector: string; block: string }[] = [];
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    out.push({ selector, block: m[2].trim().replace(/\s+/g, ' ') });
  }
  return out;
}

/**
 * A selector reduced to something `Element.matches()` will accept.
 *
 * Pseudo-ELEMENTS (`::after`, `:after`, `::first-line`) are not matchable and
 * are not the point: a rule on `.chip::after` applies to `.chip`, and whether
 * the generated box exists is the rule's business, not the selector's.
 * Pseudo-CLASSES that depend on state jsdom does not have (`:hover`,
 * `:focus-visible`, `:active`) are dropped for the same reason — a hover rule
 * still applies to the element, and refusing to see it would be the more
 * dangerous direction.
 */
export const UNMATCHABLE_PSEUDOS =
  /::?(after|before|first-line|first-letter|selection|backdrop|placeholder|marker|hover|focus|focus-visible|focus-within|active|visited|target|-[a-z-]+)\b(\([^)]*\))?/gi;

export function matchableSelector(selector: string): string {
  return selector.replace(UNMATCHABLE_PSEUDOS, '').trim() || '*';
}

/**
 * Every `content:` declaration's value in the given CSS, as written.
 *
 * The preceding character must not be a letter or `-`, which is what separates
 * `content:` from `justify-content:` and from any future `*-content` property.
 */
export function contentDeclarations(css: string, label = 'stylesheet'): string[] {
  const out: string[] = [];
  for (const m of normalizeCss(css, label).matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/gi)) {
    out.push(m[2].trim());
  }
  return out;
}

/**
 * Every `content:` declaration WITH the selector that owns it.
 *
 * ── ROUND 15's N1: THE EMPTINESS RULE WAS THE ONLY LAYER ─────────────
 *
 * The gate replaced the caller's `expect(value).toMatch(/^(''|"")$/)` with
 * `expect(typeof value).toBe('string')` and the suite stayed green. That is the
 * base case — an assertion cannot guard its own deletion — and everywhere else
 * in this gate the answer has been to put a SECOND, independent half on the
 * same channel so that neither deletion opens it alone.
 *
 * This is that half, and it is independent in the way that matters: it is a
 * PIN on the exact set of rules, so it fails on a declaration being ADDED,
 * MOVED to a different selector, or given text, without reading the value's
 * shape at all. The emptiness rule fails on a value being given text wherever
 * it sits, without reading the selector. Gutting either leaves the other
 * standing on the escape round 15 measured (`.chip::after { content: ' (see
 * acdp-consumer)'; }`), which is what "no longer the only layer" means here.
 */
export function contentRules(css: string, label = 'stylesheet'): { selector: string; value: string }[] {
  css = normalizeCss(css, label);
  const out: { selector: string; value: string }[] = [];
  for (const m of css.matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/gi)) {
    // The nearest `{` before the declaration opens the rule; what precedes it
    // back to the previous `}`, `{` or start of file is the selector.
    const brace = css.lastIndexOf('{', m.index);
    const prior = Math.max(css.lastIndexOf('}', brace), css.lastIndexOf('{', brace - 1));
    out.push({
      selector: css.slice(prior + 1, brace).trim().replace(/\s+/g, ' '),
      value: m[2].trim(),
    });
  }
  return out;
}

/**
 * The independent count, derived by TOKENISING rather than by matching.
 *
 * ── ROUND 17's NB-2: IT WAS NOT INDEPENDENT WHERE IT MATTERED ────────
 *
 * The previous version counted `/content\s*:/` and subtracted
 * `/[-A-Za-z]content\s*:/`, under a docblock saying "derived a different way
 * from `contentDeclarations` on purpose — the two agreeing is what says the
 * scanner is neither over- nor under-matching". Both were case-SENSITIVE on
 * the same `content` token, so when round 17 added `.chip::after { CONTENT: '
 * (see acdp-consumer)'; }` the two agreed at `2 === 2` while both missed the
 * rule entirely. Two derivations that share a blind spot agree loudest exactly
 * where they are both wrong, which is worse than one derivation, because the
 * agreement is read as evidence.
 *
 * So this now differs in the dimension that failed AND in the method. It
 * splits the sheet into declarations on `;{}` boundaries and reads each one's
 * property name — the parser's own model of what a declaration is — instead of
 * pattern-matching around the token. A case bug in one is not a case bug in
 * the other, and a regex that stops matching does not stop the splitter.
 *
 * ── ROUND 21's NB-2: THE DIFFERENCE IS ARGUED, NOT GUARDED ───────────
 *
 * Recorded rather than papered over. Replacing this body with
 * `return contentDeclarations(css, label).length` — collapsing the two
 * derivations into one — passes every case the caller gives it. So the
 * paragraph above is an argument about how the code is written, and nothing
 * fails if somebody unwrites it. Agreement is evidence only where difference
 * is ESTABLISHED, and what would establish it is deriving the second count
 * from `lightningcss`'s own visitor rather than from a second scan of its
 * output string, plus a case on which a collapsed implementation could not
 * agree. That is not done here, and this sentence is the honest version of
 * what the second derivation is currently worth: a second chance to notice,
 * not a checked independence.
 */
export function contentOccurrences(css: string, label = 'stylesheet'): number {
  // Comments are gone already — `normalizeCss` drops them — but the strip is
  // kept so this function is still correct on a raw sheet, and so that the two
  // derivations do not become the same function with a different name.
  const stripped = normalizeCss(css, label).replace(/\/\*[\s\S]*?\*\//g, '');
  let count = 0;
  for (const chunk of stripped.split(/[;{}]/)) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    if (chunk.slice(0, colon).trim().toLowerCase() === 'content') count += 1;
  }
  return count;
}

/**
 * Every rule in a stylesheet whose selector names one of `classes`, as
 * `selector` plus the declaration block exactly as written.
 *
 * ── ROUND 17's BL-6: THE BOUND WAS ON ADDITION ONLY ──────────────────
 *
 * Everything above this point asks how a character can REACH the screen.
 * Nothing asked how one can be taken off it, while `registry-card.tsx`'s
 * suppression bullet said the CSS channel "is bounded separately" — by this
 * module, which enumerated only ways to add text.
 *
 * Measured, one line appended to `app/globals.css`:
 *
 *   @media (max-width: 640px) { .metric-row .chip { display: none; } }
 *
 * 977/977 green. Every profile id vanishes from every registry card at phone
 * width — a deployment the tests do not run on, which is half of what this
 * gate exists to prevent. The `@media` framing is what makes it dangerous:
 * it reads as ordinary mobile compaction, not as a suppression.
 *
 * A property denylist (`display`, `visibility`, `opacity`, `font-size`,
 * `clip-path`, `content-visibility`, `transform: scale(0)`, `color:
 * transparent`, …) is the open-set mistake this file has now made six times.
 * So the PRODUCT is pinned instead: selector and block together, for every
 * rule that APPLIES.
 *
 * ── ROUND 19's BL-3: "APPLIES" IS NOT "MENTIONS A CLASS" ─────────────
 *
 * Round 18 decided applicability by matching selector text against the classes
 * the card paints, and wrote "there is no list to keep complete". There was:
 * the list of classes the card paints. `.grid-2 > div > div > div` is
 * `.grid-2 > .card > .card-body > .metric-row` and `grid-2` belongs to the
 * PAGE; `div[class*="metric"]` names no class at all. Each was 977/977 green
 * and each took every metric row off every registry card at phone width.
 *
 * `applicableRules()` asks a selector ENGINE instead, against the card
 * rendered inside the page ancestry it ships in. Ancestor selectors, attribute
 * selectors, `:has()`, `*` and tag selectors stop being cases because the
 * matcher is the browser's. A selector the engine cannot evaluate is returned
 * to the caller to pin, never skipped.
 */
/**
 * The JSX ancestry of one site in a compiled source, outermost-first, as
 * `tag.class` for an intrinsic element and `ComponentName` for a component.
 *
 * ── ROUND 21's BL-1: A PROBE IS NOT THE DOCUMENT ─────────────────────
 *
 * `applicableRules` asks a selector engine, which was round 19's fix and is
 * right. What it asked the engine ABOUT was a two-element probe —
 * `<div className="page"><div className="grid-2"><RegistryCard/></div></div>` —
 * under a docblock saying the card is rendered "inside the page ancestry it
 * ships in". The ancestry it ships in is
 *
 *   html > body > div.shell > main.content > div.page > div.grid-2 > div.card
 *
 * and `.shell` and `.content` are real classes in `app/globals.css`. Four
 * one-line rules walked through the gap, each 979/979 green with typecheck and
 * lint clean, and each removing every profile id from every registry card at
 * phone width:
 *
 *   @media (max-width: 640px) { .content .metric-row .chip { display: none } }
 *   @media (max-width: 640px) { .grid-2 > .card:nth-child(2) .chip { display: none } }
 *   @media (max-width: 640px) { :root { --muted: transparent } }
 *   @media (max-width: 640px) { .shell .chip { font-size: 0 } }
 *
 * The first is round 19's BL-3 one frame further up. The second needs a SECOND
 * card, and the probe rendered one. The third targets `:root`, and the element
 * universe started at the probe and so never contained `html`. Each is a
 * narrowing of the probe, not of the matcher.
 *
 * Widening the probe by hand would leave the same class of defect one frame
 * further out again, so the chain is DERIVED from the files that produce it and
 * the probe is checked against it. A probe that drifts from the shipped DOM is
 * then red, which is the thing the previous version could not tell apart from a
 * correct one.
 */
export function jsxAncestry(file: string, needle: string): string[] {
  const src = repoFileSource(file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: ts.Node[] = [];
  const isSite = (node: ts.Node): boolean => {
    if (needle === 'children') {
      return (
        ts.isJsxExpression(node) &&
        node.expression !== undefined &&
        node.expression.getText(sf).trim() === 'children'
      );
    }
    return (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === needle
    );
  };
  const find = (node: ts.Node): void => {
    if (found.length > 0) return;
    if (isSite(node)) {
      found.push(node);
      return;
    }
    ts.forEachChild(node, find);
  };
  find(sf);
  if (found.length === 0) {
    throw new Error(`\`${file}\` renders no \`${needle}\` — this ancestry lost its subject`);
  }
  const describe = (open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string => {
    const tag = open.tagName.getText(sf);
    const attr = open.attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className',
    );
    const init = attr?.initializer;
    if (init && ts.isStringLiteral(init)) {
      return `${tag}.${init.text.trim().split(/\s+/).join('.')}`;
    }
    // A computed className is reported as such rather than dropped: an
    // ancestor whose classes this reader cannot name is exactly the case where
    // silence is indistinguishable from an ancestor with none.
    return init ? `${tag}.{computed}` : tag;
  };
  const chain: string[] = [];
  for (let n: ts.Node | undefined = found[0].parent; n !== undefined; n = n.parent) {
    if (ts.isJsxElement(n)) chain.push(describe(n.openingElement));
    else if (ts.isJsxSelfClosingElement(n)) chain.push(describe(n));
  }
  return chain.reverse();
}

export type AppliedRule = { sheet: string; selector: string; block: string };

export function applicableRules(
  root: Element,
  sheets: readonly { label: string; css: string }[],
): { applied: AppliedRule[]; unmatchable: string[] } {
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  const applied: AppliedRule[] = [];
  const unmatchable = new Set<string>();
  for (const { label, css } of sheets) {
    for (const { selector, block } of cssRules(css, label)) {
      // A selector list is a list of selectors; any one of them applying is the
      // rule applying.
      const hits = selector.split(',').some((part) => {
        const sel = matchableSelector(part);
        try {
          return elements.some((el) => el.matches(sel));
        } catch {
          // NOT silently skipped — a selector the matcher cannot evaluate is
          // returned to the caller to pin. Silence here would be the failure
          // this whole module exists to refuse: a rule that applies in a
          // browser and is invisible to the scan.
          unmatchable.add(`${label}: ${part.trim()}`);
          return false;
        }
      });
      if (hits) applied.push({ sheet: label, selector, block });
    }
  }
  return { applied, unmatchable: [...unmatchable].sort() };
}

/** A `<style>` element or a `dangerouslySetInnerHTML` prop, with its spelling. */
export type InjectionSite = { file: string; spelling: string };

/**
 * `<style>` elements and `dangerouslySetInnerHTML` props anywhere in the
 * compiled source.
 *
 * The trailing `[\s>/]` and `[=:]` are what make these props and elements
 * rather than words in a sentence; see the docblock. Exported as
 * {@link INJECTION_SPELLINGS} so the caller can pin the list itself — a scan
 * for an open set of spellings would be the same defect one level up.
 */
export const INJECTION_SPELLINGS: readonly { name: string; re: RegExp }[] = [
  { name: '<style> element', re: /<style[\s>/]/ },
  { name: 'dangerouslySetInnerHTML prop', re: /dangerouslySetInnerHTML\s*[=:]/ },
];

export function htmlInjectionSites(files?: readonly string[]): InjectionSite[] {
  const out: InjectionSite[] = [];
  for (const file of files ?? renderedSourcePaths()) {
    const src = repoFileSource(file);
    for (const { name, re } of INJECTION_SPELLINGS) if (re.test(src)) out.push({ file, spelling: name });
  }
  return out;
}

/**
 * The SECOND half of the `<style>` bound: an AST walk that resolves the tag.
 *
 * ── ROUND 17's BL-4: "SPELLINGS ARE THE CLOSED SIDE" WAS FALSE ───────
 *
 * The docblock above argues for a text scan on the grounds that "an element's
 * tag name is a fixed string, so a substring scan cannot miss one by failing
 * to recurse", and names `createElement('style', …)` as a construct an AST
 * walk would have to enumerate. The argument is backwards for the one case it
 * names: a JSX tag name is an IDENTIFIER, and an identifier can be bound to
 * the string `'style'` anywhere.
 *
 * Measured in `app/layout.tsx` — an ancestor of every card, which this module
 * says explicitly is in scope:
 *
 *   const Tag = 'style' as const;
 *   …
 *   <Tag>{".chip::after { content: ' (see acdp-consumer)'; }"}</Tag>
 *
 * 977/977 green, typecheck and lint clean; the literal `<style>` spelling of
 * the same injection is red. Measured directly against `INJECTION_SPELLINGS`:
 * `createElement('style', …)` → `[]`, `React.createElement('style', …)` →
 * `[]`, `<Tag>` with `Tag = 'style'` → `[]`.
 *
 * The closed side is neither the tag spelling nor the node kind — it is that
 * the string `'style'` has to appear SOMEWHERE for any of these to work. So
 * the two halves are kept and they fail differently: the text scan catches the
 * literal element and cannot miss it by failing to recurse; this walk resolves
 * a tag through its `const` initializer and reads the first argument of every
 * `createElement`/`jsx`/`jsxs` call, and catches the indirection the text scan
 * is blind to by construction. Neither is the whole bound and the module no
 * longer claims either is.
 */
export function styleElementSpellings(src: string): string[] {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];

  // Names bound to the literal 'style', at any scope. One pass first, because a
  // `const Tag = 'style'` may sit below the element that uses it.
  const styleAliases = new Set<string>();
  const findAliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
      if ((ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) && init.text === 'style') {
        styleAliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, findAliases);
  };
  findAliases(sf);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (tag === 'style' || styleAliases.has(tag)) out.push(`<${tag}> resolving to a style element`);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/(^|\.)(createElement|jsx|jsxs|jsxDEV)$/.test(callee)) {
        const first = node.arguments[0];
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && first.text === 'style') {
          out.push(`${callee}('style', …)`);
        }
        if (first && ts.isIdentifier(first) && styleAliases.has(first.text)) {
          out.push(`${callee}(${first.text}, …) resolving to a style element`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function styleElementAstSites(files?: readonly string[]): InjectionSite[] {
  const out: InjectionSite[] = [];
  for (const file of files ?? renderedSourcePaths()) {
    for (const spelling of styleElementSpellings(repoFileSource(file))) out.push({ file, spelling });
  }
  return out;
}

/**
 * THE CLOSED SIDE THE TWO HALVES ABOVE NAMED AND NEITHER IMPLEMENTED: the
 * string `'style'`, wherever it is written.
 *
 * ── ROUND 19's BL-5 ──────────────────────────────────────────────────
 *
 * `styleElementSpellings` tests the callee against
 * `/(^|\.)(createElement|jsx|jsxs|jsxDEV)$/` — an enumeration of CALLEE NAMES,
 * one level over from the tag-name enumeration it replaced, and this module's
 * signature defect. `import { createElement as ce } from 'react'` then
 * `ce('style', null, "…content:…")` in `app/layout.tsx` was 977/977 green,
 * typecheck and lint clean; the unaliased spelling of the same injection is
 * red.
 *
 * The docblock above had already identified the right bound — "the string
 * `'style'` has to be written somewhere for any spelling to work" — and then
 * did not look for the string. This looks for the string.
 *
 * It has no list in it. The alias, the object-property tag (`{tag: 'style'}`),
 * a tag passed as a function parameter, `document.createElement('style')`, a
 * `Map` of tag names, and whatever the next spelling is all require the
 * literal, and all fail here identically. A JSX tag name is covered by
 * `styleElementSpellings`, which resolves identifiers; between the two there
 * is no way to name a style element that neither sees.
 *
 * Comments are not string literals, which is why `registry-card.tsx` may
 * discuss this channel in prose while `htmlInjectionSites()`'s text scan may
 * not. Both facts are asserted where this is used.
 */
export function styleStringLiteralSites(files?: readonly string[]): InjectionSite[] {
  const out: InjectionSite[] = [];
  for (const file of files ?? renderedSourcePaths()) {
    const src = repoFileSource(file);
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        node.text === 'style'
      ) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        out.push({ file, spelling: `the string 'style' at line ${line}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** A read off a browser global, or a handle on an element obtained another way. */
export type DomHandleSite = { file: string; reach: string };

/**
 * Every member name this repository reads off `document` or `window`, plus
 * every `useRef` call site — the two ways a CSS write can get a handle on the
 * document without naming a stylesheet file or a style element.
 *
 * ── ROUND 19's BL-7 ──────────────────────────────────────────────────
 *
 * Every other scanner in this module looks for a `.css` FILE, a `<style>`
 * ELEMENT, a `createElement`-family CALL, or `dangerouslySetInnerHTML`. Three
 * lines in `components/layout/app-shell.tsx` — a `'use client'` ancestor of
 * every page — used none of them:
 *
 *   const sheet = new CSSStyleSheet();
 *   sheet.replaceSync(".chip::after { content: ' (see acdp-consumer)'; }");
 *   document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
 *
 * 977/977 green, and the rule reaches every chip on every card in every real
 * browser. `new CSSStyleSheet()` is a `NewExpression` with none of the
 * enumerated callees; `replaceSync`, `adoptedStyleSheets` and `insertRule`
 * are named nowhere in this file.
 *
 * The module's residual paragraph said what was left was "a stylesheet or
 * script injected by something OUTSIDE this repository". This one is inside
 * it, in a file already walked, and trivially visible to a test process. The
 * circle was drawn one ring too small.
 *
 * The answer is not `CSSStyleSheet` added to a list. A constructed sheet that
 * is never adopted styles nothing, and adopting requires a handle on a
 * document or a shadow root. So the SUPPLY is bounded: `document.*` and
 * `window.*` member reads, per file, pinned as a product the way
 * `applicableRules` pins the stylesheet — and `useRef`, because a ref is the one other
 * way an element handle enters this codebase. What is genuinely left is a
 * handle obtained some third way, and there is no third way in this codebase
 * today, which is a claim the pin makes checkable instead of assumed.
 */
export const BROWSER_GLOBALS = [
  'document',
  'window',
  'globalThis',
  // The three other names for the same window object. `self` and `frames` and
  // `top` are not exotic — they are what a minifier and a bundler emit — and
  // leaving them out would make this list an enumeration of the spellings
  // somebody thought of, which is the defect this whole module keeps finding.
  'self',
  'top',
  'frames',
] as const;

/**
 * The reaches of ONE source text, root-relative and deduped.
 *
 * The source-level entry point, so the resolver can be measured spelling by
 * spelling against synthetic inputs instead of only against whatever this
 * repository happens to contain today. Round 21's BL-2 survived a pin over the
 * repository's own reads precisely because the repository contains none of the
 * spellings it walked through.
 */
export function domHandleReaches(source: string, file = 'probe.tsx'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return [...new Set(globalReaches(sf, BROWSER_GLOBALS).map((r) => r.reach))];
}

export function domHandleSites(files?: readonly string[]): DomHandleSite[] {
  const out: DomHandleSite[] = [];
  for (const file of files ?? renderedSourcePaths()) {
    const src = repoFileSource(file);
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const seen = new Set<string>();
    const add = (reach: string): void => {
      if (seen.has(reach)) return;
      seen.add(reach);
      out.push({ file, reach });
    };
    // ROUND 21's BL-2. This used to be `ts.isPropertyAccessExpression(node) &&
    // ts.isIdentifier(node.expression)`, which is one spelling of a read — see
    // `test/support/ts-reads.ts` for the escape that walked through it and for
    // why the resolver is shared with `capabilityReads` rather than copied.
    for (const r of globalReaches(sf, BROWSER_GLOBALS)) add(r.reach);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && /(^|\.)useRef$/.test(node.expression.getText(sf))) {
        add('useRef()');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

/** An `import './x.css'` or `require('x.css')`, with the file that wrote it. */
export type CssImport = { file: string; specifier: string };

/**
 * Every CSS module specifier imported by the compiled source.
 *
 * `stylesheetPaths()` proves what stylesheets the repository HOLDS; this
 * proves what the app LOADS, which is the larger set — a vendor sheet under
 * `node_modules` is invisible to the first and reaches the screen all the same.
 */
export function cssImportSpecifiers(files?: readonly string[]): CssImport[] {
  const out: CssImport[] = [];
  for (const file of files ?? renderedSourcePaths()) {
    const src = repoFileSource(file);
    for (const m of src.matchAll(/['"]([^'"]+\.css)['"]/g)) out.push({ file, specifier: m[1] });
  }
  return out;
}

/**
 * Every stylesheet the app actually loads, resolved and read.
 *
 * A specifier that cannot be resolved THROWS rather than being skipped: an
 * unreadable stylesheet is the one case where silence would be indistinguishable
 * from a clean scan, which is the failure mode this whole module exists to
 * refuse.
 */
export type LoadedStylesheet = { specifier: string; label: string; css: string };

export function readLoadedStylesheet({ file, specifier }: CssImport): LoadedStylesheet {
  const base = specifier.startsWith('.')
    ? join(REPO_ROOT, dirname(file), specifier)
    : join(REPO_ROOT, 'node_modules', specifier);
  // A sheet inside the repository is labelled by the SAME repo-relative path
  // `stylesheetPaths()` uses, so the two enumerations name one sheet once. A
  // universe that double-counted `app/globals.css` would make every count and
  // every set pin over it wrong in a way that reads like a real change.
  const rel = relative(REPO_ROOT, base).split('\\').join('/');
  const label = rel.startsWith('..') || rel.startsWith('node_modules/') ? specifier : rel;
  try {
    return { specifier, label, css: readFileSync(base, 'utf8') };
  } catch {
    throw new Error(
      `the stylesheet \`${specifier}\` imported by ${file} could not be read at ${base}; ` +
        'it is loaded by the app and therefore must be scanned, not skipped',
    );
  }
}

export function loadedStylesheets(files?: readonly string[]): LoadedStylesheet[] {
  return cssImportSpecifiers(files).map(readLoadedStylesheet);
}

/**
 * The universe every CSS bound is taken over: the stylesheets this repository
 * HOLDS unioned with the stylesheets the app LOADS, each appearing once.
 *
 * Neither enumeration contains the other. `stylesheetPaths()` cannot see a
 * vendor sheet under `node_modules`; `loadedStylesheets()` cannot see a sheet
 * that is present but not yet imported — which is one edit away from being
 * loaded, and is exactly the shape round 15's escape had before its second line
 * was added. So the bound is over the union, not over either.
 */
export function stylesheetUniverse(files?: readonly string[]): { label: string; css: string }[] {
  const byLabel = new Map<string, string>();
  for (const path of stylesheetPaths()) byLabel.set(path, repoFileSource(path));
  for (const { label, css } of loadedStylesheets(files)) byLabel.set(label, css);
  return [...byLabel].map(([label, css]) => ({ label, css }));
}

/**
 * Every `@import` in the given CSS — a stylesheet reaching a stylesheet, which
 * no scan of the TypeScript sources can see. Pinned empty by the caller.
 */
export function cssAtImports(css: string): string[] {
  return [...css.matchAll(/@import\s+([^;]+);/gi)].map((m) => m[1].trim());
}

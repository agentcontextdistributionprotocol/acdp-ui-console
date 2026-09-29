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
 *      → `cardRules()`, whose whole product the caller pins: selector and
 *        declaration block, for every rule that mentions a class the card
 *        renders. A denylist of suppressing PROPERTIES would be the open-set
 *        mistake this file has now made six times — `display`, `visibility`,
 *        `opacity`, `font-size: 0`, `clip-path`, `color: transparent`,
 *        `content-visibility`, `transform: scale(0)` — so the set of rules is
 *        bounded instead of the set of ways to write one.
 *
 * What is left: a stylesheet or script injected by something outside this
 * repository at runtime — a browser extension, an edge worker, a `<link>` added
 * by the host. Nothing in a test process can see those, and saying so is the
 * honest form of the bound.
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
 * The closed side underneath them is that the string `'style'` has to be
 * written somewhere for any spelling to work.
 *
 * The cost of a text scan is prose: two files in `components/` name
 * `dangerouslySetInnerHTML` in a comment saying they do not use it, and
 * refusing those would be a false alarm that teaches the next author to widen
 * the scan. Hence the trailing `=` or `:` — the syntax that makes it a prop
 * rather than a word — which is asserted as a case below rather than trusted as
 * a comment.
 *
 * ── CASE ─────────────────────────────────────────────────────────────
 *
 * Every scanner here is case-INSENSITIVE, and round 17's BL-3 is why: CSS
 * Syntax L3 makes property names and at-rule names ASCII case-insensitive, and
 * every regex in this file was case-sensitive. `.chip::after { CONTENT: ' (see
 * acdp-consumer)'; }` was 977/977 green — verified to survive `lightningcss`,
 * the engine Next 16 compiles with, verbatim — and `@IMPORT` was invisible to
 * the at-rule scan for the same reason.
 *
 * `justify-content` is the trap in the other direction: the stylesheet has
 * eight of those and two real `content:` declarations, a scanner that confuses
 * them reports eight failures with values like `center`, and one that
 * over-corrects finds none and passes vacuously. Both directions, and both
 * cases, are asserted where this is used.
 */
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'coverage',
  'temp',
  'scratchpad',
  'plans',
]);

/** Source directories that are compiled into the app. */
export const RENDERED_DIRS: readonly string[] = ['app', 'components', 'lib'];

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
  const out: string[] = [];
  for (const dir of RENDERED_DIRS) walk(join(REPO_ROOT, dir), out, (n) => n.endsWith('.tsx') || n.endsWith('.ts'));
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) out.push(entry.name);
  }
  return out.map((p) => p.split('\\').join('/')).sort();
}

export function repoFileSource(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/**
 * Every `content:` declaration's value in the given CSS, as written.
 *
 * The preceding character must not be a letter or `-`, which is what separates
 * `content:` from `justify-content:` and from any future `*-content` property.
 */
export function contentDeclarations(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/gi)) out.push(m[2].trim());
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
export function contentRules(css: string): { selector: string; value: string }[] {
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
 */
export function contentOccurrences(css: string): number {
  // Comments first: `/* content: x */` is not a declaration.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
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
 * So the PRODUCT is pinned instead: the set of rules that touch the card at
 * all, selector and block together. Any new rule, any changed declaration, any
 * new `@media` arm targeting the card is a red test whatever property it sets,
 * and there is no list to keep complete — the closed side is "these are the
 * rules that may mention the card", which is short because the card's styling
 * is shared semantic classes.
 */
export function cardRules(css: string, classes: readonly string[]): { selector: string; block: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; block: string }[] = [];
  // A class name is matched as a TOKEN, not as a substring. `.dot` is a class
  // this card renders and `.react-flow__background-pattern.dots` is a vendor
  // rule that has nothing to do with it; a substring test pulls the second into
  // the pin, and then every `@xyflow/react` bump rewrites a pin whose job is to
  // make a change to THIS CARD's styling visible. Trailing `-` is excluded for
  // the same reason in the other direction: `.badge` must not claim
  // `.badge-pub`'s rule, because `badge-pub` is a class in its own right and is
  // in this list on its own merits when the card renders it.
  const touches = (selector: string, cls: string): boolean =>
    new RegExp(`${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(selector);
  // A rule is `<selector> { <declarations> }` where the declarations contain no
  // nested brace — which is true of every rule here, `@media` blocks included,
  // because the inner rules are what this matches and the `@media` wrapper is
  // not a rule with declarations of its own.
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    if (!classes.some((c) => touches(selector, c))) continue;
    out.push({ selector, block: m[2].trim().replace(/\s+/g, ' ') });
  }
  return out;
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

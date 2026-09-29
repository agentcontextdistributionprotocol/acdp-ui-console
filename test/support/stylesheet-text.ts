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
 * ── THE FOUR WAYS A CHARACTER CAN REACH THE SCREEN WITHOUT PASSING ───
 * ── THROUGH A COMPONENT'S SOURCE OR ITS DOM TEXT ─────────────────────
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
 *   4. A `<style>` element rendered by a component (including styled-jsx).
 *      → `htmlInjectionSites()`.
 *   5. `dangerouslySetInnerHTML`.
 *      → `htmlInjectionSites()` as well. `assertNoAlternateDisclosureChannel`
 *        already refuses this one inside `registry-card.tsx`; this refuses it
 *        anywhere under `app/` or `components/`, because an ancestor of the
 *        card can inject into the card's subtree just as effectively.
 *
 * What is left: a stylesheet or script injected by something outside this
 * repository at runtime — a browser extension, an edge worker, a `<link>` added
 * by the host. Nothing in a test process can see those, and saying so is the
 * honest form of the bound.
 *
 * ── WHY THESE ARE TEXT SCANS AND NOT AST WALKS ───────────────────────
 *
 * The recurring defect this whole gate exists to kill is a guard that
 * enumerates an open set. An AST walk for injection would have to enumerate
 * node kinds — `JsxOpeningElement`, `JsxSelfClosingElement`, a
 * `createElement('style', …)` call, a spread carrying the prop — and each
 * omission is silent. The SPELLINGS are the closed side: React's prop name is
 * a fixed string and an element's tag name is a fixed string, so a substring
 * scan over the file text cannot miss one by failing to recurse into a
 * construct its author did not anticipate.
 *
 * The cost of a text scan is prose: two files in `components/` name
 * `dangerouslySetInnerHTML` in a comment saying they do not use it, and
 * refusing those would be a false alarm that teaches the next author to widen
 * the scan. Hence the trailing `=` or `:` — the syntax that makes it a prop
 * rather than a word — which is asserted as a case below rather than trusted as
 * a comment. `justify-content` is the same trap on the CSS side: the stylesheet
 * has eight of those and two real `content:` declarations, a scanner that
 * confuses them reports eight failures with values like `center`, and one that
 * over-corrects finds none and passes vacuously. Both directions are asserted
 * where this is used.
 */
import { readdirSync, readFileSync } from 'node:fs';
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

/** Every compiled source file under {@link RENDERED_DIRS}, sorted. */
export function renderedSourcePaths(): string[] {
  const out: string[] = [];
  for (const dir of RENDERED_DIRS) walk(join(REPO_ROOT, dir), out, (n) => n.endsWith('.tsx') || n.endsWith('.ts'));
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
  for (const m of css.matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/g)) out.push(m[2].trim());
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
  for (const m of css.matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/g)) {
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
 * The independent count: how many `content:` occurrences are not part of a
 * longer property name. Derived a different way from {@link contentDeclarations}
 * on purpose — the two agreeing is what says the scanner is neither over- nor
 * under-matching.
 */
export function contentOccurrences(css: string): number {
  const all = css.match(/content\s*:/g)?.length ?? 0;
  const compound = css.match(/[-A-Za-z]content\s*:/g)?.length ?? 0;
  return all - compound;
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
  return [...css.matchAll(/@import\s+([^;]+);/g)].map((m) => m[1].trim());
}

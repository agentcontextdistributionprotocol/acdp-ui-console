// ══════════════════════════════════════════════════════════════════════
// Bounding what `registry-card.tsx` can render profile copy from.
//
// Shared by `registry-card-profiles.test.tsx` (the key set) and
// `mock-data.test.ts` (the version each tooltip names).
//
// FIVE guards have now failed on this one claim, and the failures rhyme. Each
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
//
// The through-line of all five: each bounded a REGION (two names, one line, one
// object, one statement list) and the copy moved to the next region over. So
// the claim is no longer defended by region at all. It is split into four
// bounds, each narrow enough to be true:
//
//   `tsc`                        — the KEYS of PROFILE_INFO. The component types
//                                  it `Record<AdvertisableProfileId, …>` off an
//                                  `as const` mirror, so an eighth key is an
//                                  excess-property error and a missing one is a
//                                  missing-property error. No test polices this.
//   `assertNoCopyOutsideTable()` — the WHOLE FILE, not its statement list: any
//                                  other object literal carrying a `title`.
//   `assertGlossChokePoint()`    — the one expression that may reach a rendered
//                                  `title` attribute.
//   `assertModuleShape()`        — the module-scope statement list AND the
//                                  BINDING NAMES of every import.
//
// What none of them does, stated because every previous version of this comment
// claimed otherwise: bound what the component renders for an ARBITRARY id
// string. No test can quantify over all strings. The render probes sample a
// universe; the bounds above are what make the sample meaningful.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
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
const GLOSS_EXPRESSION = '{info?.title}';

/**
 * The only condition `glossFor` may gate on, whitespace-collapsed.
 *
 * Pinned as a shape rather than as a substring for the reason this whole file
 * exists: a `body.includes('ADVERTISABLE_PROFILE_IDS')` check is satisfied by
 * `if (false && !ADVERTISABLE_PROFILE_IDS.includes(p))`, which gates nothing.
 * Five guards were lost to readers that matched text instead of structure.
 */
const GLOSS_GATE_CONDITION = '!(ADVERTISABLE_PROFILE_IDSasreadonlystring[]).includes(p)';

function sourceFile(): ts.SourceFile {
  return ts.createSourceFile(
    REGISTRY_CARD_PATH,
    readFileSync(REGISTRY_CARD_PATH, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

function fail(what: string): never {
  throw new Error(
    `registry-card.tsx: ${what}. Profile copy in this file is bounded to the PROFILE_INFO table ` +
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
export function assertModuleShape(): void {
  const sf = sourceFile();
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
export function assertNoCopyOutsideTable(): void {
  const sf = sourceFile();
  const table = copyTableNode(sf);

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && !isWithin(node, table)) {
      for (const prop of node.properties) {
        const name = ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)
          ? prop.name.getText(sf).replace(/^['"]|['"]$/g, '')
          : undefined;
        if (name === 'title' || name === 'accent') {
          fail(
            `has an object literal carrying \`${name}\` outside PROFILE_INFO ` +
              `(\`${node.getText(sf).slice(0, 60).replace(/\s+/g, ' ')}\`) — a second source of copy`,
          );
        }
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
 * Its limit: it bounds `title`. Copy smuggled into `aria-label`, `data-*` or
 * the chip's TEXT is a different (and louder) change, and the render probes are
 * what read those.
 */
export function assertGlossChokePoint(): void {
  const sf = sourceFile();
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
export function assertGlossIsGated(): void {
  const sf = sourceFile();
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
 * The `ADVERTISABLE_PROFILE_IDS` literal as the component declares it, so the
 * test can assert it against the shared mirror under `test/support/`.
 *
 * The component cannot import that mirror (production code must not depend on
 * the test tree), so there are genuinely two copies of the list; this is what
 * stops them drifting.
 */
export function advertisableIdsInComponent(): string[] {
  const sf = sourceFile();
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
 * The profile-copy entries, as `id -> title`.
 *
 * Runs every structural bound first: the key set is `tsc`'s to enforce, but
 * treating this object as THE copy table is only safe once the other three have
 * refused every other place copy could live.
 *
 * Fails closed: a spread, a computed key, an accessor, a shorthand, a
 * non-string key or a non-string `title` throws rather than being skipped.
 */
export function profileCopyTable(): { entries: Map<string, string>; tables: number } {
  assertModuleShape();
  assertNoCopyOutsideTable();
  assertGlossChokePoint();
  assertGlossIsGated();
  const sf = sourceFile();
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

// ══════════════════════════════════════════════════════════════════════
// Bounding what `registry-card.tsx` can render profile copy from.
//
// Shared by `registry-card-profiles.test.tsx` (the key set) and
// `mock-data.test.ts` (the version each tooltip names).
//
// FOUR guards have now failed on this one claim, and the failures rhyme. Each
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
//      version it replaced had caught. A fix that loses coverage is the defect
//      this file has now shipped twice.
//
// So this one is INVERTED. It does not hunt for copy; it refuses anything that
// is not one of the handful of constructs the module is allowed to contain.
// `assertModuleShape()` whitelists the module-scope statement list and the
// import list, and throws on ANY other statement — an extra variable, an
// assignment, a call, a class, a re-export, a form nobody has thought of yet.
// That is the property every previous version lacked: an unanticipated
// construct is a loud failure rather than a silent pass.
//
// The residual limit is stated rather than papered over: this bounds MODULE
// scope. Copy inlined inside the component function is not visible here, which
// is what the render probe in `registry-card-profiles.test.tsx` is for — and
// that probe renders across several capability fixtures because a probe pinned
// to one fixture cannot see context-dependent copy either.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Anchored to THIS FILE, not to `process.cwd()`. The guard should not depend on
// which directory the runner was invoked from.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY_CARD_PATH = join(REPO_ROOT, 'components/registries/registry-card.tsx');

/** The only module specifiers `registry-card.tsx` may import from. */
const ALLOWED_IMPORTS = [
  '@/components/ui/status-dot',
  '@/components/ui/badge',
  '@/lib/utils/format',
  '@/lib/types',
];

/** The only value declarations the module may contain, at module scope. */
const ALLOWED_VARIABLES = ['PROFILE_INFO'];
const ALLOWED_FUNCTIONS = ['RegistryCard'];

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
    `registry-card.tsx: ${what}. This module is deliberately bounded to its imports, the ` +
      `PROFILE_INFO table and the RegistryCard component, because four previous guards on the ` +
      `profile copy each missed a construct their author had not anticipated. If this file ` +
      `genuinely needs the construct, widen the allow-list in test/support/profile-copy-table.ts ` +
      `and say why — do not delete the check.`,
  );
}

/**
 * Refuse any module-scope construct other than the ones named above.
 *
 * This is the guard. Everything else in this file is detail.
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

    if (ts.isImportDeclaration(st)) {
      const spec = (st.moduleSpecifier as ts.StringLiteral).text;
      if (!ALLOWED_IMPORTS.includes(spec)) {
        fail(`imports from \`${spec}\`, which is not on the allow-list (copy could come from it)`);
      }
      continue;
    }

    if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        const name = decl.name.getText(sf);
        if (!ALLOWED_VARIABLES.includes(name)) {
          fail(`declares \`${name}\` at module scope; only ${ALLOWED_VARIABLES.join(', ')} may exist`);
        }
        if (name === 'PROFILE_INFO') {
          if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
            fail(
              'exports PROFILE_INFO. It was exported once so a test could read Object.keys, and ' +
                'that let any other module mutate the table at module scope — invisible to the ' +
                'guard because Vitest isolates module graphs per test file',
            );
          }
          sawTable = true;
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.getText(sf) ?? '<anonymous>';
      if (!ALLOWED_FUNCTIONS.includes(name)) {
        fail(`declares function \`${name}\` at module scope; only ${ALLOWED_FUNCTIONS.join(', ')} may exist`);
      }
      sawComponent = true;
      continue;
    }

    fail(`contains a ${ts.SyntaxKind[st.kind]} at module scope`);
  }

  // Anti-vacuity in both directions: an empty or renamed module must not pass.
  if (!sawTable) fail('no PROFILE_INFO declaration found — the guard lost its subject');
  if (!sawComponent) fail('no RegistryCard declaration found — the guard lost its subject');
}

/**
 * The profile-copy entries, as `id -> title`.
 *
 * Call `assertModuleShape()` first — this reads the `PROFILE_INFO` initializer
 * specifically, and it is only safe to treat that as THE copy table because the
 * shape assertion has already refused every other place copy could live.
 *
 * Fails closed: a spread, a computed key, an accessor, a shorthand, a
 * non-string key or a non-string `title` throws rather than being skipped.
 */
export function profileCopyTable(): { entries: Map<string, string>; tables: number } {
  assertModuleShape();
  const sf = sourceFile();
  const entries = new Map<string, string>();
  let tables = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === 'PROFILE_INFO' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      tables += 1;
      for (const prop of node.initializer.properties) {
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
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Exactly one table. Merging several into one map lets a second table shadow
  // an entry of the first — which is how the version cross-check was made
  // unfalsifiable once already, through a regex, and again through a parser.
  if (tables !== 1) fail(`found ${tables} PROFILE_INFO initializers, expected exactly 1`);
  return { entries, tables };
}

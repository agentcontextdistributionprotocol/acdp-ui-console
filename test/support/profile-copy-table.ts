// ══════════════════════════════════════════════════════════════════════
// Reading the registry-card profile copy table WITHOUT importing it.
//
// Shared by `registry-card-profiles.test.tsx` (which asserts the key set) and
// `mock-data.test.ts` (which cross-checks the version each tooltip names).
//
// Why a parser rather than an import, given the import is simpler: three gate
// rounds on #95 each failed differently, and the third failed because of the
// import. Exporting `PROFILE_INFO` so a test could read `Object.keys` meant any
// OTHER module could import the same object and add a key at module scope —
// and because Vitest isolates module graphs per test file, the guard went on
// seeing a pristine seven while the shipped app rendered the tooltip copy #95
// had deleted, on an id a registry is forbidden to advertise. Reading the
// object vouches for the object. The claim is about what the component renders.
//
// The two readers before that were regexes, and both had the same fatal
// property in common: syntax they did not anticipate produced NO MATCH, and no
// match read as success. Everything here fails CLOSED instead — it throws on
// anything it cannot account for, so the failure mode is a loud red rather than
// a quiet pass.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const REGISTRY_CARD_PATH = join(process.cwd(), 'components/registries/registry-card.tsx');

export function registryCardSource(): string {
  return readFileSync(REGISTRY_CARD_PATH, 'utf8');
}

function sourceFile(): ts.SourceFile {
  return ts.createSourceFile(
    REGISTRY_CARD_PATH,
    registryCardSource(),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

function literalName(node: ts.Node, sf: ts.SourceFile): string | null {
  return ts.isPropertyAssignment(node) ? node.name.getText(sf).replace(/^['"]|['"]$/g, '') : null;
}

/**
 * Every profile-copy entry the component file declares, as `id -> title`.
 *
 * A "copy table" is ANY object literal whose entries are themselves object
 * literals carrying a `title` — the shape the chip renders from. Collecting all
 * of them rather than one named constant is the point: a second lookup object
 * consulted by the component (`PROFILE_INFO[p] ?? LEGACY_INFO[p]`, or a spread
 * into an `ACTUAL_INFO` the component reads instead) is the realistic way this
 * regresses, and it is exactly what a check anchored to one symbol cannot see.
 *
 * Throws on a spread, a computed key, an accessor, a shorthand or a non-string
 * key rather than skipping it.
 */
export function profileCopyTable(): { entries: Map<string, string>; tables: number } {
  const sf = sourceFile();
  const entries = new Map<string, string>();
  let tables = 0;

  const isCopyTable = (node: ts.ObjectLiteralExpression) =>
    node.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ts.isObjectLiteralExpression(p.initializer) &&
        p.initializer.properties.some((q) => literalName(q, sf) === 'title'),
    );

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && isCopyTable(node)) {
      tables += 1;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          throw new Error(
            `registry-card.tsx: copy table contains ${ts.SyntaxKind[prop.kind]}, which this ` +
              `reader cannot account for. Refusing to report a key set it cannot vouch for.`,
          );
        }
        if (!ts.isStringLiteral(prop.name)) {
          throw new Error(
            `registry-card.tsx: copy-table key \`${prop.name.getText(sf)}\` is not a string ` +
              `literal (${ts.SyntaxKind[prop.name.kind]}). Refusing to guess what it resolves to.`,
          );
        }
        const title = ts.isObjectLiteralExpression(prop.initializer)
          ? prop.initializer.properties.find((q) => literalName(q, sf) === 'title')
          : undefined;
        if (!title || !ts.isPropertyAssignment(title) || !ts.isStringLiteral(title.initializer)) {
          throw new Error(
            `registry-card.tsx: entry \`${prop.name.text}\` has no string-literal \`title\`. ` +
              `Refusing to report copy it cannot read.`,
          );
        }
        entries.set(prop.name.text, title.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { entries, tables };
}

/**
 * Runtime forms that would put a tooltip on screen without adding a key any
 * STATIC read can see — and two of which defeat `Object.keys` as well.
 *
 * Detected through the AST, not by scanning text: this file's own docblocks
 * name every one of these forms in prose, and a text scan would fire on the
 * explanation of the problem rather than on the problem.
 */
export const PROHIBITED_RUNTIME_FORMS = [
  'Object.defineProperty',
  'Object.assign',
  'Reflect.set',
  'Reflect.defineProperty',
  'Proxy',
] as const;

export function prohibitedRuntimeFormsUsed(): string[] {
  const sf = sourceFile();
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf);
      for (const form of PROHIBITED_RUNTIME_FORMS) {
        if (callee === form) found.add(form);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found];
}

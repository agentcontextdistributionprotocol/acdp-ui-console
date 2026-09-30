/**
 * Structural resolution of a READ, shared by every guard on this branch that
 * has to answer "does this file reach X".
 *
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS
 *
 * Round 21's BL-2. Two guards were written on the same day, forty lines apart
 * in sibling modules, to answer the same question about two different subjects:
 *
 *   `capabilityReads`   does this file read `capabilities.<member>`?
 *   `domHandleSites`    does this file read `document`/`window`.<member>?
 *
 * The first resolves the read — it unwraps `( )`, `!`, `as T`, `satisfies T`,
 * accepts element access with a literal key, and accepts destructuring — under
 * a docblock saying why: "a guard that compares source strings is an
 * enumeration of spellings wearing the word structural". The second matched
 * `ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)`,
 * which is ONE spelling. Measured, in `components/layout/app-shell.tsx` — an
 * unconditional `'use client'` ancestor of every page in the app:
 *
 *   const { document: doc } = window;
 *   const sheet = new CSSStyleSheet();
 *   sheet.replaceSync(".chip::after { content: ' (see acdp-consumer)'; }");
 *   doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
 *
 * 42 files / 979 tests green, typecheck and lint clean — and every chip on
 * every registry card reads `acdp-registry-core (see acdp-consumer)` in a real
 * browser. The identical injection written `document.adoptedStyleSheets` was
 * 1 red. The only difference between the escape and the control is the
 * SPELLING of the document read.
 *
 * So the resolver lives once, here, and both guards call it. The next widening
 * lands on both by construction rather than by somebody remembering.
 * ══════════════════════════════════════════════════════════════════════
 */
import ts from 'typescript';

/**
 * Strip the wrappers that change an expression's TEXT and not its VALUE:
 * `(x)`, `x!`, `x as T`, `x satisfies T`, `<T>x`.
 */
export function unwrapExpression(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur)) cur = cur.expression;
    else if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    else if (ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else return cur;
  }
}

/** The literal key of an element access, or `null` when it is computed. */
export function literalKey(node: ts.ElementAccessExpression): string | null {
  const arg = node.argumentExpression;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isNumericLiteral(arg)) return arg.text;
  return null;
}

export type MemberRead = { member: string; text: string; node: ts.Node };

/**
 * Every READ of `<base>.<member>`, where `isBase` decides what counts as the
 * base — property access, optional access, element access with a literal key,
 * and object destructuring (renames included).
 *
 * The three forms are ONE read. That is the whole point: `capabilities.profiles`,
 * `capabilities?.profiles`, `capabilities!.profiles`, `(capabilities).profiles`,
 * `capabilities['profiles']` and `const { profiles } = capabilities` differ in
 * source text and not in what they do.
 */
export function memberReads(
  sf: ts.SourceFile,
  isBase: (expr: ts.Expression) => boolean,
): MemberRead[] {
  const out: MemberRead[] = [];
  const text = (node: ts.Node): string => node.getText(sf).replace(/\s+/g, '');
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isBase(node.expression)) {
      out.push({ member: node.name.text, text: text(node), node });
    } else if (ts.isElementAccessExpression(node) && isBase(node.expression)) {
      const key = literalKey(node);
      if (key !== null) out.push({ member: key, text: text(node), node });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isBase(node.initializer)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        out.push({
          member: ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : key.getText(sf),
          text: text(node),
          node,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** One way a file reaches something derived from a browser global. */
export type GlobalReach = { reach: string; node: ts.Node };

/**
 * Every value in `sf` transitively derived from one of `roots`, as the dotted
 * path it was reached by.
 *
 * ── WHY A CLOSURE AND NOT A MATCH ────────────────────────────────────
 *
 * `document.adoptedStyleSheets` is one read. `const { document: doc } = window;
 * doc.adoptedStyleSheets` is the same read through one more local, and a guard
 * that looks for `ts.isIdentifier(node.expression) && text === 'document'` sees
 * the first and not the second. Enumerating the spellings — `window['document']`,
 * `(window).document`, `window!.document`, `const d = document`, a destructure,
 * a rename — is an open set, and round 21 walked through it with the plainest
 * member of it.
 *
 * So the closure is computed instead: a local bound to a root, or to a member
 * of something already derived, or to the RESULT of calling something already
 * derived, is itself derived. A handle passed through one more local is then a
 * reviewable diff in the pinned product rather than a spelling nobody
 * anticipated.
 *
 * The path is reported from the ROOT (`window.document.adoptedStyleSheets`,
 * not `doc.adoptedStyleSheets`), so the pin names the channel rather than the
 * local somebody happened to choose — and a rename of that local changes
 * nothing, while a new channel changes the pin.
 *
 * A computed key reports as `[computed]` rather than being skipped: a member
 * read this resolver cannot name is exactly the case where silence would be
 * indistinguishable from a clean scan.
 */
export function globalReaches(sf: ts.SourceFile, roots: readonly string[]): GlobalReach[] {
  const origin = new Map<string, string>(roots.map((r) => [r, r]));
  const out: GlobalReach[] = [];
  const emit = (reach: string, node: ts.Node): void => {
    out.push({ reach, node });
  };

  /** The dotted path this expression denotes, or `null` if it is not derived. */
  const pathOf = (expr: ts.Expression): string | null => {
    const cur = unwrapExpression(expr);
    if (ts.isIdentifier(cur)) return origin.get(cur.text) ?? null;
    if (ts.isPropertyAccessExpression(cur)) {
      const base = pathOf(cur.expression);
      return base === null ? null : `${base}.${cur.name.text}`;
    }
    if (ts.isElementAccessExpression(cur)) {
      const base = pathOf(cur.expression);
      if (base === null) return null;
      const key = literalKey(cur);
      return key === null ? `${base}[computed]` : `${base}.${key}`;
    }
    if (ts.isCallExpression(cur)) {
      const callee = pathOf(cur.expression);
      return callee === null ? null : `${callee}()`;
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    // A LOCAL that shadows one of the roots is not that root. No scope
    // analysis here beyond this: a binding of the name stops it being derived
    // from the point it appears, which under-reports a shadow that goes out of
    // scope again and never over-reports. `window` as a parameter name is the
    // realistic case (`function f(window: Window)`), and calling every member
    // read on it a browser reach would be a false entry in a pinned product,
    // which is worse than a narrow one because it trains the reader to edit
    // the pin.
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) origin.delete(node.name.text);
    // A binding first, so a local is derived before the reads that use it.
    if (ts.isVariableDeclaration(node)) {
      const base = node.initializer ? pathOf(node.initializer) : null;
      if (base === null) {
        if (ts.isIdentifier(node.name)) origin.delete(node.name.text);
      } else {
        if (ts.isIdentifier(node.name)) {
          origin.set(node.name.text, base);
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            const key = el.propertyName ?? el.name;
            const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : key.getText(sf);
            emit(`${base}.${name}`, el);
            if (ts.isIdentifier(el.name)) origin.set(el.name.text, `${base}.${name}`);
          }
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = pathOf(node.expression);
      if (base !== null) {
        const reach = pathOf(node);
        if (reach !== null) emit(reach, node);
      }
    }
    // A bare reference to a derived value that is NOT the base of a read: the
    // handle is being PASSED somewhere this scan cannot follow, which is the
    // one remaining way to reach a document without naming a member of it.
    // `typeof window` is excluded — it yields a string, not a handle.
    if (ts.isIdentifier(node) && origin.has(node.text)) {
      // Climb the wrappers first, or `(window).document` reports the window as
      // "passed" — the paren is the identifier's parent, and the read is its
      // grandparent. The wrappers are the same ones `unwrapExpression` strips,
      // for the same reason.
      let cur: ts.Node = node;
      while (
        ts.isParenthesizedExpression(cur.parent) ||
        ts.isNonNullExpression(cur.parent) ||
        ts.isAsExpression(cur.parent) ||
        ts.isSatisfiesExpression(cur.parent) ||
        ts.isTypeAssertionExpression(cur.parent)
      ) {
        cur = cur.parent;
      }
      const p = cur.parent;
      const isBaseOfRead =
        (ts.isPropertyAccessExpression(p) && p.expression === cur) ||
        (ts.isElementAccessExpression(p) && p.expression === cur) ||
        (ts.isCallExpression(p) && p.expression === cur);
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === cur) ||
        (ts.isVariableDeclaration(p) && p.name === cur) ||
        (ts.isPropertyAssignment(p) && p.name === cur) ||
        ts.isBindingElement(p) ||
        ts.isImportSpecifier(p) ||
        ts.isPropertySignature(p);
      // An initializer whose binding this walk has already recorded is not a
      // pass-through — `const d = document` IS the derivation, and reporting it
      // twice makes the product noisier without making it stricter.
      const isRecordedBinding = ts.isVariableDeclaration(p) && p.initializer === cur;
      if (!isBaseOfRead && !isName && !isRecordedBinding && !ts.isTypeOfExpression(p)) {
        emit(`${origin.get(node.text)} (passed as a value)`, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

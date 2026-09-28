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
//      remain unbounded — it did not close the channel, and the render probes
//      are what actually catch a gloss arriving that way, for the ids and prop
//      combinations they cover.
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
  const mapCalls: ts.CallExpression[] = [];
  const findMap = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.getText(sf) === 'map' &&
      node.expression.expression.getText(sf).replace(/\s+/g, '') === 'capabilities.profiles'
    ) {
      mapCalls.push(node);
    }
    ts.forEachChild(node, findMap);
  };
  findMap(sf);
  if (mapCalls.length === 0) {
    fail('no `capabilities.profiles.map(...)` found — this guard lost its subject');
  }
  if (mapCalls.length > 1) {
    fail(
      `renders ${mapCalls.length} \`capabilities.profiles.map(...)\` calls; this guard bounds the ` +
        'callback of ONE. A second map is a second, unbounded place to render per-profile copy',
    );
  }
  const call: ts.CallExpression = mapCalls[0];

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
  assertNoRuntimeCopyForms();
  assertNoAlternateDisclosureChannel();
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

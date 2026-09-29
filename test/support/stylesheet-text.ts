/**
 * THE CHANNEL NO DOM WALK AND NO SOURCE WALK CAN SEE: `content:`.
 *
 * Both halves of the profile-copy gate (#95) and the witness-ack copy gate (#84)
 * bound what a component may say by asking two questions — what the rendered
 * DOM contains, and what the component's own source spells. A CSS rule answers
 * neither. `.chip::after { content: 'acdp-consumer'; }` puts a word on the
 * screen that
 *
 *   - the source walks cannot see, because it is not in the component; and
 *   - the DOM walks cannot see, because jsdom does not compute pseudo-element
 *     content and `textContent` never includes it in any browser.
 *
 * So the closed worlds are closed over the wrong universe unless the stylesheet
 * is bounded too. It is bounded here, once, rather than in each test file that
 * makes a copy claim: there is exactly one stylesheet in this app
 * (`app/globals.css` — CLAUDE.md's "CSS variables only, no Tailwind", and every
 * other colour or rule lives in it), and the bound is that no rule may put a
 * CHARACTER in it.
 *
 * THE RULE IS "EMPTY", NOT "ALLOW-LISTED", for the same reason the profile
 * guards invert their enumerations: an allow-list of permitted `content` strings
 * is an open set, and the two declarations this file actually has are both `''`
 * — decorative `::before`/`::after` boxes. A rule that genuinely needs text
 * would be a design change with a reviewer, which is the point.
 *
 * `justify-content` is the trap, and it is why this does not simply grep for
 * `content:`. The file has eight of those and two real `content:` declarations;
 * a scanner that confuses them reports eight failures with values like `center`,
 * and one that over-corrects (requiring a preceding `{`, say) finds none and
 * passes vacuously. Both directions are asserted where this is used.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Anchored to this file, not to the runner's working directory. */
const STYLESHEET_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app/globals.css');

export function stylesheetSource(): string {
  return readFileSync(STYLESHEET_PATH, 'utf8');
}

/**
 * Every `content:` declaration's value, as written.
 *
 * The preceding character must not be a letter or `-`, which is what separates
 * `content:` from `justify-content:` and from any future `*-content` property.
 */
export function contentDeclarations(css = stylesheetSource()): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/(^|[^-A-Za-z])content\s*:\s*([^;}]*)/g)) {
    out.push(m[2].trim());
  }
  return out;
}

/**
 * The independent count: how many `content:` occurrences are not part of a
 * longer property name. Derived a different way from `contentDeclarations` on
 * purpose — the two agreeing is what says the scanner is neither over- nor
 * under-matching.
 */
export function contentOccurrences(css = stylesheetSource()): number {
  const all = css.match(/content\s*:/g)?.length ?? 0;
  const compound = css.match(/[-A-Za-z]content\s*:/g)?.length ?? 0;
  return all - compound;
}

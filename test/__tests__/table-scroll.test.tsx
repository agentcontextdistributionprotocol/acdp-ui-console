// ══════════════════════════════════════════════════════════════════════
// Wide tables scroll inside their own card (#93).
//
// The defect was that a table wider than the viewport pushed the entire
// `.content` region sideways: `.content` is `overflow-y: auto` with no
// `overflow-x`, and CSS computes the unspecified axis to `auto` too, so the
// overflow surfaced on the page rather than on the table. At phone width the
// whole console slid.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE. jsdom performs no layout — every
// element is 0×0, `scrollWidth` equals `clientWidth` always — so nothing here
// can demonstrate the 400px behaviour. No `playwright` is installed and adding
// one is out of this plan's scope. So the layout half was a MANUAL gate: the
// eleven tables were checked by hand at 400px before this shipped. That record
// lives in the session's working notes, which are gitignored by this repo's
// convention — so for anyone reading the repo it is not evidence, it is a
// claim, and it is written here as one. Treat the layout half as unverified by
// CI and re-check it by hand after any change to `.shell`, `.content` or
// `.table-scroll`. These tests pin the three things that ARE mechanically
// checkable and that a future edit would silently break:
//
//   1. The STRUCTURE — every `.data-table` really is inside a `TableScroll`, the
//      container is focusable, and it carries a name a browser will honour.
//   2. The NAMES — each caption enumerates the table's ACTUAL `<th>` set, both
//      directions: no header left out, and no column named that does not exist.
//      The first version of this change failed at TEN of eleven sites — only
//      `components/config/sdk-matrix.tsx` was right — because the captions were
//      written from the plan instead of from the rendered header row. (An
//      earlier revision of this comment said SIX. That number was inherited
//      from a review's phrasing rather than recomputed, which is the same
//      not-re-derived mistake as the focusable count below, in the very file
//      whose subject is captions nobody checked against their tables.
//      Recomputed with this gate's own normalizer: ten fail set equality, ten
//      name a column that does not exist, ten omit one that does.)
//   3. The CSS TEXT — the rules that make the structure do anything, read off
//      `app/globals.css`, in the `readFileSync` style `use-verdicts.test.ts`
//      already uses for the same reason.
//
// The accessible half is the part worth the most scrutiny. FOUR of the eleven
// tables contain nothing focusable at all — the SDK matrix, the security
// revocation feed, and both tables in `run-trust-panel.tsx` — so
// `overflow-x: auto` on its own would have produced a scroll region no keyboard
// user could reach, which is WCAG 2.1.1. (An earlier version of this comment
// said FIVE and named agents, recent runs and events: the first two spread
// `pressable()` onto every row, which sets `role="button"` and `tabIndex: 0`,
// and the events table does so on any row carrying a `runId` — conditional, so
// an all-`null` page falls back to this container, which is one more argument
// for the unconditional `tabIndex`.
// It also named a "security JWKS table", which does not exist. The corrected
// count is smaller; the conclusion is not weakened, because four tables with no
// other way in is still four.) That is why `tabIndex` lives on the shared
// component rather than at eleven call sites, and why the repo-wide gate below
// DISCOVERS its files rather than being handed a list.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TableScroll } from '@/components/ui/table-scroll';
import type { CpRun, CpContextEvent, RunTrustSummary } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { EventsTable } = await import('@/components/events/events-table');
const { RecentRunsTable } = await import('@/components/dashboard/recent-runs-table');
const { RunsTable } = await import('@/components/runs/runs-table');
const { RunTrustPanel } = await import('@/components/runs/run-trust-panel');

afterEach(cleanup);

// Comments STRIPPED before matching. The rules these tests assert the absence
// of are described in the comments explaining why they were removed, so a naive
// read would match the explanation and report the defect still present.
const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// EVERY block for the selector, joined — not just the first. CSS cascades, so a
// second `.data-table .did { max-width: 220px }` further down the file would
// reinstate exactly what this change deleted while a first-match-only reader
// reported it gone.
function rule(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g');
  return (CSS.match(re) ?? []).join('\n');
}

describe('the TableScroll component contract', () => {
  it('is a named, focusable group', () => {
    const { container } = render(
      <TableScroll label="Widget inventory">
        <table className="data-table">
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>,
    );
    const group = screen.getByRole('group', { name: 'Widget inventory' });
    expect(group).toBe(container.firstElementChild);
    expect(group.className).toBe('table-scroll');
    expect(group.tabIndex).toBe(0);
    expect(group.querySelector('table')).not.toBeNull();
  });

  it('is found by ROLE plus name, which a nameless div would not be', () => {
    // The distinction this repo has already been bitten by once, in
    // `LiveMarker`: an element with NO role maps to ARIA's `generic`, which is
    // name-prohibited in ARIA 1.2, so Chromium drops the `aria-label` and the
    // focusable container announces as nothing at all. `getByLabelText` matches
    // the attribute as text and so cannot tell an honoured name from a discarded
    // one; `getByRole` pins the element to a role that CAN be named.
    //
    // This asserts the positive case is reachable by role. The negative — that a
    // roleless div is NOT — is the control render immediately below.
    //
    // The control is the same markup MINUS the role. `queryAllByRole('group')`
    // rather than a `[role="group"]` attribute selector, which could only ever
    // be null on markup that was written without the attribute — a fact about
    // this test's own JSX, not about the DOM. Asking testing-library for the
    // ROLE puts the question to the accessibility tree, where a roleless div is
    // `generic` and therefore not a group.
    render(
      <div className="table-scroll" aria-label="Widget inventory" tabIndex={0}>
        <table />
      </div>,
    );
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    cleanup();

    render(
      <TableScroll label="Widget inventory">
        <table />
      </TableScroll>,
    );
    expect(screen.getByRole('group', { name: 'Widget inventory' })).toBeTruthy();
  });

  it('adds no landmark', () => {
    // `role="region"` would also have given a name, and eleven new landmarks —
    // one per table, on pages that hold one table — is noise in the landmark
    // list that costs more than it gives. `group` is nameable and is not a
    // landmark.
    const { container } = render(
      <TableScroll label="Widget inventory">
        <table />
      </TableScroll>,
    );
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('puts a passed style on the wrapper, not on the table', () => {
    const { container } = render(
      <TableScroll label="Widget inventory" style={{ marginBottom: 14 }}>
        <table className="data-table" />
      </TableScroll>,
    );
    expect((container.firstElementChild as HTMLElement).style.marginBottom).toBe('14px');
    expect(container.querySelector('table')?.getAttribute('style')).toBeNull();
  });
});

describe('the CSS that makes the wrapper do something', () => {
  it('scrolls horizontally', () => {
    expect(rule('.table-scroll')).toMatch(/overflow-x:\s*auto/);
  });

  it('has NO local :focus-visible copy — that convention is stated in this very file', () => {
    // The first version of this change shipped
    // `.table-scroll:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px }`,
    // which is precisely the local copy `globals.css` forbids beside
    // `.error-detail > pre`: "a local copy would silently keep the old treatment
    // for this component alone the day that one changes."
    //
    // It was not hypothetical harm. The copy had ALREADY diverged on the day it
    // landed — it omitted the global rule's `border-radius` — and being more
    // specific it won, so the eleven new containers rendered a square focus ring
    // where every other focusable element in the console gets a rounded one.
    expect(CSS).not.toMatch(/\.table-scroll:focus-visible/);
  });

  it('the repo-wide :focus-visible rule still exists, because it is now load-bearing here', () => {
    // A focusable element with no visible focus state is WCAG 2.4.7, and these
    // containers are focusable on purpose for the four tables with nothing else
    // to focus. Having deleted the local copy, this file is the only thing that
    // notices if the universal rule is deleted or narrowed to a selector list —
    // which, before this test, killed ZERO tests in the suite.
    //
    // Anchored at line start so `.form-input:focus-visible { outline: none }`
    // cannot satisfy it: that rule is a deliberate exception for inputs and says
    // nothing about whether the universal one survives.
    const universal = CSS.match(/^:focus-visible\s*\{[^}]*\}/m)?.[0] ?? '';
    expect(universal).toMatch(/outline:\s*\d+px\s+solid/);
    expect(universal).toMatch(/outline-offset:/);
    // The exact property the deleted local copy was missing.
    expect(universal).toMatch(/border-radius:/);
  });

  it('leaves .content alone', () => {
    // Deliberate: `overflow-x: hidden` there would CLIP the columns with no way
    // to reach them — data present in the DOM and unreadable, a WCAG 1.4.10
    // failure rather than a fix. The overflow has to stop before it arrives.
    const content = rule('.content');
    expect(content).toMatch(/overflow-y:\s*auto/);
    expect(content).not.toMatch(/overflow-x/);
  });

  it('drops the three .did rules and keeps the four real ones', () => {
    // On a table CELL those three did nothing: CSS 2.1 §10.4 leaves `max-width`
    // undefined there and auto table layout sizes the column to content
    // regardless. Reading them suggested the overflow was handled.
    //
    // The word "inert" used to be in this title and in the CSS comment without
    // qualification, and round 3 of this change's gate measured it false: three
    // `.did` spans under `.data-table` are FLEX ITEMS, which CSS Flexbox §4
    // blockifies, so §10.4 applied and they really were capped and ellipsised.
    // Dropping the cap on those three is a deliberate widening, not a no-op —
    // the partition is pinned by the test below, and the reasoning is in
    // `globals.css` beside the rules.
    const did = rule('.data-table .did');
    expect(did).not.toMatch(/max-width/);
    expect(did).not.toMatch(/overflow/);
    expect(did).not.toMatch(/text-overflow/);
    // `nowrap` stays and is now load-bearing: a wrapped DID is unreadable, and
    // an unwrappable column is exactly what the scroll container is for.
    expect(did).toMatch(/white-space:\s*nowrap/);
    expect(did).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(did).toMatch(/font-size:\s*11px/);
    expect(did).toMatch(/color:\s*var\(--muted\)/);
  });

  it('hides the captions without removing them from the accessibility tree', () => {
    // `display: none` and `visibility: hidden` both take the element OUT of the
    // accessibility tree, which would make every caption pointless. The
    // 1px-box + `clip-path` form is the one that keeps it announced.
    const sr = rule('.sr-only');
    expect(sr).toMatch(/clip-path/);
    expect(sr).not.toMatch(/display:\s*none/);
    expect(sr).not.toMatch(/visibility:\s*hidden/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The repo-wide gate.
//
// It DISCOVERS its own files by walking `app/` and `components/`. The first
// version of this gate was handed a frozen list of ten paths, which made its
// headline assertion ("no twelfth table") false advertising: a new file with an
// unwrapped table was invisible to it, because a file not in the list is a file
// it never reads. Discovery is the whole point — the risk this guards is a
// table added LATER, and a later table is exactly the one a hardcoded list
// cannot contain.
// ══════════════════════════════════════════════════════════════════════
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * A `.data-table` in ANY of the shapes this repo writes classNames in — not
 * just the double-quoted literal the eleven current sites happen to use.
 *
 * The first version of this gate matched the fixed string `className="data-table`
 * under prose claiming it covered "every `.data-table`". It did not. A NEW file
 * with a wholly unwrapped table written as `className={cn('data-table', x)}`, as
 * a template literal, or with single quotes killed ZERO tests and passed `tsc`
 * and `eslint` clean. Not hypothetical: dozens of sites under `app/` and
 * `components/` already compose classNames with an expression, and
 * `lib/utils/cn.ts` exists for exactly that.
 *
 * The trailing `(?![\w-])` is not `\b`, and the difference is load-bearing:
 * `\b` matches between `table` and the `-` of `data-table-header`, so a file
 * whose only mention is that class would be discovered, then fail the "wraps
 * each of its tables" check for having no tables at all. Caught by mutation —
 * a false positive that blocks a legitimate file is still a broken gate.
 */
const TABLE_MARK = /className=(?:["'{][^>]{0,200}?)?\bdata-table(?![\w-])/;

/** The same shape, anchored to a `<table>` open tag, for the per-table checks. */
const TABLE_OPEN = /<table\s+className=(?:["'{][^>]{0,200}?)?\bdata-table(?![\w-])/g;

const SOURCES = new Map<string, string>(
  ['app', 'components']
    .flatMap((root) => walk(join(process.cwd(), root)))
    .map((abs) => [relative(process.cwd(), abs), readFileSync(abs, 'utf8')] as const)
    .filter(([, raw]) => TABLE_MARK.test(raw))
    // Whitespace-collapsed, so a `<TableScroll>` open tag broken over several
    // lines still matches — the wrapping is a formatting choice and this gate
    // must not turn red for one.
    .map(([file, raw]) => [file, raw.replace(/\s+/g, ' ')]),
);
const FILES = [...SOURCES.keys()].sort();

// `it.each([])` asserts nothing at all, silently. Discovery that finds nothing
// — a moved directory, a renamed class — would turn this whole gate green and
// empty, so it fails at import instead. Same guard `sdk-matrix-utils.test.ts`
// uses, for the same reason.
if (FILES.length === 0) throw new Error('table discovery found no files — the gate below would be vacuous');

/**
 * Every `<th>` of a table, in order, as a browser would announce it.
 *
 * An empty `<th aria-label="Actions" />` IS a column — the enrollments and
 * webhook tables each have one — so its accessible name comes from the
 * attribute. Returning the raw JSX for anything else is deliberate: if a header
 * ever holds an element rather than text, `parseTables` below fails loudly
 * rather than quietly dropping that column from the correspondence check.
 */
function headerNames(thead: string): string[] {
  return [...thead.matchAll(/<th\b([^>]*?)(?:\/>|>([^<]*)<\/th>)/g)].map((m) => {
    const text = (m[2] ?? '').trim();
    if (text) return text;
    return /aria-label="([^"]*)"/.exec(m[1])?.[1]?.trim() ?? '';
  });
}

/** `"Registry enrollments: authority, base URL and actions"` → the column list. */
function captionColumns(caption: string): string[] {
  const colon = caption.indexOf(': ');
  if (colon < 0) return [];
  return caption
    .slice(colon + 2)
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type ParsedTable = { file: string; caption: string; headers: string[] };

function parseTables(file: string, src: string): ParsedTable[] {
  // From the wrapper's table open tag to the end of its header row. Lazy, so
  // two tables in one file (run-trust-panel) parse as two.
  const blocks = [...src.matchAll(new RegExp(`${TABLE_OPEN.source}[\\s\\S]*?</thead>`, 'g'))].map((m) => m[0]);
  return blocks.map((block) => {
    const caption = /<caption className="sr-only">([^<]*)<\/caption>/.exec(block)?.[1]?.trim() ?? '';
    const headers = headerNames(block);
    // A `<th>` that held an element instead of text would be silently skipped
    // by the matcher, which would weaken the set-equality below into something
    // that passes for the wrong reason. Count first, compare second.
    const declared = (block.match(/<th\b/g) ?? []).length;
    expect(headers.length, `${file}: a <th> was not parseable as plain text or aria-label`).toBe(declared);
    return { file, caption, headers };
  });
}

const TABLES = FILES.flatMap((f) => parseTables(f, SOURCES.get(f)!));

// The names in this block say "every data-table this gate can see", not "every
// data-table", and round 3's gate is why: three shapes escape discovery and
// none of them is one the repo currently writes. A `>` inside a className
// EXPRESSION hides the file (`[^>]` cannot cross it); a SECOND table in an
// already-discovered file is invisible if any attribute precedes its
// `className`; and a table with row headers but no `<thead>` never reaches the
// caption check. Surveyed at the time: of 43 className expressions under `app/`
// and `components/`, none contains a `>`, none uses `cn(`, and all eleven
// tables are `<table className=` first with a `<thead>`. So the claim in the
// docblock — any shape THIS REPO writes — holds; these titles are scoped to
// match it rather than promising the general case.
describe('every data-table this gate can see is wrapped', () => {
  it('discovers the call sites rather than being told them', () => {
    // A lower bound, not an equality: a legitimately-wrapped twelfth table must
    // not turn this red. The per-table checks below are what an unwrapped one
    // fails, and they now run on files that did not exist when this was written.
    //
    // It is a floor in one direction only, and that is a real cost: DELETING a
    // table file legitimately would false-fail here until the number is lowered.
    // Accepted, because the alternative — no floor — lets a broken walker
    // silently empty every `it.each` below, and a deletion arrives with a human
    // who can read this comment while a broken walker does not.
    expect(FILES.length).toBeGreaterThanOrEqual(10);
    expect(TABLES.length).toBeGreaterThanOrEqual(11);
    // And the walker really reaches both roots, so a discovery bug that returns
    // only `components/` cannot pass by coincidence.
    expect(FILES.some((f) => f.startsWith('app/'))).toBe(true);
    expect(FILES.some((f) => f.startsWith('components/'))).toBe(true);
  });

  it.each(FILES)('%s wraps each table this gate parses out of it', (file) => {
    const src = SOURCES.get(file)!;
    const opens = [...src.matchAll(TABLE_OPEN)];
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) {
      // Walk BACKWARDS from the table to the nearest tag open. `<TableScroll[^>]*>`
      // would false-fail the day a label holds a `>` inside an expression; this
      // asks the question that actually matters — what is the immediately
      // enclosing element — and cannot be satisfied by a `TableScroll` that sits
      // elsewhere in the file.
      // Known limitation, loud rather than silent: a JSX comment between the
      // wrapper and the table leaves `before` ending in `}`, which fails here
      // with the message below rather than passing wrongly. Move the comment
      // above the wrapper.
      const before = src.slice(0, open.index).trimEnd();
      expect(before.endsWith('>'), `${file}: table is not the first child of anything`).toBe(true);
      const openedAt = before.lastIndexOf('<');
      expect(
        before.slice(openedAt).startsWith('<TableScroll'),
        `${file}: table at ${open.index} is wrapped by ${before.slice(openedAt, openedAt + 24)}…, not <TableScroll>`,
      ).toBe(true);
    }
  });

  it('gives every wrapper a literal, non-empty, non-over-claiming label', () => {
    for (const [file, src] of SOURCES) {
      const tags = (src.match(/<TableScroll\b/g) ?? []).length;
      const labels = [...src.matchAll(/<TableScroll label="([^"]*)"/g)].map((m) => m[1]);
      // Without this, the loop below is vacuous for any site that passes an
      // expression (`label={x}`) or puts another prop first — the exact shapes a
      // "every wrapper is labelled" check is supposed to catch.
      expect(labels.length, `${file}: a <TableScroll> has no literal label= as its first prop`).toBe(tags);
      for (const label of labels) {
        expect(label.trim().length, `${file}: empty TableScroll label`).toBeGreaterThan(3);
        // "Agent inventory, scrollable" was the first draft. A name should say
        // what the thing IS; whether it scrolls is a property of the moment
        // (it does not, on a wide screen) and assistive tech announces the
        // scroll container itself. Naming it in the label states as fact
        // something that is often false.
        expect(label.toLowerCase(), `${file}: label narrates its own scrollability`).not.toContain('scroll');
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Caption ↔ header correspondence.
//
// The gate above proves a caption EXISTS. That is not the property worth having:
// the first version of this change had all eleven captions present, non-empty
// and over three characters, and TEN of the eleven described columns the table
// does not have — including `app/security/page.tsx`, whose table is the
// revocation feed and whose caption called it "Registry signing keys". A caption
// is the table's accessible NAME: a screen reader announces it on entering the
// table, and still announces each `<th>` per cell in table-navigation mode — it
// does not replace the header row, and an earlier version of this comment said
// it did. What it does is tell a non-sighted user what they have arrived at
// before they navigate a single cell, which is precisely when a wrong one does
// its damage. The verbosity cost is real and accepted: enumerating columns
// means the enrollments table announces seven column names on entry. That is
// the price of a caption a test can check, and the alternative — free prose —
// is how ten of eleven came to be wrong and stay wrong.
//
// THE CAPTION FORMAT IS PART OF THE CONTRACT, deliberately. A caption must read
// "<name>: <col>, <col> and <col>": a free-prose caption — "the most recent runs
// across every scenario" — cannot be checked against anything, and an
// uncheckable caption is how ten of eleven came to be wrong and stay wrong. The
// cost is real and accepted: a future table cannot write a purely descriptive
// caption, and caption copy is now coupled to header copy. That coupling IS the
// feature. The name before the colon is free text and is where a table says
// what it is for.
//
// Both directions are asserted, because they fail independently: a caption can
// omit a real column (incomplete) or name an absent one (false).
// ══════════════════════════════════════════════════════════════════════
describe('each parsed caption enumerates its table’s real columns', () => {
  it.each(TABLES.map((t, i) => [`${t.file} #${i}`, t] as const))(
    '%s names exactly its <th> set',
    (_id, table) => {
      expect(table.headers.length, 'a table with no parsed headers').toBeGreaterThan(0);
      expect(table.caption, `${table.file}: caption must be "<name>: <col>, <col> and <col>"`).toContain(': ');
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const named = captionColumns(table.caption).map(norm).sort();
      const actual = table.headers.map(norm).sort();
      // Set equality, not `toContain`. `toContain` in one direction alone is
      // what let "Registry signing keys" survive: every word it needed was
      // absent, and nothing asked whether the words present were real.
      expect(named, `${table.file}: caption "${table.caption}" vs headers [${table.headers.join(' | ')}]`).toEqual(
        actual,
      );
    },
  );

  it('holds the wrapper LABEL to the caption too — it is the name announced first', () => {
    // The gap this closes: every check above is about the `<caption>`, and the
    // `aria-label` on the group is what a screen reader announces FIRST, on
    // entry, before any of it. Re-labelling the security wrapper "Registry
    // signing keys" while leaving its caption correct — half of the original
    // defect, and the louder half — killed zero tests.
    //
    // Equality with the caption's name part, not with its column list: the two
    // strings answer the same question ("what is this table?") and there is no
    // reason for them to disagree. Where the label and the name genuinely want
    // different words, LABEL_ALIASES records the pair explicitly, so a
    // deliberate difference is a line in this file rather than an absence of
    // checking.
    const LABEL_ALIASES: Record<string, string> = {
      // The feed is of revocations; the rows are the revoked credentials. Both
      // accurate, and the row-level noun is the better caption while the
      // surface-level noun is the better name on entry.
      'Revocation feed': 'Revoked credentials',
    };
    let checked = 0;
    for (const [file, src] of SOURCES) {
      const labels = [...src.matchAll(/<TableScroll label="([^"]*)"/g)].map((m) => m[1]);
      const captions = [...src.matchAll(/<caption className="sr-only">([^<]*)</g)].map((m) => m[1]);
      expect(labels.length, `${file}: label/caption counts differ`).toBe(captions.length);
      for (const [i, label] of labels.entries()) {
        const name = captions[i].split(': ')[0].trim();
        expect(LABEL_ALIASES[label] ?? label, `${file}: wrapper label "${label}" vs caption name "${name}"`).toBe(
          name,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(11);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Real consumer renders. The source gates above can be satisfied by text that
// does not compile into the shape it looks like; these prove the rendered DOM —
// and re-run the correspondence check against what a browser would actually
// build, where the caption and the headers are elements rather than regex hits.
// ══════════════════════════════════════════════════════════════════════
const RUN: CpRun = {
  runId: 'run-1',
  tenantId: 'default',
  scenarioId: 'sc-1',
  status: 'completed',
  startedAt: '2026-08-01T00:00:00Z',
  completedAt: '2026-08-01T00:01:00Z',
  contextsCount: 3,
  registries: ['registry-a.playground.local'],
};

const EVENT: CpContextEvent = {
  id: 'ev-1',
  eventType: 'context_published',
  agentId: 'did:key:z6Mkabc',
  ctxId: 'acdp://registry-a.playground.local/ctx-1',
  registryAuthority: 'registry-a.playground.local',
  runId: 'run-1',
  eventTs: '2026-08-01T00:00:00Z',
  receiptPresent: true,
};

function summary(over: Partial<RunTrustSummary> = {}): RunTrustSummary {
  return {
    audited: 1,
    verified: 0,
    verifiedHistorical: 0,
    structural: 0,
    noReceipt: 0,
    errors: 0,
    flagged: [
      {
        eventId: 'ev-flag',
        ctxId: 'acdp://registry-a.playground.local/ctx-1',
        status: 'discrepancy',
        discrepancies: ['content_hash_mismatch:sha256'],
      },
    ],
    ...over,
  };
}

const REVOKED = {
  eventId: 'ev-1',
  ctxId: 'acdp://registry-a.playground.local/ctx-1',
  status: 'revoked_at_or_after' as const,
  boundary: '2026-08-01 00:00:00+00',
  trustClass: 'producer_signed' as const,
  sources: [],
};

describe('the rendered DOM at four real call sites', () => {
  it.each([
    ['EventsTable', 1, () => render(<EventsTable events={[EVENT]} />)],
    ['RecentRunsTable', 1, () => render(<RecentRunsTable runs={[RUN]} scenarioName={(id: string) => id} />)],
    ['RunsTable', 1, () => render(<RunsTable runs={[RUN]} scenarioName={(id: string) => id} />)],
    ['RunTrustPanel', 2, () => render(<RunTrustPanel trust={summary({ revoked: [REVOKED] })} />)],
  ] as const)('%s puts each table in a named focusable group that matches its caption', (_name, count, mount) => {
    const { container } = mount();
    const tables = [...container.querySelectorAll('table.data-table')];
    expect(tables).toHaveLength(count);
    for (const table of tables) {
      const group = table.parentElement as HTMLElement;
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(3);
      expect(group.tabIndex).toBe(0);

      // The same correspondence as the source gate, but through the DOM: this
      // reads the `<th>` elements a browser builds and the caption it announces,
      // so a header emitted by a map or a caption assembled from a variable is
      // still held to it.
      const caption = table.querySelector('caption.sr-only')?.textContent ?? '';
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const headers = [...table.querySelectorAll('thead th')].map((th) =>
        norm(th.textContent || th.getAttribute('aria-label') || ''),
      );
      expect(headers.every((h) => h.length > 0)).toBe(true);
      expect(captionColumns(caption).map(norm).sort()).toEqual([...headers].sort());
    }
    // The container is never a landmark, at any call site.
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
  });
});

describe('the run trust panel keeps the spacing it had', () => {
  it('moves the conditional margin onto the wrapper and still applies it', () => {
    // The margin was inline on the `<table>`. A margin on a child of an
    // `overflow` container still applies, but the visual result differs once the
    // child can be wider than the parent — so it belongs on the wrapper, and
    // this asserts it arrived there rather than being dropped in the move.
    const { container } = render(<RunTrustPanel trust={summary({ revoked: [REVOKED] })} />);
    const groups = container.querySelectorAll('.table-scroll');
    expect(groups).toHaveLength(2);
    expect((groups[0] as HTMLElement).style.marginBottom).toBe('14px');
    // And the table itself no longer carries it.
    expect(groups[0].querySelector('table')?.getAttribute('style')).toBeNull();
  });

  it('drops the margin when there is no second table below it', () => {
    const { container } = render(<RunTrustPanel trust={summary()} />);
    const groups = container.querySelectorAll('.table-scroll');
    expect(groups).toHaveLength(1);
    expect((groups[0] as HTMLElement).style.marginBottom).toBe('0px');
  });
});

describe('which .did elements the dropped cap actually affected', () => {
  // The claim in `globals.css` is a partition of every element matching
  // `.data-table .did` into the ones the deleted `max-width`/`overflow`/
  // `text-overflow` rules could not reach and the three they could. A partition
  // stated in a comment is a claim nothing checks — which is exactly how the
  // unqualified "provably inert" survived two gate rounds. So it is enumerated
  // here from the same sources the wrapper gate walks.
  //
  // A FOURTH non-cell `.did` appearing under a `.data-table` should fail this
  // and be re-derived, not waved through: whether the rules reached it depends
  // on its display, and the answer is not the same for a cell, an inline span
  // and a flex item.
  const CELL = /<td([^>]*?)className="did"/g;
  const NON_CELL = /<(?!td\b)(\w+)([^>]*?)className="did"/g;

  /**
   * Every `.did` element in a file that contains a `.data-table`.
   *
   * Re-read from disk rather than taken from `SOURCES`, which is whitespace-
   * collapsed so the wrapper gate survives a reformat — that collapse makes
   * every match report line 1, and a line number nobody can act on is worse
   * than none.
   */
  function didElements() {
    const cells: string[] = [];
    const others: Array<{ file: string; line: number; tag: string }> = [];
    for (const file of FILES) {
      const raw = readFileSync(join(process.cwd(), file), 'utf8');
      for (const m of raw.matchAll(CELL)) cells.push(`${file}:${lineOf(raw, m.index!)}`);
      for (const m of raw.matchAll(NON_CELL)) {
        others.push({ file, line: lineOf(raw, m.index!), tag: m[1] });
      }
    }
    return { cells, others };
  }

  function lineOf(raw: string, index: number): number {
    return raw.slice(0, index).split('\n').length;
  }

  it('finds the cells, and they are the bulk of them', () => {
    const { cells } = didElements();
    // `max-width` is undefined on a table cell (CSS 2.1 §10.4) and auto table
    // layout sizes the column to content, so none of these was ever capped.
    expect(cells.length).toBeGreaterThanOrEqual(18);
  });

  it('pins the NON-CELL .did elements, which is where the behaviour changed', () => {
    const { others } = didElements();
    const ids = others.map((o) => `${o.file}:${o.tag}:${o.line}`).sort();
    // Seven matches live in table files. Only five of them are inside a
    // `.data-table` in the DOM — `agents/page.tsx`'s is in the recent-activity
    // list beside the table and `security/page.tsx`'s is in the JWKS card, so
    // the selector never reached either. Both are listed so the count is
    // reproducible from this file rather than taken on trust.
    expect(ids).toEqual([
      'app/agents/page.tsx:span:112', // NOT in a table — activity list
      'app/security/page.tsx:div:224', // NOT in a table — JWKS card
      'app/trust/page.tsx:span:292', // flex item — WAS capped
      'app/trust/page.tsx:span:312', // inline in a <td> — inert (§10.4)
      'app/trust/page.tsx:span:329', // inline in a <td> — inert (§10.4)
      'components/runs/run-trust-panel.tsx:span:138', // flex item — WAS capped
      'components/runs/run-trust-panel.tsx:span:185', // flex item — WAS capped
    ]);
  });

  it('MEASURES the three that were capped: each is a blockified flex item', () => {
    // The derivation that matters, taken off the rendered DOM rather than read
    // off the source. CSS Flexbox §4 blockifies a flex item, and a blockified
    // box is not a non-replaced inline, a table row or a row group — the three
    // things CSS 2.1 §10.4 excludes — so `max-width` applied to these and the
    // ellipsis rendered. jsdom performs no layout, so this asserts the
    // STRUCTURE the derivation turns on, not a pixel width.
    // `REVOKED.sources` is empty, and an empty `sources` renders no span at
    // all — so the default fixture would make this vacuous. One source is what
    // puts a `span.did` inside the flex column.
    const { container } = render(
      <RunTrustPanel
        trust={summary({
          revoked: [
            {
              ...REVOKED,
              sources: [
                { ctxId: 'acdp://registry-a.playground.local/c4f1a2b3', publisher: 'did:web:registry-a.local:agents:cross-a' },
              ],
            },
          ],
        })}
      />,
    );
    const spans = [...container.querySelectorAll('table.data-table span.did')];
    expect(spans.length).toBeGreaterThanOrEqual(1);
    for (const span of spans) {
      const parent = span.parentElement as HTMLElement;
      expect(parent.style.display).toBe('flex');
    }
  });

  it('DISCRIMINATES: a .did that is a table cell is not a flex item', () => {
    const { container } = render(<RunTrustPanel trust={summary({ revoked: [REVOKED] })} />);
    const cells = [...container.querySelectorAll('table.data-table td.did')];
    expect(cells.length).toBeGreaterThanOrEqual(1);
    for (const cell of cells) {
      expect((cell.parentElement as HTMLElement).style.display).not.toBe('flex');
    }
  });
});

describe('the lineage page’s two flex rows can shrink', () => {
  // Not tables, but the same defect and the same page. Asserted on the source
  // because the page needs a router, a query client and three hooks to render,
  // none of which these claims depend on.
  const src = readFileSync(join(process.cwd(), 'app/lineage/page.tsx'), 'utf8').replace(/\s+/g, ' ');

  it('caps the run picker at the container width', () => {
    // A fixed 320px child in a non-wrapping flex row cannot shrink, so it pushed
    // `.content` sideways exactly as the tables did.
    expect(src).toMatch(/flexWrap: 'wrap'[^}]*justifyContent: 'flex-end'/);
    expect(src).toMatch(/width: 320, maxWidth: '100%'/);
  });

  it('lets the lineage_id input shrink below its intrinsic width', () => {
    // Missed on the first pass, and the subtler of the two: `flex: 1` is
    // `1 1 0%`, but a flex item's `min-width` is `auto`, which for a text input
    // resolves to the intrinsic width of its default `size=20` — about 180px it
    // will not give up. With the fixed 130px select and the button beside it the
    // row cannot fit 400px. `minWidth: 0` is the half that actually lets it
    // shrink, so both halves are pinned.
    expect(src).toMatch(/flex: 1, minWidth: 0/);
    expect(src).toMatch(/display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14/);
  });
});

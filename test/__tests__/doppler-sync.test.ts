// @vitest-environment node
//
// deploy/doppler-sync.sh runs for real (bash, git, jq, shasum) against a
// throwaway git repo, with fake `doppler`, `vercel` and `curl` binaries first on
// PATH. The fake curl serves a small in-memory Vercel API backed by a JSON
// state file and logs every argv it receives, so the tests prove what was
// written, where, and that no secret value or token ever reaches a command line
// or the output. Ported from aitp-website's scripts/test_doppler_sync.py.
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../deploy/doppler-sync.sh');
const TOKEN = 'tok-SENTINEL-4f1c';
const SECRET = 's3cr3t-VALUE-9a7e';

const FAKE_CURL = String.raw`#!/usr/bin/env python3
import json, os, re, sys
state_path = os.environ["FAKE_VERCEL_STATE"]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write("curl " + json.dumps(sys.argv[1:]) + "\n")
args = sys.argv[1:]
url, method, headers, data = None, "GET", [], None
i = 0
while i < len(args):
    a = args[i]
    if a == "-X": method = args[i + 1]; i += 2; continue
    if a == "-H": headers.append(args[i + 1]); i += 2; continue
    if a == "-o": i += 2; continue
    if a in ("--data-binary", "--data"): data = args[i + 1]; i += 2; continue
    if a.startswith("http"): url = a
    i += 1
auth = []
for h in headers:
    if h.startswith("@"):
        with open(h[1:]) as f: auth += [l.strip() for l in f if l.strip()]
    else:
        auth.append(h)
if "Authorization: Bearer " + os.environ["EXPECT_TOKEN"] not in auth:
    sys.stderr.write("fake curl: missing auth\n"); sys.exit(22)
with open(state_path) as f: st = json.load(f)
path = "/" + url.split("://", 1)[1].split("/", 1)[1].split("?", 1)[0]
def out(o): sys.stdout.write(json.dumps(o)); sys.exit(0)
if method == "GET" and os.environ.get("FAKE_GET_FAIL") == path.split("/")[1]: sys.exit(22)
if method == "GET" and re.fullmatch(r"/v9/projects/[^/]+/env", path):
    out({"envs": [{k: e[k] for k in ("id", "key", "type", "target", "gitBranch", "updatedAt")} for e in st["envs"]]})
m = re.fullmatch(r"/v1/projects/[^/]+/env/([^/]+)", path)
if method == "GET" and m:
    e = next(e for e in st["envs"] if e["id"] == m.group(1))
    if e["type"] == "sensitive": out({"id": e["id"]})
    out({"id": e["id"], "value": e["value"]})
def body():
    return json.loads(sys.stdin.read() if data == "@-" else data)
def save():
    with open(state_path, "w") as f: json.dump(st, f)
def logw(kind, o):
    with open(os.environ["FAKE_LOG"], "a") as log: log.write(kind + " " + json.dumps(o) + "\n")
if method == "POST" and re.fullmatch(r"/v10/projects/[^/]+/env", path):
    if os.environ.get("FAKE_WRITE_FAIL"): sys.exit(22)
    b = body()
    logw("post", {k: b[k] for k in ("key", "type", "target")})
    if any(e["key"] == b["key"] and set(e["target"]) & set(b["target"]) for e in st["envs"]): sys.exit(22)
    st["envs"].append({"id": "env_new_" + b["key"], "key": b["key"], "type": b["type"],
                       "target": b["target"], "gitBranch": None, "updatedAt": 2, "value": b["value"]})
    save(); out({"created": {}})
m = re.fullmatch(r"/v9/projects/[^/]+/env/([^/]+)", path)
if method == "PATCH" and m:
    if os.environ.get("FAKE_WRITE_FAIL"): sys.exit(22)
    b = body()
    logw("patch", {"id": m.group(1), "fields": sorted(b), "type": b.get("type")})
    e = next(e for e in st["envs"] if e["id"] == m.group(1))
    e["value"] = b["value"]; e["updatedAt"] += 1
    if "type" in b: e["type"] = b["type"]
    save(); out({})
if method == "GET" and path == "/v6/deployments":
    out({"deployments": [{"uid": d} for d in st.get("deployments", [])]})
sys.stderr.write("fake curl: unexpected " + method + " " + path + "\n"); sys.exit(22)
`;

const FAKE_DOPPLER = `#!/usr/bin/env bash
printf 'doppler %s\\n' "$*" >> "$FAKE_LOG"
case "$1" in
  me) exit 0 ;;
  secrets) [ -n "\${FAKE_DOPPLER_FAIL:-}" ] && exit 1; cat "$FAKE_DOPPLER_JSON" ;;
  *) exit 1 ;;
esac
`;

const FAKE_VERCEL = `#!/usr/bin/env bash
printf 'vercel %s\\n' "$*" >> "$FAKE_LOG"
exit 0
`;

interface Env {
  id: string;
  key: string;
  type: string;
  target: string[];
  gitBranch: null;
  updatedAt: number;
  value: string;
}
function entry(key: string, value: string, opts: { target?: string[]; type?: string; id?: string } = {}): Env {
  return {
    id: opts.id ?? `env_${key}`,
    key,
    type: opts.type ?? 'encrypted',
    target: opts.target ?? ['production'],
    gitBranch: null,
    updatedAt: 1,
    value,
  };
}

let tmp: string;
let repo: string;
let bin: string;
let log: string;
let state: string;
let doppler: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'doppler-sync-test-'));
  repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'deploy'), { recursive: true });
  copyFileSync(SCRIPT, join(repo, 'deploy', 'doppler-sync.sh'));
  bin = join(tmp, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [
    ['curl', FAKE_CURL],
    ['doppler', FAKE_DOPPLER],
    ['vercel', FAKE_VERCEL],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  log = join(tmp, 'calls.log');
  writeFileSync(log, '');
  state = join(tmp, 'vercel.json');
  doppler = join(tmp, 'doppler.json');
  setVercel([]);
  setDoppler({});
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function git(...args: string[]) {
  execFileSync('git', ['-C', repo, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    stdio: 'pipe',
  });
}
function commitKeys(...lines: string[]) {
  writeFileSync(join(repo, 'deploy', 'doppler-keys.txt'), `# managed keys\n${lines.map((l) => `${l}\n`).join('')}`);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'keys', '--allow-empty');
}
function setVercel(envs: Env[], deployments: string[] = ['dpl_latest']) {
  writeFileSync(state, JSON.stringify({ envs, deployments }));
}
function setDoppler(secrets: Record<string, string>) {
  writeFileSync(doppler, JSON.stringify(secrets));
}
function runSync(args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync('bash', ['deploy/doppler-sync.sh', ...args], {
    cwd: repo,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VERCEL_TOKEN: TOKEN,
      EXPECT_TOKEN: TOKEN,
      FAKE_LOG: log,
      FAKE_VERCEL_STATE: state,
      FAKE_DOPPLER_JSON: doppler,
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const calls = readFileSync(log, 'utf8');
  for (const blob of [r.stdout, r.stderr, calls]) {
    expect(blob, 'secret value leaked').not.toContain(SECRET);
    expect(blob, 'token leaked onto argv or output').not.toContain(TOKEN);
  }
  return { code: r.status, stderr: r.stderr };
}
function calls(prefix: string): string[] {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith(`${prefix} `));
}
const writes = () => [...calls('post'), ...calls('patch')];
const redeploys = () => calls('vercel').filter((c) => c.includes('redeploy'));
const envCliCalls = () => calls('vercel').filter((c) => / env /.test(c));
function vercelEntry(key: string): Env {
  return (JSON.parse(readFileSync(state, 'utf8')).envs as Env[]).find((e) => e.key === key)!;
}

describe('doppler-sync.sh: a failed read stops the run with nothing written', () => {
  it.each([
    ['the Vercel list read', 'v9'],
    ['a per-entry Vercel read', 'v1'],
  ])('%s', (_label, failing) => {
    // A shared entry exists: if a failed read looked like "no entry" the
    // script would report "new" and write. It must stop instead.
    commitKeys('SITE_FLAG', 'OTHER_FLAG');
    setDoppler({ SITE_FLAG: SECRET, OTHER_FLAG: SECRET });
    setVercel([entry('SITE_FLAG', 'old', { target: ['production', 'preview'] }), entry('OTHER_FLAG', 'old')]);
    for (const mode of [[], ['--apply']]) {
      const r = runSync(mode, { FAKE_GET_FAIL: failing });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('reading Vercel environment variables failed');
      expect(r.stderr).not.toMatch(/: (new|changed)$/m);
    }
    expect(writes()).toEqual([]);
    expect(redeploys()).toEqual([]);
  });

  it('a failed Doppler read', () => {
    commitKeys('SITE_FLAG');
    setVercel([entry('SITE_FLAG', 'old')]);
    const r = runSync(['--apply'], { FAKE_DOPPLER_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('reading Doppler acdp-ui-console/prd failed');
    expect(writes()).toEqual([]);
    expect(redeploys()).toEqual([]);
  });
});

describe('doppler-sync.sh: writes go through the REST API, never `vercel env`', () => {
  it('--push updates a sensitive entry by PATCH {value, type: sensitive}', () => {
    commitKeys('ACDP_UI_CONSOLE_PASSWORD sensitive');
    setDoppler({ ACDP_UI_CONSOLE_PASSWORD: SECRET });
    setVercel([entry('ACDP_UI_CONSOLE_PASSWORD', 'unreadable', { type: 'sensitive' })]);
    const r = runSync(['--apply', '--push', 'ACDP_UI_CONSOLE_PASSWORD']);
    expect(r.code, r.stderr).toBe(0);
    expect(calls('patch').map((c) => JSON.parse(c.slice(6)))).toEqual([
      { id: 'env_ACDP_UI_CONSOLE_PASSWORD', fields: ['type', 'value'], type: 'sensitive' },
    ]);
    expect(vercelEntry('ACDP_UI_CONSOLE_PASSWORD').value).toBe(SECRET);
    expect(envCliCalls()).toEqual([]);
    expect(redeploys()).toHaveLength(1);
  });

  it('without --push a sensitive entry is left alone', () => {
    commitKeys('ACDP_UI_CONSOLE_PASSWORD sensitive');
    setDoppler({ ACDP_UI_CONSOLE_PASSWORD: SECRET });
    setVercel([entry('ACDP_UI_CONSOLE_PASSWORD', 'unreadable', { type: 'sensitive' })]);
    const r = runSync(['--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('ACDP_UI_CONSOLE_PASSWORD: sensitive-unverifiable');
    expect(writes()).toEqual([]);
    expect(redeploys()).toEqual([]);
  });

  it('a new key is POSTed production-only with its class; a changed key is PATCHed {value}; one redeploy', () => {
    commitKeys('SITE_FLAG', 'NEW_SECRET sensitive');
    setDoppler({ SITE_FLAG: SECRET, NEW_SECRET: `${SECRET}-2` });
    setVercel([entry('SITE_FLAG', 'old')]);
    const r = runSync(['--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(calls('post').map((c) => JSON.parse(c.slice(5)))).toEqual([
      { key: 'NEW_SECRET', type: 'sensitive', target: ['production'] },
    ]);
    expect(calls('patch').map((c) => JSON.parse(c.slice(6)))).toEqual([
      { id: 'env_SITE_FLAG', fields: ['value'], type: null },
    ]);
    expect(vercelEntry('SITE_FLAG').value).toBe(SECRET);
    expect(envCliCalls()).toEqual([]);
    expect(redeploys()).toHaveLength(1);
    expect(redeploys()[0]).toContain('dpl_latest --target production');
    // Every API call carried the token in a header file, never in argv.
    for (const c of calls('curl')) expect(c).not.toContain('Bearer');
  });

  it('unchanged keys write nothing and do not redeploy', () => {
    commitKeys('SITE_FLAG');
    setDoppler({ SITE_FLAG: SECRET });
    setVercel([entry('SITE_FLAG', SECRET)]);
    const r = runSync(['--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('SITE_FLAG: unchanged');
    expect(writes()).toEqual([]);
    expect(redeploys()).toEqual([]);
  });

  it('an empty Doppler value is refused before any write', () => {
    commitKeys('SITE_FLAG');
    setDoppler({ SITE_FLAG: '' });
    setVercel([entry('SITE_FLAG', 'old')]);
    const r = runSync(['--apply']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('Doppler value for SITE_FLAG is empty');
    expect(writes()).toEqual([]);
    expect(redeploys()).toEqual([]);
  });

  it('a shared entry is reported and never written', () => {
    commitKeys('SITE_FLAG');
    setDoppler({ SITE_FLAG: SECRET });
    setVercel([entry('SITE_FLAG', 'old', { target: ['production', 'preview'] })]);
    const r = runSync(['--apply']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('SITE_FLAG: shared-with-other-environments');
    expect(writes()).toEqual([]);
  });

  it('a failed write stops before the redeploy', () => {
    commitKeys('SITE_FLAG');
    setDoppler({ SITE_FLAG: SECRET });
    setVercel([entry('SITE_FLAG', 'old')]);
    const r = runSync(['--apply'], { FAKE_WRITE_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('updating SITE_FLAG failed');
    expect(redeploys()).toEqual([]);
  });

  it('the dry run reports and writes nothing', () => {
    commitKeys('SITE_FLAG');
    setDoppler({ SITE_FLAG: SECRET });
    setVercel([entry('SITE_FLAG', 'old')]);
    const r = runSync([]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toContain('SITE_FLAG: changed');
    expect(r.stderr).toContain('would change');
    expect(writes()).toEqual([]);
  });
});

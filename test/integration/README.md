# Real-backend integration suite

Playwright specs that drive a production build of this console (`next build && next start`, demo mode
off) against a real `acdp-playground` stack. It is not run by `npm test` or by CI. The full description
is in [`docs/testing.md`](../../docs/testing.md#real-backend-integration-suite); this file is the setup.

## One-time setup

```bash
npm ci
npx playwright install chromium                  # first run only
```

## Run

```bash
# other terminal; playground, control plane, both registries, with the playground key enforced
cd ../acdp-playground && LLM_PROVIDER=mock PLAYGROUND_API_KEY=acdp-ui-console-integration-playground-key PLAYGROUND_REQUIRE_API_KEY=true make up-full
npm run test:integration
```

The key is a test-only constant (`PLAYGROUND_API_KEY` in `playwright.config.ts`), not a secret. With
`PLAYGROUND_REQUIRE_API_KEY=true` a keyless playground call answers 401, so every passing spec proves the
console sent `x-api-key`.

`global-setup.ts` fails fast, naming the command above, if any backend is unreachable or a keyless
playground call is not refused with 401. It then seeds three real runs (`s1_single_publish`,
`s5_cross_registry`, `s22_receipts`, keyed, from a random `X-ACDP-Client-IP`) and signs in through the real
`/login` form, saving the session to `test/integration/.auth/session.json` (gitignored).

One build, two servers: port 3100 with `ACDP_UI_PUBLIC_MODE` off (every spec at the top level, signed in)
and port 3101 with it on (`public/`, the Playwright project `public`, an anonymous visitor). The public
project sends a random `x-real-ip` from `198.18.0.0/15` each run (`ACDP_UI_CLIENT_IP_HEADER=x-real-ip`),
so the console's and the playground's per-IP limits never carry over between runs.

The LLM quota badge spec (`public/public-mode.spec.ts`) is skipped unless `ACDP_INTEGRATION_LLM_QUOTA=1`.
It needs a real-provider stack with `LLM_QUOTA_PER_IP_PER_DAY=1` (the playground requires a value above 0),
so it makes at most one real LLM call per run; run it through `/live-test`.

## Overrides

Defaults match the playground's `docker-compose.full.yml`; set these only if your stack differs:
`ACDP_UI_INTEGRATION_PORT` (3100; the public server takes the next port), `PLAYGROUND_URL`,
`CONTROL_PLANE_URL`, `REGISTRY_A_URL`, `REGISTRY_B_URL` (reachability checks only; the console reaches
registries through the playground), `PLAYGROUND_API_KEY`, `CONTROL_PLANE_API_KEY`,
`CONTROL_PLANE_READ_API_KEY`, `ACDP_UI_CONSOLE_PASSWORD`, `ACDP_UI_INTEGRATION_CLIENT_IP`. See
[`playwright.config.ts`](../../playwright.config.ts).

Several pages (registries observed via webhooks, per-registry JWKS) are *expected* to be empty in that
stack — it ships with registry webhooks disabled and HS256 signing — and the specs assert that emptiness.

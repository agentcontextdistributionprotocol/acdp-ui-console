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
cd ../acdp-playground && LLM_PROVIDER=mock make up-full   # other terminal; playground, control plane, both registries
npm run test:integration
```

`global-setup.ts` fails fast, naming the command above, if any backend is unreachable. It then seeds three
real runs (`s1_single_publish`, `s5_cross_registry`, `s22_receipts`) and signs in through the real `/login`
form, saving the session to `test/integration/.auth/session.json` (gitignored).

## Overrides

Defaults match the playground's `docker-compose.full.yml`; set these only if your stack differs:
`ACDP_UI_INTEGRATION_PORT` (3100), `PLAYGROUND_URL`, `CONTROL_PLANE_URL`, `REGISTRY_A_URL`,
`REGISTRY_B_URL`, `CONTROL_PLANE_API_KEY`, `ACDP_UI_CONSOLE_PASSWORD`. See
[`playwright.config.ts`](../../playwright.config.ts).

Several pages (registries observed via webhooks, per-registry JWKS) are *expected* to be empty in that
stack — it ships with registry webhooks disabled and HS256 signing — and the specs assert that emptiness.

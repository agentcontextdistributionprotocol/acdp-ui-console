# ACDP UI Console Documentation

The **ACDP UI Console** is a Next.js (App Router) web console for the Agent Context
Distribution Protocol (ACDP). From one browser tab you can launch playground
scenarios, watch a run's events arrive live, browse and inspect contexts in the
registries, follow lineage across registries, and see the control plane's trust and
security state: receipt coverage, revocations, JWKS, and transparency-log witnesses.

It is a **client**. It does not implement the protocol, run a registry, or issue
tokens. Every call goes through the console's own server-side proxy
(`app/api/proxy/[service]/[...path]/route.ts`) and SSE relays (`app/api/stream/*`) to
four upstream services: the playground, the control plane, and two registries. The
browser never contacts those services directly. With demo mode on (the default),
every page runs on built-in mock data (`lib/data/mock-data.ts`) and no backend is
needed at all.

## Scope of these docs

These docs cover **only what is specific to the console**: how its proxy and relays
sit between the browser and the backends, what each page shows, how it computes
trust verdicts in the browser (via `@agentcontextdistributionprotocol/acdp-wasm`),
its operator passphrase gate, its own environment variables, how it is built and
deployed, and how it is tested.

If a topic belongs to another project, these docs link to it and don't repeat it.
Backend routes and `errorCode`s are documented by the control plane and the registry.
Scenario behaviour is documented by the playground. Signature, canonicalization and
verifier semantics are documented by the SDK. Protocol rules are documented by the
spec. The **[Related projects](#related-projects)** table below says where each one
lives.

## Documentation map

| Document | What it covers |
|----------|----------------|
| [README](README.md) | This index: what the console is, scope, where to look next |
| [Getting started](getting-started.md) | Install, run in demo mode, connect to a real stack, sign in |
| [Architecture](architecture.md) | Browser → proxy/relay → backend flow, demo/real branching, state management |
| [Pages](pages.md) | What each page shows and where its data comes from |
| [Trust & verification](trust-and-verification.md) | The in-browser verdict core (`lib/verify/`) and the revocation model the trust surfaces derive from |
| [Authentication](authentication.md) | The single-operator passphrase gate (`middleware.ts`, `/api/auth/*`) |
| [Configuration](configuration.md) | The console's own environment variables and per-browser preferences |
| [Deployment](deployment.md) | Vercel, the standalone Docker image, the GHCR publish, production requirements |
| [Testing](testing.md) | The Vitest suite, coverage scope, the Playwright real-backend suite, and CI |

## Related projects

The console is one repo in the ACDP family. Each project maintains its own docs, and
these are the places to go for the authoritative details:

| Project | Repo | Owns the docs for |
|---------|------|-------------------|
| **Spec / RFCs** | [`agentcontextdistributionprotocol`](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/rfcs/README.md) | The protocol, the error-code registry, version compatibility |
| **SDK** (`acdp-rs`) | [`acdp-rs`](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/bindings/acdp-wasm/README.md) | The `acdp-wasm` verifier the console loads, its error taxonomy |
| **Registry** | [`acdp-registry-rs`](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/README.md) | Registry HTTP API, receipts, webhooks, auth/JWKS, configuration |
| **Control plane** | [`acdp-control-plane`](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/README.md) | Runs/events API, auth, tenancy, revocation, log-witness, configuration |
| **Playground** | [`acdp-playground`](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/README.md) | The run API, the scenario catalog, the `make up-full` stack the console runs in |
| **Shared CI** | [`acdp-ci`](https://github.com/agentcontextdistributionprotocol/acdp-ci/blob/main/README.md) | The reusable `auto-merge` and `bump-consume` workflows this repo calls |
| **Ecosystem** | [`acdp-docs`](https://github.com/agentcontextdistributionprotocol/acdp-docs/blob/main/README.md) | Cross-repo map and agent-readable index |

### Sibling docs the console relies on

| Topic | Read |
|-------|------|
| Control-plane routes, `errorCode`s, `/healthz`, enrollment, log-witness, revocations | [control-plane API.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/API.md) |
| Control-plane bearer auth and tenancy | [AUTH.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/AUTH.md) · [TENANCY.md](https://github.com/agentcontextdistributionprotocol/acdp-control-plane/blob/main/docs/TENANCY.md) |
| Registry search, lineages, `.well-known/*` | [registry HTTP-API.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/HTTP-API.md) |
| Receipts, webhooks, registry auth/JWKS | [RECEIPTS.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/RECEIPTS.md) · [WEBHOOKS.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/WEBHOOKS.md) · [AUTHENTICATION.md](https://github.com/agentcontextdistributionprotocol/acdp-registry-rs/blob/main/docs/AUTHENTICATION.md) |
| Playground run API, scenarios, local stack | [http-api.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/http-api.md) · [scenarios.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/scenarios.md) · [getting-started.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/getting-started.md) · [deployment.md](https://github.com/agentcontextdistributionprotocol/acdp-playground/blob/main/docs/deployment.md) |
| `acdp-wasm` surface, bindings, errors | [acdp-wasm README](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/bindings/acdp-wasm/README.md) · [bindings.md](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/docs/bindings.md) · [errors.md](https://github.com/agentcontextdistributionprotocol/acdp-rs/blob/main/docs/errors.md) |
| Protocol error codes and version matrix | [error-codes.md](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/registries/error-codes.md) · [version-matrix.md](https://github.com/agentcontextdistributionprotocol/agentcontextdistributionprotocol/blob/main/docs/version-matrix.md) |
| Ecosystem overview | [ecosystem map](https://github.com/agentcontextdistributionprotocol/acdp-docs/blob/main/kb/ecosystem-map.md) · [console knowledge-base entry](https://github.com/agentcontextdistributionprotocol/acdp-docs/blob/main/kb/repos/acdp-ui-console.md) |

These docs were last checked against **`@agentcontextdistributionprotocol/acdp-wasm`
`^0.14.4`** (the version range in `package.json`). That records what was checked, not
a compatibility promise. The spec's version matrix is where to check which versions
work together.

## Repo links

- **Project README:** [`../README.md`](../README.md)
- **Example environment:** [`../.env.example`](../.env.example)

> These docs are **not** published on the ACDP docs website. The website's
> content sync intentionally skips this repo: the console is hosted separately and
> only linked from the site navbar (see
> [`acdp-website` `scripts/sync-content.sh`](https://github.com/agentcontextdistributionprotocol/acdp-website/blob/main/scripts/sync-content.sh)).
> This repo's `.github/workflows/notify-website.yml` still sends a `docs-updated`
> dispatch when `docs/**` or `README.md` changes on `main`, but the website does not
> pull this repo's content in response. Read these files on GitHub.

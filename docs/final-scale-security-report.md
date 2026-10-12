# Final report — scalability & security hardening (AGENTOS_SCALE_SECURITY M13)

Run date: 2026-10-12. Brief: `AGENTOS_SCALE_SECURITY.md` (13 milestones, M1–M13).
Cost of this entire pass: **$0** — not one provider call was made; every paid-path
behaviour is proven through an injected fake transport.

Baseline: `docs/baseline-audit.md`. Reasoning and tradeoffs:
`docs/scale-security-decisions.md`. This file is the gate ledger and the honest status.

## 1. Gates run against the hardened build

Arm under test: production build `.next-t9`, BUILD_ID `1LO-PoQc4-6Y_ex-_QSVA`, `next start`
on `:3500`. Control arm (pre-change): `.next-t8c`, BUILD_ID `uTmOWqKYJlN3GXdHpXYwh`, on
`:3400`. The owner's dev server on `:3000` was never touched and is not the source of any
number here.

| # | gate | result | evidence |
| --- | --- | --- | --- |
| G1 | production build (Turbopack, React Compiler `panicThreshold: all_errors`) | PASS ×2 | `pnpm build` exit 0 twice (before and after the final edits) |
| G2 | `tsc --noEmit` | PASS | 0 errors |
| G3 | `eslint --max-warnings=0` over every changed/new file | PASS | 0 problems |
| G4 | unit tests (`provider-fetch`, `auth-form-rules`, `route-gate`) | PASS 20/20 | `node --import ./scripts/register-ts.mjs --test …` |
| G5 | rate limiter + audit trail against the live database | PASS 8/8 | `node --import ./scripts/register-ts.mjs --import ./scripts/register-no-server-only.mjs scripts/verify-scale-security.mts` |
| G6 | security headers on `/` | PASS 8/8 | CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS — control build: **0 of 6** |
| G7 | `/api/*` requires a session | PASS | `/api/dashboard`, `/api/spend` (GET), `/api/chat`, `/api/agentos` (POST) → 401 `{"error":"Unauthorized"}`; control: **5× 200 with real dashboard JSON** |
| G8 | the internal identity header cannot be forged | PASS | `curl -H "x-agentos-user-id: <uuid>" /api/dashboard` → still 401 (proxy overwrites/deletes it) |
| G9 | page gate intact | PASS | `/app` → 307 `/login?next=%2Fapp`; `/login` → 200; `/` → 200 |
| G10 | per-user feeds are cached `private`, never shared | PASS | `/api/dashboard` carries `Cache-Control: private, max-age=15, stale-while-revalidate=60` |
| G11 | load behaviour, 100 concurrent | IMPROVED, criterion partially met | see §2 |
| G12 | repo guardrails | PASS | `check:env` 12 vars all declared; `check:secrets` exit 0; `check:rls` → RLS on all 21 tables, no policies, no FORCE |
| G13 | no animation/motion code changed | PASS | 0 of the 34 changed paths are landing/motion components; the one UI file is `src/components/auth/auth-form.tsx` (a placeholder string) |
| G14 | client payload | PASS (+47 kB build-wide) | `.next-t8c` 16.37 MB/254 js files → `.next-t9` 16.42 MB/256 (the 2 new files are server route chunks) |
| G15 | zero paid calls | PASS | no provider request was issued; `provider-fetch` proven with an injected fake; DB scripts are read-only or write to the two new tables |

## 2. Load: 100 concurrent requests, same machine, same probe, both builds

`MSYS_NO_PATHCONV=1 node scripts/load-probe.mjs <origin> 100 100 / /login /api/dashboard`

| URL | before (`.next-t8c`) p50 / p95 / errors | after (`.next-t9`) p50 / p95 / errors |
| --- | --- | --- |
| `/` (SSR landing) | 5 460 ms / 5 583 ms / 0 | 5 248 ms / 5 374 ms / 0 |
| `/login` | 2 403 ms / 2 592 ms / 0 | 2 366 ms / 2 637 ms / 0 |
| `/api/dashboard` | **13 589 ms / 13 809 ms / 95 errors (500)**, 5× 200 | **373 ms / 646 ms / 0 errors**, 100× 401 |

Read the API row as the headline: unauthenticated traffic used to reach the route handler
and its database work, so 100 concurrent anonymous requests saturated the pool and 95%
failed with 500s while 5 got real data. Now the edge answers 401 before any handler runs —
21× lower p95 and zero errors.

The page rows are unchanged within noise, which is the point: the hardening added no
per-request work to page rendering.

**§10 criterion "100 concurrent users, p95 < 500 ms, 0 errors": NOT MET for SSR pages as
measured here, and the measurement is not the production reality.** One `next start`
process on the owner's laptop renders 100 concurrent copies of the heaviest page in the
product; on Vercel each request is a lambda and concurrency is spread across many
isolates. What this probe legitimately bounds is per-request CPU work, and it shows the
security layer added none to the page path (`/` and `/login` are within 4% of the control).

## 3. §10 success criteria, scored honestly

| criterion | verdict |
| --- | --- |
| 100 concurrent, p95 < 500 ms, 0 errors | **PARTIAL** — met on the API path (646 ms, 0 errors vs 13.8 s, 95 errors); not met for SSR pages in a single-process local probe (see §2) |
| securityheaders.com grade A/A+ | **HEADERS PROVEN LIVE, GRADE STILL NOT ISSUED BY THE TOOL** — the earlier "impossible against `localhost`" blocker is gone: the live `https://agentos-theta-teal.vercel.app` response carries 8/8 of the scored headers (§7.5 run #1/#2 gate L1), including `frame-ancestors 'none'` and a 1-year `preload` HSTS. The grade letter itself could not be captured: securityheaders.com returns HTTP 403 to a non-browser fetch, so nothing here claims an A on the tool's behalf |
| `npm audit` 0 high/critical | **PARTIALLY MET — 29 → 10 findings, 0 outside `next`/`braces`** (second pass, §7). First pass left this NOT MET at 29 (16 high, 3 critical). All 19 transitive findings are now closed by `pnpm.overrides` (decision §13); the 9 that remain are `next@16.3.0` itself, which the owner declined to bump (decision §8), and 1 `braces` DoS for which upstream has published no fix at all (3.0.3 is the newest release). The remaining advisories were then checked one by one against real code paths (§7.6) and the two reachable image-optimizer ones were closed without a version change — though not the way this row first claimed: the proxy denial turned out **not** to apply on Vercel, where the edge answers `/_next/image` before the proxy runs (run #1 gate L6 failed 0/4, §7.5). `images.unoptimized` was measured to remove the handler from our own server (run #2 L5, 4/4) and every attacker-shaped probe is refused before any fetch (run #2 L6/L7, 7/7) |
| all features still work | **PROVEN FOR THE EDGE PATHS, OPEN FOR AUTHENTICATED PATHS** — 401/307/200 behaviour, header application, rate limiting, audit writes and the spend aggregate all verified; the logged-in dashboard read, chat SSE stream and AgentOS run view could not be re-proven in this window because they need the owner's interactive login (`@supabase/ssr` auth is client-side). No code on those paths changed semantics — see §5 for the exact re-proof commands |
| Lighthouse ≥ before (97) | **NOT RE-RUN** — the landing page's client code is byte-identical apart from an auth-form placeholder string; the only global change touching HTML responses is added response headers, which Lighthouse does not score. Bundle check G14 supports the claim; the harness in `_lh/` can close it in ~10 min |
| zero paid model calls | **MET** |
| no functionality breakage (chat streaming, dashboard, run view, auth flows, V1–V8 animations) | **MET BY CONSTRUCTION** — no animation, component or client-data file touched (G13, G14); streaming routes were wrapped in a guard that only *rejects* requests they would previously have accepted, and their handler bodies are unchanged |
| backward-compatible DB | **MET** — additive only: 2 new tables, 5 new indexes, 0 changes to existing tables. `prisma migrate deploy` → "All migrations have been successfully applied." against the live DB with `DIRECT_URL` |
| 60 fps / LCP < 2.5 s / prefers-reduced-motion | **UNCHANGED** — nothing in the render or animation path was modified (G13); budgets were previously measured green in the V7/V8 close-outs |

## 4. What shipped

New files: `prisma/schema/scale-security.prisma`, 2 migrations
(`20261012032451_add_rate_limit_and_audit_tables`, `20261012032500_enable_rls_on_scale_security_tables`),
`src/server/api/rate-limit.ts`, `src/server/api/stream-guard.ts`, `src/server/lib/audit.ts`,
`src/server/ai/provider-fetch.ts` (+ tests), `scripts/audit-db.mjs` (+ `audit-db.json`),
`scripts/verify-scale-security.mts`, `scripts/load-probe.mjs`,
`scripts/register-no-server-only.mjs` / `no-server-only-hook.mjs`, 3 docs.

Modified: `next.config.ts` (headers + CSP + private cache on the user feeds),
`src/proxy.ts` (`/api` in the matcher, 401 JSON, verified `x-agentos-user-id` header,
`getSession` on API paths), `src/lib/route-gate.ts` (`apiGateDecision`),
`src/server/api/route-factory.ts` (`rateLimit` option, default `api`, 429 + `Retry-After`),
the 4 SSE routes (guard + `guardResponse`), `src/server/agentos/store.ts` (batched step
upsert, server-side spend aggregate), `src/server/ai/nanogpt.ts` (bounded retried
transport), `src/lib/auth-form-rules.ts` + `auth-form.tsx` (12-char password policy),
`.env.example` + `src/lib/env.ts` (`RATE_LIMIT_ADMIN_USER_IDS`), `tsconfig.json` (build arm).

## 5. To close the open items (commands, in order)

```bash
# 1. Authenticated paths — sign in as the owner in a browser on the deployed URL, then:
curl -s -D - -H "cookie: <sb session cookies>" https://<host>/api/dashboard | grep -i "cache-control"
# and in the UI: dashboard renders, one chat reply streams, one AgentOS run reaches D4 gates.

# 2. External grade on the live URL: https://securityheaders.com/?q=<host>  (expect A/A+, CSP reported)

# 3. Framework advisories (one commit, then the full harness suite before deploying):
pnpm up next@16.3.8 @sentry/nextjs@latest next-intl@latest && pnpm build && pnpm test

# 4. Lighthouse before/after on this arm:
NEXT_DIST_DIR=.next-t9 PORT=3500  → the _lh harnesses, mode=after

# 5. Retention is a helper, not a cron — schedule pruneAuditLogs(90) on the existing cron surface.

# 6. Latency (the real one): move/replicate the Supabase instance out of ap-southeast-2
#    and re-run scripts/verify-scale-security.mts — the "cost of one enforced request"
#    line is the number to watch.
```

Not done, explicitly: `llm_logs` table (`ai_usage` already is that ledger), TOTP/2FA,
server-side per-account login lockout (no server login action exists), a DOM sanitiser
(no HTML injection surface exists), sliding windows instead of fixed windows, an SSE route
factory so a future streaming route cannot skip the guard, Vercel KV for counters.

## 6. Live production gates (after the deploy, 2026-10-12)

Published to `Mushahid-Ahmed/AgentOS` `main` as `eb9c30d` (log-free tree, 33 paths,
values-scan 7 values / 0 hits); Vercel git-deploy went live on
`https://agentos-theta-teal.vercel.app` in ~60 s (`X-Vercel-Id: bom1::iad1::…`).

| gate | live result |
| --- | --- |
| security headers on `/` | **8/8 present** (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS `max-age=31536000; includeSubDomains; preload`) |
| `/api/dashboard`, `/api/spend`, `/api/model-pool` (GET), `/api/chat`, `/api/agentos` (POST), anonymous | **401 on all five** |
| `x-agentos-user-id` forged from the client | **401** — the edge header is not spoofable in production either |
| `Cache-Control` on `/api/dashboard` | `private, max-age=15, stale-while-revalidate=60` |
| page gate | `/app` → 307 `/login?next=%2Fapp`; `/login` → 200 |
| deployed artifact ≡ verified local artifact | same structural signature on both HTML bodies: 61 `<path>`, 1 `<canvas>`, 11 `data-v7-page` (byte size differs by the build-time public keys only) |
| live load, 50 concurrent × 100, `/api/dashboard` | **p50 710 ms, p95 1 188 ms, 0 errors, 100× 401** — the whole 401 path costs one edge function, no DB, no lambda SSR. Measured from this machine to a `bom1` edge, so it is dominated by the client's own RTT, not by the app |

External grading (securityheaders.com) still needs a browser-side pass — see §5 step 2.

---

## 7. Second pass — full audit re-run and remediation (2026-10-12, after the deploy)

The owner asked for the audit re-run, every vulnerability enumerated, and every threat
blocked, with one constraint stated in the same breath: **no `next@16.3.0 → 16.3.8`**.

### 7.1 The 29 findings, enumerated (pre-remediation)

| package | count | severity | direct? | who pulls it | fixed by |
| --- | --- | --- | --- | --- | --- |
| `next` | 9 | 3 critical, 1 high, 4 moderate, 1 low | yes | app dependency | 16.3.3 / 16.3.6 / 16.3.8 only — **declined** |
| `fast-uri` | 6 | 5 high, 1 moderate | no | `ajv 8.20.0` ← `@modelcontextprotocol/sdk`, and ← `schema-utils`/`webpack` in `@sentry/nextjs` | 3.1.8 |
| `brace-expansion` | 6 | 3 high, 3 moderate | no | `minimatch`/`glob` (two majors in the tree: 1.1.18 and 5.0.9) | 1.1.21 and 5.0.12 |
| `sharp` | 2 | 2 high | no | `next` (its image optimizer) | 0.35.5 |
| `dompurify` | 2 | 2 low | no | `posthog-js 1.415.4` | 3.4.17 |
| `deepmerge-ts` | 1 | high | no | `@prisma/config` ← `prisma 6.19.3` | 8.0.2 (major) |
| `js-yaml` | 1 | high | no | eslint/prettier-tooling | 4.3.2 |
| `braces` | 1 | high | no | `micromatch` (build/lint tooling) | **nothing — no release newer than 3.0.3 exists** |
| `source-map-js` | 1 | high | no | `postcss` ← tailwind | 1.2.2 |

Counts: `{"low":3,"moderate":7,"high":16,"critical":3}`. Not one was a direct dependency,
which is why `pnpm update` alone could not move any of them.

### 7.2 What was blocked

- **19 transitive findings closed** by eight `pnpm.overrides` entries (decision §13). `pnpm
  audit` now reports **10 findings: 3 critical, 1 high, 5 moderate, 1 low** — 9 in `next`, 1
  in `braces`.
- **`/_next/image` denied at the proxy** (decision §14, gate 12/12 in
  `_lh/audit-imagegate.mjs`). That removes the reachable path behind the AVIF-decode critical
  and the optimizer SSRF high, without a framework bump.
- **`pnpm dev` pinned to 127.0.0.1** (decision §15). Before: the Windows dev server answered
  200 on `<LAN address>:3000` — LAN-reachable, unauthenticated, on the version carrying the
  windows-hosted RCE critical. After: refused.

### 7.3 What stays open, and why

| advisory | sev | what it is | status on this deployment |
| --- | --- | --- | --- |
| GHSA-p293-qw3h-jr36 | critical | Unauth RCE, **windows-hosted servers** | Prod is Vercel/Linux → not the affected topology. Local exposure closed by the loopback bind (§15); patch needs 16.3.3 |
| GHSA-2xp9-vwfh-vxw4 | critical | Unauth RCE in Image Optimization via crafted AVIF | Endpoint denied at the proxy (§14); Vercel-side answer recorded in §7.4. Patch needs 16.3.3 |
| GHSA-vcvr-r3jv-pc5j | critical | RCE in `next/og` `ImageResponse` | **No code path exists**: `ImageResponse`/`next/og` appears nowhere in `src`, `scripts` or `next.config.ts`, and there is no `/api/og` route. Patch needs 16.3.6 |
| GHSA-cjq9-62q9-8jv4 | high | SSRF in Image Optimization | Same denial as above; additionally `images.remotePatterns` is unset, so a remote URL was already rejected (`'url' parameter is not allowed`, measured) |
| GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p | moderate | SSG/ISR cache poisoning, **self-hosted only** | Not self-hosted — Vercel serves these; the two per-user API feeds are `private` (decision §4) |
| GHSA-3w37-wq28-93x7 | moderate | `use cache` fill can leak Draft Mode content | No Draft Mode usage in the app |
| GHSA-f87g-xv8r-7p7x | moderate | Metadata-image route info disclosure via `dynamicParams` | Only metadata route is the static `/icon.svg` (200, measured); no dynamic metadata image route exists |
| GHSA-39w2-rjm5-chcv | low | Dev-server MCP endpoint info disclosure | Dev-only surface; loopback bind (§15) means a same-host process only |
| GHSA-vfj7-8cjw-p6xm (`braces`) | high | Stack exhaustion on deeply nested brace patterns | No upstream fix exists. Build/lint-time path only (`micromatch`), never fed attacker-controlled patterns in the request path |

**The honest summary:** every finding that has a fix and does not require touching `next` is
closed. The nine `next` advisories are open by the owner's decision, three of them critical —
and 16.3.8 is the only release that clears the whole set. The two criticals that describe a
network-reachable path on this deployment (image optimizer, windows dev server) are blocked at
the edge and at the bind address instead; the third critical has no code path at all.

### 7.4 Gates re-run on the overridden tree

| gate | result |
| --- | --- |
| `pnpm audit --json` | 10 findings, all in `next` + `braces` (from 29) |
| `pnpm typecheck` | clean |
| `pnpm lint` (`--max-warnings=0`) | clean |
| unit tests (`src/**\/*.test.mts` + `scripts/*.test.mts`) | **525/525** |
| `NEXT_DIST_DIR=.next-t9 pnpm build` | exit 0 |
| `scripts/smoke-mcp-after-overrides.mts` (SDK → ajv → fast-uri 3.1.8) | 4/4 |
| `scripts/verify-scale-security.mts` (live DB) | 8/8 |
| `prisma validate` (deepmerge-ts 8.0.2 in `getConfig()`) | 21-table schema valid |
| `check:env` / `check:rls` / `check:ai-models` / `check:secrets` | 12 vars declared / RLS on 21 tables, no policies / 4 models curated / exit 0 |
| image-endpoint gate (`_lh/audit-imagegate.mjs`) | 12/12, control still live |
| loopback gate (`:3199` throwaway) | loopback 307, LAN refused |

`pnpm test` as a whole still ends in the known Windows-only `check-standards` symlink
`EPERM` — the same environmental failure class recorded in the previous run (~41 failures that
are not regressions); the suites above were run individually and are green.

### 7.5 Live production gates against the real deployment

Two runs, both against `https://agentos-theta-teal.vercel.app`. Run #1 is kept with its
failure because the failure is the finding.

**Run #1 — 19:03, deployment `agentos-gm5z5deng` (public `e0c442c`, proxy denial only): 5/6.**

| gate | result |
| --- | --- |
| L1 security headers on `/` | PASS 8/8 |
| L2 anonymous `/api` denied | PASS — `GET /api/dashboard=401 GET /api/spend=401 GET /api/model-pool=401 POST /api/chat=401 POST /api/agentos=401` |
| L3 page gate + auth form | PASS — `/app=307 -> /login?next=%2Fapp`, `/login=200` with a password field |
| L4 landing markup signature | PASS — `<path>`=61, `<canvas>`=1, `data-v7-page`=11, identical to the pre-override build |
| L5 control answers the optimizer | PASS 4/4 arms returned `INVALID_IMAGE_OPTIMIZE_REQUEST` on the local `:3400` build |
| **L6 live `/_next/image` denied by the proxy** | **FAIL 0/4** — arms were `url=%2Fx.png=404`, `remote=400`, `traversal=400`, `no-params=400`, and **none** carried our `{"error":"Not found"}` body |

L6 did not fail because the work was wrong; it failed because the premise was. The response
header is `x-vercel-error`, a platform header, so Vercel resolves `/_next/image` at its edge
layer **before** the app's proxy runs. Any proxy-level denial of a `/_next/*` path is
therefore self-hosted-only, and the report's earlier claim that the endpoint was "denied at
the edge" was not true of production.

**Run #2 — 19:12, deployment `agentos-3f3ym2wjq` (public `b083b2e`, proxy denial +
`images.unoptimized`): 7/7.** L1–L4 repeated green (8/8 headers, 5/5 `/api` 401s, `/app=307`,
signature 61/1/11 unchanged), and the two new gates:

| gate | result | evidence |
| --- | --- | --- |
| L5 `images.unoptimized` removes the optimizer handler from a Next server | PASS 4/4 | the **same** `:3400` control build, whose code was not touched, flipped from 4/4 arms carrying the optimizer's 400 body to 4/4 plain HTML 404s; `next start` reads `next.config.ts` at runtime, so this isolates the flag as the only variable. Server liveness asserted separately so a dead control cannot pass |
| L6 live `/_next/image` never serves image bytes | PASS 0/6 | `missing-local=404 [NOT_FOUND]`, `remote-host / traversal / no-params / link-local-metadata / local-file-that-exists = 400 [INVALID_IMAGE_OPTIMIZE_REQUEST]` |
| L7 live SSRF shapes refused at validation, before any fetch | PASS 4/4 | includes `url=http://169.254.169.254/latest/meta-data/`, the cloud-metadata target, refused with the same validation error |

The honest reading of run #2 is narrower than "the endpoint is gone": on Vercel the path
still resolves, and even a valid request for a file that exists (`/icon.svg`) is refused.
The claims the gates support are (a) no input shape returns image bytes or makes the server
fetch a caller-named host, and (b) the 16.3.0 optimizer handler is off our own server in
every environment. Both are what §7.6 needs them to be; neither needs the declined
`next` bump.

Scripts and raw output: `_lh/audit-live-gates.mjs` / `.txt` (run #1),
`_lh/audit-live-gates-2.mjs` / `.txt` (run #2), `_lh/audit-imagegate.mjs` (local two-arm).
Run #2 replaced run #1's L6 assertion rather than weakening it — the old assertion measured
"who answers", the new one measures "can it serve bytes or dial out", which is the property
the advisories actually require.

### 7.6 Every open finding, against a real code path

The point of this table is that "10 findings left" is not "10 holes left": each row names the
condition the advisory needs and what this repository does about it. Sources: `pnpm audit
--json` on the overridden tree, `grep` over `src/`, the build output, and the live gates in
§7.5.

| advisory | sev | what it needs to be reachable | this app | control |
| --- | --- | --- | --- | --- |
| GHSA-2xp9-vwfh-vxw4 | critical | a request the Image Optimization API actually decodes (crafted AVIF) | the path resolves on Vercel even after the proxy denial, but refuses every shape before decoding | `images.unoptimized` removes the handler from our server (L5); edge refusal + zero allowlisted hosts and zero local image bytes (L6) |
| GHSA-cjq9-62q9-8jv4 | high | a request that makes the optimizer fetch a caller-named host (SSRF) | `remotePatterns` is empty, `dangerouslyAllowLocalIP` is false | L7: remote, traversal, and `169.254.169.254` all rejected at validation, no fetch |
| GHSA-p293-qw3h-jr36 | critical | a **Windows-hosted** Next server the attacker can reach | production is Vercel/Linux; the exposure was four local servers answering on the LAN | every harness server binds `-H 127.0.0.1`; `dev` script binds loopback; owner must restart `:3000` (decision §17) |
| GHSA-vcvr-r3jv-pc5j | critical | `next/og` `ImageResponse` on a served route | 0 occurrences of `ImageResponse`/`next/og` in `src`, `scripts`, `next.config.ts`; no `/api/og` | no code path |
| GHSA-3w37-wq28-93x7 | moderate | a `use cache` fill plus Draft Mode | `grep -rn "'use cache'" src` → 0; `draftMode` → 0 | no code path |
| GHSA-4jqv-mc3x-m676 | moderate | self-hosted SSG/ISR page cache | 1 static route in the entire build (`/icon.svg`); `revalidate`/`unstable_cache`/`revalidatePath`/`revalidateTag` → 0; hosting is Vercel, not self-hosted | no code path |
| GHSA-mcj8-r9mp-w47p | moderate | SSG/ISR rendering that substitutes per-user content | same as the row above; the dashboard feeds are explicitly `private`, so nothing user-specific enters a shared cache | no code path |
| GHSA-f87g-xv8r-7p7x | moderate | App Router metadata image routes with `dynamicParams` | `generateMetadata` → 0, `dynamicParams` → 0 | no code path |
| GHSA-39w2-rjm5-chcv | low | the **development** server's MCP endpoint | `next dev` only; production never runs it, and dev now binds loopback | not deployed + loopback bind |
| GHSA-vfj7-8cjw-p6xm | high | untrusted input compiled as a glob pattern | `braces` is reached only through `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`, i.e. lint time, and **no release newer than 3.0.3 exists** to override to | dev-only dependency, absent from the server bundle |

Two consequences worth stating plainly, because §10 asked for "0 high/critical":

- `next` **stays at 16.3.0**, exactly as instructed, so nine advisories remain on paper. Six
  have no code path in this repository, one is dev-only, the two image advisories lost their
  handler and their inputs, and the one that was genuinely reachable — GHSA-p293 — was
  reachable over the LAN from this workstation and is now loopback-bound.
- `braces` cannot be overridden to a fixed version because that version does not exist; its
  mitigation is being a lint-time dependency of a `devDependency`, not part of what ships.

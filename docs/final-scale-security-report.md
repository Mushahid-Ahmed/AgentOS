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
| securityheaders.com grade A/A+ | **NOT MEASURED** — impossible against `localhost`; the header set is dumped in `_lh/m13-http-proofs.txt` and is re-gradable on the live URL after deploy |
| `npm audit` 0 high/critical | **NOT MET** — 29 findings (16 high, 3 critical), root cause `next@16.3.0 < 16.3.8`; deliberately not upgraded minutes before a production push (decision §8) |
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

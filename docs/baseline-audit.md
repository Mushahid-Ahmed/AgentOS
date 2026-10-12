# Baseline audit — scalability & security (AGENTOS_SCALE_SECURITY M1)

Measured on 2026-10-12 against the pre-change production build (`.next-t8c`, BUILD_ID
`uTmOWqKYJlN3GXdHpXYwh`, served on `:3400`) and the live Supabase database. Everything
below is a number from a command in this session, not an assumption; the reproducible
commands are listed at the bottom.

## 1. Database (M2)

**Shape of the data — `scripts/audit-db.mjs`, read-only over the pooler:**

| table | rows |
| --- | --- |
| `agent_runs` | 82 |
| `agent_steps` | 226 |
| `agent_events` | 1 815 |
| `conversations` | 30 |
| `messages` | 73 |
| `route_events` | 30 |
| `ai_usage` | 700 |
| `benchmark_results` | 108 |
| `agentos_benchmark_results` | 152 |

**Indexes before this work: 46**, covering every foreign key and sort column the app
uses. `EXPLAIN ANALYZE` over the nine real query shapes (`scripts/audit-db.json`) shows
the server doing its job:

| query | wall clock from this client | Postgres actual execution | plan |
| --- | --- | --- | --- |
| `agentos-run-list` | 1 938 ms | 1.1–4.1 ms | Limit over `agent_runs_created_at_idx` |
| `agentos-run-steps` | 1 793 ms | 1.2 ms | Index + sort on 1 row |
| `agentos-run-events` | 1 793 ms | <1 ms | `agent_events_run_id_seq_key` |
| `conversation-list` | 1 850 ms | 0.66 ms | Limit, 30 rows |
| `conversation-messages` | 1 887 ms | <1 ms | `messages_conversation_id_created_at_idx` |
| `nightly-spend` | 1 826 ms | <1 ms | `ai_usage_created_at_idx` |
| `spend-by-model` | 2 195 ms | 0.72 ms | Limit, 20 rows |
| `dashboard-route-events` | 1 801 ms | 1.6 ms | HashAggregate, 118 rows |
| `benchmark-results-by-run` | 2 018 ms | <1 ms | Index Scan |

**The finding: the database is not the bottleneck — round trips are.** Every query above
executes inside 4 ms and costs 1.8–2.2 s wall clock. The ratio is ~500:1. Confirmation
from the same connection pool: 10 sequential `SELECT 1` took 18.1 s (1.8 s each), 20 took
37.8 s, and 10 *concurrent* `SELECT 1` took 4.7 s total. Latency, not throughput.

Why: the project is deployed to Vercel `iad1` (Washington) and the Supabase instance is
`ap-southeast-2` (Sydney) — a trans-oceanic hop on every single query, paid once per
statement, never amortised. This is a dashboard-level configuration fact, not a code
fact, and changing a database region is the owner's decision (see
`docs/scale-security-decisions.md` §6).

Two consequences that *are* code, and were fixed:

1. **Round-trip count.** `agent_steps` were written one `upsert` per step inside a loop,
   and the nightly spend cap read every `agent_runs` row of the last 12 hours into Node to
   sum it. Both became one statement each.
2. **Index additions would have been theatre.** With 82–1 815 row tables and plans already
   on Index Scans, adding indexes changes nothing measurable. The only indexes created in
   this pass are the ones the two new tables need to answer their own access patterns.

**Connection pooling:** `DATABASE_URL` points at Supavisor in *transaction* mode, which
also means schema/DDL work must use `DIRECT_URL` (it errors with
`prepared statement "s1" already exists` otherwise — hit and documented during the
migration). No PgBouncer-style tuning was added: the app is one Prisma client per
lambda, and the real fix is either fewer queries per request (done) or the region (open).

## 2. Caching (M3)

Before: no `Cache-Control` on any `/api/*` response, and no `headers()` block in
`next.config.ts`. Dashboard feeds refetched on every client navigation.

## 3. Rate limiting (M4)

Before: **none anywhere in the repo.** `/api/chat` (1 paid completion per request) and
the three launch routes (`/api/agentos`, `/api/benchmark`, `/api/agentos-benchmark`, each
a multi-call paid run) were unbounded and unauthenticated at the edge, limited only by the
per-run/nightly USD caps enforced *after* work had started. Vercel KV/Redis was not
provisioned and cannot be from this session without a paid store; the counters live in
Postgres instead (decision §2 in `docs/scale-security-decisions.md`).

## 4. Security headers (M5)

`curl -sI http://localhost:3400/` on the control build greps **0 hits** for
`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `Strict-Transport-Security`. No `headers()` existed. Clickjacking,
MIME sniffing and inline-script containment were all default-open.

## 5. Input validation (M6)

Already good, and unchanged in substance: every write route parses through an explicit Zod
contract (`createApiRoute` requires an `input` schema), with bounds in place — chat
`content.max(32 000)` and `messages.max(50)`, AgentOS `query.max(8 000)`, benchmark
`label.max(120)` / `notes.max(2 000)` / `limit.max(500)`. The four *streaming* routes were
the gap: they cannot go through `createApiRoute` (it buffers JSON, they return SSE), so
they had their own parsing and no shared guard. `src/server/api/stream-guard.ts` closes
that.

XSS: `grep -rn dangerouslySetInnerHTML src` → **no matches**. All model output and user
text renders as React children, which escapes. A sanitiser library would have nothing to
guard that React does not already guard; recorded as a deliberate skip rather than an
omission (decision §7).

## 6. Auth (M7) and route protection (M8)

- Password floor was 8 characters with no character classes; now 12 with capital, number
  and symbol required at signup (login unchanged, so existing accounts still work).
- Supabase's own brute-force protection stays on; there is **no server-side login action**
  to lock out — auth happens in the browser via `@supabase/ssr`
  (`src/components/auth/auth-form.tsx`), so a §5.2 "5 failures / 15 min" counter has no
  server surface to sit on. The equivalent enforced server-side limit is the new
  `login: <ip>` budget (10 requests / 15 min) available to any form route.
- Route protection: `src/proxy.ts` gated **pages only**. Its matcher was
  `['/((?!api|_next|_vercel|.*\\..*).*)']` — `?!api` explicitly excluded `/api/*`, so
  every data endpoint was public. Live proof from the control build: 100 concurrent
  unauthenticated `GET /api/dashboard` → **5 returned 200**, 95 returned 500. The five 200s
  are the vulnerability (an anonymous caller got real dashboard JSON); the 95 500s are the
  same unprotected route exhausting its DB pool under load.
- Cookies come from `@supabase/ssr` (httpOnly, sameSite=lax, secure in production) and are
  refreshed in the proxy; nothing here weakened them. 2FA/TOTP is optional in §5.5 and not
  implemented — recorded as not-done.

## 7. Errors (M9), secrets (M10/M11), audit logging (M12)

- `createApiRoute` already funnels every unexpected error through `captureError()`: a
  generic message and a 500 to the caller, detail to Sentry, stack traces never sent to
  the client. Kept, and extended so a 429 keeps its own status and `Retry-After`.
- `pnpm audit` (before any remediation): **29 vulnerabilities — 3 low, 7 moderate, 16
  high, 3 critical.** The critical/high mass is concentrated in `next@16.3.0`
  (advisory range `>=16.0.0 <16.3.8`), reached directly and through `@sentry/nextjs@10.70.0`
  and `next-intl@4.13.6`. A framework minor-upgrade was *not* performed inside this
  window; see decision §8 for the reasoning and the exact command.
- Secret scanning is value-based, not pattern-based: the real strings from `.env.local`
  (Supabase URL/keys, DB passwords, NanoGPT/BeatAPI keys, Sentry DSN, PostHog key,
  `CRON_SECRET`) are searched as literal byte sequences across the tracked tree, `.gitignore`
  carries `.env*`, and the private-log repos are handled by the separate
  log-free publish path. `pnpm check:secrets` (pattern layer) exits 0.
- Audit logging before this work: none as a table. Facts about *runs* lived in
  `agent_events` and about *money* in `ai_usage`; there was no record of who called what
  when, and no retention policy.

## 8. Performance / animation baseline (for the no-breakage constraint)

From the previous run's close-out, still the reference point: Lighthouse **97** on the
landing page after the UI/UX programme (79 before it), SI regression documented, all V1–V8
animations green in their own harnesses. This hardening pass touches **zero** animation or
landing component files — the full changed-file list is in
`docs/final-scale-security-report.md` §4, and the only UI file is the auth form's password
placeholder string.

## Reproduce

```
DATABASE_URL / DIRECT_URL from .env.local, then:
node scripts/audit-db.mjs                     → scripts/audit-db.json (indexes, row counts, EXPLAIN ANALYZE)
pnpm audit                                    → 29 (3 low, 7 moderate, 16 high, 3 critical)
curl -sI http://localhost:3400/               → no security headers (control build)
MSYS_NO_PATHCONV=1 node scripts/load-probe.mjs http://localhost:3400 100 100 / /login /api/dashboard
grep -rn dangerouslySetInnerHTML src          → no matches
```

# Scale & security decisions (AGENTOS_SCALE_SECURITY §6 format)

Every entry: **what changed / why / tradeoff / verification**. Verification means a
command that could have failed; the numbers it produced are in
`docs/final-scale-security-report.md`.

---

## 1. Fewer round trips instead of more indexes

**What changed.** `src/server/agentos/store.ts`: the per-step `upsert` loop became
`upsertStepsBatch()` — one `INSERT … VALUES Prisma.join(…) ON CONFLICT ("run_id","key")
DO UPDATE`. The nightly spend gate became a server-side aggregate
(`db.agentRun.aggregate({ _sum: { costMicroUsd } })`) instead of fetching rows and summing
them in Node. No index was added to any pre-existing table.

**Why.** `EXPLAIN ANALYZE` on the nine real query shapes showed Postgres executing each in
0.6–4.1 ms while the client waited 1.8–2.2 s. All nine plans were already Index Scans on
46 existing indexes over tables of 30–1 815 rows. The cost is per statement, not per row,
so the only lever that moves the number is *statement count*.

**Tradeoff.** The batched write is one statement instead of N, so a single malformed step
now fails the whole step write rather than one row. Accepted: the step payloads are built
by our own executor, the run row and its steps are already best-effort, and the failure is
logged. Aggregating server-side means the cap decision depends on a `SUM` the DB must keep
correct — which is where it belongs anyway, since `cost_micro_usd` is written by the same
code path.

**Verification.** `node scripts/verify-scale-security.mts` gate
`scale: nightly spend aggregate is server-side` runs the new aggregate against the live
tables; the batch upsert path is exercised by the production build booting and by
`pnpm typecheck` against the generated Prisma types. Baseline vs after plans are in
`scripts/audit-db.json`.

---

## 2. Request budgets counted in Postgres, not Vercel KV/Redis

**What changed.** New `rate_limit_buckets` table + `src/server/api/rate-limit.ts` with four
fixed windows: `api` 100/60 s, `chat` 10/60 s, `launch` 3/60 s, `login` 10/900 s, keyed per
(scope, identity). Applied to every route through `createApiRoute` (default scope `api`, so
a route must opt out rather than opt in) and to the four SSE routes through
`stream-guard.ts`. `RATE_LIMIT_ADMIN_USER_IDS` whitelists ids.

**Why not Redis/KV, as the brief suggested.** Provisioning Vercel KV (or Upstash) needs a
paid store and dashboard access I do not have from this session, and adding a secret I
cannot rotate is worse than a slower counter I can. A fixed-window counter is exactly one
atomic `INSERT … ON CONFLICT DO UPDATE`, which Postgres does well and which this app
already connects to.

**Tradeoff.** Each enforced request costs one DB round trip, which from this machine is
~1.8 s (see §6) — i.e. the limiter inherits the database's latency problem instead of the
~1 ms a KV hit would cost. Concretely: the counter adds one statement per API call to
routes that were already making several. The mitigations are that the budget check sits
*before* body parsing so a throttled request does no other work, `api`-scope failures open
(§5), and the whole thing becomes a KV swap behind one function. Also fixed windows, not
sliding: a client can burst at the end of one window and the start of the next, up to 2×
the nominal rate. Accepted for a 100/min per-user budget on a two-user app; a sliding
window needs either two buckets or Lua, which is what KV would give us.

**Verification.** `scripts/verify-scale-security.mts` against the real database — 8/8,
including three arms designed so a broken counter cannot pass: the `launch` budget allows
exactly 3 and 429s the 4th (`3/3 allowed then 429`); an artificially expired window rolls
over to count 1 instead of needing a sweeper; and 20 *concurrent* increments of one bucket
land on exactly 20, which a read-then-write counter would not (that is the lost-update
race the `ON CONFLICT` form exists to avoid). The HTTP layer shows `Retry-After` bounded
between 1 and the window.

---

## 3. `/api/*` is gated in the proxy, with a verified-identity header

**What changed.** `src/proxy.ts`'s matcher grew a second entry, `'/api/:path*'` (Next 16
has no `middleware.ts`; the proxy *is* the edge, and its matcher was the one place that
could cover `/api`). For API paths: no session → an immediate `401 {"error":"Unauthorized"}`
JSON, never a redirect. When a session exists, the proxy writes the verified
`x-agentos-user-id` header (and *deletes* it when there is none), which is what
`requestIdentity()` reads. API checks use `getSession()` (local JWT + expiry, no network);
page checks keep `getUser()` (server-verified).

**Why.** Baseline: the matcher excluded `/api`, so every data endpoint was public. The live
proof was 5 unauthenticated `GET /api/dashboard` requests returning **200 with real
dashboard JSON**. Authorization has to be enforced where no route can forget it, and the
routes then need an identity they can trust — which only the edge has, because it just
verified the cookie.

**Tradeoff.** `getSession()` trusts the local cookie's expiry rather than asking Supabase
right then, so a user revoked server-side keeps API access until the cookie expires
(Supabase's own access-token lifetime; the proxy refreshes it every request). The
alternative, `getUser()`, adds one network round trip to *every* API call on a database
that already costs 1.8 s per statement from here — it would have halved the app's
responsiveness to defend against a revocation window of minutes. The header is
unforgeable from outside because the proxy overwrites it on every request — proven, not
assumed (§verification). Serverless isolates do not share the in-request header object, so
there is no path where a client-supplied value survives.

**Verification.** On the hardened build: `GET /api/dashboard`, `GET /api/spend`,
`POST /api/chat`, `POST /api/agentos` → all 401 with no session; the same request *with a
forged* `x-agentos-user-id: <uuid>` header → still 401; 100 concurrent unauthenticated
`/api/dashboard` → 0 errors, `statuses=401:100`, p95 646 ms (was 13.8 s p95 with 95 errors
and 5 200s). Unit tests for the pure classifier: `src/lib/route-gate.test.mts` in the
`pnpm test` lane.

---

## 4. `Cache-Control: private` on the per-user feeds, never `public`

**What changed.** `next.config.ts` `headers()`: `/api/(dashboard|spend|model-pool)` get
`private, max-age=15, stale-while-revalidate=60`. Everything else inherits Next's default
`private, no-cache`.

**Why.** The brief's §2.2 sketch suggested caching dashboard responses; those responses
contain one user's spend, tokens and prompts. A `public`/CDN cache would leak user B's
numbers to user A — the exact failure mode a "caching win" memo loves to miss. `private`
lets the browser and the client's own SWR absorb repeat navigation (the dashboard polls
every few seconds per session) while no shared cache ever stores it.

**Tradeoff.** 15 s of staleness on a spend figure during a live run, which is already how
the client's SWR behaves; and no cross-user hit rate at all, so the cache does nothing for
the 100-concurrent-users criterion. The honest framing: this endpoint's real fix is the
region (§6), and pretending a CDN cache fixes a per-user authenticated feed would be a
fake win.

**Verification.** Header dump in `_lh/m13-http-proofs.txt`: the 401 for `/api/dashboard`
already carries `Cache-Control: private, max-age=15, stale-while-revalidate=60`, which
proves the pattern matches that path in the built server.

---

## 5. The limiter fails open, except on money routes

**What changed.** `enforceRateLimit(scope, identity, { failClosed })`: if the counter
statement itself throws, `api`/`login` scopes allow the request and only `chat`/`launch`
(the paid ones) propagate a 500. SSE routes pass `failClosed: true`.

**Why.** A rate limiter that turns a database hiccup into a site-wide 500 is an
availability bug worse than the traffic it was guarding. On a money route the arithmetic
reverses: an unbounded failure mode is a bill, and the app already has nightly caps whose
whole point is to stop spend.

**Tradeoff.** During a Postgres outage a user can exceed 100 req/min — but during a
Postgres outage the dashboard returns errors anyway, so the budget was never the binding
constraint. Money routes fail closed, so a Postgres outage makes AgentOS unlaunchable;
that is intended.

**Verification.** `verify-scale-security.mts` exercises the real statement (so "fails
open" is a decision about a counter that is known to work, not an untested branch);
`provider-fetch.test.mts` (7 tests) proves the paid-path transport gives up after a bounded
budget instead of burning retries forever; the whole suite is $0 because the fetch
implementation is injected.

---

## 6. Region: measured, recommended, not changed

**What changed.** Nothing. This is a finding, not a diff.

**Why it is not code.** Vercel `iad1` → Supabase `ap-southeast-2` is ~500× the query's own
cost (1.8 s of wire per 4 ms of Postgres). No amount of indexing, pooling or caching
recovers a trans-oceanic hop, and it is recoverable by exactly one dashboard action: move
(or replicate) the database to `us-east`/`eu-west` nearest the app's users and region.

**Tradeoff.** Moving a live database is a destructive, owner-only operation (downtime,
connection-string rotation, RLS re-verification) and cannot be bundled into a hardening
commit. The cost of not doing it is that every number in this report is latency-bound
rather than CPU-bound.

**Verification.** `scripts/audit-db.mjs` (10 sequential `SELECT 1` = 18.1 s; 10 concurrent
= 4.7 s), and the same ~1.8 s median per enforced request in
`verify-scale-security.mts` from a warm pool. If the DB moves to the app's region, the
first thing to re-measure is that number, not the Lighthouse score.

---

## 7. No DOMPurify, and no CSP-driven markup changes

**What changed.** Nothing. `grep -rn dangerouslySetInnerHTML src` → zero matches; the CSP
needed no relaxation for the existing UI.

**Why.** §6 of the brief asks for HTML sanitisation on rendered model output. The app never
renders HTML from model or user text — React escapes children, charts render numbers, and
the docs pages go through MDX at build time. Installing DOMPurify would add a dependency
guarding a surface that does not exist, and its real use would be to *enable*
`dangerouslySetInnerHTML` somewhere, which is a step backwards.

**Tradeoff.** If a future feature renders model-supplied Markdown or HTML, this decision
expires immediately and sanitisation becomes mandatory; the CSP's `script-src
'unsafe-inline'` (needed by Next's own inline runtime/RSC payload) means an HTML-injection
bug would still be able to run script. Recorded here so the next reader does not treat
"no sanitiser" as an oversight.

**Verification.** The grep, plus `img-src`/`connect-src` checked against the actual remote
URLs used in `src/` (`api.nano-gpt.com` and `api.beatapi.io` are server-side only;
`us.i.posthog.com` and `*.ingest.sentry.io` are in `connect-src`; `posthog-js` is bundled
from `self`; no remote image host exists in the tree).

---

## 8. `next@16.3.0` → `16.3.8` deferred

**What changed.** Nothing yet. The advisory is open and documented.

**Why.** `pnpm audit` reports 16 high + 3 critical, whose common root is
`next >=16.0.0 <16.3.8`, reached directly and via `@sentry/nextjs@10.70.0` and
`next-intl@4.13.6`. Upgrading the framework minutes before a production push would put a
router/React-Compiler change underneath a hardening diff, and the two would be impossible
to separate if a V1–V8 animation regressed. §10 ("0 high/critical") is therefore not met,
and the miss is reported instead of being closed recklessly.

**Tradeoff.** The known framework CVEs stay open until the bump, which is mitigated in the
meantime by the header set (CSP + `frame-ancestors 'none'`) and by `/api` now requiring a
session. The safe path is one commit: `pnpm up next@16.3.8 @sentry/nextjs@latest
next-intl@latest && pnpm build && pnpm test`, then re-run
`_lh`/harness gate suites before deploying.

**Verification.** `pnpm audit` numbers recorded in `docs/baseline-audit.md` §7.

---

## 9. Provider transport: bounded, retried, and stream-aware

**What changed.** New `src/server/ai/provider-fetch.ts`, used by both NanoGPT call sites in
`nanogpt.ts`: 30 s timeout, 2 retries with 1 s/2 s backoff on 408/429/500/502/503/504, the
error body cancelled before retrying, and the last response handed back when the budget is
exhausted. For SSE, `timeoutCovers: 'headers'` bounds only the wait for first bytes.

**Why.** A stalled provider previously held an SSE stream and a serverless function open
until the platform killed them, and a single upstream 429 (the ordinary shape of a
rate-limited provider) was shown as a failure, with retries left to the client — where a
retry is another paid call.

**Tradeoff.** `timeoutCovers: 'headers'` means a stream that starts and then hangs is not
cut off by this module; bounding that needs an idle-detection timer per chunk, which
belongs with the chat client's own abort controls. Returning (not throwing) the exhausted
status keeps `nanogpt.ts`'s existing error mapping intact — deliberately chosen so users
see the same messages as today.

**Verification.** 7 unit tests with an injected fake fetch, no network: backoff doubling
(`1000,2000`), body cancelled on the 429, 400 never re-sent, three 500s stop at 3 calls and
surface as a 500, a stalled call aborts within 2 s with an `AbortSignal` on every attempt,
and a transport error retries then succeeds.

---

## 10. Streaming routes share one guard

**What changed.** `src/server/api/stream-guard.ts`, called by all four SSE routes before
they parse their body, and `guardResponse(error)` as the first line of their `catch`. It
does identity → 401-if-no-user → rate limit (fail closed) → audit, in that order.

**Why.** `createApiRoute` buffers a JSON response, so the streaming endpoints were the one
class of route that could not use the standard protections — including the three that cost
money. One guard function means "streaming" is no longer a way to be unlimited and
unlogged.

**Tradeoff.** The four routes each call the guard by hand rather than being wrapped, so a
*fifth* streaming route could still forget it; the ordering requirement (guard before
`req.json()`) is documented at the call site. A factory for SSE routes is the eventual
fix and is on the not-done list.

**Verification.** `POST /api/chat` and `POST /api/agentos` with no session → 401 (previously
they reached their handler and started paid work). `audit_logs` rows appear for launched
runs — the write/read/prune round trip is the `audit:` pair of gates in
`verify-scale-security.mts`.

---

## 11. Password policy at signup only; no server-side login lockout

**What changed.** `PASSWORD_MIN_LENGTH = 12` plus capital/number/symbol required on signup,
with per-rule messages; the auth form's placeholder matches. Login is unchanged, so nobody's
existing password stops working.

**Why.** A strength rule applied at login would lock out every account created under the
old 8-character rule — that is a breakage, not hardening. Supabase already throttles
password guessing server-side; §5.2's "lock out after 5 failures / 15 min" needs a server
login action, and this app authenticates in the browser (`@supabase/ssr`), so there is no
request to count.

**Tradeoff.** Per-account brute-force lockout is therefore *not* implemented in this pass —
the honest status is "Supabase-side throttling plus an IP-keyed `login` budget that is
wired and ready, but has no form route to sit on until auth moves server-side". Also
recorded as not-done: 2FA/TOTP (§5.5, optional), and a "7-day session" change — session
length is a Supabase project setting, not app code.

**Verification.** `auth-form-rules.test.mts` asserts the 12-character message, each class
message, that a compliant 15-character password passes, and that an old 8-character password
still logs in (the no-breakage arm).

---

## 12. Audit logging: narrow, best-effort, 90 days

**What changed.** New `audit_logs` table + `src/server/lib/audit.ts`
(`recordAudit`, `pruneAuditLogs(90)`), writing auth transitions and money-spending launches
only, with ids/counts/outcomes and never a prompt or an email. RLS enabled on both new
tables (`pnpm check:rls` → 21 tables, no policies, never `FORCE`), so the service role is
the only writer.

**Why.** The brief asks for `audit_logs` *and* `llm_logs`; `ai_usage` already is the LLM
ledger (per-call model, tokens, cost) and `agent_events` the run ledger. A third table
copying them gives two sources of truth for one fact and a new place to leak prompt text.
Retention is a helper rather than a cron because nothing here should delete rows a UI reads.

**Tradeoff.** Best-effort writes mean an audit row can be lost while the request succeeds —
the deliberate opposite of fail-closed, for the same reason as §5. And the 90-day prune is
not scheduled, so retention only improves when it is called (from the existing cron
surface). `llm_logs` as specified is not implemented: `ai_usage` covers it.

**Verification.** `verify-scale-security.mts`: a row lands with metadata + ip; a row dated
91 days ago is deleted by the prune while today's row survives (both directions asserted, so
"prune returns a count" cannot pass vacuously).

---

## 13. Transitive advisories closed by `pnpm.overrides`, not by waiting for parents

**What changed.** `package.json` gained `pnpm.overrides` pinning eight transitive families:
fast-uri 3.1.8, brace-expansion 1.1.21 **and** 5.0.12 (selector-scoped per major), js-yaml
4.3.2, source-map-js 1.2.2, sharp 0.35.5, dompurify 3.4.17, deepmerge-ts 8.0.2. `next` stays
at 16.3.0.

**Why.** 19 of the 29 findings live in packages nothing here depends on directly, so their
parents (ajv 8.20.0, `@prisma/config`, posthog-js, webpack/`schema-utils`) decide when they
move. An override is the only mechanism that patches a transitive without changing the app's
own declared ranges, and every pin except one stays inside the major the consumer declared.
The exception is deepmerge-ts, whose advisory range is `<8.0.0` — no 7.x release fixes it.

**Tradeoff.** An override promises a consumer a version it never tested against, so the risk
was bounded per package and proven on the live path for the two that mattered: `prisma
validate` exercises `@prisma/config`'s `getConfig()` — the code that calls deepmerge-ts — and
still reports the 21-table schema valid on 8.0.2, and an MCP tool round-trip over the SDK's own
in-memory transport compiles a zod→JSON-Schema contract and rejects a wrong-typed argument with
fast-uri 3.1.8 loaded (`scripts/smoke-mcp-after-overrides.mts`). `brace-expansion` needed a
selector per major because 1.x and 5.x are different APIs; a single pin would have handed the
older glob callers a breaking package while trying to fix a DoS.

**Verification.** `pnpm audit` **29 → 10** findings (3 critical / 16 high → 3 critical / 2 high),
and the residual set is `next` (9) + `braces` (1). Typecheck, lint at `--max-warnings=0`, 525
unit tests, `NEXT_DIST_DIR=.next-t9 pnpm build`, the 8 DB-backed security gates, `check:env`,
`check:rls`, `check:ai-models` and `check:secrets` all re-run green on the overridden tree.

---

## 14. The Image Optimization endpoint is denied at the proxy

**What changed.** `src/proxy.ts` answers `/_next/image` with a 404 before any session or
locale work, and its matcher gained an explicit `/_next/image` entry — the general pattern
deliberately excludes Next internals, so without the extra entry the guard would never run.

**Why.** Three of the open `next` advisories are in that one built-in route: unauthenticated
RCE when a crafted AVIF is decoded (GHSA-2xp9-vwfh-vxw4, critical), SSRF in the optimizer
(GHSA-cjq9-62q9-8jv4, high), and the metadata-image information-disclosure family. Their only
patch is a `next` bump the owner declined (§8). This app never calls the optimizer: there is no
`next/image` import and no `public/` directory, and the only image asset is `/icon.svg`, served
as a static metadata route file. So the endpoint is attack surface with zero product value, and
denying it turns "critical/high with an open network path" into "no path" without touching the
framework.

**Tradeoff.** Anyone who later adds `next/image` gets broken images until they delete the guard;
the comment names the advisories and says why, so it cannot be removed blindly. Vercel answers
`/_next/image` from the platform's own image function, which may intercept before the proxy
runs — the live production gate says which of the two answered, and that answer is reported
either way rather than assumed.

**Verification.** `_lh/audit-imagegate.mjs`, 12/12. Control build (`:3400`, pre-change) answers
all four query shapes with the optimizer's *own* 400s — `"url" parameter is required`, `"url"
parameter is not allowed`, `The requested resource isn't a valid image.` — so the endpoint is
provably reachable there; the hardened build (`:3500`) answers all four with `{"error":"Not
found"}` at 404. Same run, regression arm: `/` 200, `/login` 200, `/icon.svg` 200,
`/app/dashboard` 307 — the guard cannot be passing by breaking the app.

---

## 15. `pnpm dev` binds 127.0.0.1

**What changed.** `"dev": "next dev"` → `"dev": "next dev -H 127.0.0.1"`.

**Why.** Measured on this machine before the change: the dev server answered
`http://<LAN address>:3000/` with **200**, so anything on the LAN could reach an unauthenticated
Next 16.3.0 dev server — and the highest-severity open advisory in that version is
*Unauthenticated Remote Code Execution on windows-hosted servers* (GHSA-p293-qw3h-jr36,
critical). This machine is a Windows host, and the dev server reads `.env.local`. Production is
unaffected either way: Vercel runs Linux, and both `/api` and `/_next/image` are now denied at
the edge.

**Tradeoff.** Testing from a phone or another machine on the LAN stops working at the next
`pnpm dev` restart; the revert is deleting `-H 127.0.0.1`. The owner's running server was left
untouched, so the change lands on their next restart, not mid-session.

**Verification.** A throwaway instance on `:3199` with its own dist dir
(`NEXT_DIST_DIR=.next-devtest`, so the owner's `.next` was never written): `127.0.0.1:3199` →
307 (the normal root redirect), `localhost:3199` → 307 through both curl and Node fetch (the
name still resolves to a bound address), `<LAN address>:3199` → **connection refused**. Instance
and dist dir removed afterwards, and the `tsconfig.json` include entries the dev server added
for it were reverted.

---

## 16. Image endpoint: the proxy denial is not the production control, and the config flag is not either

**What changed.** Two closures instead of one, and a claim corrected against measurement:
`images: { unoptimized: true }` added to `next.config.ts`, the proxy's `/_next/image`
denial kept, and both comments rewritten to say what the gates actually showed.

**Why.** Live gate run #1 (`_lh/audit-live-gates.txt`, 19:03, against deployment
`agentos-gm5z5deng` = public commit `e0c442c`, the build that contained the proxy denial)
**failed its own L6: 0/4 arms returned our `{"error":"Not found"}` body.** The remote-URL,
path-traversal and empty-query arms got the optimizer-shaped `400` and the relative-path
arm got a `NOT_FOUND` page. `x-vercel-error` is a *platform* header, which means Vercel
resolves `/_next/image` at its edge layer before the app's proxy ever runs. A proxy-level
denial therefore protects a self-hosted deployment and nothing else.

The config flag was then measured rather than assumed, and it is also not a full block:
against the deployed app, `/_next/image?url=%2Ficon.svg&w=64&q=75` — a syntactically valid
request for a file that **does** exist in the deployment — returns
`400 INVALID_IMAGE_OPTIMIZE_REQUEST`, as do all four attacker-shaped arms including
`url=http://169.254.169.254/...`. The path still exists on Vercel. What the flag
demonstrably removes is the handler from *our* Next server: the pre-change control build
flipped from 4/4 arms carrying the optimizer's own 400 body to 4/4 plain HTML 404s with
**no code change at all**, because `next start` reads `next.config.ts` at runtime. That is
the cleanest possible isolation of the variable, and it is gate L5.

**Net position.** No input shape can make the path return image bytes or make the server
fetch a host the caller names (gates L6/L7, 7/7 green). On Vercel the refusal is the
platform's; in any self-hosted deployment it is `unoptimized` plus the proxy denial. The
`next` 16.3.0 optimizer code is not reachable from either.

**Tradeoff.** Nothing renders through the optimizer: `next/image` appears **0** times in
`src/`, there is no `public/` directory, and the only static route in the build output is
`/icon.svg`. If a real image component is added later it ships un-optimised URLs until this
line is lifted — a payload regression, never a security one.

**Verification.** `_lh/audit-live-gates.mjs` + `_lh/audit-live-gates.txt` (run #1, L6 FAIL
kept verbatim), `_lh/audit-live-gates-2.mjs` + `_lh/audit-live-gates-2.txt` (run #2, 7/7),
`_lh/audit-imagegate.mjs` (two-arm local). Numbers in
`docs/final-scale-security-report.md` §7.5.

---

## 17. Local Next servers were reachable from the LAN while an open Windows RCE sat in `next`

**What changed.** Every harness server started by this pass binds loopback
(`next start -H 127.0.0.1`): `:3400` (pre-change control) and `:3500` (measurement build).
The V7-era `:3600` server was stopped rather than restarted — it had no remaining consumer.
`package.json`'s `dev` script already carries `-H 127.0.0.1`.

**Why.** `curl http://<this workstation's LAN address>:<port>/` answered **200 on 3000,
3400, 3500 and 3600** — four Windows-hosted Next servers listening on `::` (all interfaces),
while `next` carries GHSA-p293-qw3h-jr36, *Unauthenticated Remote Code Execution on
windows-hosted servers*, whose advisory text says no workaround exists other than
upgrading. Upgrading is declined (§8), so the reachability is removed instead. Production is
not the exposure: Vercel runs the app on Linux (`iad1`) and the advisory is scoped to
Windows hosts.

**Tradeoff.** The owner's long-running dev server on `:3000` predates the `dev`-script
change and is therefore still LAN-bound until it is restarted; ending a session that is not
mine to end was not authorised here. **Owner action:** stop the `:3000` process and run
`pnpm dev` — the committed script binds loopback, and that behaviour was proven on a
throwaway dev server (loopback answers, the LAN address refuses the connection).

**Verification.** `Get-NetTCPConnection -State Listen` reports `127.0.0.1` for 3400/3500
(where it had reported `::` for 3000/3400/3500/3600), `curl` to the LAN address on both
ports gets no connection, and `http://127.0.0.1:3400/` still answers 307.

---

## 18. Round trips removed from the four hot paths (the scalability half)

**What changed.** Five edits, all of the same species — a sequential `await` chain that was
never actually ordered by anything but code layout, turned into either one statement or a
`Promise.all`:

1. `src/server/agentos/store.ts` — `save()` awaited the run-row `UPDATE` and then the plan
   write in series. They are independent (different tables, no read depends on either) and
   both are best-effort inside the same `try`, so the series was pure latency. Now
   `Promise.all([agentRun.update, upsertStepsBatch])`: two statements, one round trip of
   wall clock. `save()` runs ~8 times per 6-step run (executor.ts:304 per step start, :583
   per transition), so this is the highest-frequency cut in the pass.
2. `src/server/api/chat-store.ts` `persistUserTurn` — it read the conversation row to check
   the thread existed, then wrote the message. The read is gone: write first, and treat the
   one error that means "the parent is gone" (`P2003`, a failed FK check) as the signal to
   start a fresh thread. Any other error still rethrows. 2 round trips → 1.
3. `src/server/api/chat-store.ts` `persistAssistantTurn` — the message insert (with its
   nested `routeEvent` row) and the `conversation.update` that touches `updatedAt` were
   awaited one after the other. Now overlapped; the returned message id comes from the
   insert, as before.
4. `src/server/agentos/replay.ts` — the run row was fetched, and only then were its three
   child tables batched. The run lookup is now the first element of that same `Promise.all`,
   with the `if (!run) return null` test moved after the batch. 2 round trips → 1.
5. `src/server/agentos-benchmark/engine.ts` — `persistResult` and `persistVerdict` were
   awaited inside the task loop, i.e. up to 8 cross-region round trips per task sitting on
   the path between two paid model calls. They now go through `trackWrite`, which keeps the
   promise (rejections captured through `captureError`, never silently dropped) and
   `drainWrites` awaits the backlog at the task boundary and immediately before `finishRun`.

**Why.** `docs/baseline-audit.md` measured the link, not the queries: the primary is in
`ap-southeast-2` and the app runs in `iad1`, so a statement costs ~1.6–1.8 s of wall clock
while `EXPLAIN ANALYZE` plans it in 0.6–4.1 ms. Adding indexes cannot help — every plan was
already an Index Scan over tables of 30–1 815 rows (§1). The only variable is how many
round trips a request waits for, and each of these was waiting for two where one would do.

**Tradeoff.** A concurrent `save()` holds two pool connections for its duration where the
sequential pair held one; on a cold pool the first connection setup (~2.5 s here) is paid
once per function invocation either way, so the cost is pool headroom, not latency, and it
is the same trade `Promise.all` always makes. The P2003 shortcut depends on `messages`
having exactly one foreign key (`schema/jev-swarm.prisma:37`, `onDelete: Cascade`), which is
what makes that code unambiguous; the helper's comment says so, because a second FK on the
table would make the inference wrong and the next reader has to notice that. The benchmark
engine's durability contract moves from "every row is on disk before the next model call" to
"every row is on disk at the task boundary and before the run goes terminal" — a process kill
between the two can lose the in-flight task's row, which the per-row write already could not
guarantee against a kill mid-statement either. Nothing here became a transaction: `BEGIN` and
`COMMIT` are two more round trips spent protecting writes the product already defines as
best-effort.

**Not done, deliberately.** `guardStream`'s identity → budget → audit → money ordering is a
product contract, not a latency accident, and the spend-cap check in `run.ts` must stay
before the provider call. `benchmark.ts:114-128`'s `warmUp()` costs two paid model calls, so
measuring it was out of scope for a $0 window. `createApiRoute`'s `authorize` option has
zero call sites on API routes, so there was no N+1 there to cut.

**Verification.** `scripts/verify-roundtrip-cuts.mts` — `node --import
./scripts/register-ts.mjs --import ./scripts/register-no-server-only.mjs
scripts/verify-roundtrip-cuts.mts`, the usage line in that file's header — → **10/10**, log at `_lh/roundtrip-cuts.txt`. It runs against the live database with the real Prisma client, and
the product code is untouched: `globalThis.prisma` is replaced with a Proxy that only
timestamps calls (`src/server/db/client.ts` caches the client there, which is what makes the
injection legitimate rather than a mock). Three premises were false the first time this was
written and are worth recording, because each produced a green-looking lie:

- the overlap test used `wall <= max + ε`, and a genuinely sequential pair restarts inside
  the same millisecond on a fast link, so the control passed as "concurrent". It is now a
  strict `<` on start-vs-finish, plus the control arm (G2) that asserts the *sum*.
- a 2-sample `median` returned the larger element, and the cold pool paid connection setup
  inside the first arm, so the "before" sample was inflated by something other than a round
  trip. The statistic is gone: G3 now requires every paired sample to be faster **and** the
  median delta to be at least half a round trip.
- `Sentry.captureException` is not callable in a bare Node process, so the `catch` path in
  `captureError` threw while testing the dead-thread branch. That is a harness-environment
  artifact, not a product bug (outside Next there is no Sentry runtime init), and it is why
  the instrument prints the failing statement itself: a best-effort module swallowing its own
  error is exactly what makes a harness-blind failure look like a crash in Sentry.

Numbers from the shipped tree: one round trip = 1620 ms; concurrent `save()` walls
1623/1620/1622 ms against a single statement of 1623/1619/1622 ms and a summed pair of
3246/3238/3240 ms, while the identical statements awaited in series measure 3244/3237/3566
ms (G2, the positive control — it can and did fail). Paired before-minus-after deltas
1621/1617/1944 ms, median 1621 ms. Assistant turn: both writes issued, wall 3241 ms = the
slower statement, ratio 1.00×. Replay: four statements, one wall, run rebuilt. Dead-thread
branch: `message.create` → P2003 → `conversation.create`, new id returned, zero reads.
Projected off the critical path: **~13.0 s per 6-step AgentOS run** and **~3.24 s per chat
turn**. The standing gate `scripts/verify-scale-security.mts` was re-run on the same tree:
8/8, cost of one enforced request median 1622 ms (baseline 1779 ms).

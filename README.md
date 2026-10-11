# AgentOS

A multi-LLM **routing workspace** and **multi-agent orchestration** app. You ask a
question; a decision model (**Jev**) classifies it and routes it to the best answer
model, or spins up a whole **team of agents** (researcher → calculator → critic →
synthesizer) that runs as a dependency graph, gathers cited evidence, fact-checks
itself, and streams every step to a live run view. Every routing decision, agent
step, tool call, citation and cent of spend is persisted to Postgres and replayable.

Built on Next.js 16 (App Router) · Prisma 6 · Supabase (Postgres + Auth) · NanoGPT ·
BeatAPI (Jev). It runs entirely on **localhost** against a **real remote Supabase
database** — no Docker, no local Postgres, no Supabase CLI.

> This repo was generated from the `8x-web-template`. The engineering conventions it
> ships with (rules in `AGENTS.md` → `docs/rules/*`, design tokens in `DESIGN.md`,
> the CI gates) still apply; this README is the product-facing guide to running
> **AgentOS** itself.

---

## What it does

| Surface              | Route               | What you see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Landing              | `/`                 | The dark animated product page: percentage preloader, 2D-canvas particle hero, 15 scroll-revealed sections including a pinned horizontal showcase, the real four-setup benchmark table and an accessible FAQ. See `docs/uiux-morning-report.md`.                                                                                                                                                                                                                                                                                                                                           |
| Sign in / Sign up    | `/login`, `/signup` | Email + password auth (Supabase). The whole app is gated behind it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Chat**             | `/app`              | Ask anything. Jev routes the turn to a model, the answer **streams** token-by-token, and a telemetry chip shows the routed model, latency, token count, real cost, and a `pool failover` badge when a weaker free model had to take over. Conversation history persists.                                                                                                                                                                                                                                                                                                                   |
| **Dashboard**        | `/dashboard`        | Cumulative routing statistics, live latency + routing distribution, the Jev benchmark and its run history, the four-setup **AgentOS benchmark**, a **Model Pool health** panel (catalogue split, circuit states, measured working/gated/unprobed models), plus the **Spend** view (real cumulative cost from the funded key — per-family breakdown, per-run + benchmark costs, spend-over-time, cap utilization, and an honestly _unknown_ balance) and the **Model usage** view (which models actually answered, per-model/family/feature call counts, chat routing + Jev-fallback rate). |
| **AgentOS run view** | `/agentos`          | The D6 terminal: Decision Bus checklist → dynamically chosen agent team (each with its routed model badge) → execution → evidence graph → Jev verification gates → final cited answer. Runs stream live over SSE and any past run is **replayable** through the same renderer.                                                                                                                                                                                                                                                                                                             |

### How the pieces fit

- **Jev** (TypeSafe AI "System One", served as the BeatAPI capability
  `model:jev-1.13-free`) is a **decision** model — it classifies the query, picks the
  agent team, routes a model per agent, and runs the evidence-sufficiency /
  evidence-validity verification gates. **It never generates prose.** Free tier.
- **NanoGPT** (an OpenAI-compatible aggregator, base `https://api.nano-gpt.com/v1`) runs
  the **answer** models (Claude / GPT / Gemini) and the **Model Pool**: a
  runtime-discovered catalogue (`GET /v1/models?detailed=true`, ~632 models) with
  capability checks, ordered failover chains, per-model circuit breakers, rate limiters,
  and an L0–L5 degradation ladder. **NanoGPT has no usable free tier** (the only `$0`
  entries are blocklisted meta-helpers), so on a funded key degradation runs
  flagship → cheaper **paid** same-family sibling → the cheapest **paid** floor
  (`meta-llama/llama-3.3-70b-instruct`); a `402`/failure falls to the next paid model
  rather than a free one. **NanoGPT exposes no web-search or embeddings endpoint**, so the
  research tool runs in an honest **knowledge-grounded, no-live-search mode** — it returns
  grounded answers with **zero citations** rather than inventing sources. Cost is computed
  as `tokens × a curated per-1M USD price` (NanoGPT's streaming `usage` carries token
  counts but no monetary `cost`); where a model's price is unpublished the ledger records
  tokens and marks USD **unknown** — never a made-up number.
- **Prisma + Postgres (Supabase)** owns every byte of application data — routing
  events, conversations, agent runs/steps/events, decision records, evidence,
  benchmarks and the AI-usage spend ledger. **Supabase is used for Auth only**; it
  never serves application data (the Data API is kept off and RLS is enabled with no
  policies — see `docs/rules/auth.md`).
- **Spend is capped in code** (`PER_RUN_CAP_USD`, `NIGHTLY_SPEND_CAP_USD`,
  `BENCHMARK_CAP_USD`) and enforced _before_ every paid call; on a cap hit the run
  stops paid work and returns the best honest partial answer — it never silently
  overspends.

---

## Prerequisites

- **Node >= 22.18.0** (`package.json` `engines`). Node's built-in `--env-file` flag is
  used below, which requires Node 20.6+.
- **pnpm 10.6.2** (`package.json` `packageManager`). `corepack enable` will fetch the
  pinned version.
- A **Supabase** project (free tier is fine) — provides both the Postgres database and
  Auth.
- A **NanoGPT** account (funded — it has no usable free tier) and a **BeatAPI** account
  (free tier runs Jev).

**No Docker and no Supabase CLI are needed or supported.** The app reads a real,
remote Postgres/Supabase instance that you supply via connection strings.

---

## 1 · Provision the services (do this once)

The repo ships **no secrets** — only `.env.example` with placeholders. You must create
your own Supabase project and API keys, then paste their values into `.env.local`.
Here is exactly where each value comes from.

### 1a · Supabase — database + auth

1. **Create a project** at [supabase.com](https://supabase.com) → _New project_. Pick a
   region and set a **database password** (you'll need it below). Wait for it to finish
   provisioning.

2. **Connection strings** — _Project Settings → Database → Connection string (URI)_.
   Supabase exposes two pooled hosts; you need **both**:
   - **Transaction pooler, port `6543`** → this is `DATABASE_URL` (what the running app
     uses). You **must append `?pgbouncer=true`**, or Prisma throws
     `prepared statement "s0" already exists`.
   - **Session pooler, port `5432`** → this is `DIRECT_URL` (what Prisma migrations use;
     `migrate deploy` holds an advisory lock a transaction pooler can't sustain).

   They look like:

   ```
   DATABASE_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
   DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```

   **Percent-encode special characters in the password.** In particular an `@` in the
   password must be written `%40`, or the URL parses wrong and the connection fails.

3. **API keys + URL** — _Project Settings → API Keys_ and _General_:
   - `NEXT_PUBLIC_SUPABASE_URL` = the **Project URL**, `https://<project-ref>.supabase.co`.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the **`sb_publishable_…`** key (the new-style
     publishable key, **not** the legacy `anon` JWT). This is safe to expose to the browser.
   - `SUPABASE_SECRET_KEY` = the **`sb_secret_…`** key. **Server-only**, never prefixed
     with `NEXT_PUBLIC_`. Optional for local email/password auth — leave it empty unless
     you need admin auth operations.

4. **Auth redirects** — _Authentication → URL Configuration_:
   - **Site URL** = `http://localhost:3000`
   - **Redirect URLs** → add `http://localhost:3000/auth/callback`
     (the sign-up confirmation link lands there).

5. **Email confirmation** — _Authentication → Sign In / Up → Email_. For the smoothest
   local experience, **turn OFF "Confirm email"**: sign-up then returns a session
   immediately and logs you straight in (no inbox needed). If you leave it **ON**, you
   must also configure an SMTP provider (or use Supabase's built-in mailer) and click the
   link in the email — see [First user](#4--create-your-first-user) below.

> **Keep the Supabase Data API off** and RLS enabled with no policies. The committed
> migrations already enable RLS on every table; nothing in the app talks to PostgREST.
> This is the repo's security convention (`docs/rules/auth.md`) — you don't need to do
> anything extra to run locally, but don't flip the Data API on.

### 1b · NanoGPT — the answer models

1. Sign in at [nano-gpt.com](https://nano-gpt.com) → **API Keys** → create a key. It looks
   like `sk-…`. This is `NANOGPT_API_KEY` (server-side only). The client talks to the
   OpenAI-compatible base `https://api.nano-gpt.com/v1` with a plain `Authorization: Bearer`
   header (no `HTTP-Referer`/`X-Title`).
2. **Funding is required.** NanoGPT has **no usable free tier** — the only `$0`-priced
   entries (`nano-gpt-help`, `auto-model`) are blocklisted meta-helpers, not answer models.
   A **funded** key is needed for chat flagships, the AgentOS agents, the judge, and the
   benchmark. On an unfunded/`402` key the degradation ladder falls to the cheapest **paid**
   floor and, if that also fails, the run stops honestly and records the real error — it
   never fabricates an answer.
3. **No search / no embeddings.** NanoGPT exposes no web-search or embedding endpoint, so
   the research tool runs in a knowledge-grounded, no-live-search mode (grounded answers,
   zero citations, `source:null` evidence rows). This is a provider capability limit, not a
   code defect — see `docs/agentos-integration-notes.md` (D-45).

### 1c · BeatAPI — the Jev router

1. Sign up at [beatapi.io](https://beatapi.io) and create an API key. This is
   `BEATAPI_API_KEY` (server-side only). It runs the Jev routing capability
   `model:jev-1.13-free`, which is **free tier**.
2. The free tier is **rate-limited** (rapid back-to-back calls return `429` with a
   `Retry-After`). The app batches Jev questions into one call and honours `Retry-After`;
   if you see routing fall back to policy under load, that's the free-tier limit, not a bug.

---

## 2 · Install

```bash
pnpm install        # installs deps, runs `prisma generate`, and wires the git hooks
```

---

## 3 · Configure env + apply migrations

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the values you provisioned above. The **required**
variables (the app fails fast at boot/build if any is missing or empty — `src/lib/env.ts`):

| Variable                               | Where it comes from | Notes                                                      |
| -------------------------------------- | ------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                         | Supabase 1a.2       | Transaction pooler `:6543`, **must** end `?pgbouncer=true` |
| `DIRECT_URL`                           | Supabase 1a.2       | Session pooler `:5432`, used by Prisma migrations          |
| `NANOGPT_API_KEY`                      | NanoGPT 1b          | `sk-…`; must be non-empty to build                         |
| `BEATAPI_API_KEY`                      | BeatAPI 1c          | must be non-empty to build                                 |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase 1a.3       | `https://<ref>.supabase.co` — needed for the auth gate     |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 1a.3       | `sb_publishable_…` — needed for the auth gate              |

Everything else (Sentry, PostHog, Slack, cron, spend caps) is optional and no-ops until
set; `.env.example` documents each one inline. `LOG_LEVEL` ships as `"info"` — leave it a
valid value (`debug|info|warn|error|silent`), not an empty string.

Then apply the committed migrations. **Important:** the Prisma CLI does **not** read
`.env.local` (only Next.js does), so load it explicitly with Node's `--env-file`:

```bash
node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy
```

Expected output: `15 migrations found in prisma/migrations` then either
`Your database is now in sync with your schema` (fresh DB) or
`No pending migrations to apply` (already migrated).

> Any Prisma/DB **CLI** command needs the same treatment (`--env-file=.env.local`),
> because standalone CLIs and scripts don't inherit Next.js's env loading. Migrations are
> **committed** under `prisma/schema/migrations/` and applied with `migrate deploy` —
> **never** `prisma migrate dev` (new migrations are CI-generated from schema changes;
> see `docs/rules/migrations.md`).

---

## 4 · Create your first user

The whole app is gated behind sign-in, so you need one account.

1. Start the app (next section), then open **http://localhost:3000/signup**.
2. Enter an email + a password (min 8 chars) → **Create account**.
   - **If you turned OFF "Confirm email"** (recommended for local, 1a.5): you're signed in
     immediately and your `User` row is provisioned. Done.
   - **If "Confirm email" is ON**: you'll see _"Check your email to confirm your account."_
     Click the link in the inbox — it lands on `/auth/callback`, which verifies the token,
     provisions your `User` row, and redirects you in. Then sign in at `/login`.
     (This requires the SMTP/mailer + redirect URL from 1a.4–1a.5 to be configured.)

`User.id` **is** the Supabase auth UUID — there's one identity, not two.

---

## 5 · Run it

```bash
pnpm dev
```

Open **http://localhost:3000**. English is served unprefixed (`/en` redirects to `/`).
Sign in, then try each surface:

- **`/app`** — send a message. Watch it stream; check the telemetry chip for the routed
  model, latency, tokens and real cost. On a funded NanoGPT key the real flagship answers;
  if a model fails mid-turn you'll see a `pool failover` / `degraded` badge naming the
  paid model that actually answered. The turn persists to history.
- **`/agentos`** — run a query and watch the Decision Bus pick a team, the agents execute,
  evidence accumulate, and the verification gates fire; then replay a past run from the picker.
- **`/dashboard`** — routing stats, latency/distribution, benchmarks, and Model Pool health.

Port 3000 busy? Run on another one: `pnpm dev -- -p 3001` (or
`node node_modules/next/dist/bin/next dev -p 3001`).

> **Don't run `next build` and `next dev` against the same `.next` directory.** Building
> first leaves a production `.next` that Turbopack dev then chokes on (a
> `next/font/google … Can't resolve` 500). If you hit that, `rm -rf .next` and start dev
> again. The normal path is just `pnpm dev`.

---

## Benchmarks

Two real benchmark harnesses persist their results and chart them on the dashboard:

```bash
pnpm benchmark            # Jev routing benchmark (scripts/benchmark.mjs)
pnpm benchmark:agentos -- --pilot   # 3-task × 4-setup AgentOS pilot
pnpm benchmark:agentos -- --full    # full 24-task × 4-setup run
```

The AgentOS benchmark runs the same tasks through four setups — **A** a single LLM,
**B** single LLM + RAG, **C** a fixed researcher→critic→synthesizer DAG, and **D** the
full AgentOS pipeline — each answer graded by a `gpt-4.1` rubric judge, with real
measured cost/latency/calls/replans. **The full run makes paid NanoGPT calls and needs a
funded key**; spend is bounded by `BENCHMARK_CAP_USD` and the harness runs a 3-task pilot
and checks actual spend before committing to the full run.

### Real results (run #6 — full 24-task × 4-setup, funded NanoGPT key, 2026-10-08)

Generator `gemini-2.5-flash`, judge `openai/gpt-4.1`, ~72 min, exit 0. Per-task averages:

| setup                 | success | judge score | cost/task     | latency    |
| --------------------- | ------- | ----------- | ------------- | ---------- |
| A · single LLM        | 100%    | 0.87        | $0.000783     | 8.4 s      |
| B · single LLM + RAG  | 100%    | 0.90        | $0.003550     | 22.8 s     |
| C · fixed multi-agent | 95.8%   | **0.92**    | $0.003430     | 26.7 s     |
| D · full AgentOS      | 95.8%   | 0.90        | **$0.008979** | **75.8 s** |

Total run spend **$0.530901** (setups $0.389973 + judge $0.140928) — 3.5% of the $15 cap.

**The honest read (not spun):** full AgentOS was (joint-)best on 16 of 24 tasks and never
best on 8; it was **sole** best on 2 — a document-qa and an ambiguous task. It does **not**
win on cost (priciest per task), latency (slowest), or top score (the fixed DAG scored
highest at 0.92). AgentOS's real, measured edge is **robustness on ambiguous /
document-heavy tasks**, not raw price or speed — the pitch is quality-per-dollar on hard
tasks, and the numbers say so plainly. Two setups errored once each (kept as honest 95.8%,
not dropped). Citations are 0 across all setups because NanoGPT has no search endpoint
(D-45) — reported as a real 0, never fabricated. Full per-task logs and the pilot (`#5`)
live in `docs/agentos-status.md`.

---

## Tests, lint, typecheck, build

```bash
pnpm test         # node --test over scripts/*.test.mjs + src/**/*.test.mts (no browser)
pnpm lint         # eslint . --max-warnings=0
pnpm typecheck    # tsc --noEmit
pnpm build        # next build (requires the non-empty API keys above)
pnpm test:e2e     # Playwright — boots the app unless E2E_BASE_URL is set
```

On **Windows**, a subset of `pnpm test` cases fail for environmental reasons (they build
temp fixtures with `symlink`, which needs Developer Mode / admin — `EPERM … symlink`),
not because of a code regression. To validate a change without that noise, run
`pnpm typecheck` and `pnpm lint` directly.

Other gates: `pnpm check:env` (env drift), `pnpm check:tokens` (design-token lint),
`pnpm check:secrets` (no committed secrets), `pnpm check:rls` (RLS on, no policies),
`pnpm check:standards`, `pnpm check:ai-models`.

---

## Environment variable reference

Every variable is documented inline in `.env.example` and validated at boot by
`src/lib/env.ts` (Zod) — a misconfigured env fails immediately with a clear message.
Groups: database (Prisma), Supabase Auth, logging, Sentry, PostHog, Slack alerting, i18n,
cron secret, app URL, the two model-provider keys (BeatAPI + NanoGPT), and the
AgentOS spend caps. `pnpm check:env` fails if any `process.env.X` referenced in `src/`
is missing from `.env.example` or the schema.

**Secrets are never committed.** `.env*` is gitignored except `.env.example` (placeholders
only). The two model keys and the DB connection strings are server-side only — never
prefixed `NEXT_PUBLIC_`, never sent to the browser, never logged.

---

## Troubleshooting

| Symptom                                                                                        | Cause / fix                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Environment variable not found: DIRECT_URL` (or `DATABASE_URL`) when running a Prisma command | The Prisma CLI doesn't read `.env.local`. Prefix with `node --env-file=.env.local …` (see §3).                                                          |
| Build fails: `NANOGPT_API_KEY … Too small: >=1 characters` (or `BEATAPI_API_KEY`)              | These are required and must be non-empty. Put your real keys in `.env.local`.                                                                           |
| Boot/build fails: `LOG_LEVEL: Invalid option`                                                  | `LOG_LEVEL` must be one of `debug\|info\|warn\|error\|silent`, not an empty string. `.env.example` ships `"info"`.                                      |
| `prepared statement "s0" already exists`                                                       | `DATABASE_URL` is missing `?pgbouncer=true` on the `:6543` transaction pooler.                                                                          |
| Migrations hang                                                                                | You pointed `DIRECT_URL` at the `:6543` pooler. It must be the `:5432` **session** connection.                                                          |
| Connection fails / auth error on the DB URL                                                    | An unescaped special char in the password. Percent-encode it (`@` → `%40`).                                                                             |
| `GET /` returns 500 with `next/font/google … Can't resolve` in dev                             | You ran `next build` before `next dev` in the same dir. `rm -rf .next`, then `pnpm dev`.                                                                |
| Redirected to `/login` everywhere                                                              | Expected — the app is auth-gated. Create a user (§4). If Supabase env vars are unset the gate fails _open_ instead.                                     |
| Sign-up says "check your email" but nothing arrives                                            | "Confirm email" is ON with no SMTP configured. Turn it off for local (1a.5) or configure the mailer + `/auth/callback` redirect.                        |
| Chat shows `pool failover` / `degraded`                                                        | A model failed mid-turn and the next **paid** model in the chain answered (NanoGPT has no free tier). The badge names the model that actually answered. |
| AgentOS run fails with `402` / insufficient credit                                             | The NanoGPT key is unfunded or out of credit. Top it up — there is no free fallback (D-44). The run stops honestly and records the real error.          |
| Research returns no citations                                                                  | Expected — NanoGPT has no search/embeddings endpoint (D-45). The tool answers knowledge-grounded with zero citations rather than inventing sources.     |
| Port 3000 already in use                                                                       | `pnpm dev -- -p 3001`.                                                                                                                                  |

---

## Known limitations (honest)

- **NanoGPT has no usable free tier and no search/embeddings endpoint.** An unfunded key
  cannot run chat flagships, the AgentOS pipeline, or the benchmark (the degradation ladder
  bottoms out at the cheapest **paid** floor). The research tool therefore runs
  knowledge-grounded with **zero citations** — honest, but it cannot retrieve live web
  evidence. Both are provider capability limits, not code defects (D-44/D-45,
  `docs/agentos-integration-notes.md`).
- **Cost is computed, not provider-reported.** NanoGPT's streaming `usage` carries token
  counts but no monetary `cost`, so USD = `tokens × a curated per-1M price`. Where a model's
  price is unpublished the ledger records tokens and marks USD **unknown** — never a
  made-up number. There is no verified balance endpoint, so the Spend view shows remaining
  credit as **unknown** rather than guessing.
- **On the funded 24-task benchmark, full AgentOS is the priciest and slowest setup and does
  not top the score** (the fixed multi-agent DAG does). Its measured edge is robustness on
  ambiguous/document-heavy tasks — see the real table under Benchmarks above.
- **Windows `pnpm test`** has environment-dependent `symlink` failures (see Tests above).
- The dashboard's benchmark, Model-Pool, Spend and Model-usage panels are auth-gated; they
  render real data only once you're signed in and, for benchmark/spend numbers, once real
  runs have executed.

---

## Project structure

```
AgentOS/
├── .agent-logs/             tracked session transcripts (ships public — never contains secrets)
├── docs/
│   ├── rules/               one file per engineering rule (database, migrations, auth, ai-usage, …)
│   ├── agentos-status.md    per-milestone honest status + the real measured numbers
│   ├── agentos-decisions-log.md   D-01… decisions (Q/Options/Chosen/Why/Risk/Reverse)
│   ├── DESIGN.md            design-token + component conventions
│   └── ui-audit/            before/after screenshots + the verification harness output
├── prisma/
│   ├── schema/              multi-file Prisma schema — the only thing you hand-edit
│   │   └── migrations/      committed, CI-generated; applied with `migrate deploy`
│   └── run-once.sql         one-off SQL, applied once per DB via a content-hash ledger
├── scripts/                 benchmarks, migration generator, run-once runner, env/standards/RLS/token/secret checks
├── src/
│   ├── app/[locale]/        App Router pages: /, /login, /signup, /app, /dashboard, /agentos
│   ├── app/api/             route handlers: chat, conversations, dashboard, agentos(+runs),
│   │                        agentos-benchmark(+runs), benchmark(+runs), model-pool
│   ├── components/          ui/ (shared primitives), nav/, chat/, dashboard/, agentos/, marketing/, auth/
│   ├── lib/                 pure, injectable cores: orchestra/ (engine), decisions/ (Jev bus),
│   │                        agents/, model-pool/, agentos/, mcp/ (calculator), env.ts
│   ├── server/              server-only: ai/ (Jev + NanoGPT), agents/, agentos/, model-pool/, db/
│   └── proxy.ts             Supabase session refresh + auth gate + next-intl locale routing
├── instrumentation.ts       Sentry init + env validation + free-model warm-up, run at server boot
├── AGENTS.md                index into docs/rules/* — read by every coding agent
└── .env.example             every variable explained inline (placeholders only)
```

---

## Development conventions

Read `AGENTS.md` (index into `docs/rules/*.md`) before changing code — the migration
workflow, Server/Client Component rules, database-access boundary, AI-usage tracking and
token conventions are enforced in CI or by the checks above, not optional style.
`DESIGN.md` has the design-token/component conventions; `pnpm check:tokens` fails on raw
hex colours, hard-coded font families or off-scale spacing in feature code.

### Scripts

| Command                                                                                                   | What it does                                                           |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                                                                            | Standard Next.js                                                       |
| `pnpm lint` / `typecheck` / `format:check`                                                                | CI gates — run before pushing                                          |
| `pnpm test` / `test:e2e`                                                                                  | `node --test` unit suite / Playwright e2e                              |
| `pnpm benchmark` / `benchmark:agentos`                                                                    | Jev routing benchmark / four-setup AgentOS benchmark                   |
| `pnpm prisma:generate`                                                                                    | Regenerate the Prisma client after a schema change                     |
| `pnpm db:run-once`                                                                                        | Apply `prisma/run-once.sql` once to `DIRECT_URL` (else `DATABASE_URL`) |
| `pnpm check:env` / `check:tokens` / `check:secrets` / `check:rls` / `check:standards` / `check:ai-models` | The repo's correctness gates                                           |

Commits use the conventional-commit format enforced by the `.githooks/commit-msg` hook
(installed by `pnpm install`); a `check-secrets` pre-commit hook blocks committed secrets.

### Deployment

This project is demonstrated on **localhost** against the real Supabase database. The repo
still carries the template's CI/CD wiring (`.github/workflows/`, `docs/CI_CD_SETUP.md`,
`docs/rules/deployment.md`) for reference, but no Vercel/hosting deploy is part of the demo.

# Jev-Swarm — Plan (Phase 0, one page)

Multi-LLM chat workspace. **Jev** (BeatAPI `model:jev-1.13-free`, free) routes each user
query to **claude | gpt | gemini**; **OpenRouter** streams the actual answer. The product's
job is to *visibly and measurably prove* Jev's latency advantage over an LLM-as-judge
baseline. Runs on **localhost + Supabase** (no Vercel deploy, per your last note).

## Architecture (fits the template — don't fight it)

- Next.js 16 App Router. `POST /api/chat` = streaming route (SSE):
  1. `performance.now()` around the Jev call → `jevLatencyMs`.
  2. Jev `run` → validate label ∈ {claude,gpt,gemini}.
  3. Emit `route` event immediately (model, jevLatencyMs, confidence, probabilities) so the
     UI animates before the answer.
  4. Stream OpenRouter tokens as `token` events (mapped slug from `lib/models.ts`).
  5. Emit `done` (TTFT, total latency, token usage, estimated cost).
- Resilience: Jev timeout (2s) / invalid label / error → configured default model,
  `fallback:true` + reason, shown honestly in UI. OpenRouter error → one retry + clear
  message. Input validation, basic rate limit, no secrets in logs/responses.
- Conversation memory: prior turns sent to the chosen model; each turn routed
  independently (badge can change mid-conversation).
- Prisma owns all data (template rule); Supabase Auth optional. AI calls go through the
  template's `src/server/ai/<provider>` + `trackAiCall` convention (OpenRouter priced).

## Data model (Prisma → Supabase Postgres; RLS enabled, no policies)

- `conversations` (id, title, createdAt, updatedAt)
- `messages` (id, conversationId, role, content, createdAt)
- `route_events` (id, messageId, chosenModel, jevLatencyMs, confidence, fallback,
  fallbackReason, ttftMs, totalLatencyMs, promptTokens, completionTokens, costUsd)
- `benchmark_runs` (id, label, startedAt, finishedAt, concurrency, judgeModel, notes)
- `benchmark_results` (id, runId, promptId, router[jev|judge], latencyMs, label,
  expectedLabel, agreed, error)

## Benchmark suite (the proof)

- `benchmarks/dataset.json`: ≥50 labelled prompts (coding, creative, long-doc, math,
  casual, multilingual) + expected best route + how labels were chosen.
- `POST /api/benchmark` + CLI: run every prompt through **Jev** and an **LLM-as-judge**
  baseline (small OpenRouter model, fixed prompt, same {claude,gpt,gemini} labels).
- Record latency/label/agreement/errors; report p50/p95/mean/min/max, accuracy vs labels,
  router agreement, failure rate, routing cost. Same concurrency + warm-up. Store in
  Supabase so the dashboard charts real history. Report honestly, incl. where judge wins.

## Frontend (two views + polished shell)

1. **Chat**: streaming markdown/code + copy, per-message live model badge (distinct
   colour/icon), animated routing visualizer (query→Jev→model lights up) driven by the
   `route` event, telemetry chips (Jev ms, TTFT, total ms, tokens, cost), fallback
   indicator, history, empty state w/ examples, loading/error/retry, mobile-responsive.
2. **Dashboard**: live Jev latency gauge, Jev-vs-judge p50/p95 bars + distribution,
   routing distribution donut, accuracy + cost comparison, cumulative stats (queries
   routed, avg Jev latency, measured speed-up factor), benchmark run button w/ progress,
   run history. All numbers real; sensible empty states.

Design: distinctive direction + real type pairing (no purple-gradient/stock-card cliché),
design tokens, dark+light, purposeful motion w/ `prefers-reduced-motion`, a11y (keyboard,
focus, aria on charts/badges). Propose direction → get approval → then polish.

## Milestones

1. **Phase 0** (now): discovery, verified log tracking, real Jev + OpenRouter calls, plan.
2. Vertical slice on localhost: chat → Jev route → OpenRouter stream → badge + telemetry.
3. Persistence, fallback handling, conversation history.
4. Benchmark engine + dataset + judge baseline + stored results.
5. Executive dashboard (live + historical charts).
6. UI/UX polish, motion, theming, mobile, a11y.
7. Hardening: tests, error states, perf, security review, README, demo script.

After each milestone: 4–6 Discord-ready bullets in your voice + a screenshot list.

## Decisions I need from you before writing feature code

1. **Jev access path:** (A) BeatAPI REST `run` [verified, matches your key, free] or
   (B) `@typesafe-ai/sdk` [brief-literal, but unverified against a BeatAPI key]? → I
   recommend **A**.
2. **Approve secret handling:** let me write the two keys to gitignored `.env.local` so I
   can run the read-only `/v1/usage` check + one real Jev call + one OpenRouter call?
   (Policy blocked the auto-write; I will never print or commit the values.)
3. **Model slugs:** OK to use `anthropic/claude-sonnet-4.5`, `openai/gpt-4.1`,
   `google/gemini-2.5-flash` (judge: `openai/gpt-4.1-nano`), re-verified live at build?

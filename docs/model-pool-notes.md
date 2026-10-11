# Model Pool — Phase 0 findings (diagnosis, inventory, limits, plan)

Phase 0 only, per the Model Pool brief's `FIRST ACTION`. **No feature code written.**
Everything below is a real, measured result (live calls against OpenRouter with the
key in `.env.local`, key never printed) or a quoted doc figure. Nothing is guessed.

Probe run: `_scratch/probe-openrouter.mjs`, executed `2026-10-03T17:18Z` via
`node --env-file=.env.local`. Raw JSON captured in this session; summarised here.

---

## 1. Why does the key "reach only ~3–4 models"? — **It doesn't. That is our own code.**

**Root cause: an application-side restriction, not an account restriction.**

- The live catalog `GET /api/v1/models` returns **466 models**, of which **17 are
  `:free`** (22 are zero-priced). The key can call them: **6/6 free probes returned
  HTTP 200 at $0.00** (measured below).
- The app only ever *asks* for 3, because `src/lib/models.ts` hard-codes the closed
  routing set `MODEL_LABELS = ['claude','gpt','gemini']` — this is **Jev's label set**
  (docs/jev-integration-notes §7), not an OpenRouter limit. Anything Jev returns
  outside those three is treated as a router miss and falls back to `gpt`.
- Compilation is further gated by `OPENROUTER_SLUGS` in
  `src/server/lib/ai-usage/models.ts` (`TrackedModel = keyof typeof OPENROUTER_SLUGS`):
  an unmapped model **does not typecheck**, and `pnpm check:ai-models` fails on a
  retired slug. Currently registered: the 3 routing targets + `gpt-4.1-nano` (judge) +
  `perplexity/sonar` (research tool) = **5 slugs actually called**.

**Conclusion:** the "few models" is a deliberate two-layer design (Jev's bounded label
set + the ai-usage guardrail), not a permission wall. The Model Pool work must therefore
*introduce a new selection layer underneath* the Jev labels and *register* pool models in
`OPENROUTER_SLUGS` — it cannot simply "unlock" models the account already can reach.

---

## 2. Account / key facts (live, measured)

| Fact | Value | Source |
|---|---|---|
| Credit balance | **`total_credits: 0`** | `GET /api/v1/credits` (200, 352ms) |
| Lifetime usage | `total_usage: 0` (fresh rotated key) | same |
| Key tier | **`is_free_tier: true`** | `GET /api/v1/key` (200, 21ms) |
| Per-key spend limit | `limit: null` (none set) | same |
| `rate_limit` field | deprecated, "safe to ignore" | same |

**The key rotated on 2026-10-03 is a fresh free-tier key with $0 credits.** The M8 full
benchmark blocker (D-32 / `docs/BLOCKED.md`) is therefore **still active** for any call
large enough to exceed the free reserve.

**Important nuance — tiny calls pass, real completions will 402.** With $0 credits the
`max_tokens: 8` probes still succeeded (gemini-2.5-flash $0.0000046, gpt-4.1-nano
$0.0000022). A real completion (e.g. `max_tokens: 1024`) reserves far more and is refused
with `402 "would exceed your available credits"` — exactly the M6/M8 wall documented
earlier. So "paid calls work" is **not** proven by the probe; only sub-reserve calls are.

---

## 3. Free-model inventory (runtime-discovered, verified metadata + live probe)

Metadata columns are from the model objects' real `supported_parameters` /
`architecture.input_modalities` / `context_length` — **not** inferred from names.
Probe columns are measured from a real completion (`max_tokens: 8`).

### Live completion probes (6 free + 3 premium)

| model | free | status | latency | cost | note |
|---|---|---|---|---|---|
| `google/gemini-2.5-flash` | no | **200** | 2765ms | $0.0000046 | app routing target; sub-reserve OK |
| `openai/gpt-4.1-nano` | no | **200** | 818ms | $0.0000022 | judge model; sub-reserve OK |
| `perplexity/sonar` | no | **400** | 1110ms | — | ⚠️ "Provider returned error" — research tool currently failing on this key (see §6) |
| `apodex/apodex-1.1-mini:free` | yes | **200** | 819ms | $0 | empty content (reasoning-style) |
| `inclusionai/ling-3.0-flash-sante:free` | yes | **200** | 952ms | $0 | empty content |
| `qwen/qwen3.8-27b:free` | yes | **200** | 508ms | $0 | empty content |
| `dots-studio/dots-3-note-preview:free` | yes | **200** | 1448ms | $0 | empty content |
| `liquid/lfm-2.5-2.6b:free` | yes | **200** | 891ms | $0 | empty content |
| `nvidia/nemotron-3.5-lightning:free` | yes | **200** | 427ms | $0 | returned text |

**Reliability caveat (real):** 5 of 6 free models returned an **empty `content`** for a
trivial prompt at `max_tokens: 8` — they are reasoning-style models that spend the token
budget on hidden reasoning or need more tokens. Per the brief, **empty output is a failover
trigger**, so the pool must not treat a 200-with-empty-content as success. This must be
re-probed at a realistic `max_tokens` before any model is trusted for a real step.

### Verified capability metadata (first 12 `:free` models from the live catalog)

| model | context | tools | structured | vision |
|---|---|---|---|---|
| `apodex/apodex-1.1-mini:free` | 262,144 | ✓ | ✓ | — |
| `inclusionai/ling-3.0-flash-sante:free` | 262,144 | ✓ | — | — |
| `qwen/qwen3.8-27b:free` | 262,144 | ✓ | ✓ | ✓ |
| `dots-studio/dots-3-note-preview:free` | 512,000 | ✓ | ✓ | ✓ |
| `liquid/lfm-2.5-2.6b:free` | 65,536 | ✓ | ✓ | — |
| `nvidia/nemotron-3.5-lightning:free` | 1,000,000 | ✓ | — | — |
| `thinkingmachines/inkling-small:free` | 1,048,576 | ✓ | — | ✓ |
| `thinkingmachines/inkling:free` | 1,048,576 | ✓ | — | ✓ |
| `poolside/laguna-s-2.1:free` | 262,144 | ✓ | — | — |
| `poolside/laguna-xs-2.1:free` | 262,144 | ✓ | — | — |
| `cohere/north-mini-code:free` | 256,000 | ✓ | — | — |
| `nvidia/nemotron-3.5-content-safety:free` | 128,000 | — | — | ✓ |

`structured` = advertises `structured_outputs` and/or `response_format`. These are
**advertised** parameters; the brief requires a real structured-output probe before the
pool *trusts* native structured output (many "free + reasoning" models emit JSON wrapped
in prose). Candidate standouts for the pool (to verify in Phase 1): `qwen/qwen3.8-27b:free`
(tools+structured+vision, 262k, fast 508ms), `dots-studio/dots-3-note-preview:free`
(512k, tools+structured+vision), `apodex/apodex-1.1-mini:free` (262k, tools+structured).

---

## 4. Documented free-tier limits (quoted from openrouter.ai/docs/api-reference/limits)

- **Rate limit (free models): 20 requests/minute** — `FREE_MODEL_RATE_LIMIT_RPM = 20`,
  constant across all account tiers.
- **Daily quota depends on credit balance:**
  - below the credit threshold: **`FREE_MODEL_NO_CREDITS_RPD = 50` requests/day**
  - account with credits: **`FREE_MODEL_HAS_CREDITS_RPD = 1000` requests/day**
- Paid variants "have no platform-level request cap."

**This account is at $0 credits → the binding limit is 50 free requests/DAY and 20/min.**
That is the single most important planning number: a 24×4 resilience benchmark with
multi-agent teams would consume **hundreds** of calls and hit the 50/day wall almost
immediately. Free models can power *interactive demos and low-volume steps*, but **not** a
full benchmark run without funding the key (which lifts the daily cap to 1000 *and* enables
paid calls).

---

## 5. Privacy / data-policy (quoted from openrouter.ai/docs/features/privacy-and-logging)

- "There are separate settings for paid and free models."
- "If you opt out of training in your account settings, OpenRouter will not route to
  providers that train." → free models that require training consent become unavailable and
  return a data-policy exclusion error (classically `404 "No endpoints found matching your
  data policy"`).
- Free models **may log prompts / use them for training** depending on provider policy.

**Evidence for this account:** all 6 free probes routed successfully (200), so the current
account settings **do allow** the free providers tested. **I did not and will not change any
account/key setting** (brief rule). If the user later enables training opt-out, some free
models will drop out — the pool must handle a data-policy 404 as a failover trigger, not a
crash. Per the brief, the UI must show a "free models may log prompts" note and Free/Premium
badges, and a guard must keep secret-shaped strings away from free models.

---

## 6. Risks / things to flag (stop-and-tell items)

1. **`perplexity/sonar` returned HTTP 400 "Provider returned error".** The research MCP tool
   (AgentOS M5) depends on sonar. On this key/credit state it is currently failing. This is a
   real degradation to investigate in Phase 1 (may be credit-related, a provider transient, or
   a required-param change). Flagged, not assumed.
2. **$0 credits** → paid path is not truly usable for real completions; the M8 full benchmark
   stays blocked. Free models are capped at **50 calls/day**, too few for a full benchmark.
3. **Free models are reasoning-style and returned empty content at low `max_tokens`** → the
   pool's "empty output = failure" rule is essential; naive success-on-200 would silently
   inject blank answers.
4. **Native structured output is advertised, not proven** → must be probe-verified before the
   Decision Bus trusts it for evidence/verification records (the brief's rule).
5. **Jev label set is closed (3 labels).** The pool must sit *under* Jev: Jev still decides
   task type / complexity / model *family or style*; the pool maps that to concrete free/premium
   candidates. `decided_by` must record `jev` vs `pool-policy` and never present a pool choice
   as a Jev choice (brief §2 + existing DecisionRecord contract).

---

## 7. Proposed plan (for approval — no code yet)

**Branch:** `feat/model-pool` (created; `main` untouched and deployable).

**Milestones (per the brief's EXECUTION RULES), each app-runnable and honestly reported:**

1. **Registry (`src/lib/model-pool/registry.ts`, pure + injectable fetch/clock).** Build the
   catalog from `GET /models` at startup, TTL cache + manual refresh. Store slug, name,
   `is_free`, context, verified capabilities, price, measured latency/reliability, health,
   tags. Keep the 3 premium routing targets as the preferred tier. Register every pool slug in
   `OPENROUTER_SLUGS` so it typechecks and prices correctly (ai-usage rule).
2. **Selection policy (pure, deterministic, explainable).** Step requests capabilities
   (`needs`, `min_context`, `quality`) → returns an **ordered candidate chain**, never one
   model. Premium for final synthesis / high-stakes verification on hard tasks; free for
   parallel research, drafting, critique, summarisation, low-risk steps. Context-aware
   (chunk/summarise or pick larger context — never silently truncate).
3. **Failover + circuit breaker + limiter/queue.** Attempt chain on 429/5xx/timeout/404/empty/
   overflow/unparseable/tool-failure; classify rate-limit (backoff+jitter, honour retry headers)
   vs permanent (cooldown) vs transient (bounded retry); per-model circuit breaker
   (closed→open→half-open) with health persisted in Supabase; global concurrency limiter + queue
   tracking per-model counts against the 20 RPM / 50 RPD free limits; hard caps integrated with
   the existing Orchestra BudgetGuard.
4. **Output reliability + quality gates.** Native structured output only if probe-verified; else
   instruct-JSON → zod validate → limited repair → one retry → failover. Never store unvalidated
   output in the evidence hub. Free-model verifiers must cite evidence IDs. Cross-check hard
   sub-questions on two models; answer-quality gate before finalize; uncertainty note when the
   answer was mostly degraded models.
5. **Degradation ladder (L0–L5)** recorded per run and shown in the UI.
6. **UI + observability.** Free/Premium badges + provider family in run view/chat/dashboard;
   failover events (`model_failover`, `model_unhealthy`, `degradation_level`) added to the SSE
   protocol and persisted for replay; Model Pool health panel on `/dashboard` (real data only,
   empty state); per-run cost split paid vs free.
7. **Fault-injection mode** (env flag, default off, loudly labelled, never in prod): simulate
   429/timeout/404/empty/malformed/overflow for deterministic failover tests.
8. **Resilience benchmark + README/demo notes.** Re-run the four-setup benchmark recording pool
   composition and free-vs-premium share; add a fault-injection resilience benchmark (completion
   rate, degradation levels, quality vs no-failure run, extra latency, cost). Honest reporting of
   where free models lowered quality and any task still not completed.

**Testing (mandatory, report what actually ran):** unit tests for chain construction, capability
filtering, context handling, circuit states, backoff, quota counters, structured-output repair,
degradation calc, privacy guard; integration tests with fault injection; real hard-query runs
recording which model served each step; concurrency test; regression check that chat / run view /
auth / dashboard / benchmarks still work.

**Privacy/safety:** surface "free models may log prompts"; Free/Premium badges; never send
secrets/keys/passwords/tokens in prompts; guard secret-shaped strings away from free models
(route to premium or refuse).

**Hard invariants carried over:** secrets server-side only; never commit/log keys; update
`.env.example`; no new paid accounts/resources without the human; never fabricate
data/numbers/citations; spend caps enforced in code; keep agent logs tracked.

---

## 8. Open questions for the user before Phase 1

1. **Funding.** The key is $0 / free-tier (50 free calls/day). Do you want to (a) fund it — which
   lifts the free daily cap to 1000 *and* enables the paid premium tier and unblocks the M8 full
   benchmark (~$0.70) — or (b) build the pool to run free-only within 50 calls/day for the demo?
2. **`sonar` 400.** OK for me to investigate the research-tool 400 in Phase 1 (may need a funded
   key or a param fix)?
3. **Scope of first slice.** Build the whole pool (milestones 1–8) or an 80/20 slice first
   (registry + selection chain + failover + badges), then resilience/UI/benchmark after?

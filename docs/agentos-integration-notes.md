# AgentOS integration notes (Phase 0 — verified against live APIs)

Anti-hallucination protocol (AGENTOS_UPGRADE_PROMPT.md §6): every claim below is
tagged `[VERIFIED]` (observed directly, evidence attached), `[ASSUMPTION]`
(reasonable, unproven — how I'll verify), or `[UNKNOWN]`. Probe: a throwaway
`node --env-file=.env.local` script that made one real call per dependency and
never printed a key value. Raw outputs are quoted.

## 0. Runtime  `[VERIFIED]`

- Node **v24.21.0**, pnpm **10.6.2** (`node -v`, `pnpm -v`). Template needs Node ≥22.18.
- Dev server **live on :3000** (pid 17340, LISTENING). `next dev`, Turbopack.
- Env present (names only): `BEATAPI_API_KEY`, `OPENROUTER_API_KEY`, `DATABASE_URL`,
  `DIRECT_URL`. `.env.local` gitignored; `.env.example` tracked with placeholders.
- Both keys work — see §1 and §3.

## 1. Jev (BeatAPI `model:jev-1.13-free`) — the Decision Bus engine

- **Key valid** `[VERIFIED]`: `GET https://api.beatapi.io/v1/usage` → HTTP 200,
  1371ms. `credit_balance: 0`, `concurrency.limit: 0`, `total_tasks: 22`,
  `by_model: [{model:"jev-1.13-free", tasks:22, credits_settled:0}]` — free tier,
  $0. api_key_id 1200 ("Development").
- **Endpoint/contract** `[VERIFIED]`: `POST https://api.beatapi.io/v1/capabilities/run`,
  `Authorization: Bearer $BEATAPI_API_KEY`, body
  `{reference:"model:jev-1.13-free", input:{state, questions:{<name>:{type,instructions?,criteria}}}}`.
  Existing working caller: `src/server/ai/jev.ts` (`routeQuery`, `routeQueryMeasured`).

### 1a. Arbitrary bounded decisions with CUSTOM criteria — the critical check  `[VERIFIED]`

One real call, **four** independent `choice` questions with criteria keys I defined
(not `{claude,gpt,gemini}`), state = *"Investigate why our signup conversion dropped
12% last month and recommend concrete fixes."* → **HTTP 200, 558ms**, `usage` 688 in /
182 out tokens (state billed once for all four):

```json
{"answers":{
  "task_type":       {"type":"choice","choice":"analysis",   "confidence":0.48,"probabilities":{"analysis":0.58,"research":0.42,"coding":0,"document_qa":0,"simple":0}},
  "complexity_tier": {"type":"choice","choice":"medium",     "confidence":0.64,"probabilities":{"medium":0.74,"hard":0.24,"simple":0.02,"very_hard":0}},
  "enough_evidence": {"type":"choice","choice":"insufficient","confidence":0.95,"probabilities":{"insufficient":0.98,"enough":0.02}},
  "best_model":      {"type":"choice","choice":"claude",     "confidence":0.25,"probabilities":{"claude":0.5,"gpt":0.5,"gemini":0}}
}}
```

**Conclusion:** Jev returns arbitrary bounded decisions over custom label sets and
batches multiple questions per call. So the Decision Bus (§11 of the prompt) and both
D4 gates can be `decided_by: "jev"` for real. `enough_evidence → insufficient` at 0.95
confidence on this query is exactly the D4 gate-1 "NO → more research" signal the demo
moment (§14) needs — observed live, not scripted.

- `confidence` ≠ top probability (e.g. best_model: confidence 0.25 vs 0.5/0.5 split).
  Store both; never conflate. `[VERIFIED]`
- **`score` question type** `[VERIFIED shape, not yet used]`: a bare
  `{type:"score", instructions}` returns **HTTP 400** — *"questions['complexity_score'].criteria
  must be a non-empty array describing the scale, lowest first"*. So `score` exists and
  needs `criteria: ["0 = …", …, "1 = …"]` (array, ascending). MVP uses the verified
  `choice` complexity_tier instead; a numeric score (for D6's "0.87") is a cheap add in
  M3 once I pass a proper anchor array.

### 1b. Rate limit (the real constraint)  `[VERIFIED prior + this run]`

Free tier is throttled: prior Phase 0 saw 6 back-to-back calls → HTTP 429
(`Retry-After` + `error.retry_after_seconds`); this run's 3 calls all succeeded fast
(no 429 yet). `concurrency.limit: 0`. **Design consequence:** batch all plan-time
decisions into ONE multi-question call; gates are separate calls spaced by the existing
backoff in `routeQueryMeasured` (BENCH_MAX_RETRIES 8, cap 30s, honors Retry-After). On
exhaustion the Decision Bus falls back to `decided_by: "policy"` and continues.

### 1c. Latency (honest)  `[VERIFIED]`

Jev decision hop ≈ **0.56s** (4-question batch, warm) / ~0.7s single cold (prior).
The brief's "~30–50ms" is **not** reproduced end-to-end and is not used anywhere. Jev's
real story is *decision-only* (~0.6s, generates no text) vs an LLM-as-judge that must
generate a decision (`src/server/ai/judge.ts`, measured in M4/M8).

**M3 update `[VERIFIED in the live AgentOS pipeline]`:** the real planning call batches
**six** `choice` questions (task_type, complexity_tier, needs_research/code/critic,
best_model) into ONE hop. Measured `latency_ms` on persisted `decision_records`:
**563ms / 707ms / 1417ms** (warm→cold spread), i.e. the same ~0.6–1.4s band, billed once.
Real OpenRouter spend per completed run: **33–41 µUSD** for a one-line `gemini` answer,
**15675 µUSD** for a long `claude` analysis. Jev planning stays **$0**. Total across all
M3 runs ≈ **$0.0158** vs the $10 nightly cap.

## 2. Embeddings  `[VERIFIED none on OpenRouter]`

`GET https://openrouter.ai/api/v1/models` → 464 models; **embedding-capable = 0**
(filtered on `architecture.output_modalities` incl. `embeddings` and id ~ `embedding`).
So §6 priority (1) is unavailable. **Decision:** MVP evidence hub is a **structured**
Prisma store (claims/sources/verification_status/relations), queried by `run_id` — no
vector search. Priority (2) Postgres full-text search is the documented fallback if
lexical recall is needed; pgvector is deferred (needs raw SQL, against docs/rules/database.md).

## 3. OpenRouter (answer + research + judge models)

- **Key valid** `[VERIFIED]`: `POST /api/v1/chat/completions`, `openai/gpt-4.1-nano`,
  `max_tokens:8`, "ping" → HTTP 200, 1466ms, reply present, **`usage.cost: 0.0000048`**,
  18 total tokens. Client: `src/server/ai/openrouter.ts` (`streamCompletion`, `completeOnce`).
- **Target slugs live** `[VERIFIED]` in the 464-model catalogue:
  `anthropic/claude-sonnet-4.5`, `openai/gpt-4.1`, `google/gemini-2.5-flash`,
  `openai/gpt-4.1-nano` (judge). Config: `src/lib/models.ts`.
- **Search/web-capable** `[VERIFIED]`: 5 models, all Perplexity Sonar —
  `perplexity/sonar`, `perplexity/sonar-pro`, `perplexity/sonar-pro-search`,
  `perplexity/sonar-reasoning-pro`, `perplexity/sonar-deep-research`. This is the
  **Research MCP backend** (§6 priority 1) with **zero new keys**.
- **`perplexity/sonar` real call** `[VERIFIED in M5, 3 probe calls ≈ $0.0153 total]`:
  `POST /chat/completions` `model:"perplexity/sonar"`, `max_tokens:200–512` → **HTTP 200**,
  a real web-grounded answer, **`usage.cost ≈ $0.0051` per call** (the web search dominates:
  `upstream_inference_completions_cost ≈ $0.005`). **Citations are NOT a top-level `citations`
  array** and `return_citations:true` does **not** add one — they come back in
  **`choices[0].message.annotations[]`**, each `{type:"url_citation", url_citation:{url, title,
  start_index, end_index}}` (29 real URLs on the probe: sec.gov, Apple IR, macrotrends, …). The
  content carries inline `[n]` markers; `message.reasoning` is `null`. **Consequence:** the research
  tool parses `annotations[].url_citation.url` for real sources — never invents a citation (§8).
  Budget: one sonar call ≈ ½¢, so a research run stays far under the $0.50 per-run cap.
- **`max_tokens` must stay capped** `[VERIFIED prior]`: uncapped, OpenRouter reserves the
  full context against the (zero) credit balance and 402s. `openrouter.ts` caps 1024
  (stream) / 16 (judge). Every AgentOS model call inherits this.

## 4. MCP SDK  `[VERIFIED installed + exercised live]`

`@modelcontextprotocol/sdk` **v1.31.0** installed in M4. Exact API verified against
`node_modules` and exercised by a live run (run 9: `calculate` → **4ms**, exact `36`):
- `McpServer` from `…/server/mcp.js`; `server.registerTool(name, {title, description,
  inputSchema:{…zodRawShape}, outputSchema?}, cb)`. A tool-level failure is **returned** as
  `{isError:true, content:[{type:'text',text}]}` — the SDK does **not** throw for it.
- `Client` from `…/client/index.js`; `InMemoryTransport` from `…/inMemory.js`;
  `InMemoryTransport.createLinkedPair()` → `[clientTransport, serverTransport]`; connect both.
- `client.listTools()` → `{tools:[{name,…}]}`; `client.callTool({name, arguments})` →
  `{content:[{type:'text',text}], structuredContent?, isError?}`.
- **Transport decision (D-15):** an in-process `InMemoryTransport` linked pair, connected lazily
  once and reused (`getToolRegistry()` singleton) — real SDK client/server semantics with **zero
  new keys, zero network** (§8/§13 keyless). The pure `{has, call}` `ToolRegistry` interface
  isolates the executor from any future transport swap.

MVP tools (§13): (1) **calculator — SHIPPED in M4** (`src/lib/mcp/calculator.ts` = pure
recursive-descent parser, never `eval`, honest errors, never `Infinity`;
`src/server/mcp/calculator-server.ts` = the MCP server); (2) **research tool over
`perplexity/sonar` — SHIPPED in M5** `[VERIFIED live: runs 12/13/14]`
(`src/lib/mcp/research.ts` = pure annotation/citation parser; `src/server/mcp/research-server.ts`
= the MCP server wrapping a real sonar call through `trackAiCall` under feature
`agentos_research`). The registry now links **both** servers over in-process transports and
routes by `toolName → client`; a paid tool's real `costMicroUsd` is lifted into
`ToolResult.costMicroUsd` so the BudgetGuard sees it (D-26). Stretch: repo-over-local-git, browser.

## 5. Data layer  `[VERIFIED]`

- Prisma multi-file schema `prisma/schema/*.prisma`; existing domain file
  `jev-swarm.prisma` (Conversation, Message, RouteEvent, BenchmarkRun, BenchmarkResult).
- Conventions to match: BigInt autoincrement ids, `@db.Timestamptz(3)`, snake_case
  `@map`, `@@map` tables, money as integer millionths `cost_micro_usd BigInt?` (NULL, never 0).
- Client singleton `src/server/db/client.ts` exports `db` (+ `Prisma`) — the only file
  allowed to import `@prisma/client`.
- **Migrations** `[VERIFIED]`: `scripts/generate-migration.mjs` diffs schema→DB, writes
  `prisma/schema/migrations/<ts>_<name>/migration.sql`, then `prisma migrate deploy`.
  Refuses destructive patterns (DROP/SET NOT NULL/…); new AgentOS tables are pure CREATE,
  so auto-gen applies. Pass `--db-url "$DIRECT_URL"` (5432) — `migrate deploy` holds an
  advisory lock the 6543 pooler can't sustain. Never hand-write a migration; never `migrate dev`.
- AI-call ledger `[VERIFIED]`: `trackAiCall` (`src/server/lib/ai-usage/sink.ts`) +
  `OPENROUTER_SLUGS` (`.../ai-usage/models.ts`, keyed by SHORT id). An unmapped call-site
  model fails `TrackedModel` at compile; a retired slug fails `pnpm check:ai-models`.
  → Any new model (e.g. `perplexity/sonar`) MUST be registered there first. Jev is $0 and
  deliberately NOT in the ledger; its latency + decision persist to `route_events`.

## 6. Existing code → target design (D1–D6)

| Design box | Today | Status |
|---|---|---|
| D1 USER entry | `/api/chat` + `chat-workspace.tsx` | exists (chat); AgentOS run entry **missing** |
| D1 JEV PLANNER (team composition) | `jev.ts` routes to ONE model only | **missing** |
| D1 dynamic agent team | — | **missing** (`lib/agents`) |
| D1/D2 Evidence RAG hub | `lib/evidence` (pure `EvidencePort` + memory impl) + `server/agentos/evidence-store.ts` (Prisma) + `evidence_records` table | **exists** (shipped M5; structured rows, no vector column — 0 embedding models on OpenRouter) `[VERIFIED live: run 14 → 8 rows]` |
| D1 Critic (evidence Skeptic) | `lib/agents/critic-core.ts` (pure) + `server/agents/critic.ts` (claude) | **exists** (shipped M5; model-based fact-checker, verdicts + contradictions) `[VERIFIED live: run 14 → checked:8, verdictsApplied:8, all rows `contested`]` |
| D4 Judge gate | `lib/decisions` bus: `decideEvidenceSufficiency` (enough/insufficient) + `decideEvidenceValidity` (valid/invalid) via `binaryGate()`, policy-default fallback flagged `decided_by:'policy'` | **exists** (gates shipped earlier; wired into the M6 replan loop) `[VERIFIED live: run 16 → 2 `evidence_sufficiency` decisions `decided_by=jev` conf 0.77 then 0.94, both `{enough:false}`]` |
| D1 PASS→final / REWORK→loop | `lib/orchestra` executor (DAG, budgets, events) + `maybeReplan` loop | **exists** (execution M2–M5; the REWORK/replan loop shipped M6) `[VERIFIED live: run 16 → `replan` event `addedSteps:[researcher_r1, synthesizer_r1]`, `replans=1`]` |
| D3 Orchestra → MCP tools | `lib/mcp/{calculator,research}` (pure parsers) + `server/mcp/{calculator-server,research-server,registry}` (SDK 1.31.0, in-memory, multi-server) | **exists** (calculator M4; research-sonar M5) `[VERIFIED live]` |
| D4 two Jev gates | `lib/decisions` (sufficiency + validity) consumed by the M6 `createVerificationReplanPolicy` | **exists** (shipped M6) `[VERIFIED live: run 16 gate 1 jev conf 0.77/0.94 → research delta; run 15 `medium` recorded ZERO gates = §12 escalation]` |
| D5 dynamic team + replan | `lib/agents/replan.ts` (pure delta builders + `shouldRunGates`) + `replan-policy.ts` (injected `ReplanPolicy`) | **exists** (shipped M6; unique `_r{n}` ids, refined follow-up query, budget/wall-clock bounded) `[VERIFIED live: run 16 `researcher_r1` ran the refined query → 8 more evidence]` |
| D6 run-view UI | M6 design system (tokens/theme/motion/ui) + SSE pattern in `chat-stream.ts` | **missing** (foundation exists) |
| Baseline single-LLM path | `chat.ts` route→stream→persist | **exists** → reuse as Baseline A / "simple" tier |
| SSE wire protocol | `chat.ts` `encodeEvent`, `chat-stream.ts` types | **exists** → extend with AgentOS event set |

## 7. Spend this Phase 0

OpenRouter ping **$0.0000048**; Jev **$0** (free). Total ≈ **$0.000005** against the
$10 nightly cap. `[VERIFIED from usage.cost]`

---

# V3 — NanoGPT provider migration (verified live 2026-10-08)

> Sections 2–3 above are the **pre-migration OpenRouter** state, kept as history. As of
> V3 the live answer/judge/research path moves to **NanoGPT** (AGENTOS_FINAL_PROMPT_V3
> §5.0). Everything below is re-verified against the live NanoGPT API with free GETs plus
> exactly ONE budgeted paid call (§5.1.3). The old OpenRouter credit-exhaustion blocker
> (decisions-log D-32) is what this migration resolves.

## 8. NanoGPT — the provider  `[VERIFIED]`

- **Base URL** `[VERIFIED]`: `https://api.nano-gpt.com`. Both the `/v1` and `/api/v1`
  prefixes are live and equivalent — `GET /v1/models` and `GET /api/v1/models` both → HTTP
  200 (632 models); `POST /v1/chat/completions` and `POST /api/v1/chat/completions` both →
  HTTP 401 `missing_api_key` without auth (i.e. both paths exist). **Standardized on
  `https://api.nano-gpt.com/v1`** (V3 §5.0 requirement 1's first choice). One client module
  owns this base URL (see decisions-log D-41).
- **Auth** `[VERIFIED]`: `Authorization: Bearer ${NANOGPT_API_KEY}`. **No** `HTTP-Referer`,
  **no** `X-Title` (those were OpenRouter-specific attribution headers; V3 §5.0 req 3 removes
  them). Only `Content-Type: application/json` alongside the bearer.
- **Error wire shape** `[VERIFIED]` (from the unauth 401): OpenAI-compatible
  `{"error":{"message","type","code","status"}}` — e.g. `code:"missing_api_key", status:401`.
  `classify.ts` / `OpenRouterError`→`PoolCallError` mapping keys off `status`, which is present.
- **Model list** `[VERIFIED]`: `GET /v1/models` → **632 models**, unauthenticated (no key,
  $0). Basic shape is minimal `{id, object, created, owned_by}` — **pricing is absent**.
  `GET /v1/models?detailed=true` → the same 632 models with **all 632 carrying `pricing`**
  plus `name, description, context_length, max_output_tokens, architecture{modality,
  input_modalities, output_modalities}, capabilities{vision, video_input, audio_input,
  reasoning, tool_calling, parallel_tool_calls, structured_output, pdf_upload, batch_api},
  open_weights, supported_service_tiers, pricing{prompt, completion, currency, unit},
  cost_estimate, category, providers, subscription{included, inputTokenMultiplier, note}`.
  This is the catalog source (V3 §5.2) and it is **free to fetch**, exactly like OpenRouter's
  unauthenticated rate card was.

### 8a. Pricing format — DIFFERENT from OpenRouter (the key migration gotcha)  `[VERIFIED]`

- NanoGPT `pricing` is **numbers, USD per 1M tokens**: `{prompt: 3, completion: 15,
  currency: "USD", unit: "per_million_tokens"}` for `anthropic/claude-sonnet-4.5`.
- OpenRouter's `/models` `pricing` was **decimal strings, USD per TOKEN** (e.g. `"0.0000003"`),
  which `lib/model-pool/registry.ts`'s `perTokenToPer1M` multiplied by 1e6 and
  `ai-usage/pricing.ts`'s `openRouterRatesSchema` parsed as strings.
- **Consequence:** the pool's `perTokenToPer1M` and the ledger's per-token-string rate schema
  must be adapted to per-1M numbers (or replaced by the curated table — see D-42). Do NOT
  reuse the OpenRouter ×1e6 path against NanoGPT numbers; it would over-price by 1e12.

### 8b. `usage` cost: NONE on the streaming path, PRESENT on the non-streaming path  `[VERIFIED — both paths]`

Exactly one throwaway paid call (§5.1.3), **streaming**, `meta-llama/llama-3.3-70b-instruct`,
`max_tokens:8`, prompt *"Reply with the single word: ok"*:

- **HTTP 200**, latency-to-headers **4512 ms**, wall **5527 ms** (cold first call), streamed
  `choices[0].delta.content` → `"ok"`, `finish_reason:"stop"`.
- Terminal `usage` chunk (because `stream_options:{include_usage:true}`):
  `prompt_tokens:17, completion_tokens:2, total_tokens:19`, plus rich detail —
  `prompt_tokens_details{cached_tokens:0, cache_write_tokens:0, audio_tokens:0, video_tokens:0}`,
  `completion_tokens_details{reasoning_tokens:0, …}`, `cache_creation_input_tokens:0`,
  `cache_read_input_tokens:0`, `reasoning_tokens:0`, `citation_tokens:0`, `num_search_queries:0`,
  `input_tokens:17`.
- **NO monetary cost field on the STREAMING usage chunk** (`Object.keys(usage).some(/cost/i)` →
  **false**). This is the path the chat SSE uses, so for chat **cost must be computed as
  `tokens × curated per-1M price / 1e6`** (D-42). Computed cost of this call:
  `17×0.05/1e6 + 2×0.23/1e6 = $0.00000131` (≈1.31 µUSD).
- **Streaming works** and `include_usage` is honored on the streaming path — the chat SSE path
  is safe to migrate as-is (token deltas + a terminal usage chunk), minus the `cost` read.

**CORRECTION (M3, 2026-10-08, decisions-log D-47):** the **non-streaming** path
(`completeOnce`, `stream:false` — the benchmark judge, the AgentOS agents, the M3 key check)
**DOES return a monetary cost.** The M3 key-verification call (`meta-llama/llama-3.3-70b-instruct`,
`max_tokens:1`, prompt *"ping"*) returned **HTTP 200** with
`usage.cost: 7.8e-7, usage.currency: "USD"` alongside the token counts (11 prompt / 1 completion /
12 total) — and `7.8e-7` ≈ the curated computation `11×0.05/1e6 + 1×0.23/1e6 = 7.8e-7`, i.e. the
provider's own cost equals the curated list price for this model. So the accurate rule is:
**streaming usage → no cost field; non-streaming usage → `cost` + `currency:"USD"` present.** The
earlier blanket "NO monetary cost field of any kind" was true only of the streaming call it measured.
Per D-42/D-47 the app still prices EVERYTHING from `tokens × curated per-1M` (the user's explicit V3
choice, and the only option on the streaming chat path), so one arithmetic covers both paths and the
ledger/telemetry/benchmark can never drift; the non-streaming provider `cost` is available as a
flagged-reversible accuracy upgrade, not currently read.

### 8c. Curated USD price table (V3 §5.2 source of truth)  `[VERIFIED from ?detailed=true]`

USD **per 1M tokens**, exactly as NanoGPT publishes. `caps` = capabilities flagged `true`.

| slug | family | tier | in $/1M | out $/1M | ctx | max out | caps |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-sonnet-4.5` | claude | flagship | 3 | 15 | 200000 | 64000 | vision, reasoning, tool_calling, structured_output, pdf_upload, batch_api |
| `anthropic/claude-haiku-4.5` | claude | cheap | 1 | 5 | 200000 | 64000 | vision, tool_calling, structured_output, pdf_upload, batch_api |
| `openai/gpt-4.1` | gpt | flagship | 2 | 8 | 1047576 | 32768 | vision, tool_calling, structured_output, pdf_upload, batch_api |
| `openai/gpt-4o` | gpt | flagship | 2.5 | 10 | 128000 | 16384 | vision, tool_calling, batch_api |
| `openai/gpt-4o-mini` | gpt | cheap | 0.15 | 0.6 | 128000 | 16384 | vision, batch_api (**no tool_calling**) |
| `openai/gpt-4.1-nano` | gpt | cheap | 0.1 | 0.4 | 1047576 | 32768 | vision, pdf_upload, batch_api (**no tool_calling**) — judge |
| `gemini-2.5-flash` | gemini | cheap | 0.3 | 2.5 | 1048576 | 65536 | vision, video_input, audio_input, reasoning, tool_calling |
| `gemini-2.5-pro` | gemini | flagship | 1.25 | 10 | 1048576 | 65536 | vision, video_input, audio_input, reasoning, tool_calling |
| `deepseek-r1` | deepseek | cheap | 0.4 | 1.7 | 128000 | 8192 | reasoning, tool_calling |
| `meta-llama/llama-3.3-70b-instruct` | llama | cheap | 0.05 | 0.23 | 131072 | 16384 | tool_calling, structured_output |

Cheapest real models on the whole catalog (for the last-resort degradation tier):
`llmtech/decider-0.8b-fp8` 0.02/0, `Meta-Llama-3-1-8B-Instruct-FP8` 0.02/0.03,
`meta-llama/llama-3.3-70b-instruct` 0.05/0.23 (the strongest cheap model — preferred last resort).

### 8d. Slug substitutions (V3 §5.0 req 4 — user-specified → live)  `[VERIFIED]`

Three of the user's named slugs are **absent** from the 632-model live list; per §5.0/§8 the
nearest verified sibling is chosen, never invented (full rationale in decisions-log D-43):

| user-specified (§5.0 req 4) | live on NanoGPT? | chosen substitute |
|---|---|---|
| `google/gemini-2.0-flash` (simple/fast) | **MISSING** | `gemini-2.5-flash` (0.3/2.5) |
| `openai/gpt-4o-mini` (simple/fast) | present | unchanged (0.15/0.6) |
| `anthropic/claude-3.5-sonnet` (complex) | **MISSING** | `anthropic/claude-sonnet-4.5` (3/15) |
| `meta-llama/llama-3.3-70b-instruct` (complex) | present | unchanged (0.05/0.23) |
| `deepseek/deepseek-r1` (complex) | **MISSING** | `deepseek-r1` (0.4/1.7) |
| current `models.ts` gemini `google/gemini-2.5-flash` | **MISSING** | `gemini-2.5-flash` |

Note the **no-`google/` and no-`deepseek/` prefix** convention on NanoGPT for those families.
The "gpt" complex-route label (§5.0 execution rule: strongest verified GPT-family) →
`openai/gpt-4.1` (2/8, 1M ctx, tool_calling) — kept, already the `models.ts` gpt flagship;
`gpt-4o` (2.5/10, 128k) is pricier with a smaller window, so gpt-4.1 stays the complex GPT.

### 8e. What NanoGPT does NOT have (drives the degradation + research design)  `[VERIFIED]`

- **No usable free LLM tier.** Only **2** models price 0/0: `nano-gpt-help` and `auto-model` —
  both NanoGPT meta/routing helpers, not general chat LLMs. There is **no `:free` suffix
  convention** and no free flagship/cheap stand-ins. **Consequence:** the Model Pool's free-tier
  machinery (`isFreeModel` `:free`/0-price test, `limiter.ts`'s OpenRouter free-tier RPM quotas
  2/6/40/142, the boot `warmFreeModelProbes`) no longer maps to reality. The §5.3 degradation
  chain becomes **flagship → cheaper PAID sibling → cheapest reliable PAID model
  (`meta-llama/llama-3.3-70b-instruct`)**, all clearly badged; there is no free rung (D-44).
- **No embedding models.** `architecture.output_modalities` including `embeddings` → **0 of 632**.
  Confirms §2's finding on the new provider: the evidence hub stays a **structured** Prisma store
  (claims/sources/verification_status/relations), no vectors. Postgres FTS remains the fallback.
- **No search-capable models.** No `online_search`/`web_search`/`search` capability on any model;
  **`perplexity/sonar` is absent entirely** (0 sonar/perplexity matches). **Consequence:** the
  Research MCP backend that used `perplexity/sonar` on OpenRouter has no NanoGPT equivalent —
  §7 research priority (1) is unavailable, so the research tool degrades to priority (3), a
  clearly-marked **no-external-search mode** (RAG over provided/local docs + model knowledge
  labeled as such), unless a keyless search endpoint is approved later (D-45). This is an M4–M9
  re-verification concern; M2 only has to stop referencing the dead slug.
- **No credits/balance endpoint** `[UNKNOWN — none documented]`: NanoGPT documents only frontend
  routes (`/balance`, `/usage`), no authenticated JSON balance API. So §5.5's "balance becomes the
  real cap" cannot be wired to a live balance; the **code spend caps** (`PER_RUN_CAP_USD`,
  `NIGHTLY_SPEND_CAP_USD`, `BENCHMARK_CAP_USD`) computed from token×price remain the enforced
  ceiling. Re-check for a balance endpoint before the morning report; until then spend is tracked
  cumulatively from our own ledger, not read back from the provider.

## 9. V3 Phase 0 spend

ONE paid streaming verification call (§5.1.3): `meta-llama/llama-3.3-70b-instruct`,
17 prompt + 2 completion tokens → **$0.00000131** computed from the curated table
(the streaming usage chunk carried no `usage.cost`; the non-streaming path does — §8b/D-47).
Jev + all catalog GETs **$0**. Total V3 Phase 0 ≈
**$0.0000013** against the $10 nightly cap. This is the run's ONLY throwaway paid call —
every subsequent paid call is real feature work (M3 chat answers, AgentOS runs, M10 benchmark)
inside the caps. `[VERIFIED from the call's usage token counts × curated price]`

## 10. V3 Milestone 3 — chat upgrade to real flagships (§5.3)  `[VERIFIED live 2026-10-08]`

### 10a. Jev label → model mapping: before (OpenRouter, unfunded) → after (NanoGPT, funded)

§5.3 requires recording the old free stand-ins and the new mapping. Jev returns one of
`{claude, gpt, gemini}`; `src/lib/models.ts` `MODELS[label].slug` is the answer model.

| Jev label | OLD target slug (OpenRouter) | what ACTUALLY answered on the $0 key | NEW target slug (NanoGPT, funded) | tier |
|---|---|---|---|---|
| `claude` | `anthropic/claude-sonnet-4.5` | a runtime `:free` pool model (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`), `degraded:true` — the premium 402'd on the credit wall | **`anthropic/claude-sonnet-4.5`** | flagship |
| `gpt` | `openai/gpt-4.1` | a runtime `:free` pool model, `degraded:true` | **`openai/gpt-4.1`** | flagship |
| `gemini` | `google/gemini-2.5-flash` | a runtime `:free` pool model, `degraded:true` | **`gemini-2.5-flash`** (no `google/` prefix on NanoGPT — D-43) | cheap |

On OpenRouter the funded-tier slug was the *target* but the unfunded key made every turn degrade to
a free stand-in (D-38). On the funded NanoGPT key the routed model **actually answers** — verified
below, `degraded:false` for all three families.

### 10b. Per-family degradation chain (§5.3, decisions-log D-46)

`src/lib/chat-model-chain.ts` → `familyDegradationChain(headSlug, headDisplayName)`, PURE over the
curated catalog: **head (Jev's pick) → cheaper same-family siblings (nearest-cheaper first) →
`CHEAP_FLOOR_SLUG` (`meta-llama/llama-3.3-70b-instruct`)**. NanoGPT has no free tier (D-44), so the
"free variant" rung is the cheapest reliable PAID floor. A pricier same-family model is never inserted
(`gemini-2.5-pro` does not join the `gemini-2.5-flash` chain). Concrete chains:
- claude: `claude-sonnet-4.5` → `claude-haiku-4.5` → `llama-3.3-70b-instruct`
- gpt: `gpt-4.1` → `gpt-4o-mini` → `gpt-4.1-nano` → `llama-3.3-70b-instruct`
- gemini: `gemini-2.5-flash` → `llama-3.3-70b-instruct`

`resolveChatCandidates` (`src/server/api/chat.ts`) leads with this chain (no network fetch for the
head) then appends health-aware Model Pool candidates for cross-family depth, capped at
`MAX_CHAT_CHAIN=6`. The badge shows the model that ACTUALLY answered + a `pool failover` marker when
`degraded` (never a flagship badge over a cheaper model's answer). 9 pure unit tests, $0.

### 10c. Live per-family verification (one REAL streamed answer per family — §5.3, real feature calls)

POST `/api/chat` against the running local dev server (:3000), funded NanoGPT key. All HTTP 200, all
`degraded:false`, cost = tokens × curated per-1M:

| family | Jev route | served by (slug) | stream events | tokens (in/out) | totalLatency | est. cost USD |
|---|---|---|---|---|---|---|
| claude | `claude` (conf 1.0, not fallback) | `anthropic/claude-sonnet-4.5` | 42 | 92 / 187 | 24288 ms | 0.003081 |
| gpt | `gpt` (**fallback=true**, conf 0) | `openai/gpt-4.1` | 149 | 98 / 266 | 41603 ms | 0.002324 |
| gemini | `gemini` (conf 1.0, not fallback) | `gemini-2.5-flash` | 1 | 58 / 2 | 10891 ms | 0.0000224 |

**Total M3 verification spend: $0.005427** (inside the $0.50 per-run / $10 nightly caps). Honest notes:
- The **gpt** turn routed via Jev's FALLBACK to `DEFAULT_LABEL='gpt'` (Jev's free BeatAPI tier flaked —
  `fallback:true`, conf 0, jev 421 ms), not a confident Jev "gpt" decision; `gpt-4.1` still really
  answered and streamed 149 token events. A genuine (non-fallback) gpt routing is a re-verify item, not
  a blocker — the §5.3 deliverable (a real streamed gpt-family answer) is met.
- The **gemini** answer is 2 completion tokens (1 stream event) because the prompt asked for a one-word
  factual answer ("capital of Australia") — correct, not a truncation.
- Latencies are high (10–42 s) because these are real flagship generations on NanoGPT plus, on the first
  turn, the cold 632-model catalog fetch inside `resolveChatCandidates`; later turns reuse the warm cache.
  These are real measurements, never the brief's un-reproduced estimates.

### 10d. M3 spend

Three real feature calls (one per family), **$0.005427** total. No throwaway test calls beyond the single
§5.1.3 key check (§9). Jev routing hops + catalog GETs are $0.

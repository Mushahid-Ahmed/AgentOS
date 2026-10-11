# AgentOS — V3 morning report (run of 2026-10-07 → 2026-10-08)

Unattended V3 migration run: **OpenRouter → NanoGPT** provider swap, funded chat upgrade,
AgentOS multi-agent re-verification, the four-setup benchmark on the funded key, the
Spend/Model-usage dashboard views, and final polish. **Localhost only** against the real
remote Supabase DB — no deploy. Every number below is a real measurement from the persisted
ledger or a captured run; nothing is estimated. Where a figure could not be verified it is
marked **unknown**, never guessed.

---

## 1 · Per-milestone status

| #   | Milestone                                                 | Status   | One-line evidence                                                                                                                                                                                 |
| --- | --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Phase 0 — NanoGPT provider verification + curated pricing | **done** | Live `GET /v1/models?detailed=true` (~632 models, free); ONE paid verify call `openai/gpt-4.1-nano` HTTP 200, real cost; notes §8 `[VERIFIED]`.                                                   |
| 2   | Provider migration OpenRouter → NanoGPT (WS0)             | **done** | One client `src/server/ai/nanogpt.ts`; `openrouter.ts` deleted; tsc 0, eslint 0, build exit 0 (24 routes), `check:ai-models` 0 vs live catalog; repo-wide grep = zero live OpenRouter call paths. |
| 3   | Chat upgrade to real flagships (WSA)                      | **done** | All 3 families reached real NanoGPT flagships live, `degraded:false`; total M3 spend $0.005427.                                                                                                   |
| 4–9 | AgentOS engine + run view re-verified on NanoGPT (WSB)    | **done** | Live run #50 (researcher→synthesizer) completed, 24 replay events, $0.019447; no-search honesty proven (zero citations, `source:null`); 478/478 tests.                                            |
| 10  | Four-setup benchmark + Spend/Model-usage dashboard        | **done** | Full 24-task run #6 exit 0, $0.530901; Spend + Model-usage panels live with real data; 491/491 tests.                                                                                             |
| 11  | Polish, README, demo script, morning report               | **done** | README de-OpenRouter'd + real benchmark/cost tables; `docs/DEMO_SCRIPT.md` around real run #81; 7 stale prisma comments fixed; this report.                                                       |

---

## 2 · Provider migration report

- **Verified live base URL:** `https://api.nano-gpt.com/v1` (chat completions at
  `…/v1/chat/completions`; catalog at `…/v1/models?detailed=true`). Bearer-only auth — the
  OpenRouter `HTTP-Referer` / `X-Title` attribution headers are **gone**.
- **Env:** `OPENROUTER_API_KEY` → **`NANOGPT_API_KEY`** in `src/lib/env.ts` (min 1 char,
  server-side only) and `.env.example`. BeatAPI (`BEATAPI_API_KEY`, Jev, $0) unchanged.
- **Final client code block** (`src/server/ai/nanogpt.ts` — the one provider seam):

```ts
import 'server-only'
import { env } from '@/lib/env'

const NANOGPT_URL = 'https://api.nano-gpt.com/v1/chat/completions'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type StreamUsage = { promptTokens: number; completionTokens: number; totalTokens: number }
export type StreamEvent =
	| { type: 'token'; text: string }
	| { type: 'usage'; usage: StreamUsage }
	| { type: 'error'; message: string; status?: number }

export class NanoGPTError extends Error {
	readonly status: number
	constructor(status: number, message: string) {
		super(message)
		this.name = 'NanoGPTError'
		this.status = status
	}
}

function authHeaders(): Record<string, string> {
	return { Authorization: `Bearer ${env.NANOGPT_API_KEY}`, 'Content-Type': 'application/json' }
}
// streamCompletion(slug, messages): AsyncGenerator<StreamEvent> — stream:true +
//   stream_options.include_usage; yields token events, a terminal usage event, and
//   {type:'error',status} on a non-2xx/in-body error (never throws mid-stream).
// completeOnce(slug, messages, maxTokens=16): non-streaming; returns the raw
//   OpenAI-shaped body for trackAiCall; throws NanoGPTError(status) on error.
```

- **Slug substitutions (user-specified §5.0 → live, nearest verified sibling, never invented):**

  | user-specified                      | live?       | chosen                                  |
  | ----------------------------------- | ----------- | --------------------------------------- |
  | `google/gemini-2.0-flash`           | **missing** | `gemini-2.5-flash` (0.3/2.5)            |
  | `anthropic/claude-3.5-sonnet`       | **missing** | `anthropic/claude-sonnet-4.5` (3/15)    |
  | `deepseek/deepseek-r1`              | **missing** | `deepseek-r1` (0.4/1.7)                 |
  | `openai/gpt-4o-mini`                | present     | unchanged (0.15/0.6)                    |
  | `meta-llama/llama-3.3-70b-instruct` | present     | unchanged (0.05/0.23) — the cheap floor |

  NanoGPT drops the `google/` and `deepseek/` family prefixes. The **"gpt" complex-route label**
  → **`openai/gpt-4.1`** (2/8, 1M ctx, tool_calling) — kept over `gpt-4o` (pricier, 128k window).
  Per-family flagships: **claude → `anthropic/claude-sonnet-4.5`**, **gpt → `openai/gpt-4.1`**,
  **gemini → `gemini-2.5-flash`**; rubric judge → `openai/gpt-4.1`.

- **Modified files (material):** added `src/server/ai/nanogpt.ts`; **deleted**
  `src/server/ai/openrouter.ts`; rewrote `src/lib/models.ts` (curated `NANOGPT_CATALOG` =
  single source of truth, `nanoGptSlug`, `costUsdFor`), `src/lib/pricing.ts` (synchronous
  `rateCard()`), `src/lib/ai-usage/sink.ts`; tests `ai-usage.test.mts`, `registry.test.mts`,
  `privacy.ts/.test.mts`; `scripts/check-ai-models.mjs`; de-OpenRouter'd comments/strings across
  ~27 source files + several components/docs. **M11 additionally:** README.md (all ~16 refs),
  7 prisma schema comments, `docs/DEMO_SCRIPT.md`. Exhaustive list in the M2 entry of
  `docs/agentos-status.md`.
- **Zero live OpenRouter paths:** repo-wide case-insensitive grep finds only historical
  migration comments + decision-log references (intentionally kept). README + prisma are now
  clean. `check:ai-models` passes against the live catalog.

---

## 3 · Spend report (real money, from the persisted ledger)

- **Total cumulative ledger (all priced `ai_usage` rows): $1.028017** — 637 priced calls,
  52 unpriced (18,682 tokens marked **unknown**, never $0).
- **The V3 night run (2026-10-07 UTC): $0.902978 across 376 calls** (the over-time bucket).
- **Nightly-cap enforced figure (AgentRun spend since UTC midnight): $0.411884 / $10.00 (4.1%).**
- **Per-family breakdown (cumulative):**

  | family                             | cost      | calls |
  | ---------------------------------- | --------- | ----- |
  | GPT                                | $0.561176 | 343   |
  | Claude                             | $0.293229 | 62    |
  | Gemini                             | $0.139512 | 168   |
  | Other (`perplexity/sonar`, legacy) | $0.034100 | 116   |

- **Remaining credit balance: unknown** — NanoGPT exposes no verified balance endpoint, so the
  Spend view shows `{ verifiable:false }` rather than a guessed number.
- **Chat-upgrade (M3) verification calls: $0.005427** (one real streamed answer per family).
- **Benchmark spend:** pilot #5 **$0.143386** + full 24-task #6 **$0.530901** (setups $0.389973
  - judge $0.140928) = **$0.674287** for V3 M10; earlier pilot #4 $0.127089, M8 pilot #1 $0.081975.
    Benchmark cap utilization **$0.530901 / $15.00 (3.5%)**.
- **Demo run #81 (M11, hard-tier, real gate→replan): $0.062626** — inside the $0.50 per-run cap.
- **Caps now:** per_run $0.065939/$0.50 · nightly $0.411884/$10 · benchmark $0.530901/$15.
  All green; no cap was ever hit.

---

## 4 · Decisions I made for you (digest — full text in `docs/agentos-decisions-log.md`)

- **D-44 — no free LLM tier on NanoGPT → all-paid degradation.** _Chosen:_ chain becomes
  flagship → cheaper **paid** same-family sibling → `meta-llama/llama-3.3-70b-instruct` floor.
  _Why:_ the only $0 models are blocklisted meta-helpers that can't answer chat. _Reverse:_ if
  NanoGPT lists free models, re-add the free rung in `select.ts`.
- **D-45 — no NanoGPT search/embeddings → no-external-search research mode.** _Chosen:_ research
  tool degrades to knowledge-grounded answers with **zero citations**, `source:null` evidence —
  never a fabricated source. _Reverse:_ wire a verified search backend behind the same
  `ToolRegistry` interface.
- **D-46 — family-aware chat degradation chain (option c).** _Chosen:_ pure
  `src/lib/chat-model-chain.ts` builds the per-family head from the curated catalog (no 632-model
  fetch, lower TTFT), pool candidates appended behind for cross-family depth. _Reverse:_ delete
  the module, restore pool-only `resolveChatCandidates`.
- **D-47 — CORRECTION + cost basis.** Non-streaming `usage` **does** carry `usage.cost`
  (streaming does not). _Chosen:_ keep **tokens × curated per-1M** as the single cost basis for
  both paths (your explicit "Curated USD price table" choice; one arithmetic keeps ledger, chat,
  pool budget and benchmark from drifting). _**Flagged for reversal:**_ if NanoGPT's billed cost
  ever diverges from list price, prefer the provider `usage.cost` on non-streaming rows.
- **Flagship slugs chosen per family** (reversible, see §2): claude `anthropic/claude-sonnet-4.5`,
  gpt `openai/gpt-4.1` (also the "gpt" complex-route label + judge), gemini `gemini-2.5-flash`.

---

## 5 · Verified vs assumed

**`[VERIFIED]` (real calls/measurements):**

- NanoGPT base URL, bearer auth, ~632-model catalog, `pricing` = USD **per-1M** numbers.
- Key **funded** — one paid verify call HTTP 200 with real cost (the single allowed throwaway).
- All 3 chat families reach real flagships live (`degraded:false`), M3 $0.005427.
- AgentOS engine live on NanoGPT: run #50 completed, 24 replay events, $0.019447; no-search
  honesty (zero citations, `source:null`, no fabricated `Sources:`).
- Full four-setup benchmark run #6 exit 0, $0.530901, real per-setup scores/costs/latencies.
- **Demo moment run #81** (`hard`, comparison, completed, $0.062626): D4 gate fired
  `evidence_insufficient` (`evidence_verified` status `unverified`, id 207) → **D5 replan**
  added `researcher_r1`(gemini) + `synthesizer_r1`(claude) → final 3,254-char verified answer.
  Cross-model team: researcher=gemini, code=gpt, critic=claude, synthesizer=claude.
- Spend/Model-usage panels render real ledger data; per-family sums exactly to the total.

**`[UNKNOWN]` / `[ASSUMPTION]` (open):**

- **Remaining NanoGPT credit balance — unknown** (no verified balance endpoint).
- **Unpublished model prices — unknown**: 52 ledger rows (18,682 tokens) carry token counts with
  USD marked unknown, never $0.
- Benchmark scores are **one judge's** (`gpt-4.1`) rubric opinion, not ground truth.
- Degradation ladder + D4/D5 gate paths are unit-tested and now have ONE live hard-tier example
  (#81); a live _paid failover_ was never forced (a funded key doesn't 402, and forcing one wastes
  spend) — it rests on the pure `chat-model-chain`/select/failover suites + the D-38 precedent.

---

## 6 · Real benchmark numbers (run #6, full 24 tasks, funded NanoGPT key)

Generator `gemini-2.5-flash`, judge `openai/gpt-4.1`, ~72 min, exit 0. Per-task averages:

| setup                 | success | score    | cost/task     | latency    | calls (m/t) |
| --------------------- | ------- | -------- | ------------- | ---------- | ----------- |
| A · single LLM        | 100%    | 0.87     | $0.000783     | 8.4 s      | 1.0 / 0.0   |
| B · single LLM + RAG  | 100%    | 0.90     | $0.003550     | 22.8 s     | 1.0 / 1.0   |
| C · fixed multi-agent | 95.8%   | **0.92** | $0.003430     | 26.7 s     | 3.0 / 1.0   |
| D · full AgentOS      | 95.8%   | 0.90     | **$0.008979** | **75.8 s** | 2.4 / 0.7   |

**Honest read:** AgentOS was (joint-)best on **16/24**, never best on **8**, **sole**-best on **2**
(document-qa `aos-21`, ambiguous `aos-22`). It is the **priciest and slowest** setup and does not
top the score (the fixed DAG does, 0.92). Its measured edge is **robustness on ambiguous /
document-heavy tasks** — quality-per-dollar on hard tasks, not raw price or speed. Two setups
errored once each (`aos-03` C, `aos-08` D), kept as honest 95.8%, not dropped. Citations 0 across
all setups (no search endpoint, D-45) — a real 0, never fabricated.

---

## 7 · Needs human in the morning

- **Rotate the demo login password + the Supabase DB password** — the demo password is quoted in a
  shipped `.agent-logs` file (D-34). Both are Supabase-dashboard actions; neither can be done from
  this environment (no service-role key, no dashboard session). **Never route a new secret through
  chat** — the session is auto-logged to the publicly-shipped `.agent-logs`.
- **Delete the leftover auth row** `ui-verify-1790900523452@jev-swarm.local` (D-34).
- **Top up / confirm NanoGPT credit** if you want more benchmark or hard-tier demo runs — balance
  is unverifiable from the API, so confirm in the NanoGPT dashboard.
- **Approve any commit/push.** Nothing from this entire V3 run (M2–M11) is committed; `git push`
  and commits require your explicit typed go-ahead.
- **Optional reversal to consider:** D-47 (prefer provider `usage.cost` on non-streaming rows) if
  you want provider-billed exactness over the curated table.

---

## 8 · Discord bullets

- **V3 done end-to-end, unattended, on the funded NanoGPT key.** OpenRouter → NanoGPT migrated
  (one client, zero live OpenRouter paths), chat routes Jev's decisions to real Claude/GPT/Gemini
  flagships, AgentOS multi-agent re-verified live.
- **Full 24-task × 4-setup benchmark, honest result:** AgentOS ties on quality (0.90) but is the
  slowest (~~76 s/task) and priciest (~~$0.009/task); the fixed DAG scored highest (0.92). AgentOS's
  real edge = robustness on ambiguous/document-qa (sole-best on 2). Total spend **$0.53**, 3.5% of cap.
- **Real demo moment captured (run #81, $0.063):** Jev's sufficiency gate fired
  `evidence_insufficient`, the orchestrator **replanned** a second cross-model research+synthesis
  pass (Gemini→Claude), and produced a verified better answer — emergent, never scripted.
- **New dashboard Spend + Model-usage views:** real cumulative **$1.03**, per-family breakdown,
  cap utilization, balance honestly **unknown**, 689 provider calls, chat routing + a 25.9% Jev
  fallback rate. Unpriced calls show tokens with USD **unknown**, never fabricated.
- **Static green throughout:** tsc 0, eslint 0, **491/491** unit tests, build exit 0.
- **Needs human:** rotate the demo + DB passwords (leaked in a shipped log), confirm NanoGPT
  credit, and approve the commit — nothing is committed yet.

---

## 9 · Screenshots to capture (auth-gated; hidden viewport blocked auto-capture)

1. **Chat** answering via a real NanoGPT flagship — telemetry chip showing model/latency/tokens/cost.
2. **Run view** of **run #81** — the Decision Bus checklist, the per-agent model badges
   (researcher=gemini, code=gpt, critic=claude, synthesizer=claude), the **gate → replan** timeline,
   and the final verified answer.
3. **Dashboard → Benchmark view** — the four-setup table above (run #6).
4. **Dashboard → Spend view** — total, per-family bars, cap utilization, "unknown" balance.
5. **Dashboard → Model-usage view** — per-model/family/feature calls + chat routing/fallback rate.

---

## 10 · Recommended next step

**Commit the V3 work** (M2–M11) once you've reviewed it — it is green (tsc 0, eslint 0, 491/491,
build 0) and fully documented, but nothing is committed and pushing needs your explicit go-ahead.
Suggested: one `feat(agentos): V3 NanoGPT migration + funded chat + benchmark + spend/usage
dashboard (M2-M11)` commit on a branch, then rotate the leaked passwords before any push. After
that, the natural follow-ups are the deferred MP-M7 (fault injection) / MP-M8 (resilience
benchmark), and capturing the five screenshots above on a logged-in session for the demo deck.

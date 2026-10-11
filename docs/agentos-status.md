# AgentOS — running status log

Appended per milestone (§15). Honest status: **done / half-done / broken / unverified**,
what I ran to verify it, 4–6 Discord bullets, screenshots to capture. Evidence tags per §6.

---

## Milestone 1 — Phase 0: discovery, capability checks, plan — **DONE**

**What shipped:** `docs/agentos-integration-notes.md` (all verified findings),
`docs/AGENTOS_PLAN.md` (one-page architecture vs D1–D6 + data model + milestones + scope
cuts), `docs/agentos-decisions-log.md` (8 decisions, Q/Options/Chosen/Why/Risk/Reverse).
Existing repo audited; D1–D6 mapped to real files (§6 table in the notes). Temp capability
probe deleted after capture.

**What I ran to verify (real calls, no invented numbers):**

- Jev multi-question custom-criteria call → **HTTP 200, 558ms**, 4 decisions incl.
  `enough_evidence → insufficient` @0.95 — the live D4 gate-1 signal. `[VERIFIED]`
- Jev bare `score` type → **HTTP 400** (needs an ascending criteria array). `[VERIFIED]`
- OpenRouter catalogue → **464 models, 0 embedding-capable, 5 search-capable** (all
  Perplexity Sonar); 4 target slugs live; ping `usage.cost = $0.0000048`. `[VERIFIED]`
- BeatAPI `/v1/usage` → 200, credit_balance 0, free tier, $0. `[VERIFIED]`
- MCP SDK `@modelcontextprotocol/sdk` v1.31.0 exists on npm (not yet installed). `[VERIFIED exists]`

**Phase 0 spend:** ≈ **$0.000005** (one OpenRouter ping; Jev free) against the $10 nightly cap.

**Discord bullets:**

- Kicked off the AgentOS night run — Phase 0 done: repo audited, all three external deps hit
  with real calls, plan + integration notes + decisions log written.
- The critical unknown is resolved: **Jev can make arbitrary bounded decisions** over custom
  label sets and batch 4 questions in one call (HTTP 200 / 558ms) — so the Decision Bus and
  both verification gates are real Jev decisions, not just policy.
- Caught the D4 "not enough evidence → do more research" signal **live and unscripted**:
  Jev returned `insufficient` at 0.95 confidence on a conversion-drop query.
- No embedding models exist on OpenRouter (0 of 464) → evidence hub is a **structured** Prisma
  store, not vectors; research backend is Perplexity Sonar on the existing key (zero new keys).
- Honest latency: Jev's decision hop is ~0.6s, **not** the brief's un-reproduced "~30–50ms" —
  the real story is decision-only vs an LLM judge that must generate.
- Spend so far: half a cent. Next: Orchestra core with mocked agents + unit tests.

**Screenshots to capture:** none for Phase 0 (docs only). First UI shots land at M7 (D6 run view).

---

## Milestone 2 — Orchestra core (state, DAG, executor, limits, events) — **DONE**

Built the in-repo workflow engine (§10) as **pure, injectable TypeScript** under
`src/lib/orchestra/` — no `server-only`, no Prisma, no fetch. Real agents/models/tools/
persistence/clock/backoff are all injected, so the whole engine is unit-tested with
**MOCKED agents before any real model is wired** (§10 closing requirement).

**What shipped (5 modules + tests):**

- `types.ts` — Run/Plan/PlanStep/StepResult/StepState, BudgetLimits/Usage, the full §13
  typed `OrchestrationEvent` union, Agent + registry + RunStore/ReplanPolicy/Finalizer contracts.
- `plan.ts` — `validatePlan`: total DAG validation (collects _every_ issue), Kahn leveling
  that returns the parallel execution levels and detects cycles, plus known-agent /
  model-exists / allowed-tool checks.
- `budget.ts` — `BudgetGuard` (§10.7/§12): cost, model-call, tool-call, wall-clock caps and
  a separate replan cap. Injected clock so wall-clock limiting is testable without real time.
- `events.ts` — `EventBus`: one typed event per state change, fanned out to live subscribers
  (SSE) + the RunStore (replay); a throwing subscriber is isolated.
- `executor.ts` — `OrchestraExecutor`: level-parallel step execution, per-step timeout,
  bounded retries with backoff, skip-on-failed-dependency, critical-vs-non-critical failure
  propagation, the bounded replan loop, budget-stop → honest partial, persist-after-every-transition.
- `orchestra.test.mts` — **16 tests** covering plan validation, parallel/sequential ordering,
  retries (throwing + retryable/non-retryable + timeout), budget stopping (cost, wall-clock,
  model-call caps), replan (spawns a new agent; bounded by maxReplans), event sequence, and
  invalid-plan short-circuit.

**One real bug found and fixed by the tests:** the budget guard first _read_ the call counter
and incremented only _after_ a call returned — so parallel steps in one DAG level all passed
the gate before any increment (a silent overspend). Fixed by making the gate **atomically
reserve** the slot on success (`reserveModelCall`/`reserveToolCall`); cost is added separately
once known. The cost-cap test was also corrected to use a _sequential_ chain, since a call's
own cost is unknowable until OpenRouter returns it.

**What I ran to verify:**

- `node … --test src/lib/orchestra/orchestra.test.mts` → **16/16 pass**. `[VERIFIED]`
- `tsc --noEmit -p tsconfig.json` → clean. `[VERIFIED]`
- `eslint --max-warnings=0 src/lib/orchestra/` → clean. `[VERIFIED]`
- Existing `benchmark-stats` + `rbac/roles` tests → 14/14 still pass (no regression). `[VERIFIED]`
- No network, no spend this milestone (mocked agents only) → **$0.00**. `[VERIFIED]`

**Discord bullets:**

- Built the AgentOS **Orchestra engine** — the in-repo workflow layer that runs a query as a
  DAG of agent steps: parallel where independent, sequential where dependent, with retries,
  timeouts, and a bounded replan loop.
- It's **pure and fully injected** (agents, models, tools, persistence, even the clock), so I
  unit-tested the whole engine with **mocked agents** — 16/16 green — before spending a cent on
  real models.
- The budget guard enforces the §12 caps (per-run cost, model calls, tool calls, wall-clock,
  replans) **in code, before every paid call** — on a cap hit the run stops and returns the best
  honest partial, never a silent overspend.
- The tests immediately caught a real overspend bug: parallel steps were all slipping past the
  cap because the counter incremented only _after_ a call. Fixed by **atomically reserving** the
  slot at the gate.
- Failure handling is honest: a failed **critical** step fails the run; a failed non-critical
  step is recorded and the run continues; a step whose dependency failed is skipped, not faked.
- Next: wire the **Decision Bus** (real Jev gates) + dynamic team selection end-to-end with SSE.

**Screenshots to capture:** none yet (engine + tests only). The D6 run view that visualizes
these events lands at M7.

---

## Milestone 3 — Decision Bus + dynamic team selection + per-agent model routing (e2e + SSE) — **DONE**

Wired the §11 **Decision Bus** and the D1 planning spine end-to-end: one batched Jev call
classifies the query, picks the team, and routes a model per agent; a plan builder turns that
into a DAG; the M2 Orchestra executor runs it on **real models** while every typed event streams
to the client as **SSE** and persists for replay. The Bus is **pure + injectable** (`ask`/`now`/
`record`), so all its logic is unit-tested with a mocked `ask` at $0 before a real model is called
— same discipline as the Orchestra core.

**What shipped:**

- `src/lib/decisions/` (pure) — `types.ts`, `schema.ts` (zod validators for every Jev output),
  `questions.ts` (ONE batched 6-question planning call + the 4 D4 gate question sets),
  `policy.ts` (deterministic fallbacks, team assembly, role→model routing), `bus.ts`
  (`DecisionBus`: `planRun` + the 4 gates, per-decision jev|policy fallback). **10 unit tests.**
- `src/lib/agents/` (pure) — `plan.ts` `buildAgentPlan`: PlanDecision → DAG (lead depends on
  workers, lead is critical); roles Jev picked that M3 hasn't implemented are **deferred**, not
  dropped. **4 unit tests.**
- `src/lib/orchestra/` — `AgentContext.model` added (per-agent routing is a _decision_, not the
  agent's choice); the executor passes `step.model` into the context.
- `src/server/` — `ai/tracked-models.ts` (shared label→`TrackedModel`/`AiProvider` maps),
  `agents/generating-agent.ts` + `index.ts` (`AGENT_REGISTRY {answerer, synthesizer}`,
  `MODEL_REGISTRY`, `REGISTERED_ROLES`), `ai/decision-bus.ts` (binds the pure Bus to real `askJev`),
  `agentos/store.ts` (run/step/decision/event persistence + nightly-spend gate + `markRunFailed`),
  `agentos/run.ts` (the SSE pipeline), `app/api/agentos/route.ts` (thin transport adapter).
- `prisma/schema/agentos.prisma` — 5 tables (`AgentRun`, `AgentStep`, `DecisionRecord`,
  `AgentEvent`, `EvidenceRecord`); generated CREATE migration + hand-written RLS migration applied.
- `src/lib/env.ts` + `.env.example` — `PER_RUN_CAP_USD` / `NIGHTLY_SPEND_CAP_USD` /
  `BENCHMARK_CAP_USD` (placeholders only), enforced in code (§12 / D-07).

**What I ran to verify (real calls, no invented numbers):**

- Pure tests `node … --test decisions+agents+orchestra` → **30/30 pass**. `[VERIFIED]`
- `tsc --noEmit` clean; `eslint --max-warnings=0` clean on the changed files. `[VERIFIED]`
- `check:env` (11 vars), `check:rls` (**16 tables**), `check:ai-models` (10 models) all pass. `[VERIFIED]`
- **Live e2e** vs real Jev + OpenRouter + Supabase (all figures read back from the DB): `[VERIFIED]`

  | run | query type         | team (Jev)                  | model routing                           | executed                                   | answer                            | cost (µUSD) |
  | --- | ------------------ | --------------------------- | --------------------------------------- | ------------------------------------------ | --------------------------------- | ----------- |
  | 1   | simple             | `[answerer]`                | `answerer:gemini`                       | answerer:gemini ✓                          | "The capital of France is Paris." | 36          |
  | 2   | research/medium    | `[researcher, synthesizer]` | `researcher:gemini, synthesizer:claude` | synthesizer:claude ✓ (researcher deferred) | (long analysis)                   | 15675       |
  | 8   | data/simple        | `[code, synthesizer]`       | `code:gpt, synthesizer:gemini`          | synthesizer:gemini ✓ (code deferred)       | "4"                               | 33          |
  | 7   | _disconnect probe_ | —                           | —                                       | aborted mid-planning                       | —                                 | **0**       |

- **Simple path = ONE model, ONE agent, no extra agents** (§11 hard requirement) — runs 1/5: `[answerer]`
  only. `[VERIFIED]`
- **Per-agent model routing is real**: run 8 routed `code→gpt` and `synthesizer→gemini` (two models,
  two roles) in one Jev batch; run 2 routed `synthesizer→claude`. `[VERIFIED]`
- **Deferred-role honesty**: research/data runs selected `researcher`/`code` (not built until M4/M5);
  they're disclosed in the SSE `run` event's `deferred` array and the lead answers alone — no silent
  drop, no validation failure. `[VERIFIED]`
- Each run persists **5 decision records** (task_type, complexity, required_agents, model_selection
  = `jev`; execution_mode = `policy`) with honest `decidedBy` + confidence, and **10 replay events**
  with monotonic `seq`. Jev's 6-question planning batch measured **563–1417 ms**. `[VERIFIED]`

**One real defect found and fixed during closeout:** a client disconnect (or the empty-plan return,
or any throw before the executor takes over) left the run row **orphaned in `planning` with
`error = NULL` forever** — a silent non-completion §8/§11 forbid, and exactly what a stale probe
row (run 3, `"noop"`) showed. Fixed with `markRunFailed`: an **atomic, idempotent** `updateMany`
guarded by a non-terminal-status filter (so it can never clobber a run the executor completed),
called from the catch block, the empty-plan return, and a new `ReadableStream.cancel()` handler.
Disconnects are classified as `client_disconnected` via an enqueue-failure flag — Node throws a
`TypeError`, _not_ a `DOMException`, so `error.name` detection is unreliable (verified empirically).
Re-verified: disconnect probe (run 7) → `status=failed`, `error=client_disconnected`, `finishedAt`
set, **`cost=NULL`, `modelCalls=0`** (no overspend); happy path (run 8) still completes. `[VERIFIED]`

**M3 spend:** runs 1/2/5/8 real model calls = **15785 µUSD total across all rows ≈ $0.015785**
(dominated by run 2's long claude completion) against the $10 nightly cap; the 3 probe/disconnect
rows spent **$0**. Jev planning is free. `[VERIFIED from agent_runs.cost_micro_usd]`

**Discord bullets:**

- Wired the AgentOS **Decision Bus** end-to-end: ONE batched Jev call classifies the query, picks
  the agent team, and routes a **different model per agent** — then the Orchestra runs it and streams
  every step as **SSE** while persisting a replay log. Real Jev + OpenRouter + Postgres, no mocks.
- **Dynamic team selection is live and honest**: a trivial question → a single `answerer` on one
  model (no extra agents, per spec); a data question → `[code, synthesizer]` with `code→gpt`,
  `synthesizer→gemini`; a research question → `[researcher, synthesizer]` with `synthesizer→claude`.
- Roles the planner picks but M3 hasn't built yet (`researcher`/`code`) are **deferred and disclosed**
  in the event stream — the lead answers alone rather than the run silently dropping work or faking it.
- Every run writes **5 decision records** flagged `jev` vs `policy` (never mislabeling a rule as the
  model's call) + **10 replay events** with monotonic sequence — the D6 run view (M7) reads these back.
- Found + fixed a real bug in closeout: a **client disconnect orphaned the run row in `planning`
  forever** (a silent non-completion). Now an atomic terminal marker records `client_disconnected`
  with **zero overspend** — verified by aborting a live stream mid-planning.
- Spend: **~1.6¢** total across all real runs (a long claude analysis dominates); probes cost $0.
  Next: M4 — real multi-agent workers + the first MCP tool (keyless calculator).

**Screenshots to capture:** no UI yet — M3 is an SSE API + DB. Interim evidence to grab: (1) the raw
`curl -N` SSE stream for a simple run showing `run` → `decision`×5 → `run_started` → `plan_created`
→ `model_selected` → `agent_started`/`agent_finished` → `cost_update` → `final`; (2) the
`agent_runs` / `decision_records` / `agent_events` rows for one run; (3) the deferred-role `run`
event for a research/data query. The visual D6 run view that renders these lands at **M7**.

---

## Milestone 4 — Multi-agent execution + first MCP tool (calculator, keyless) — **DONE**

Wired the first **real worker agent** and the **first real MCP tool** (§11 Code/Data agent + §13
tool priority 1). The `code` agent M3 could only _defer_ now executes: it asks its routed model to
translate the request into ONE arithmetic expression, hands that to a keyless `calculate` MCP tool,
and returns the tool's **exact** value — so a number in the answer is tool-computed, never
model-guessed. The agent is split **pure core / thin server wrapper** so the never-invent-a-number
logic is unit-proven at $0 before a real model or a real MCP call is wired (same discipline as M2/M3).

**What shipped:**

- `src/lib/mcp/calculator.ts` (pure) — `CALCULATOR_TOOL='calculate'` + `evaluate()`: a
  **recursive-descent parser, never `eval`**, that returns an honest error (never `Infinity`, never
  a throw) on division/modulo-by-zero, malformed input, non-arithmetic characters, or over-length.
  **8 unit tests** (incl. "never evaluates injected code").
- `src/server/mcp/calculator-server.ts` — a real `McpServer` ('agentos-calculator') on the official
  SDK, `registerTool` with a zod input schema (`expression`) + structured output (`{expression, value}`);
  a bad expression returns `{isError:true}` (the SDK surfaces tool errors as a result, not a throw).
- `src/server/mcp/registry.ts` — `getToolRegistry()`: a **lazy process-wide singleton** MCP `Client`
  linked to the server over `InMemoryTransport` (**zero new keys, zero network**), adapting the SDK
  to the executor's narrow `{has, call}` `ToolRegistry`. `listTools()` drives `has()` (so it grows
  when M5 adds research-sonar); `call()` maps `isError → {ok:false, error}`, else `{ok:true, output:
structuredContent ?? text}`; a transport throw is caught and reported, never propagated.
- `src/lib/agents/code-agent-core.ts` (pure) — `sanitizeExpression` (strips fences/`= value`/quotes/
  trailing period, detects NONE), `readCalcOutput` (narrows to a finite `{expression, value}` or null),
  `runCodeStep` (model→expression→tool→exact value; every non-happy path returns an honest StepResult
  and **no fabricated number**). **11 unit tests.**
- `src/server/agents/code-agent.ts` — the `server-only` wrapper: `trackAiCall` + `completeOnce` +
  `getModel`, injecting the real completer and `ctx.callTool` into the pure core (ledger-correct spend).
- `src/lib/agents/plan.ts` — `TOOLS_BY_ROLE.code = [CALCULATOR_TOOL]` (validatePlan rejects a tool the
  registry doesn't have, so this grant is what forces the registry to be wired).
- `src/server/agents/index.ts` — registered `code`; strengthened the synthesizer prompt to reuse a
  worker's **exact calculated value verbatim** rather than recompute it.
- `src/server/agentos/run.ts` — `needsTools` gate: only connect the MCP pair when a step actually
  allows a tool (tool-free runs never spin it up); registry passed into the executor.
- `package.json` — `@modelcontextprotocol/sdk@1.31.0`.

**What I ran to verify (real calls; every figure read back from Postgres, none invented):**

- Pure suites `node … --test` → **50/50 pass** (calculator 8, code-agent-core 11, agents 5,
  decisions 10, orchestra 16). `[VERIFIED]`
- `tsc --noEmit -p tsconfig.json` → exit 0; `eslint --max-warnings=0` on all changed files → exit 0. `[VERIFIED]`
- MCP registry + calculator-server integration (server-only modules) via a **throwaway** loader stub
  for `server-only` → `listTools()` returns `calculate`, a good expression returns the exact value,
  a bad one returns `isError`. Stub deleted after — keeping it would erode the pure/server guardrail. `[VERIFIED]`
- **Live e2e** vs real Jev + OpenRouter + the real MCP tool + Supabase: `[VERIFIED]`

  | run | query                                                   | taskType (Jev) | team / routing                    | tool call                                         | result                                                                                        | cost (µUSD) |
  | --- | ------------------------------------------------------- | -------------- | --------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
  | 9   | "What is 15% of 240 dollars?"                           | `data`         | `[code:gpt → synthesizer:gemini]` | `calculate {expression:"240*0.15"}` → **ok, 4ms** | code `240*0.15 = 36`; synthesizer presents **36 dollars** verbatim                            | **561**     |
  | 10  | _DB-writable probe_                                     | `simple`       | `[answerer]`                      | none                                              | completed                                                                                     | 308         |
  | 11  | "Write a short Python function that reverses a string." | `coding`       | `[code:gpt → synthesizer:gpt]`    | **none (0 tool calls)**                           | code returns honest "no calculation" note; synthesizer writes the function; **run completed** | 1404        |

- **The exact number is tool-verified, not model-guessed:** run 9's `agent_events` persisted a
  `tool_call` (`calculate`, `args.expression="240*0.15"`) and a `tool_result` (`ok:true`,
  `summary="240*0.15 = 36"`, **`latencyMs:4`**) between the code step's `agent_started`/`agent_finished`;
  17 events total, status `completed`, `toolCalls=1`. `[VERIFIED from agent_events / agent_steps]`
- **Persistence held for every path:** run 11 (the graceful-degradation case) read back as
  `status=completed`, `taskType=coding`, `modelCalls=2`, **`toolCalls=0`**, `error=null`, 14 events
  (**0 tool events**), code step `succeeded` with `outputSummary="No exact calculation was needed or
derivable for this request; answered without the calculator."` (no numeric value), synthesizer
  `succeeded`, 5 decision records (4 `jev`, 1 `policy`). `[VERIFIED from agent_runs / agent_steps / agent_events]`

**Two real defects found and fixed:**

1. **`sanitizeExpression` fence bug** (caught by a pure unit test, $0): an inline-fenced `'```2+2```'`
   returned `'+2'` because the fence-language regex `[a-z0-9]*` ate the leading digit. Fixed to
   `[a-z]*` — a fence language tag is alphabetic and an arithmetic expression never starts with a
   letter, so the operand is preserved. `[VERIFIED: test asserts '```2+2```' → '2+2']`
2. **Coding-task landmine** (found by reading `policy.ts`): `assembleTeam` routes `coding` tasks — not
   just `data` — to the calculator-only `code` agent. A coding query makes the model return `NONE`;
   the original hard `ok:false` would fail the non-critical code step, and since the **critical**
   synthesizer `dependsOn: [code]`, the executor would skip it and **fail the entire run** — a landmine
   for M8's coding benchmark tasks and any coding demo. Fixed: `NONE`/empty is now an honest
   **`ok:true`** "no calculation applies" note (**no invented number**, tool never called) so the lead
   still answers. Verified live by run 11 (completed, 0 tool calls). Tool failures stay **loud**
   (`ok:false`) — graceful degradation applies only to "nothing to calculate", never to a failed tool.

**M4 spend:** runs 9+10+11 = **2273 µUSD total ≈ $0.002273** (each run well under the $0.50 per-run
cap) against the $10 nightly cap. Jev planning and the keyless calculator tool are **$0**.
`[VERIFIED from agent_runs.cost_micro_usd]`

**Discord bullets:**

- M4 done — AgentOS now runs **real multi-agent teams with a live MCP tool**. "What is 15% of 240?"
  routed to `[code(gpt) → synthesizer(gemini)]`: the code agent translated it to `240*0.15`, called the
  keyless **`calculate`** MCP tool (**4ms**), got the exact **36**, and the synthesizer presented that
  tool-verified number verbatim — no model-guessed arithmetic.
- The first MCP tool is real, built on the official **`@modelcontextprotocol/sdk` 1.31.0** — a calculator
  server + client over an **in-process transport (zero new keys, zero network)**. The parser is pure
  **recursive-descent, never `eval`**, so injected code is rejected and ÷0 returns an honest error, not `Infinity`.
- Honesty is **unit-proven at $0**: I split the code agent into a pure core + a thin server wrapper, so
  the never-invent-a-number logic (and every failure path) is covered by mocked tests before a cent is
  spent. Pure suite is now **50/50**; tsc + eslint clean.
- Found + fixed a real landmine: the Bus routes **`coding`** tasks to the calculator-only code agent, so
  a coding query returned NONE → failed the step → skipped the critical synthesizer → **failed the run**.
  NONE is now an honest "no calculation applies" **success** (no invented number); verified live — a
  "write a Python string-reverser" query **completed** via the synthesizer with **0 tool calls**.
- **Tool failures stay loud**: if the calculator errors or returns unreadable output the step reports
  `ok:false` with the real reason and never fabricates a value (§13) — proven by tests and the registry's
  `isError → {ok:false}` mapping.
- Spend: **$0.002273** across 3 live runs, all persisted (events/steps/decisions) and read back from
  Postgres. Next: **M5** — evidence hub + research-sonar MCP tool (2nd tool) + Skeptic/Fact-Checker.

**Screenshots to capture:** still no dedicated UI — the D6 run view that renders these events lands at
**M7**. Interim evidence to grab: (1) run 9's raw SSE stream showing `tool_call` → `tool_result`
(`calculate`, `latencyMs:4`, `"240*0.15 = 36"`) nested in the code step; (2) run 9's `agent_steps` rows
(code `succeeded` "240*0.15 = 36", synthesizer `succeeded`); (3) run 11's SSE stream + `agent_runs` row
(`taskType=coding`, `toolCalls=0`, `status=completed`) as the graceful-degradation proof; (4) the
calculator suite output (8/8, incl. "never evaluates injected code").

---

## Milestone 5 — DONE (RAG evidence hub + 2nd MCP tool `research` + Skeptic/Fact-Checker) `[VERIFIED]`

**Status: DONE and verified live.** The second real MCP tool (`research`, backed by **perplexity/sonar**
over OpenRouter), the shared **evidence hub**, and the model-based **Skeptic/Fact-Checker (`critic`,
claude)** all run end-to-end against the real Jev + OpenRouter + Supabase stack.

**Static + pure (all $0):** `tsc --noEmit -p tsconfig.json` → exit 0; `eslint --max-warnings=0` on all 21
changed/new files → exit 0; pure suite **87/87** (researcher-core 9, critic-core 10, evidence/memory 8,
mcp/research 10, mcp/calculator 8, orchestra 16, decisions, agents, code-agent-core); `ai-usage` **18/18**;
`check:ai-models` → "All 11 mapped model(s) still priced by OpenRouter. No batch tier upstream for: sonar
(fine unless you use it)." `[VERIFIED]`

**Live e2e (real sonar + Jev + Postgres):**

| run | query                                               | taskType / tier (Jev)   | team / routing                                                           | critic                      | evidence                               | result                                                 | cost (µUSD) |
| --- | --------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ | --------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------- |
| 12  | Apple vs MSFT FY2024 revenue                        | `research` / **simple** | `[researcher:gemini, code:gpt → synthesizer:gemini]`                     | **none** (Jev rated simple) | 1 coarse (`source:null`) — **pre-fix** | completed, but `final.citations:[]` (**defect found**) | 5879        |
| 13  | _same, post-fix_                                    | `research` / simple     | `[researcher, code → synthesizer]`                                       | none                        | **8 sourced rows**                     | completed, `final.citations` = **8 real URLs**         | 6000        |
| 14  | _hard_ 2-claim cross-check "flag any contradiction" | `research` / **hard**   | `[researcher:gemini, code:gpt → **critic:claude** → synthesizer:claude]` | **ran**                     | **8 rows, all `contested`**            | completed                                              | 37347       |

**The Skeptic is real and its verdicts propagate + persist.** Run 14's `critic` (claude) read the populated
hub and returned `checked:8, verdictsApplied:8, contradictions:0`, marking **all 8 evidence rows
`contested`** in `evidence_records` with honest source-quality reasoning (e.g. _"Source is Microsoft's
annual report, not Apple's filing; cannot verify Apple figures"_). The **synthesizer depended on the critic**
and its final answer explicitly surfaced that skepticism (_"The critic correctly flags that none of the
worker's citations directly link to Apple's official 10-K"_). DAG order proved live: `critic.dependsOn =
[researcher, code]`; `synthesizer.dependsOn = [researcher, code, critic]`. `[VERIFIED from agent_runs /
agent_steps / agent_events / evidence_records]`

**Citations are real, not invented.** Run 13's `final` event carried 8 live source URLs (Apple 10-K,
macrotrends, investopedia, Microsoft AR24, …) harvested from sonar's `message.annotations[]` — the same URLs
persisted as `evidence_records.source`. Run 14's tool call spent ~$0.0056 on sonar; the budget guard saw it
(`cost_update` jumped 486→6096 µUSD on the `tool_result`), proving paid-tool spend is threaded into the run
budget (D-26). `[VERIFIED]`

**Two real defects found and fixed this milestone:**

1. **Citations dropped when sonar omits spans** (found by live run 12, fixed + re-verified by run 13):
   sonar returned 8 real URLs but no usable `start_index`/`end_index`, so `buildEvidence` collapsed to one
   `source:null` coarse record and the evidence-citing finalizer emitted `citations:[]` — real sources thrown
   away. Fixed: when citations exist but none span-map, emit one record per **unique real URL** (claim = the
   whole finding, source = that URL); only a genuine absence of URLs keeps the null-source coarse record. No
   URL is ever invented (§8). Pure test added; run 13 now yields 8 `evidence_added` + 8 final citations.
   `[VERIFIED]` (D-25)
2. **A transient Supabase pooler blip** (`6543` unreachable) failed run 13's first attempt at the pre-flight
   `nightlySpendMicroUsd` budget check — it surfaced as a clean SSE `error` event, **created no run row and
   spent nothing**, and a retry succeeded. Honest failure, not a code defect; noted for M6 hardening.

**Design notes logged (D-20…D-26):** researcher uses sonar's provider spans for the claim↔source link and
makes **no model call of its own** (its routed `gemini` label is intentionally unused; the spend is the
tool's sonar call under `agentos_research`); sonar citations parsed per-element from `annotations[]`;
evidence hub = structured rows behind a pure `EvidencePort` (no vector column — 0 embedding models on
OpenRouter) with executor-wrapped event emission; a contradiction is an **UPDATE** of an existing row, not an
insert; the critic is gated by Jev complexity and sequenced after the primaries.

**M5 spend:** runs 12+13+14 = **49,226 µUSD ≈ $0.0492** (run 14 alone 37,347 ≈ $0.0373, well under the
$0.50 per-run cap). Nightly total incl. M4's runs 9–11 ≈ **$0.0515**, far under the $10 cap. The prior-window
sonar shape probes (≈$0.0153) were separate discovery spend. `[VERIFIED from agent_runs.cost_micro_usd]`

**Discord bullets:**

- M5 done — AgentOS now has a **real RAG evidence hub + a second live MCP tool (`research`) + a Skeptic that
  fact-checks it**. A _hard_ 2-claim query routed to `[researcher(gemini) → code(gpt) → **critic(claude)** →
synthesizer(claude)]`: the researcher pulled live web sources via **perplexity/sonar**, filed **8 sourced
  evidence records**, and the critic marked **all 8 `contested`** with real reasoning ("that source is
  Microsoft's filing, not Apple's — can't verify Apple's numbers").
- **The skepticism propagates.** Because the synthesizer _depends on_ the critic, the final answer didn't just
  parrot the numbers — it surfaced the critic's source-quality warning verbatim ("none of the citations
  directly link to Apple's official 10-K"). Verification is wired into the DAG, not bolted on.
- **Citations are real, never invented.** The 2nd MCP tool is built on the official `@modelcontextprotocol/sdk`
  over an in-process transport; it harvests sonar's `message.annotations[]` url_citations, so the final answer
  carries **8 live source URLs** (Apple 10-K, Microsoft AR24, macrotrends…) that are the _same_ URLs persisted
  in `evidence_records.source`. No embedding models exist on OpenRouter, so the hub is **structured evidence,
  not vectors** — a Skeptic can point at an exact claim↔source row.
- **Found + fixed a real defect live:** sonar sometimes returns URLs _without_ span indices, and the first
  version threw all 8 away (`citations:[]`). Now, when spans are missing, every real URL is still kept as a
  source for the finding — re-verified live (run 13: 8 `evidence_added`, 8 final citations). §8 holds: we
  never fabricate a link, but we never discard a real one either.
- **Paid-tool spend is on the budget.** Sonar's real ~$0.0056 cost is threaded into the run's BudgetGuard the
  moment the tool returns (the `cost_update` visibly jumps on the `tool_result`), so a web-research run can't
  silently overspend (§12). Honesty stays unit-proven at $0: pure suite **87/87**, tsc + eslint clean.
- **Jev stays in charge of verification depth:** a _simple_ revenue comparison honestly got **no** critic
  (cheaper), while a _hard_ cross-check earned one — cost scales with the task. Spend: **$0.0492** across 3
  live runs, all persisted and read back from Postgres. Next: **M6** — Jev D4 gates + replan loop (D5) +
  escalation tiers + budget enforcement.

**Screenshots to capture:** still no dedicated run UI (the D6 run view lands at **M7**). Interim evidence to
grab: (1) run 14's `plan_created` SSE showing the 4-agent DAG with `critic.dependsOn:[researcher,code]`;
(2) run 14's `evidence_records` read-back — 8 rows, `verification_status=contested`, real `source` URLs;
(3) run 14's `critic` `agent_finished` (`checked:8, verdictsApplied:8`) + the synthesizer answer citing the
critic; (4) run 13's `final` event with 8 real citations (the defect-fix proof); (5) run 14's `cost_update`
jump on the sonar `tool_result` (budget threading); (6) the pure suite output (87/87) + `check:ai-models`.

---

## Milestone 6 — DONE & verified live (D4 gates + D5 replan loop + §12 escalation + budget honesty)

**Honest status: DONE.** Code complete, type-clean, lint-clean, **147/147 pure unit tests green**, and the
full gate→replan→finalize chain proven live across two real runs (16 = `very_hard` with a live replan;
17 = `medium` clean finalize). The earlier OpenRouter-credit blocker (D-28) was RESOLVED by the human on
2026-10-01. See decisions D-27…D-30.

### What was built (M6 = D4 gates + D5 replan loop + §12 escalation + budget honesty)

- `src/lib/agents/replan.ts` — PURE: `shouldRunGates(tier)` (gates only at `hard`/`very_hard`),
  `summarizeEvidenceState` (the D4 gate input, built from real hub rows — never invents a claim),
  `refineResearchQuery` (targets the gap, de-dupes repeated coarse claims — D-30), `buildResearchDelta` /
  `buildReworkDelta` (unique `_r{n}` ids, sound `dependsOn`, correct tool grants).
- `src/lib/agents/replan-policy.ts` — PURE `createVerificationReplanPolicy`: gate 1 sufficiency NO → research
  delta; gate 2 validity NO → rework delta; both pass → finalize. `GateDecider` + `EvidencePort` injected.
- `src/server/agents/researcher.ts` — follow-up step prefers `inputs.query` (refined) over `ctx.query`.
- `src/lib/orchestra/budget.ts` — `canReplanRound()` composes `canReplan()` + `checkClock()` so the wall-clock
  cap also bounds replan ROUNDS (Jev gate calls happen between step reservations — D-29).
- `src/lib/orchestra/executor.ts` — `maybeReplan` gates on `canReplanRound()`; a budget stop now runs the
  finalizer and emits `final` (best partial + real citations) alongside the `error`/`budget_stopped` reason
  (§10.7/§12), never an empty reply.
- `src/server/agentos/run.ts` — policy injected only when `shouldRunGates(tier)`; MCP registry connected
  whenever gates are enabled (a research delta needs `RESEARCH_TOOL`); gate records streamed via
  `send('decision', …)` (persisted once by the bus sink).

### What was run to verify

- **147/147 pure unit tests green** over `src/lib/**` — incl. `replan` (11: tiers, evidence-state, refined-query
  de-dupe, delta shapes validated by the real `validatePlan`, unique ids across replans), `replan-policy`
  (6: escalation skip, gate sequencing, both-pass finalize, gate state reflects the hub), and `orchestra` (18:
  incl. the budget-stop-partial test and the new wall-clock-replan-bound test). `tsc --noEmit` clean;
  `eslint --max-warnings=0` clean on all changed/added files.
- **LIVE run 16 (`very_hard` research query) — the replan proof:** researcher (sonar, 8 evidence) → critic
  (Claude) → synthesizer (Claude, succeeded) → **gate 1 `evidence_sufficiency` `decided_by=jev` conf 0.77
  `{enough:false}`** → **`replan` event `addedSteps:[researcher_r1, synthesizer_r1]`** → `researcher_r1` ran the
  REFINED gap-targeting query (8 more evidence) → `synthesizer_r1` → **gate 1 fired again conf 0.94
  `{enough:false}`** starting a 2nd round. DB: 16 evidence records, 2 jev gate decisions, `replans=1`,
  cost 43300 µUSD ($0.0433). (Run 16 ended on a client-side curl timeout at 220s, not a server fault — hence
  run 17 below for the clean terminal.)
- **LIVE run 17 (`medium` query) — the clean-finalize + escalation proof:** Jev rated it `medium`
  (`complexity by=jev conf 0.53`), so `shouldRunGates` was false and the run recorded **only the 5 planning
  decisions — ZERO `evidence_sufficiency`/`evidence_validity` gates and ZERO replans**. Steps
  researcher(gemini)/critic(claude)/synthesizer(claude) all succeeded; status went
  `running → finalizing → completed`; a real `final` event streamed (4237-char answer + real citations:
  arxiv/oracle/apxml) and curl exited 0 (server closed the stream cleanly). DB: `status=completed`,
  `replans=0`, `err=null`, cost 36326 µUSD ($0.0363), 8 evidence records, `has final=true`.

### §12 escalation — verified live across BOTH tiers

- `medium` (run 17) and `medium` (run 15) → **zero** gate decisions, zero replans: cheap queries stay cheap.
- `very_hard` (run 16) → gates fire with `decided_by=jev` and drive a real replan: verification effort scales
  with complexity.

### Two robustness gaps found via the live runs and fixed (D-29, D-30)

- **D-29:** the wall-clock cap was only checked at step/tool reservation, so a slow Jev gate between rounds
  could overrun `maxWallClockMs`. Fixed with `canReplanRound()`; a new orchestra test advances a fake clock
  past the cap and asserts the replan policy is never consulted (`policyCalls===0`, `replans===0`,
  status `completed`, `finalAnswer` set).
- **D-30:** the refined-query "coverage" list repeated one coarse claim per URL (the no-span fallback writes
  the same claim per source — D-25). Fixed by de-duping with a `Set`; a new replan test asserts 3 identical
  rows + 1 distinct yield exactly 2 covered entries.

### Spend (M6 live verification)

- Run 15: 17017 µUSD (failed on the pre-top-up 402). Run 16: 43300 µUSD. Run 17: 36326 µUSD.
  M6 live total ≈ 96643 µUSD (**$0.0966**) — far under the $0.50/run and $10/nightly caps.

### Discord-ready bullets

- 🔁 **AgentOS M6 is live:** the D4 Jev gates (evidence sufficiency → validity) now drive a real **D5 replan
  loop**. On a `very_hard` research run, Jev judged the evidence insufficient (conf 0.77), the orchestrator
  emitted a `replan` adding `researcher_r1` + `synthesizer_r1`, and the follow-up researcher ran a **refined,
  gap-targeting query** — then Jev re-checked (conf 0.94). Bounded by `maxReplans`.
- 📶 **§12 escalation proven on both tiers:** a `medium` run spent **zero** gate calls and **zero** replans
  (only the 5 planning decisions recorded), while `very_hard` fired real Jev gates — verification effort scales
  with complexity, so cheap queries stay cheap.
- ✅ **Clean terminal finalize:** run 17 streamed `running → finalizing → completed` with a real `final` answer
  (4237 chars + live citations) and the server closed the SSE stream cleanly (curl exit 0) — no dangling run.
- 💸 **Honest budget stops:** a run that hits its cost cap now returns the best **partial** answer with real
  citations + the reason, instead of an empty reply (§10.7/§12).
- 🧪 **147/147 pure unit tests green** + `tsc`/`eslint` clean — the whole loop (delta builders, policy
  sequencing, wall-clock bound, budget-stop partial) is proven at $0 before any live Jev hop.
- 🩹 **Two live-found gaps hardened:** wall-clock cap now bounds replan rounds (D-29); refined-query coverage
  list de-duped (D-30) — both with regression tests.

### Screenshots captured / to capture

1. Run 16 `decision_records`: two `evidence_sufficiency` rows `decided_by=jev` conf 0.77 / 0.94, both
   `{enough:false}`. 2. Run 16 `replan` SSE event `addedSteps:[researcher_r1, synthesizer_r1]`. 3. Run 16
   `researcher_r1` `tool_call` showing the refined query. 4. Run 17 `medium` decision list (5 planning
   decisions, no gates) = escalation proof. 5. Run 17 terminal `status: completed` + `final` event with
   citations. 6. The 147/147 pure-suite output. 7. A budget-stopped run's `final` partial answer (unit-proven;
   a live budget-stop screenshot needs a deliberately tiny cap).

---

## Milestone 7 — DONE & verified live (run-view UI D6 + replay)

**Status: done.** The D6 run view is live at `/agentos`, renders the Decision Bus → team →
execution → evidence → verification pipeline from real run state, and replays any persisted
run through the same code path as the live stream.

### What was built

- **M7a — pure reducer** `src/lib/agentos/run-view.ts`: folds the SSE wire frames (`run` init,
  `decision`, and every OrchestrationEvent) into the exact D6 panel model (checklist, roster,
  evidence graph, gate quote, replan/contradiction markers, cost/latency, final + citations).
  Pure and total — a malformed frame is ignored, never a throw. 23 unit tests.
- **M7b — replay server** `src/server/agentos/replay.ts` + `GET /api/agentos/runs` and
  `GET /api/agentos/runs/[id]`: reconstructs the SAME wire-event list the live stream produced
  (run init + decision records + agent_events, time-merged so a gate lands just before the
  replan it triggered) and hydrates `evidence_added` from the authoritative `evidence_records`.
- **M7c — client hooks** `use-agent-run.ts` (hand-rolled fetch+reader SSE loop, throwing code
  kept out of the hook body for the React Compiler) + `use-run-replay.ts` (TanStack Query) +
  pure `src/lib/agentos/sse.ts` frame parser/splitter (12 unit tests).
- **M7d — D6 terminal UI** `src/components/agentos/run-view.tsx`: dark monospace dashed-border
  stacked panels in the mockup's exact order (header, USER, JEV DECISION BUS, agent roster,
  EVIDENCE GRAPH, JEV DECISION, RESULT), model badges with brand colours, status dots,
  replan/contradiction markers, running cost + latency + tier, markdown final answer with
  numbered citation links, and a replay picker. Reuses the shared `Markdown` renderer.
- **M7e — route + nav**: `src/app/[locale]/agentos/page.tsx` and an AgentOS entry in `ViewNav`.

### What was run to verify

- **186/186 pure unit tests green** (147 at M6 close; +23 run-view, +12 sse, +4
  `applyTerminalStatus`). `tsc --noEmit` exit 0; `eslint --max-warnings=0` exit 0 on every
  touched file; **production build exit 0** (React Compiler `panicThreshold:'all_errors'`
  did not panic on the new hook/component).
- **Live browser verification** (dark theme = the mockup): empty state renders all panels with
  honest "—" placeholders; **replay #16** (very_hard) shows the Jev gate quote
  ("Enough evidence? NO … confidence 0.94"), the `REPLAN #1 → spawn researcher_r1,
synthesizer_r1` marker, a 5-row roster with model badges + per-step latencies + `+REPLAN`
  tags, evidence counters (12 sources / 3 verified / 5 contested), and — because run 16 was
  killed by a client disconnect — an honest `FAILED` badge + the stored error instead of a
  misleading "Synthesizing…"; **replay #14** (hard, completed) renders the full markdown answer
  - 8 numbered citation links; **live run #18** (simple) streamed `RUNNING → COMPLETE` with the
    roster flipping code→COMPLETE / synthesizer→RUNNING→COMPLETE, cost/elapsed/models/tools
    ticking, the §12 escalation line ("No verification gate fired — tier \"simple\" is below
    hard"), a markdown final answer, and the run auto-appearing in the replay picker on completion.
- Replay endpoints exercised via curl against runs 16/17 during M7b (correct ordering +
  evidence hydration).

### Honest artifacts / known limits

- **Cost staleness on killed runs (D-31):** for a run killed mid-stream the stored
  `agent_runs.costMicroUsd` can lag the last persisted `cost_update` (run 16: row 43300 vs
  event 68134 µUSD) because the row write is cut short by the disconnect while per-event rows
  are more durable. The run-view **detail header deliberately shows the event-derived (more
  complete) total**; the history list shows the stored row. Both are real measurements.
- **`applyTerminalStatus`** reconciles a replayed view's terminal phase with the stored row so
  a killed run never renders as still-synthesizing (4 unit tests).
- Runs that predate the M6 gates (e.g. #14, tier hard) show "No verification decision
  recorded." — honest: the gates did not exist when they ran.
- The in-app browser screenshot surface became unavailable partway through verification; four
  real screenshots were captured before that and the remainder of the evidence is structural
  (accessibility-tree) snapshots, which confirm the same rendered content.

### Discord-ready bullets

- 🖥️ **AgentOS M7 is live:** the D6 run view is up at `/agentos` — a dark monospace terminal of
  stacked dashed panels (Decision Bus checklist → agent roster → evidence graph → Jev decision →
  result) that updates **live** from the SSE stream as agents run.
- 👥 **Watch a real team assemble:** the roster shows each agent with its routed model badge
  (Claude/GPT/Gemini), a live status dot, and per-step latency; replanned agents are tagged
  `+REPLAN` so a spawned-mid-run worker is visibly distinct from the original team.
- ⏪ **Every run is replayable:** the view folds a persisted run's reconstructed event log
  through the _same_ reducer as the live stream, so replay #16 reproduces its Jev gate
  ("Enough evidence? NO"), its replan, and its evidence counters exactly — pixel-identical to
  watching it live.
- 🧾 **Answers ship with receipts:** the result panel renders the markdown answer plus numbered
  citation links straight from the evidence hub, and the header shows real measured cost,
  elapsed time, model calls and tool calls — never a fabricated figure.
- 🩹 **Honest about dead runs:** a run killed mid-stream (client disconnect) now shows `FAILED`
  - the stored reason instead of spinning "Synthesizing…" forever — reconciled against the
    stored run row, with regression tests.
- 🧪 **186/186 pure tests green** + `tsc`/`eslint`/production-build all exit 0 — the D6 reducer,
  SSE parser and replay reconciliation are proven at $0 before any live hop.

### Screenshots captured / to capture

1. `/agentos` empty state (light) — all D6 panels in order with honest placeholders + the new
   AgentOS nav entry. 2. `/agentos` dark, replay #16 — header `FAILED · tier very_hard` +
   cost/elapsed/models/tools, USER quoted query, JEV DECISION BUS checklist. 3. `/agentos` dark,
   replay #16 — AGENT ROSTER ·5 with model badges + `+REPLAN` tags + latencies, EVIDENCE GRAPH
   counters, JEV DECISION gate quote + REPLAN marker, RESULT error banner. 4. `/agentos` dark,
   replay #14 — RESULT markdown answer with numbered citation links. 5. (structural) live run
   #18 mid-stream: roster code COMPLETE / synthesizer RUNNING, §12 escalation line, ticking
   cost/elapsed. 6. The 186/186 pure-suite output + production-build exit 0.

---

## Milestone 8 — IMPLEMENTATION DONE & verified via pilot; FULL run BLOCKED on OpenRouter credits

**Status: half-done — implementation complete and verified end-to-end; the full-scale live
result set is blocked (honest, not fabricated).** The four-setup benchmark (A single LLM · B
single LLM + RAG · C fixed multi-agent DAG · the full AgentOS pipeline), the gpt-4.1 rubric
judge, persistence, SSE stream, CLI, GET endpoints and the dashboard panel are all built and
proven working by a real 3-task pilot. A complete 24×4 comparison table **cannot** be produced
right now because the OpenRouter account is out of credits (`total_credits: 0`) — see
`docs/BLOCKED.md`. No number below is invented; the pilot's partial results are reported as-is.

### What was built

- **M8a — schema/migration/RLS**: `agentos_benchmark_runs / _results / _verdicts` (Prisma,
  migration via `scripts/generate-migration.mjs`, RLS the sanctioned hand-written exception).
- **M8b — pure modules** `src/lib/agentos-benchmark/`: `stats.ts` (setup/report aggregation),
  `wire.ts` (SSE + report contract), `judge-parse.ts` (robust JSON verdict parser — never
  fabricates a score), `derive.ts` (folds AgentOS run frames into a setup-D outcome via the SAME
  D6 reducer the run view uses, so setup-D metrics can't drift from the UI). 31 unit tests.
- **M8c — rubric judge** `src/server/ai/rubric-judge.ts`: gpt-4.1 (a different family from the
  gemini generator), one JSON verdict `{score,unsupportedClaims,notes}`, retries 429/5xx with
  backoff, an unparseable verdict is a hard failure (not silently retried or invented).
- **M8d — four setup runners** `src/server/agentos-benchmark/setups.ts`: A = one gemini call;
  B = research-sonar retrieval → gemini; C = a FIXED researcher→critic→synthesizer DAG on the real
  Orchestra engine (all gemini, no Jev/gates/replan); AgentOS = the full production pipeline via
  in-process `agentRunStreamResponse`. Wall-clock latency + honest failure rows owned here.
- **M8e — store + engine + SSE + spend caps** `store.ts` / `engine.ts`: pilot defaults to 3 tasks;
  pre-flight nightly gate (409); effective cap = `min(BENCHMARK_CAP, nightlyCap − spentTonight)`;
  sequential tasks × 4 setups + judge; a cap stop is an honest `budget_stopped` that still emits a
  partial `done`; crashes/aborts are `failed`.
- **M8f — API + CLI**: `POST /api/agentos-benchmark` (streaming), `GET …/runs`, `GET …/runs/[id]`;
  `scripts/agentos-benchmark.mjs` (`pnpm benchmark:agentos`), `--pilot/--full/--limit/--label`.
- **M8g — dashboard panel** `src/components/dashboard/agentos-benchmark-panel.tsx` +
  `use-agentos-benchmark-run.ts` (module-level SSE loop, React-Compiler-safe) +
  `use-agentos-benchmark-data.ts` (TanStack Query). Run control (Pilot/Full/Cancel), live progress +
  spend-vs-cap meter, per-setup semantic `<table>`, per-task winners, a deliberate **"Where AgentOS
  did NOT win"** section, methodology + limitations, empty/loading/error states, reduced-motion.
  Mounted as a new section in `dashboard-view.tsx`.

### What was run to verify

- **31/31 agentos-benchmark unit tests green** (judge-parse 15 + stats/report 16).
- `tsc --noEmit` exit 0; `eslint --max-warnings=0` exit 0 on all M8 files (incl. the three M8g
  client files + `dashboard-view.tsx`); **production build exit 0** — all three
  `/api/agentos-benchmark*` routes present in the route manifest.
- **Live PILOT (run #1, 3 tasks × 4 setups)** via `pnpm benchmark:agentos --pilot`: streamed
  start→progress→done, persisted **12 result rows**, real spend **$0.082** (≪ $15 cap).
- **GET endpoints recompute** run #1 correctly from stored rows (`resultCount:12`, honest
  per-setup success counts, `agentosBest 1 / neverBest 1`).
- **Dashboard panel verified in-browser** (structural DOM assertion at `/dashboard`): the four-setup
  table renders run #1's real measured numbers and the run-history list shows
  `#1 M8 pilot 3x4 · pilot · completed · 3 tasks · 12 rows`.

### Real pilot numbers (run #1 — PARTIAL, credit-limited; reported honestly)

| setup                 | success   | judge score | unsup. claims | citations | mean cost | mean latency | calls (m/t) |
| --------------------- | --------- | ----------- | ------------- | --------- | --------- | ------------ | ----------- |
| A · single LLM        | 2/3 (67%) | 0.80        | 3.50          | 0.00      | $0.0018   | 8.4s         | 1.0/0.0     |
| B · single LLM + RAG  | 2/3 (67%) | 0.97        | 0.00          | 8.00      | $0.0077   | 13.7s        | 1.0/1.0     |
| C · fixed multi-agent | 1/3 (33%) | 1.00        | 0.00          | 8.00      | $0.0077   | 10.6s        | 3.0/1.0     |
| AgentOS               | 1/3 (33%) | 1.00        | 0.00          | 8.00      | $0.0134   | 62.4s        | 2.0/1.0     |

**These success rates are depressed by the credit wall, not by the pipeline.** `aos-01` completed on
all four setups (real scores A 0.60 / B 1.00 / C 1.00 / AgentOS 1.00); `aos-02` failed all four with
`402`; `aos-03` A/B succeeded, C/AgentOS failed `critical_step_failed` (402 on a required step). On a
funded key the full 24×4 run is expected to cost ~$0.65–$0.70 (pilot ≈ $0.027/task all-in).

### Blocker

OpenRouter `total_credits: 0` → paid calls return `402 "would exceed your available credits"`. Per §8
I cannot add credits (paid resource) and will not fabricate a full-run table. Documented in
`docs/BLOCKED.md` + decision **D-32**. **Human action:** fund `OPENROUTER_API_KEY`, then
`pnpm benchmark:agentos -- --full` (or click **Run full (24)**) — it persists and charts automatically.

### Discord-ready bullets

- 🧪 **AgentOS M8 four-setup benchmark is built & pilot-verified:** the SAME tasks run through
  A (single LLM), B (+RAG), C (fixed researcher→critic→synthesizer DAG) and the **full AgentOS
  pipeline**, every answer graded by a **gpt-4.1 rubric judge** (a different model family from the
  gemini generator) — real measured cost/latency/calls/replans, never estimated.
- 📊 **Now a dashboard section:** run control (Pilot 3 / Full 24), a live progress bar **plus a
  spend-vs-cap meter** that turns amber >85%, a per-setup comparison table, per-task winners, and a
  deliberate **"Where AgentOS did NOT win"** panel — the losses are shown, not hidden (§14).
- 🎯 **Setup D can't drift from the UI:** the AgentOS arm is consumed in-process and folded through
  the _same_ D6 reducer the run view uses, so benchmark numbers and the live run view agree by
  construction.
- 💸 **Spend discipline held:** the 3-task pilot cost **$0.082** of the **$15** cap, streamed its
  real cumulative spend the whole way, and every failure was persisted as an honest row (12/12) —
  nothing dropped, nothing fabricated. **31/31 pure tests + tsc/eslint/prod-build all green.**
- ⛔ **One honest blocker:** the OpenRouter key is back to **$0 credits**, so paid calls 402'd
  partway through (aos-01 fully scored; aos-02/03 partially). The *full* 24×4 table is blocked until
  the key is funded (~$0.70 expected) — documented in `docs/BLOCKED.md`, not papered over.

### Screenshots captured / to capture

Structural DOM verification of `/dashboard` captured this session (four-setup table rendering run #1's
real numbers + run-history row). Visual screenshots pending an in-app-browser visible surface (the
headless viewport was hidden at capture time — `take_screenshot` returned
`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`); to capture: open the in-app browser, load `/dashboard`, scroll
to the "AgentOS four-setup benchmark" section — (1) run control + methodology/limitations, (2) the
per-setup comparison table with the AgentOS row highlighted, (3) per-task winners + "Where AgentOS did
NOT win", (4) run history with the `completed` pilot badge.

---

## Model Pool M3 — failover, circuit breaker, limiter/queue — **HALF-DONE (pure core done, server wiring pending)**

**What shipped (pure, `$0`, all under `src/lib/model-pool/`):**

- `classify.ts` — HTTP/provider-error → `FailureKind` (rate-limit, server-error, timeout,
  unavailable, insufficient-credits, empty-output, context-overflow, unparseable, bad-request,
  unknown). Grounded in Phase 0: 402=credit wall, 400 "provider returned error"=server-error,
  404/data-policy=unavailable. `isSameModelRetryable` / `opensCircuitImmediately` /
  `isGlobalStopSignal` drive the loop's decisions.
- `backoff.ts` — exponential backoff with **full jitter**, capped, honouring `Retry-After` as a
  FLOOR (never retry sooner than the provider asked). `parseRetryAfterMs` handles delta-seconds +
  HTTP-date, garbage→null (falls back to computed, never guesses).
- `circuit.ts` — per-model breaker: closed→open→half-open. Immediate-open kinds (unavailable,
  insufficient-credits) bench on the first failure; threshold kinds need N consecutive; a **failed
  half-open probe always re-opens** with a fresh cooldown. `createHealthStore` is in-memory with an
  `onStateChange(slug, health)` hook = the Supabase-persistence seam (module stays DB-free).
- `limiter.ts` — `createRateLimiter` (sliding-window **20 RPM** + daily quota **50 unfunded / 1000
  funded**, account-wide `free` bucket, UTC-day rollover, dynamic limits for a funded key) and
  `createConcurrencyLimiter` (counting semaphore + FIFO queue, slot released in a `finally` so a
  throwing call never leaks).
- `failover.ts` — `runWithFailover(chain, …)` walks the candidate chain best-first: classifies each
  failure, retries the same model for transient kinds (backoff+jitter), fails over for permanent
  kinds, **skips remaining premium candidates once a 402 credit wall is seen** (degrades to free
  instead of burning attempts), gates every paid attempt through the injected Orchestra budget
  (structurally a `BudgetGuard`), caps per-model/total/wall-clock, and emits `model_failover` +
  `model_unhealthy` events. Clock, sleep, transport, health, limiters, budget ALL injected.

**What I ran to verify (real, on this machine, `$0` — no network, no real model call):**

- `node --test "src/lib/model-pool/*.test.mts"` → **74/74 pass** (registry 19, select 16,
  circuit 11, limiter 13, failover 15). `[VERIFIED]`
- `tsc --noEmit -p tsconfig.json` → **no model-pool errors**. `[VERIFIED]`
- `eslint --max-warnings=0 src/lib/model-pool/ src/server/model-pool/` → **clean**. `[VERIFIED]`
- Failover integration cases proven at `$0` with fakes: transient-retry-then-success; permanent
  → circuit opens + `model_unhealthy` + `model_failover`; empty-output rejected; 402 credit wall
  skips premium → free serves; all-fail → `all_failed`; only-402s → `insufficient_credits`;
  budget refusal → `budget_stopped`; wall-clock → `wall_clock`; attempt cap → `max_attempts`;
  open-circuit skip; limiter refusal → failover; Retry-After honoured as backoff floor.

**The one honest blocker for the server half (M3 wiring / M4+ live):** the ai-usage ledger
(`src/server/lib/ai-usage/models.ts`) types `trackAiCall({ model })` as a compile-time
`TrackedModel = keyof typeof OPENROUTER_SLUGS`. The pool discovers free-model slugs **at runtime**,
so a runtime slug cannot be a `TrackedModel` without either (a) extending the ledger to accept an
arbitrary slug priced from OpenRouter's real `usage.cost` (unmapped → NULL, never 0 — the map's own
documented behaviour), or (b) registering a curated allowlist of _verified_ free slugs in
`OPENROUTER_SLUGS`. Both touch the AGENTS.md "adding a model" rule + `pnpm check:ai-models`, so this
is surfaced rather than assumed (brief ANTI-HALLUCINATION: "if anything conflicts, tell me"). Live
verification of the transport is additionally blocked on the **$0 key** (same blocker as M8/D-32).

**Not done yet (server half of M3):** the real transport wrapping `completeOnce` + `trackAiCall` +
`registry.recordProbe`; the Supabase-backed `HealthStore` persistence; sizing the concurrency limiter
to the free tier; and swapping agents/the Decision Bus to call `runWithFailover` — deliberately NOT
done yet so existing chat/run-view/benchmark paths stay untouched until the ledger decision + funding
land.

### Discord bullets (M3 pure core)

- 🔁 **Model Pool failover core is built & green:** an ordered candidate chain now walks best-first —
  transient faults (429/5xx/timeout) retry the _same_ model with jittered backoff that **honours
  Retry-After**, permanent faults (404/data-policy/context-overflow/empty-output) fail straight over.
- 🚦 **Per-model circuit breaker:** closed→open→half-open. A removed/credit-walled model benches on
  the first failure; flaky ones bench only after N consecutive; a failed half-open probe re-opens.
- 💸 **$0 credit wall handled honestly:** the first 402 stops the run from burning attempts on every
  remaining premium model and degrades to free instead — never a silent error, never a fake answer.
- ⏱️ **Free-tier limiters wired:** sliding-window 20 RPM + daily quota (50 unfunded / 1000 funded) +
  a concurrency semaphore with a FIFO queue so parallel agents can't stampede the free limits.
- 🧪 **74/74 pure tests + tsc + eslint clean**, every number from a real run on this machine —
  clock/sleep/transport/budget all injected, so the whole loop is proven at `$0` before any live call.
- ⛔ **One surfaced decision (not assumed):** runtime-discovered free slugs don't fit the ledger's
  compile-time `TrackedModel` map — needs a small ai-usage extension (or a verified-slug allowlist)
  before the server transport goes live; live verify still blocked on the `$0` key.

### Screenshots to capture (M3)

No UI in M3 (pure logic). The failover/circuit/limiter become visible in **M6** — capture then:
(1) a run view showing a `model_failover` event (which model failed, why, which took over),
(2) a `model_unhealthy` event with the circuit state, (3) the dashboard Model Pool health panel
(circuit states, success rate, free-limit counters, last refresh).

---

## Model Pool M4 — output validation + quality gates — **DONE (pure core; agent wiring deferred to the server pass)**

**What shipped (pure, `$0`, `src/lib/model-pool/`):**

- `validate.ts` — the gate that keeps unvalidated weak-model output OUT of the evidence store /
  Decision Bus fallbacks (brief §4). `extractJson` is a string-aware balanced scanner (ignores braces
  inside string values, handles objects + arrays + nesting, greedy fallback) that returns **null, never
  a guess**. `repairJson` does ONE conservative pass (strip ```fences, remove trailing commas) and
  returns null when nothing would change — it never rewrites quotes/casing/content, because a "repair"
  that alters data is a fabrication. `validateStructured(text, zodSchema)` tries as-is → on failure one
  bounded repair → re-validate, reporting `repaired:true` when a repair saved it (so a model that
  constantly needs repair can be demoted) and the REAL zod issues when it can't. `isBlankOutput` is the
  free-model 200-with-empty-content trap. Generalizes the proven `agentos-benchmark/judge-parse.ts`
  pattern (honest null, never a fabricated 0), schema-driven.
- `quality.ts` — the two §5 safeguards. `auditClaims` = the answer-quality/citation gate: every claim
  must be cited to a REAL evidence id or explicitly marked model-knowledge; a fabricated citation
  (unknown id) counts as `unsupported` (worse than none), and the gate fails on any unsupported claim.
  `crossCheckVerdicts` = verification cross-check: two models must AGREE (after `normalizeVerdict`
  collapses synonyms) AND both be evidence-grounded; disagreement → `contested`, an ungrounded verdict
  → not trusted, so weak reasoning cannot invent a verification. `normalizeVerdict` checks refuted
  BEFORE supported (so "incorrect" ≠ "correct") and is honest about its limit (label matching, not
  negation parsing).

**Verified (real, `$0`, no network/model):** `node --test "src/lib/model-pool/*.test.mts"` → validate 14

- quality 12 new tests green; **tsc --noEmit clean; eslint --max-warnings=0 clean.** `[VERIFIED]`

**Deferred (integration):** calling `validateStructured` at the evidence-store / Decision-Bus write
boundary and `crossCheckVerdicts` in the Skeptic/Fact-Checker path — bundled into the single server
pass (see M3b) so existing chat/run-view paths are touched once, not per-milestone.

### Discord bullets (M4)

- 🧼 **Weak-model output is now validated before it's trusted:** defensive JSON extraction (ignores
  braces inside strings), ONE conservative repair (fences + trailing commas only — never rewrites data),
  then zod schema validation. Unusable output reports the real issues and fails over; nothing is fabricated.
- 🔇 **The free-model "200 but empty" trap is handled:** blank content is a failure, not a success.
- ✅ **Citation gate:** every claim must cite a REAL evidence id or be explicitly marked model-knowledge;
  a fabricated citation fails the gate — an answer with any unsupported claim does not pass.
- ⚖️ **Cross-check verification:** two models must agree AND both cite real evidence; disagreement is
  flagged `contested`, an ungrounded free-model verdict is not trusted (weak reasoning can't fake a verify).
- 🧪 **+26 pure tests, tsc + eslint clean at `$0`** — generalizes the already-proven judge-parse honesty
  pattern (null, never a guessed 0).

---

## Model Pool M5 — degradation ladder L0–L5 — **DONE (pure core; recording/streaming wired in M6)**

**What shipped (pure, `$0`, `src/lib/model-pool/degradation.ts`):** turns what actually happened in a run
into one honest level + reason + per-step levels (brief §6). **Monotonic worst-wins** — a single L4 gap is
never averaged away by ten L0 steps, and an honest failure is always L5. Signals: L0 preferred served ·
L1 same-tier failover · L2 premium→free downgrade · L3 reduced team and/or verification · L4 unserved step
/ partial answer · L5 no trustworthy answer (with what was tried). `stepLevel` per step; `assessDegradation`
for the run (a free-preferred step served by free, or an upgrade, is NOT degraded); `mostlyDegraded` = a
strict majority of served steps were downgraded; `uncertaintyNote` produces the answer's honest note (empty
at L0, "could not be answered trustworthily… nothing was fabricated" at L5, "weaker free models / explicit
gaps / weaker cross-checking" as applicable); `degradationLabel` + `isDegraded` for the UI.

**Verified (real, `$0`):** +15 pure tests (step levels, worst-wins, honestFailure dominance, mostlyDegraded
threshold, uncertainty notes) — **119/119 model-pool tests pass; tsc + eslint clean.** `[VERIFIED]`

**Deferred (integration):** recording the level on each Run + streaming `degradation_level` (M6 owns the
SSE event union + persistence + UI badge), and appending `uncertaintyNote` to the finalizer's answer.

### Discord bullets (M5)

- 🪜 **Every run now gets an honest degradation level L0–L5** — preferred → same-tier failover → free
  replaced premium → reduced team/verification → partial answer with gaps → honest failure. Worst-wins,
  never averaged, so a gap can't hide behind healthy steps.
- 📝 **The answer carries an uncertainty note when degraded** ("produced mostly by weaker free models…",
  "explicit gaps…", "weaker cross-checking…"), and at L5 it says plainly it couldn't be answered
  trustworthily and that nothing was fabricated.
- 🎯 **Tier logic is honest:** a low-risk step that WANTED free and got free is L0, not a downgrade; only
  premium→free counts as L2.
- 🧪 **+15 pure tests, 119/119 green, tsc + eslint clean at `$0`.** Level recording + `degradation_level`
  streaming land in M6.

### Screenshots to capture (M4/M5)

No UI yet (pure logic). Capture in M6: (1) the run view's degradation-level badge (e.g. "L2 — free models
replaced premium"), (2) an answer rendering its uncertainty note, (3) a `contested` cross-check flag in the
evidence/verification panel, (4) a claim-audit view showing cited vs model-knowledge vs unsupported.

---

## Model Pool privacy guard (part of M6 privacy, shipped pure with the core) — **DONE**

`src/lib/model-pool/privacy.ts` — the brief's "light guard so obviously sensitive content is not sent to
free models". `detectSecrets` finds secret-shaped substrings (OpenRouter/Anthropic/OpenAI keys, GitHub/
Slack/Google/AWS tokens, JWTs, PEM private-key blocks, DB connection strings with passwords, Bearer
tokens, `password=`/`api_key=` assignments, Supabase secret keys) and returns **masked** matches only
(4-char prefix + length — NEVER the raw value, so a log/event built from a match cannot leak).
`guardForTier(text, tier)` → free tier + any secret = `allowed:false, action:'route-premium'` (the caller
routes to premium or refuses); premium tier is allowed but still surfaces the matches so the caller avoids
echoing them. Conservative by design (false positives route to premium, never leak). **+9 pure tests with
synthetic fixtures.** The UI privacy note ("free models may log prompts") + wiring the guard into the
free-tier call path land in M6/the server pass.

**Model Pool pure core is now COMPLETE: M1 registry · M2 select · M3 failover/circuit/limiter · M4
validate/quality · M5 degradation · privacy guard — 128/128 tests, tsc + eslint clean, all at `$0` with
zero network/model calls.** Everything side-effectful (catalog fetch, clock, transport, health persistence,
budget) is injected. The remaining work is one server-integration pass (tracked) + M6 UI + M7 fault
injection + M8 resilience benchmark, the last of which needs the **funded key** for live numbers.

---

## Server-integration pass, part 1 — ledger (D-36) + transport — **DONE at `$0`, live verify BLOCKED on the key**

Two pieces of the server pass landed, both pure/unit-tested with zero network or model calls.

### Ledger: runtime slugs priced from OpenRouter's real `usage.cost` (decision D-36, user chose option a)

`trackAiCall({ model })` now accepts `TrackedModel | (string & {})`, so a canonical OpenRouter slug (any
string with `/`, e.g. `meta-llama/llama-3.1-8b-instruct:free`) is a legal ledger subject WITHOUT a
compile-time map entry. Precedence for the stored cost (`resolveCostMicroUsd`): OpenRouter's authoritative
`usage.cost` (captured by the openai-format extractor into `providerCostMicroUsd`) → rate card by slug →
NULL. A `:free` model's real `0` is kept as `0`, never treated as absence; an unmapped short id still prices
NULL (never `$0`) and is reported once to Sentry. Touched `usage.ts`, `track.ts`, `models.ts`
(`isOpenRouterSlug`, slug pass-through, no `:batch` stacking on a variant), `pricing.ts`, `sink.ts`, and
`ai-usage.test.mts` (**+5 tests, 23/23 green**). AGENTS.md's "adding a model" rule and the
`check-ai-models.mjs` header now document the escape hatch and its deliberate out-of-scope status.
**Side effect flagged for veto:** every `provider:'openai'|'perplexity'` row now prefers real `usage.cost`
over the rate-card estimate — strictly more accurate, but it changes historical non-pool behaviour too.

### Transport: the `CallModel` seam the failover runner drives

`src/lib/model-pool/transport.ts` (PURE, **+11 tests, 139/139 model-pool green**) — `createPoolTransport`
adapts one candidate attempt into `(model) => AttemptOutcome`: runs the privacy guard (a free model asked to
carry secret-shaped content is refused WITHOUT calling it and WITHOUT penalising its health — a permanent
`bad-request` so the runner fails over to premium), catches the free-model empty-output trap (200-with-blank
≠ success), converts OpenRouter's `usage.cost` to integer micro-USD, classifies every error via `classify.ts`
(402 → insufficient-credits, 429 → rate-limit + Retry-After, context-overflow refinement, unknown fallback),
records each probe, and NEVER throws (a throw would escape the runner's per-attempt handling). The
`src/server/model-pool/transport.ts` wrapper owns the three real seams: `completeOnce` (HTTP), `trackAiCall`
(the ledger, as `provider:'openai'` so the cost-capturing extractor applies to OpenRouter's wire format), and
`registry.recordProbe` (process-wide measurements). tsc + eslint clean.

**Not yet done in the server pass (still tracked as #88):** Supabase-backed HealthStore persistence via
`onStateChange`, sizing the concurrency limiter to the free tier, calling `validateStructured` at the
evidence/Decision-Bus write boundary + `crossCheckVerdicts` in the Skeptic, recording the degradation level
on the Run + appending the `uncertaintyNote`, and swapping the agents/Decision Bus to `runWithFailover`.
**Live verification of the transport (and M8's resilience benchmark) stays BLOCKED on the `$0` OpenRouter
key (D-32)** — no live call was made; this is `$0`/unit-tested only.

## Server-integration pass, part 2 — agents swapped onto the pool + two live-run fixes

The three OpenRouter-calling agents (generating/synthesizer, critic, code) now route through
`src/server/model-pool/runner.ts` → `runWithFailover` instead of calling `completeOnce` directly, so a
premium `402` degrades to a verified `:free` model rather than failing the step. The Decision Bus (already
policy-fallbacks, flags `decided_by: policy`) and the researcher (its spend is the `perplexity/sonar` MCP
tool, not an OpenRouter completion) are deliberately NOT swapped.

Two bugs surfaced only on the LIVE runs and were fixed at the pure layer:

- **All-premium chain (fixed in `select.ts`, `guaranteeTierFallback`).** Run 40's first attempt died
  `insufficient_credits after 1 attempt` because `selectCandidates` slices premium-first ordering to 4 while
  the catalog holds dozens of premium models — an all-premium chain with no free tail, so the credit wall had
  nowhere to fall. Now, when both tiers are eligible and the chain has room for two, the final slot is
  reserved for the best candidate of whichever tier is missing. +2 regression tests.
- **Media model masquerading as a text completion (fixed in `registry.ts`, D-37, `isTextGenerationModel`).**
  Run 40 then _completed_ but the synthesizer was served by `google/lyria-3-clip-preview` (an AUDIO model,
  `output_modalities ["text","audio"]`) which returned lyric-timestamp garbage counted as success. The
  registry ingested every catalog entry with a string id and never checked output modality. Measured on the
  live catalog (466 models): 451 text-only, 11 `image+text`, 4 `audio+text`. The gate keeps only
  text-only-output models, dropping all 15 media models at ingest. +5 tests, **146/146 model-pool green**,
  tsc 0, eslint 0.

**Live green run STILL BLOCKED on the unfunded key (measured, not assumed):** after restarting the dev server
on the fixed registry, confirmation run 41 died at the researcher with `OpenRouter 402 "This account never
purchased credits"`. `GET /api/v1/credits` returns **`total_credits: 0`, `total_usage: $0.2136`**. The
researcher's web-research spend is the PAID `perplexity/sonar` tool — outside the pool failover by design
(D-20) with no free equivalent — so on a `$0` key it 402s and cascades (code failed, synthesizer skipped).
The media-model gate and the tier-fallback guarantee are proven at `$0`; the end-to-end live pass needs the
key funded (same ACTIVE BLOCKER as M8/D-32). No free web-search model exists to fail over to, so the
researcher cannot degrade on a `$0` key.

## Chat route pass — streaming pool failover + boot warm-up (D-38), VERIFIED LIVE at `$0`

The Chat workspace turn that showed _"This turn failed / Stream ended before a response arrived"_ was the
chat route's **single-model** streaming: Jev routed to one closed-label model and `chat.ts` called
`streamCompletion(model.slug,…)` with **no failover**, so the routed premium model's `402` (unfunded key)
ended the turn with nothing to fall back to. Chat now resolves an ordered candidate chain
(`resolveChatCandidates` → `selectCandidates`, Jev's routed model as `preferredSlug`) and streams candidates
in turn — each in its own `trackAiCall`, committing once a candidate emits a token, `recordProbe`-ing every
attempt, and reporting the slug that **actually answered** in `done` with a new `degraded:true` flag.

Three supporting fixes made the free-tier fallback real: **403 → `unavailable`** (app-harness gating is
failover-worthy, not a dead-end `bad-request`); a **second free slot** + **successRate centred at 0.5** in
`select.ts` (a proven-gated model now sinks below an unprobed one); and a **boot-time free-model warm-up**
(`warmFreeModelProbes`, kicked from `instrumentation.ts`) that discovers the free tier at runtime and
**verifies each with a real `$0` test call** — recording structural failures (403/404/402) so they sink, and
deliberately NOT recording transient ones (429/5xx/timeout) so a boot burst can't poison a good model. The
warm-up initially didn't help the route because dev Turbopack gives `instrumentation.ts` and the app bundle
**separate module graphs**; moving the registry singleton onto `globalThis` (one per process, shared across
bundles/HMR — the Prisma-client pattern) made the warm-up's probes the ones selection reads.

**Measured live (`$0` key):** warm-up logged `probed=20 working=14 gated=3 transient=3`; the 3 gated are
exactly `thinkingmachines/inkling-small:free`, `thinkingmachines/inkling:free`, `inclusionai/ling-3.1-flash`
(the models that broke the turn). The **first** chat after warm-up now streams real tokens and completes —
`done.model.slug = nvidia/nemotron-3-ultra-550b-a55b:free`, `degraded:true`, `cost:0` — and two consecutive
runs served `nemotron-3.5-content-safety:free` and `nemotron-3-super-120b-a12b:free`. **149/149 model-pool
green**, tsc 0, eslint 0. Chat works on the `$0` key by degrading to a verified free model; a **funded** key
is still what lets it answer on the routed premium model with no `degraded` flag (and remains the only path
to a live green AgentOS run — D-37's sonar dependency).

## Model Pool pass — MP-M6 surface the pool in the UI (D-39), code-complete + unit-verified

MP-M6 makes the pool's failover **visible** across three surfaces that all read one shared truth (the
globalThis registry singleton):

- **Dashboard "Model Pool health" panel** — a PURE builder `buildPoolHealth` (`src/lib/model-pool-health.ts`,
  4 tests) maps the live `PoolModel[]` → an honest summary (free/premium, probed, healthy, open circuits, and
  the **measured** free split `freeWorking`/`freeGated`/`freeUnprobed`; unprobed = `null`, never a fake 100%).
  Server module `src/server/api/model-pool.ts` + thin `createApiRoute` at `src/app/api/model-pool/route.ts`,
  TanStack hook `use-model-pool-health.ts` (15s refetch), panel `pool-health-panel.tsx` mounted in
  `dashboard-view.tsx`.
- **Chat `pool failover` badge** (MP-M6-B) — `telemetry.tsx` shows a warning chip when `degraded` is true.
- **AgentOS failover SSE events** (MP-M6-A) — `onEvent` threaded `PoolCallOptions` → `runWithFailover`, and the
  three OpenRouter agents forward `model_failover`/`model_unhealthy` to `ctx.emit`. The two shapes are reused
  verbatim as new `OrchestrationEvent` members; the SSE/persist/replay layers are generic so needed no change.
  The pure reducer folds them into a `poolEvents` timeline + a per-step `roster.degraded` flag, rendered as a
  conditional "Model Pool Failover" panel + `+FAILOVER` roster tag (4 new reducer tests).

**Real bug fixed on the way:** a catalog refresh past the 10-min TTL rebuilt the registry cache and **wiped
every `recordProbe` measurement** (`probed:0` on first `curl`), so the pool forgot which free models were
verified-serving and would walk back into an app-gated 403. `load()` now carries `health`+`measurements`
forward by slug and recomputes tags from fresh metadata + preserved measurements (+1 test).

**Measured live (`$0` key):** `GET /api/model-pool` → 200, `total:451 free:20 premium:431`; after a restart the
warm-up logged `probed=20 working=1 gated=3 transient=16` (the burst tripped free-tier RPM; the 16 transient
were correctly NOT recorded) and the endpoint reflected exactly that — `freeWorking:1`
(`stealth/space-bunny-alpha`), `freeGated:3` (`inkling:free`, `inkling-small:free`, `ling-3.1-flash`),
`freeUnprobed:16`. **471/471 green**, tsc 0, eslint 0, dev log free of compile errors.

**Honest gaps:** the panel/badge/timeline are auth-gated pages with no browser session available, so their
**visual render is unconfirmed** (validated by tsc/eslint/tests + the live endpoint only); a live AgentOS run
to observe real failover events end-to-end is still blocked by the unfunded key (D-37/D-38 sonar dependency).

---

## V3 Phase 0 (milestone 1) — NanoGPT provider verification — **DONE** (2026-10-08)

**Status: done.** Provider fully verified against the live API with free GETs + exactly ONE budgeted
paid call. No migration code written yet (that is milestone 2). Findings → `agentos-integration-notes.md`
§8–§9; decisions → `agentos-decisions-log.md` D-41…D-45; plan overlay → `AGENTOS_PLAN.md`.

**What I ran to verify (all real, no invented numbers):**

- `GET https://api.nano-gpt.com/v1/models` → **HTTP 200, 632 models**, unauthenticated, no pricing.
- `GET …/v1/models?detailed=true` → **632 models, all 632 with `pricing`** (numbers, USD per 1M).
- `POST …/v1/chat/completions` and `…/api/v1/chat/completions` unauth → both **HTTP 401**
  `missing_api_key` (both paths exist; OpenAI-shaped error body).
- **ONE paid streaming call** (§5.1.3), `meta-llama/llama-3.3-70b-instruct`, `max_tokens:8`:
  **HTTP 200**, content `"ok"`, `finish_reason:"stop"`, `usage{prompt_tokens:17, completion_tokens:2,
total_tokens:19}`, **no monetary cost field**, computed **$0.00000131**, wall 5527 ms (cold).
  The verify script was deleted immediately after (no lingering paid-call script).

**Verified facts that shape milestone 2:** base `https://api.nano-gpt.com/v1`; bearer-only auth
(drop `HTTP-Referer`/`X-Title`); streaming + `include_usage` work; `usage` has **no cost** → compute
from tokens × curated per-1M table; pricing is **per-1M numbers** (NOT OpenRouter per-token strings);
**0** embedding models; **0** search-capable models and **no** `perplexity/sonar`; only **2** zero-price
models (`nano-gpt-help`, `auto-model` — meta-helpers, not chat LLMs) → **no free tier**; **no**
documented balance/credits endpoint.

**Slug substitutions (D-43):** `google/gemini-2.0-flash` & `google/gemini-2.5-flash` → `gemini-2.5-flash`;
`anthropic/claude-3.5-sonnet` → `anthropic/claude-sonnet-4.5`; `deepseek/deepseek-r1` → `deepseek-r1`;
`openai/gpt-4o-mini` + `meta-llama/llama-3.3-70b-instruct` present/unchanged; complex-route "gpt" →
`openai/gpt-4.1`.

**V3 Phase 0 spend:** **$0.0000013** (the single paid call) + $0 for every GET and Jev. Against the
$10 nightly cap. This is the run's only throwaway paid call.

**Discord-ready bullets:**

- NanoGPT verified live: 632 models, free unauth catalog with `?detailed=true` per-1M USD pricing.
- Funded key confirmed working over streaming with ONE $0.0000013 call — the OpenRouter credit blocker (D-32) is dead.
- Gotcha caught: NanoGPT `usage` returns tokens but **no cost**, and prices are per-1M **numbers** not per-token strings → cost = tokens × curated table.
- No free LLM tier and no search/embedding models on NanoGPT → degradation is all-paid; research drops to no-external-search mode.
- 3 of the user's named slugs don't exist on NanoGPT; nearest verified siblings chosen + logged.

**Screenshots to capture (milestone 2+):** none for Phase 0 (no UI change). Next: chat answering via
real flagships on NanoGPT, run view, dashboard Benchmark + Spend views.

**Next:** milestone 2 — the OpenRouter → NanoGPT code migration (single client rename/repoint,
`env.ts` + `.env.example`, verified `models.ts` catalog with curated prices, Model Pool + ledger
re-priced on token×price, dashboard spend fields repointed, zero live OpenRouter paths, typecheck/
build/tests green). No paid calls in milestone 2.

---

## V3 Milestone 2 — OpenRouter → NanoGPT code migration — **DONE** (2026-10-08)

**Status: done, no paid calls.** Every live completion path now runs through the single NanoGPT
client. `src/server/ai/openrouter.ts` is **deleted**; `src/server/ai/nanogpt.ts` is the one module
that knows the base URL + bearer auth. Typecheck, lint (migration files), the migration-critical
test suites, and the production build are all green, and `check:ai-models` was verified against the
**live** NanoGPT catalog. No new spend this milestone.

### What changed (the shape of the migration)

- **One client.** `nanogpt.ts` exposes `streamCompletion` (SSE, `stream_options.include_usage`) and
  `completeOnce` (raw OpenAI-shaped body for `trackAiCall`), plus `NanoGPTError` (carries HTTP
  status). Bearer-only auth — the OpenRouter `HTTP-Referer`/`X-Title` headers are gone (§5.0 req 3).
- **Cost = tokens × curated per-1M price.** NanoGPT `usage` has NO monetary `cost`, so a single
  shared helper `costUsdFor(slug, promptTokens, completionTokens)` in `src/lib/models.ts` is the one
  source of the derived figure. The ledger's rate card is now the **static** `NANOGPT_CATALOG`
  (`rateCard()` is synchronous — no fetch, no TTL). Precedence in `resolveCostMicroUsd` is unchanged:
  a real provider cost (never sent today) → curated rate card by slug → NULL (never a fabricated 0).
- **Ledger.** `OPENROUTER_SLUGS`→`NANOGPT_SLUGS` (trimmed to the 4 slugs the repo actually calls);
  `openRouterSlug`/`isOpenRouterSlug` → a single `nanoGptSlug(model)` (the dead `serviceTier` param
  was removed — NanoGPT has no `:batch` variant). All three providers route through ONE
  `openAiExtractor` because NanoGPT normalizes the wire format; the native Anthropic/Google parsers
  were removed (they would mis-parse the normalized body). `AI_PROVIDERS` dropped `perplexity`.
- **Model Pool parser** (`src/lib/model-pool/registry.ts`) re-read for the NanoGPT catalog: `pricing`
  is per-1M **numbers** (read directly via `per1M()`, NO ×1e6), capabilities come from the boolean
  `capabilities` object (not `supported_parameters`), and `POOL_BLOCKLIST` drops the two 0/0
  meta-helpers (`nano-gpt-help`, `auto-model`). With no free tier (D-44) every pool model is
  `premium`; `isFreeModel` is price-based only and the boot free-model warm-up is now inert (it still
  warms the catalog cache).
- **Research tool → no-search grounded mode** (D-45): no `perplexity/sonar` and no search-capable
  model exist on NanoGPT, so `research-server.ts` answers from the model's own knowledge and is
  explicitly forbidden from inventing URLs/citations.
- **Privacy guard**: removed the dead `openrouter-key` / `sk-or-` kind; a NanoGPT `sk-…` key is caught
  by `generic-secret-key` (`\bsk-[A-Za-z0-9_-]{16,}`).
- **`check:ai-models`** rewritten for NanoGPT: local invariant (every mapped slug has a curated price)
  - best-effort live check against `GET /v1/models?detailed=true`; the `:batch` half was dropped.
- Comment/string sweep de-OpenRouter'd the live source; historical "migrated from OpenRouter" notes
  and decision-log contrasts (D-36/D-42/D-43/D-44/D-45) were **kept** deliberately.

### Modified / added / deleted files

- **Added:** `src/server/ai/nanogpt.ts`
- **Deleted:** `src/server/ai/openrouter.ts`
- **Ledger:** `src/server/lib/ai-usage/{models,usage,sink,track,pricing}.ts`,
  `src/server/lib/ai-usage/ai-usage.test.mts`
- **Shared config:** `src/lib/models.ts` (NANOGPT_CATALOG, `costUsdFor`, `pricePer1MFor`),
  `src/lib/env.ts`, `.env.example`
- **Pool (pure):** `src/lib/model-pool/{registry,types,transport,select,classify,limiter,backoff,failover,privacy}.ts`
  - `registry.test.mts`, `privacy.test.mts`
- **Pool (server):** `src/server/model-pool/{registry,transport,runner}.ts`
- **AI callers:** `src/server/ai/{judge,rubric-judge,jev,tracked-models}.ts`,
  `src/server/api/{chat,benchmark-stats}.ts`, `src/server/mcp/research-server.ts`,
  `src/server/agentos-benchmark/setups.ts`, `src/server/agentos/run.ts`,
  `src/server/agents/{critic,generating-agent}.ts`, `src/lib/mcp/research.ts`,
  `src/lib/agents/{code-agent-core,critic-core}.ts`, `src/lib/{benchmark,chat-stream,dashboard}.ts`,
  `src/lib/orchestra/{budget,executor,types}.ts`
- **UI strings:** `src/components/chat/telemetry.tsx`, `src/components/marketing/landing.tsx`,
  `src/components/dashboard/{dashboard-view,pool-health-panel}.tsx`
- **Scripts / CI:** `scripts/check-ai-models.mjs`, `scripts/benchmark.mjs`, `.github/workflows/ci.yml`

### What I ran to verify (all real)

- `tsc --noEmit` → **exit 0**.
- ESLint (`--max-warnings=0`) over every migration-touched file → **exit 0** (the one unused-var
  warning was fixed by removing the dead `serviceTier` param, not by suppressing it).
- Full suite `node --test scripts/*.test.mjs src/**/*.test.mts` → **504 pass / 41 fail**. The 41 are
  the **known Windows-environmental** standards-validator tests (git-hook executability, CI-gate and
  secrets-scan subprocess checks) — unchanged from the pre-migration baseline. A targeted grep for any
  migration-related failure (nanogpt/slug/cost/pool/usage/catalog/capability/free/tier) → **none**.
- Migration-critical suites in isolation → **model-pool 151 + ai-usage 20 = 172 pass / 0 fail**.
- `next build` → **exit 0** (all 24 routes compiled).
- `check:ai-models` against the **live** NanoGPT catalog → `All 4 mapped model(s) are curated AND
still listed by NanoGPT` (exit 0). Confirms `anthropic/claude-sonnet-4.5`, `openai/gpt-4.1`,
  `gemini-2.5-flash`, `openai/gpt-4.1-nano` all still exist upstream and have a curated price.
- Repo-wide grep: **zero** live `openrouter` code paths; zero references to the removed symbols
  (`OpenRouterError`, `OPENROUTER_SLUGS`, `openRouterSlug`, `isOpenRouterSlug`, `fetchRateCard`) or the
  deleted module. Remaining `openrouter` hits are historical migration comments only.

### Final client (`src/server/ai/nanogpt.ts`) — the one provider seam

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

// streamCompletion(slug, messages): AsyncGenerator<StreamEvent> — POST with
//   stream:true + stream_options.include_usage; parses SSE frames, yields token
//   events, a terminal usage event, and {type:'error',status} on a non-2xx/in-body
//   error (never throws mid-stream). [full body in the file]
// completeOnce(slug, messages, maxTokens=16): Promise<NanoGPTCompletion> — non-
//   streaming; returns the raw OpenAI-shaped body for trackAiCall's extractor;
//   throws NanoGPTError(status) on a non-2xx or in-body error.
```

### Honest limits

- No live chat/agent completion was run this milestone (that is milestone 3, which spends inside the
  caps). M2 is a code migration verified by types, units, build, and the live **catalog** GET only.
- NanoGPT's **streaming** usage carries no `usage.cost` (the non-streaming path does — corrected in
  M3, D-47 / notes §8b), so every cost figure in the product is the derived tokens × curated-price
  estimate and is labelled as such in the UI (telemetry chip, dashboard hint).
- The `limiter.ts` free-tier rate constants (20 RPM / 50-1000 RPD) are retained but **inert**: they
  are OpenRouter-era and NanoGPT has no free tier. They were left in place (not deleted) so the
  concurrency/rate guard still functions if a free tier ever appears; comments mark them legacy.

**Next:** milestone 3 — chat upgrade so Jev's {claude,gpt,gemini} decisions reach the REAL flagship
slugs, with one verified streamed answer per family (real spend, inside the caps).

---

## V3 Milestone 3 — chat upgrade to real flagship models (§5.3) — **DONE (2026-10-08)**

**Status: DONE + verified live.** Jev's `{claude, gpt, gemini}` decisions now reach the REAL funded
NanoGPT models in the existing chat, with a spec-faithful per-family degradation chain, and one real
streamed answer per family was verified against the running local server. Not committed (commit needs
explicit authorization).

**Key funding gate cleared first:** one tiny real call (`meta-llama/llama-3.3-70b-instruct`,
`max_tokens:1`, "ping") → **HTTP 200**, `usage` 11/1/12 tokens, `cost:7.8e-7 USD` → the NanoGPT key is
**FUNDED and working** (this also surfaced the D-47 correction: non-streaming usage DOES carry a cost).

**What changed (code):**

- **NEW** `src/lib/chat-model-chain.ts` — PURE `familyDegradationChain(headSlug, headDisplayName)`
  built from the curated catalog: head (Jev's pick) → cheaper same-family siblings (nearest-cheaper
  first) → `CHEAP_FLOOR_SLUG` (`meta-llama/llama-3.3-70b-instruct`). A pricier same-family model is
  never inserted (no `gemini-2.5-pro` in the `gemini-2.5-flash` chain). Decisions-log **D-46**.
- **NEW** `src/lib/chat-model-chain.test.mts` — 9 pure unit tests ($0): claude/gpt/gemini chains,
  no-upgrade rule, displayName preservation vs bare-id rungs, every rung priced (never null), floor
  last + once, floor-as-head single link, uncurated head still leads, no uncurated slug in any chain.
- `src/server/api/chat.ts` — `resolveChatCandidates` now LEADS with the family chain (no network fetch
  for the head; survives a catalog outage) and appends health-aware Model Pool candidates for
  cross-family depth, capped at `MAX_CHAT_CHAIN=6`. Stale `:free`-on-a-$0-key comments rewritten.
- `src/lib/models.ts` — corrected the `costUsdFor` doc comment for the streaming-vs-non-streaming cost
  nuance (D-47).

**Mapping recorded (§5.3 requirement, notes §10a):** on the unfunded OpenRouter key every turn degraded
to a runtime `:free` stand-in (`degraded:true`); on the funded NanoGPT key the routed model actually
answers — claude→`anthropic/claude-sonnet-4.5`, gpt→`openai/gpt-4.1`, gemini→`gemini-2.5-flash`.

**What I ran to verify (real, no invented numbers):**

- `node tsc --noEmit` → **exit 0**. `eslint --max-warnings=0` on the 3 changed files → **exit 0**.
- 9/9 `chat-model-chain` unit tests pass ($0).
- **Live per-family streamed answers** (POST `/api/chat`, funded key, notes §10c) — all HTTP 200, all
  `degraded:false`, cost = tokens × curated per-1M:
  - claude → `anthropic/claude-sonnet-4.5`, 42 stream events, 92/187 tokens, 24288 ms, **$0.003081**
  - gpt → `openai/gpt-4.1`, 149 stream events, 98/266 tokens, 41603 ms, **$0.002324** (Jev FALLBACK
    route — see honest limits)
  - gemini → `gemini-2.5-flash`, 1 stream event, 58/2 tokens, 10891 ms, **$0.0000224**
- **Total M3 spend: $0.005427** (inside the $0.50 per-run / $10 nightly caps). No throwaway calls
  beyond the single §5.1.3 key check.
- Restarted the :3000 dev server to load `NANOGPT_API_KEY` + the new modules (cleared the build-populated
  `.next` first per the known Turbopack stale-font gotcha). Boot warm-up logged `probed:0` (correct —
  NanoGPT has no free tier, D-44, so the free-probe march is inert). `GET /app 200`, `GET /api/conversations
200`, `GET /api/agentos 405` (POST-only route compiled + ran → M2 integrity confirmed; a one-off stale
  `@/server/ai/openrouter` compile error at startup did NOT recur and repo-wide grep is clean).

**Honest limits:**

- The **gpt** verification turn routed via Jev's FALLBACK to `DEFAULT_LABEL='gpt'` (`fallback:true`,
  conf 0, jev 421 ms) — Jev's free BeatAPI tier flaked on that hop. `gpt-4.1` still really answered and
  streamed 149 token events, so the §5.3 deliverable (a real streamed gpt-family answer) is met, but a
  genuine non-fallback gpt routing is a re-verify item (Jev free-tier 429s), not a blocker.
- The **degradation chain itself was not exercised live** (it only fires on a paid 402/429/5xx, which the
  funded key didn't produce, and forcing a paid failure would waste spend). It is covered by the 9 pure
  unit tests + the D-38 live failover precedent; the badge/`degraded` wiring is unchanged from MP-M6.
- Latencies (10–42 s) are real flagship generations plus, on the first turn, the cold 632-model catalog
  fetch inside `resolveChatCandidates`; later turns reuse the warm cache. Real measurements only.
- Visual render of the badge/telemetry in the browser was NOT re-captured this milestone (auth-gated page);
  the SSE contract + `done.model`/`degraded` payload were verified at the wire level.

**Files:** added `src/lib/chat-model-chain.ts` + `.test.mts`; modified `src/server/api/chat.ts`,
`src/lib/models.ts`, `docs/agentos-decisions-log.md` (D-46, D-47), `docs/agentos-integration-notes.md`
(§8b correction, new §10), `docs/agentos-status.md` (this entry).

**Discord bullets:**

- V3 M3 done: Jev's claude/gpt/gemini decisions now hit the REAL funded NanoGPT flagships in chat —
  verified one live streamed answer per family, total spend $0.0054.
- The NanoGPT key is confirmed FUNDED (one 1-token call, HTTP 200, real cost) — the thing that blocked
  every paid milestone on OpenRouter is gone.
- Added a pure, unit-tested per-family degradation chain (flagship → cheaper same-family sibling →
  cheapest paid floor) so failover follows §5.3 instead of the pool's cross-family score order.
- Honest catch: NanoGPT's NON-streaming usage does return a cost field (streaming doesn't) — corrected
  the notes; we still price everything from the curated table for consistency (flagged as reversible).
- One nuance for the demo: the gpt turn routed via Jev's free-tier fallback (default label), not a
  confident Jev decision — gpt-4.1 still answered for real.

**Screenshots to capture (demo):** the chat answering via a real flagship on NanoGPT — the model badge
showing `Claude Sonnet 4.5` / `GPT-4.1` / `Gemini 2.5 Flash` with the live cost + latency chips, and (if
a degradation can be shown) the `pool failover` marker over the cheaper model that actually answered.

**Next:** milestone 4–9 — re-verify the AgentOS engine + run view on NanoGPT (research no-search mode
behavior per D-45, the degradation-ladder rework per D-44, and `select.ts` flagship→cheap→floor ordering),
then M10 (4-setup benchmark on the funded key) and M11 (polish/README/demo/morning report).

---

## V3 Milestone 4–9 — AgentOS engine + run view re-verified on NanoGPT (§5.3/D-44/D-45) — DONE (2026-10-08)

**Goal:** confirm the multi-agent AgentOS engine (M2 had already swapped the provider client) actually runs
end-to-end on the funded NanoGPT key, and that the two V3 behavior changes are honest in a LIVE run: the
research tool's no-search grounding (D-45) and the all-paid degradation ladder (D-44, no free tier).

**What changed (code):** the migration itself was already complete at M2 — this milestone was verification
plus honesty fixes where behavior had silently drifted from the comments/labels:

- `src/server/agents/researcher.ts` — the run-view step note said `research-sonar web retrieval`, which is
  now FALSE (no sonar, no web retrieval). Changed to `knowledge-grounded research (no live web search)`
  (+ a `(follow-up)` variant). This string surfaces in the D6 run view, so it was a real honesty bug, not
  just a comment.
- Stale `perplexity/sonar` framing corrected in the header comments of `src/lib/mcp/research.ts`,
  `src/lib/agents/researcher-core.ts`, `src/server/agents/generating-agent.ts`, `src/server/agents/index.ts`,
  `src/server/agentos/run.ts`, `src/server/mcp/registry.ts` — all now describe the no-search grounded tool.
  The parser/logic was already provider-agnostic and honest (empty citations when no annotations), so NO
  functional change there.
- No change needed to `select.ts` / the pool: on a funded key there is no 402 credit wall, so the premium-only
  chain (no free tier) is correct; `guaranteeTierFallback`'s free-slot reserve is inert-by-design (D-44) and
  already documented as such.

**Verification — static (all $0):** `node tsc --noEmit` exit 0; `eslint --max-warnings=0` exit 0 on the 7
touched files; targeted pure suites (`researcher-core`, `mcp/research`, `chat-model-chain`, `model-pool/select`,
`model-pool/registry`) **74/74 pass**; full `.test.mts` suite **478/478 pass, 0 fail** (the ~41 Windows-env
standards-validator failures live outside `.test.mts` and are the known baseline, not regressions).

**Verification — ONE live AgentOS run (real spend, inside caps):** `POST /api/agentos` with a research-bearing
comparison query, SSE captured end-to-end.

- Run **id 50**, `taskType=comparison`, `tier=simple`, `executionMode=sequential`; plan = **researcher(gemini)
  → synthesizer(claude, critical)**; both agents succeeded; final answer streamed; `status=completed`.
- **No-search honesty PROVEN live:** the `research` tool returned `ok:true` with a knowledge-grounded answer
  carrying **zero citations**; the researcher wrote exactly one `evidence_added` row with **`source:null`**
  (the honest coarse record), and the 3380-char final answer contained **ZERO URLs and no fabricated
  `Sources:` section**. This is the D-45 contract holding under a real run — grounded, never invented.
- **Cost (real, from `cost_update`):** research step 5,662 µUSD (1 model + 1 tool call) → run total
  **19,447 µUSD = $0.019447** (2 model calls + 1 tool call). Well inside PER_RUN_CAP 0.50 / NIGHTLY 10.
- **Persistence + replay:** `GET /api/agentos/runs/50` → 200, `run.status=completed`, **24 events** persisted
  as `{name,data}` pairs (run/decision/plan_created/model_selected/tool_call/tool_result/evidence_added/
  cost_update/agent_finished/final/status) — the D6 replay log is intact on NanoGPT.

**Honest limits:**

- This was a `tier=simple` run, so the D4 verification gates + D5 replan loop (`gatesEnabled`) did NOT fire —
  they only trigger at hard tiers. The gate/replan path is unchanged from M6 and unit-tested, but was not
  re-exercised live this milestone (a hard-tier run costs more; deferred unless the demo needs it).
- No live failover was forced (a funded key doesn't 402, and forcing a paid failure wastes spend) — the
  all-paid degradation ladder rests on the 9 pure `chat-model-chain` tests + the select/failover suites + the
  D-38 live-failover precedent. `model_failover`/`model_unhealthy` SSE wiring is unchanged from MP-M6.
- Decision records on this run show `decidedBy:"policy"` for execution_mode (Jev policy-fallback), consistent
  with the free BeatAPI tier; the answer models were still the real routed flagships.
- Run-view VISUAL render not re-captured (auth-gated page); verified at the wire + persistence level.

**Files:** modified `src/server/agents/researcher.ts`, `src/lib/mcp/research.ts`,
`src/lib/agents/researcher-core.ts`, `src/server/agents/generating-agent.ts`, `src/server/agents/index.ts`,
`src/server/agentos/run.ts`, `src/server/mcp/registry.ts`, `docs/agentos-status.md` (this entry). `_scratch/`
deleted (held the SSE capture + run JSON, no secrets).

**Discord bullets:**

- V3 M4–9 done: the full multi-agent AgentOS engine runs end-to-end on the funded NanoGPT key — one live run
  (researcher→synthesizer) completed, persisted 24 replay events, cost $0.0194.
- No-search mode is honest under a real run: the research tool grounded an answer with zero citations, the
  evidence row is `source:null`, and the final answer invented no URLs.
- Fixed a real honesty bug: the researcher's run-view note claimed "web retrieval" that no longer happens —
  now says "knowledge-grounded research (no live web search)".
- Static green: tsc 0, eslint 0, 478/478 unit tests pass.

**Next:** milestone 10 — the 4-setup benchmark on the funded key (pilot → full within BENCHMARK_CAP_USD 15)

- the dashboard Benchmark/Spend/Model-usage views; then M11 (polish/README-real-data/demo/MORNING_REPORT).

## V3 Milestone 10 — 4-setup benchmark on the funded key + Spend/Model-usage dashboard views — **DONE (2026-10-08)**

**Goal (§15/§16):** run the SAME 24 tasks through four setups (A single flagship LLM · B +RAG · C fixed
multi-agent DAG · full AgentOS) on the funded NanoGPT key with a real rubric judge, and add three dashboard
views driven only by real persisted data — Benchmark (existed), **Spend**, and **Model usage**. Pilot-first
rule (§13): run 3 tasks × 4 setups, check actual spend, then commit to the full run.

### The benchmark (all real, all on the funded NanoGPT key)

**Pilot (run #5, 3 tasks):** completed exit 0, total **$0.143386** (≈$0.048/task). Spend checked against
BENCHMARK_CAP $15 + nightly headroom before launching the full run — the §13 pilot→check→full gate.

**Full run (run #6, 24 tasks):** generator `gemini-2.5-flash`, judge `openai/gpt-4.1`, started
2026-10-07T21:36:36Z, finished 2026-10-07T22:48:54Z (~72 min), exit 0. Persisted total
**$0.530901** = setups $0.389973 + judge $0.140928 (verified live via `/api/spend`, matches the CLI report).

Per-setup summary (measured, per-task averages):

| setup                 | success | score    | cost/task | latency | calls (model/tool) |
| --------------------- | ------- | -------- | --------- | ------- | ------------------ |
| A · single LLM        | 100.0%  | 0.87     | $0.000783 | 8421ms  | 1.0 / 0.0          |
| B · single LLM + RAG  | 100.0%  | 0.90     | $0.003550 | 22761ms | 1.0 / 1.0          |
| C · fixed multi-agent | 95.8%   | **0.92** | $0.003430 | 26720ms | 3.0 / 1.0          |
| AgentOS (D)           | 95.8%   | 0.90     | $0.008979 | 75775ms | 2.4 / 0.7          |

**Head-to-head, reported honestly (not hidden):** AgentOS was (joint-)best on **16** tasks and NEVER best on
**8**. It was **sole** best on 2 — `aos-21` (document-qa, 0.80) and `aos-22` (ambiguous, 0.95), exactly the
tasks where dynamic orchestration earns its keep. Two setups errored once each — `aos-03` setup C and `aos-08`
AgentOS D — which is why both sit at 95.8% (23/24); the failures are recorded, not dropped.

**The honest bottom line (the "quality per dollar" caveat the brief requires):** on this catalog AgentOS does
NOT win on cost (~2.5× B, ~11× A per task) or latency (slowest, ~76s/task vs A's ~8s), and it ties B on score
(0.90) while fixed multi-agent C actually scored highest (0.92). AgentOS's real, measurable edge is robustness
on ambiguous / document-qa tasks, not raw score or price. This is stated plainly rather than spun.

### Dashboard build — Spend + Model-usage views (the new half of M10)

Standard route shape (pure module → server loader → thin route → client hook → panel):

- `src/lib/spend.ts` — isomorphic pure builders (`buildSpendView`, `buildModelUsageView`, `spendFamilyOfSlug`).
- `src/server/api/spend.ts` — `getSpendAndUsage()` (`server-only`): reads `ai_usage`, `agent_runs`,
  `AgentosBenchmarkRun` (**`startedAt`**, no `createdAt`), grouped benchmark results, `route_events`, and
  `nightlySpendMicroUsd()`; maps BigInt→number micro.
- `src/app/api/spend/route.ts` — `createApiRoute({ input: z.object({}) })`, nodejs, force-dynamic, no
  `authorize` (matches `/api/dashboard`, `/api/model-pool`).
- `src/components/dashboard/use-spend.ts` — module-level fetcher + `useSpendAndUsage()` (15s refetch).
- `spend-panel.tsx`, `model-usage-panel.tsx`, and shared `meter-bar.tsx`; mounted in `dashboard-view.tsx`
  (new `aria-label="Spend and model usage"` section) and both benchmark/agent panels invalidate `SPEND_QUERY_KEY`.

**Honesty rules the view enforces (never an estimate, never a made-up number):**

- Total = sum of **priced** `ai_usage` rows only; NULL cost is skipped, never treated as 0.
- Unpriced rows/tokens are surfaced and marked **"unknown"** (live: 631 priced / 52 unpriced rows, 18,682
  unpriced tokens shown as unknown).
- Balance is `{ verifiable:false, note:"NanoGPT exposes no verified balance endpoint, so remaining credit is
unknown — not guessed." }` — never fabricated.
- `agent_runs` and benchmark costs are **labelled subsets**, never added on top of the ledger total.
- Cap utilization is real: per_run = largest single AgentOS run; nightly = AgentRun spend since UTC midnight
  (the enforced figure); benchmark = largest benchmark run (setups + judge).

**Live-verified figures (real, from `/api/spend`):** total **$0.965391**; per-family claude $0.248007/59,
gpt $0.543772/340, gemini $0.139512/168, other $0.034100/116 — sums to exactly the total. Caps: per_run
$0.065939/$0.50 (13.2%), nightly $0.349258/$10.00 (3.5%), benchmark $0.530901/$15.00 (3.5%). Model usage:
**683** provider calls; chat routing 27 turns, gpt 12 / gemini 10 / claude 5, **7 Jev fallbacks (25.9%)**.

### The heartbeat fix (root cause of the earlier pilot socket-termination)

The first pilot died at task 3 with `TypeError: terminated`: undici's default `bodyTimeout` is **300s**, and
the engine only emitted `progress` after a WHOLE task (4 setups + judge), so a slow task's SSE silence exceeded
300s and the socket was aborted. Fixed by emitting a `heartbeat` SSE event **before each setup** (max silence
now ≈ one setup, ~110s). Added `AgentosBenchmarkHeartbeatEvent` to `wire.ts`, the `emit(...)` in `engine.ts`,
and the `case 'heartbeat'` print in `scripts/agentos-benchmark.mjs`. Validated by a clean exit-0 pilot re-run
(#5) and the full run (#6) completing exit 0.

**Verification:** `node tsc --noEmit` exit 0; eslint clean on all touched files; full `.test.mts` suite
**491/491 pass** (478 + 13 new `src/lib/spend.test.mts` tests: family lookup/inference/collapse, total sums +
NULL-skip, no double-count, per-family shares, over-time day buckets, cap utilization, balance-unknown, model
usage counts, byFeature, chat routing/fallback rate, empty-ledger no-NaN). Browser render confirmed via
structural `take_snapshot` (screenshot unavailable — hidden viewport): both panels paint with the live figures
above.

**Honest limits:**

- Benchmark `cites` = 0 and `verif` ≈ 0 across ALL setups: NanoGPT has no search/embeddings (D-45), so RAG /
  research grounding yields no real citations — the column is honestly 0, never faked.
- One judge model (`gpt-4.1`); scores are that judge's rubric opinion, not ground truth.
- Two setup failures (`aos-03` C, `aos-08` D) are kept as errors (95.8% success), not silently dropped.
- Dashboard not re-captured as an image (hidden viewport); verified at the structural-snapshot + live-API level.

**Files:** created `src/lib/spend.ts`, `src/lib/spend.test.mts`, `src/server/api/spend.ts`,
`src/app/api/spend/route.ts`, `src/components/dashboard/{use-spend.ts,meter-bar.tsx,spend-panel.tsx,
model-usage-panel.tsx}`; modified `src/lib/agentos-benchmark/wire.ts`, `src/server/agentos-benchmark/engine.ts`,
`scripts/agentos-benchmark.mjs`, `src/components/dashboard/{dashboard-view.tsx,agentos-benchmark-panel.tsx}`,
`docs/agentos-status.md`. Temporary `src/app/[locale]/auth/spend-preview/page.tsx` created for the browser
render check then **deleted**; `_scratch_bench_pilot.log` / `_scratch_bench_full.log` **deleted**.

**Discord bullets:**

- V3 M10 done: the full 24-task × 4-setup benchmark on the funded NanoGPT key + new Spend & Model-usage
  dashboard views, every number from real persisted data.
- Honest result: AgentOS ties on quality (0.90) but is the slowest (~~76s/task) and priciest (~~$0.009/task);
  fixed multi-agent C scored highest (0.92), single LLM A is cheapest. AgentOS's real edge = robustness on
  ambiguous/document-qa (sole-best on 2 tasks). Total benchmark spend **$0.53**, well under the $15 cap.
- New Spend view: real cumulative **$0.965**, per-family + per-run + benchmark costs, cap utilization, and an
  honestly "unknown" balance (no verified NanoGPT endpoint). Model-usage view: 683 calls, per-model/family/
  feature, chat routing + a 25.9% Jev-fallback rate.
- Fixed the SSE socket-termination root cause (undici 300s bodyTimeout) with per-setup heartbeats.
- Static green: tsc 0, eslint 0, 491/491 unit tests.

**Next:** milestone 11 — polish, README with real data (~16 lingering OpenRouter references to correct),
demo script, and `docs/MORNING_REPORT.md` (tonight's total spend, per-family breakdown, benchmark cost,
verification-call cost, decisions digest, Discord bullets, screenshots).

# AgentOS — 3-minute live demo script

Everything below is **real, measured, and replayable** — no scripted or hard-coded
moments. The centrepiece is **run #81**, a genuine `hard`-tier AgentOS run captured on the
funded NanoGPT key on 2026-10-08, where the evidence-sufficiency gate fired, the orchestrator
replanned across models, and the verified second pass produced a better answer.

## Before you start (setup)

1. `pnpm dev` → app on **http://localhost:3000** (real remote Supabase DB; localhost only).
2. Sign in at `/login` with the demo account.
3. Confirm the demo run is persisted: `GET /api/agentos/runs/81` → `status:"completed"`,
   `tier:"hard"`, `taskType:"comparison"`, `replans:1`, `costMicroUsd:62626` (**$0.062626**),
   `modelCalls:6`, `toolCalls:2`, `hasFinalAnswer:true`.
4. Have `/dashboard` loaded in a second tab (Benchmark + Spend + Model-usage views).

> **Run #81 query (verbatim):** "Should a mid-size e-commerce company migrate its product
> search from Elasticsearch to a vector-database hybrid retrieval stack in 2026? Quantify the
> latency, monthly cost, and recall/precision trade-offs, explicitly weigh the contradictory
> vendor-published benchmarks, and give a defensible recommendation with stated uncertainty and
> the conditions that would reverse it."

---

## 0:00 – 0:35 · Chat — Jev routes to a real flagship

- Open **`/app`**, send any question.
- **Say:** "A decision model called **Jev** classifies this turn and routes it to one of three
  real flagship families on NanoGPT — Claude, GPT, or Gemini. Jev never writes the answer; it
  only decides."
- **Point at** the telemetry chip as the answer streams: the **routed model that actually
  answered**, latency, token count, and **real cost** (computed from tokens × the curated
  per-1M price). If a model failed mid-turn, a `pool failover` / `degraded` badge names the
  paid model that took over.
- **Honest note:** "NanoGPT has no free tier, so degradation falls to the cheapest _paid_
  model, not a free one — and the cost you see is real, never an estimate."

## 0:35 – 1:15 · AgentOS run view — the team Jev assembled

- Open **`/agentos`**, pick **run #81** from the replay picker (or re-run the query live).
- **Decision Bus checklist** (real `decision` events): `complexity → hard`,
  `task_type → comparison`, `required_agents → [researcher, code, critic, synthesizer]`.
- **Say:** "Jev read the query, judged it **hard**, classified it a **comparison**, and chose a
  task-specific team — and it routed a **different model to each agent**, all from the live
  NanoGPT catalogue."
- **Point at the per-agent model badges** (real `model_selected` / `agent_started` events):
  - `researcher → gemini`
  - `code → gpt`
  - `critic → claude`
  - `synthesizer → claude`
- **Say:** "That's genuine **cross-model** work — Gemini researches, GPT handles the
  quantitative/code pass, Claude critiques and synthesizes."

## 1:15 – 2:10 · THE DEMO MOMENT — gate fires NO, orchestrator replans, answer gets better

This is the part that emerges from real logic, never a script. Walk the timeline events in order:

1. **First pass runs.** `researcher(gemini)` + `code(gpt)` execute in parallel; the research
   tool returns a **knowledge-grounded answer with zero citations** (NanoGPT has no search
   endpoint — D-45). `critic(claude)` challenges the findings; `synthesizer(claude)` drafts an
   answer.
2. **The D4 sufficiency gate fires NO.** Point at the real `evidence_verified` event:
   `status:"unverified"`, `evidenceId:"207"`. **Say:** "Jev's evidence-sufficiency gate looked at
   what came back and judged it **not good enough** — the contradictory vendor benchmarks weren't
   adequately resolved."
3. **D5 replan.** Point at the real `replan` event:
   `reason:"evidence_insufficient: Jev gate 1 asked for more research (replan 1)."`,
   `addedSteps:["researcher_r1","synthesizer_r1"]`. **Say:** "Instead of shipping a weak answer,
   the orchestrator **replanned** — it spun up a **second research pass** and a **second
   synthesis**, and routed them again (`researcher_r1 → gemini`, `synthesizer_r1 → claude`)."
4. **Verified, better final answer.** The second `tool_call` runs, evidence is re-checked, and
   `synthesizer_r1(claude)` produces the **final 3,254-character answer** with stated uncertainty
   and reversal conditions. `status:"completed"`, **1 replan**, **6 model calls**, **2 tool
   calls**, total **$0.062626** — inside the $0.50 per-run cap.

- **Say:** "Detect-weak-evidence → replan → re-verify → better answer. That loop is the whole
  thesis: an OS that supervises its own agents, not a single shot."

> **Live alternative:** re-run the same query from `/agentos` and let the gate/replan happen on
> stage. It is real logic — but it costs another ~$0.06 and ~3–4 min, so the persisted replay of
> #81 is the safe centrepiece; keep the live run as a backup.

## 2:10 – 2:40 · Dashboard — Benchmark view (real four-setup results)

- Open **`/dashboard`**, scroll to the **AgentOS benchmark** panel (run #6, full 24 tasks).
- **Read the real table** (per-task averages, funded NanoGPT key):

  | setup                 | success | score    | cost/task     | latency    |
  | --------------------- | ------- | -------- | ------------- | ---------- |
  | A · single LLM        | 100%    | 0.87     | $0.000783     | 8.4 s      |
  | B · single LLM + RAG  | 100%    | 0.90     | $0.003550     | 22.8 s     |
  | C · fixed multi-agent | 95.8%   | **0.92** | $0.003430     | 26.7 s     |
  | D · full AgentOS      | 95.8%   | 0.90     | **$0.008979** | **75.8 s** |

- **Be honest out loud (this is the credibility move):** "AgentOS is the **priciest and slowest**
  setup and does **not** top the score — the fixed DAG scored highest at 0.92. AgentOS was
  joint-best on 16 of 24 tasks and **sole-best on 2** — a document-qa and an ambiguous task. Its
  edge is **robustness on hard, ambiguous tasks**, not price or speed. Total benchmark spend was
  **$0.53**, 3.5% of the $15 cap."

## 2:40 – 3:00 · Dashboard — Spend + Model-usage views (real money, real calls)

- **Spend view:** real cumulative spend from the funded key, **per-family breakdown**
  (Claude / GPT / Gemini / other), per-run + benchmark costs, spend-over-time, and **cap
  utilization** against PER_RUN / NIGHTLY / BENCHMARK. The **balance is shown as "unknown"** —
  NanoGPT exposes no verified balance endpoint, so it is never guessed. Unpriced calls show their
  **token counts** with USD marked **unknown**, never a fabricated number.
- **Model-usage view:** which models **actually answered** — per-model / per-family /
  per-feature call counts, plus **chat routing** (turns, per-label split, and the **Jev
  fallback rate** when the free router 429s).
- **Close:** "Every number on this dashboard is measured and persisted — cost, latency, calls,
  replans. Nothing is an estimate."

---

## Replay / verification commands

```bash
# The demo run (persisted, replayable through the same D6 renderer):
curl -s http://localhost:3000/api/agentos/runs/81 | jq '.run | {id,tier,taskType,status,replans,costMicroUsd,modelCalls,toolCalls}'

# The full four-setup benchmark report + spend:
curl -s http://localhost:3000/api/agentos-benchmark/runs/6
curl -s http://localhost:3000/api/spend | jq '.spend | {totalCostMicroUsd, perFamily, caps}'
```

## Honest caveats to keep visible

- **No live web search** (D-45): research is knowledge-grounded with **zero citations**; the
  benchmark `cites` column is a real 0, not a bug.
- **Cost is computed**, not provider-reported: NanoGPT streaming `usage` carries tokens but no
  monetary `cost`, so USD = tokens × a curated per-1M price; unpublished prices → **unknown**.
- **One judge model** (`gpt-4.1`): benchmark scores are that judge's rubric opinion, not ground
  truth.
- **Jev runs on BeatAPI's free tier** and 429s under load; when it does, routing falls back to
  policy (the `fallback` flag and the dashboard fallback-rate show this honestly).

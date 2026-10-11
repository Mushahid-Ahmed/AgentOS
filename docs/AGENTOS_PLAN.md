# AgentOS — Upgrade Plan (one page, Phase 0)

Jev-Swarm → **AgentOS**: an in-repo multi-agent orchestration engine where **Jev** makes
every bounded decision (planning + the two D4 verification gates), a dynamic per-query
agent team executes on OpenRouter models through real MCP tools, all output lands in a
shared structured **evidence hub**, a **skeptic** hunts contradictions, and the run is
streamed live to a D6 terminal UI. **Extend, don't rewrite.** Localhost only; Supabase
already provisioned. Spend caps enforced in code (§12). All verified findings →
`agentos-integration-notes.md`; all autonomous decisions → `agentos-decisions-log.md`.

## Architecture mapped to the target design (D1–D6)

| Box | Build in | Reuse | Status |
|---|---|---|---|
| D1 USER entry → Jev planner → dynamic team | `lib/orchestra/`, `lib/agents/` | `/api/chat` route + `chat-workspace.tsx` (Baseline A / "simple" tier) | foundation exists |
| D2 Evidence RAG hub (read+write by research/workers/critics) | `lib/evidence/` + `agentos.prisma` | Prisma conventions, `db` singleton | missing |
| D3 Orchestra → MCP tools (Research, calculator; repo/browser stretch) | `lib/mcp/` | `openrouter.ts` (sonar research), `models.ts` | missing |
| D4 Two Jev gates (enough-evidence / evidence-valid) | `lib/decisions/` | `jev.ts` backoff; Jev multi-question capability **VERIFIED** (§1a) | missing |
| D5 Dynamic team + replan (delta may spawn new agents) | `lib/orchestra/` plan-delta | — | missing |
| D6 Run-view terminal UI + replay | `app/[locale]/agentos/` | M6 design system (tokens/theme/motion/ui), SSE pattern | missing |

New module roots (§5): `lib/orchestra/`, `lib/decisions/`, `lib/agents/`, `lib/mcp/`,
`lib/evidence/`. Extend `lib/models.ts`; add `prisma/schema/agentos.prisma`.

## Data model — `prisma/schema/agentos.prisma` (pure CREATE, auto-gen migration)

Match existing conventions: BigInt autoincrement ids, `@db.Timestamptz(3)`, snake_case
`@map`/`@@map`, money as integer millionths `cost_micro_usd BigInt?` (NULL, never 0).

- **AgentRun** — id, query, status (`planning|running|verifying|replanning|finalizing|completed|failed|budget_stopped`), tier, plan (Json DAG), cost_micro_usd, model_calls, tool_calls, replans, started/finished_at, final_answer.
- **AgentStep** — id, runId, agent, model, tools_allowed (Json), depends_on (Json), status (`pending|running|succeeded|failed|skipped`), tokens, cost_micro_usd, started/finished_at, output_summary.
- **DecisionRecord** — id, runId, kind (task_type/complexity/required_agents/model_selection/evidence_sufficiency/contradiction/evidence_validity/finalization…), input_summary, output (Json), `decided_by` (`jev|policy`), confidence, latency_ms, rationale.
- **EvidenceRecord** — id, runId, claim, source, retrieved_text, discovered_by_agent, verification_status (`unverified|verified|contested|refuted`), relation (`supports|contradicts`), evidence_id ref.
- **AgentEvent** — id, runId, seq, type (decision/plan_created/agent_started/…/final), payload (Json), at. Persisted for replay (§13).

## Milestones (§15, strict order, app runnable after each)

1. **Phase 0** — discovery, capability checks, plan. ← this doc + notes + status.
2. **Orchestra core** — Run state, DAG validate, parallel/sequential executor, retries, budget guard, event emitter. **MOCKED agents + unit tests** before any real model.
3. **Decision Bus + dynamic team + per-agent routing** — simplest path e2e with SSE. Generalize `jev.ts` → `askJev(state, questions)`; decisions logged.
4. **Multi-agent execution + first MCP tool** — calculator (keyless). Real models wired.
5. **Evidence hub + 2nd MCP tool (research-sonar) + Skeptic/Fact-Checker.**
6. **Jev D4 gates + replan loop (D5) + escalation tiers + budget limits.**
7. **Run-view UI (D6) + replay** from persisted events.
8. **Benchmark** — `benchmarks/agentos-tasks.json` (20–30), 4 setups (A single-LLM · B +RAG · C fixed multi-agent · AgentOS), LLM-judge scoring, dashboard. Pilot 3×4 first (§12).
9. **Polish, hardening, tests, README, demo script** + `docs/MORNING_REPORT.md`.

## Scope cuts — MVP vs stretch

**MVP (build):** Orchestra engine; Decision Bus with real Jev gates (policy fallback when
throttled); dynamic teams for the 5 tested shapes; calculator + research-sonar MCP tools;
**structured** evidence hub (no vectors — 0 embedding models on OpenRouter, §2); D4 gates;
replan (max 2); 4 escalation tiers; budget caps; D6 UI + replay; 4-setup benchmark.

**Stretch (cut unless time+budget allow):** embeddings/pgvector vector search (Postgres FTS
is the documented fallback); repo-over-local-git MCP; Browser MCP; Vision agent; score-type
complexity (MVP uses verified `choice` tier; numeric 0.87-style score is a cheap M3 add once
an anchor array is passed).

**Hard invariants:** never push / touch shared state; no new keys or paid accounts; never
exceed §12 caps; never fabricate data/numbers/citations/tool output; never claim unrun work;
never silently crash or overspend. Keys server-side only; `.env.example` placeholders only.

---

## V3 overlay — provider migration + funded model tier (2026-10-08)

`AGENTOS_FINAL_PROMPT_V3.md` adds THREE workstreams on top of the AgentOS build above. The
engine (D1–D6, milestones 2–9 of the original plan) is **already built**; V3 re-points it at a
new provider and a **funded** model tier. User confirmed: **Full V3 (M2→M11)** · **curated USD
price table** · **verified nearest-sibling slugs**. Verified facts → `agentos-integration-notes.md`
§8; decisions → `agentos-decisions-log.md` D-41…D-45.

- **Workstream 0 — provider migration (V3 milestone 2, blocks all paid work):** OpenRouter →
  **NanoGPT** everywhere. One shared client at `https://api.nano-gpt.com/v1`, `NANOGPT_API_KEY`,
  headers `Authorization`+`Content-Type` only (drop `HTTP-Referer`/`X-Title`). Repo-wide
  case-insensitive `openrouter` grep → **zero live code/config hits** after migration.
- **Workstream A — funded chat (V3 milestone 3):** Jev's `{claude,gpt,gemini}` decisions route to
  **real flagships** — `anthropic/claude-sonnet-4.5` (3/15), `openai/gpt-4.1` (2/8),
  `gemini-2.5-flash` (0.3/2.5, no `google/` prefix on NanoGPT) — not free stand-ins. Per-family
  degradation = flagship → cheaper **paid** sibling → `meta-llama/llama-3.3-70b-instruct`
  (0.05/0.23); **no free rung exists** on NanoGPT (D-44). Badge shows what actually answered.
- **Cost model (D-42):** NanoGPT `usage` has token counts but **no monetary cost** → cost =
  `tokens × curated per-1M price / 1e6`, integer micro-USD, enforced against the §13 caps before
  every paid call. No live balance endpoint `[UNKNOWN]`, so the code caps are the ceiling.
- **Workstream B — AgentOS on the paid catalog (V3 milestones 4–10):** re-verify Orchestra /
  Decision Bus / multi-agent+MCP / RAG / D4 gates+replan / D6 run view on NanoGPT; per-agent model
  policy from the catalog (§5.4); cross-family judge. **Research MCP loses `perplexity/sonar`**
  (absent on NanoGPT) → no-external-search mode (D-45). Then the 4-setup benchmark on the funded
  key (pilot 3×4 → full, inside `BENCHMARK_CAP_USD`) + dashboard Benchmark/Spend/Model-usage views.
- **No embeddings** on NanoGPT (0 of 632) → evidence hub stays **structured** (Prisma), no vectors.
- **Spend discipline:** exactly ONE throwaway paid call for the whole run — **done in Phase 0**
  ($0.0000013, notes §9). Every later paid call is real feature work inside the caps.

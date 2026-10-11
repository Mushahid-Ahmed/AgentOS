# BLOCKED — ACTIVE 2026-10-01 (AgentOS M8 full benchmark: OpenRouter credits exhausted)

**Status: ACTIVE hard blocker for the FULL four-setup benchmark run only.**

The M8 four-setup benchmark **implementation is complete and verified end-to-end** (see
`docs/agentos-status.md` → Milestone 8). What is blocked is producing a *complete, statistically
meaningful* result set, because the OpenRouter account has run out of credits again.

## Evidence (real, measured this session)

- `GET https://openrouter.ai/api/v1/credits` → `{"total_credits":0,"total_usage":0.1810982}`.
- The 3-task PILOT (run #1, `M8 pilot 3x4`) ran and cost only **$0.082** of real spend, well under
  the $15 `BENCHMARK_CAP_USD`. But partway through, paid calls began returning:
  `OpenRouter 402: "This request would exceed your available credits given your current in-flight
  requests. Retry after in-flight requests settle, or add credits."`
- Result rows (honest, persisted — never dropped or fabricated):
  - `aos-01` — all four setups succeeded (ran on residual free-tier headroom), fully judged.
  - `aos-02` — all four setups failed with `402` (baseline_a/b directly; baseline_c/agentos as
    `critical_step_failed` because their researcher step hit the 402).
  - `aos-03` — baseline_a/b succeeded; baseline_c/agentos failed `critical_step_failed` (402 on a
    required step).

So the engine, judge, persistence, SSE stream, CLI, GET endpoints and dashboard panel all work; the
account simply cannot sustain the paid calls (gpt-4.1 judge, research-sonar retrieval, gemini beyond
free headroom) that a full 24×4 run needs.

## Why I stopped instead of continuing (AGENTOS_UPGRADE_PROMPT §7, §8, §12)

- §12 requires a **pilot-first** spend check. The pilot surfaced a credit blocker, so the disciplined
  action is to stop rather than hammer a $0 account and produce a full run of mostly-`402` rows
  (which would look like a broken pipeline and waste the free headroom).
- §8 NEVER: I may not "create cloud projects, accounts, or **paid resources**" — adding OpenRouter
  credits is a paid resource, so I cannot resolve this autonomously.
- §8 NEVER: I may not "fabricate data … or claim something works that you did not actually run." A
  full-run comparison table cannot be honestly produced without credits, so I will not invent one.
- Standing user constraint: "If … a label other than claude/gpt/gemini comes back, **stop and tell
  me**" and the no-fabrication rule — a 402 credit wall is exactly a stop-and-tell condition.

## Resolution required (human)

Fund the OpenRouter key in `.env.local` (`OPENROUTER_API_KEY`) with enough credit for a full run.
Measured pilot cost was ~$0.027/task across all four setups + judge; a full 24-task run is therefore
roughly **$0.65–$0.70** of real spend (far below the $15 cap). Once funded, re-run:

```
pnpm benchmark:agentos -- --full --label "M8 full 24x4"
```

or click **Run full (24)** in the dashboard's AgentOS benchmark panel. The run will persist as a new
row and chart automatically; no code change is needed.

## Remaining human item (not a blocker)

Rotate the Supabase password (pasted in chat in an earlier session; persists in a local transcript
outside the repo). No commits are made unless explicitly asked.

---

### Historical (resolved) — was: AgentOS M6 live e2e, OpenRouter credits (D-28)

The first hard blocker of the AgentOS build was an exhausted OpenRouter balance: live run 15's
synthesizer (Claude, `max_tokens` 1024) was refused with `OpenRouter 402: … can only afford 758`.
The human funded the key on 2026-10-01 and M6 run 16 then completed the full chain end-to-end
(gates + replan proven; see decisions D-28…D-30). That same balance has now been exhausted again,
which is the active M8 blocker described above.

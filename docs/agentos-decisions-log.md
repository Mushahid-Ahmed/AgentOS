# AgentOS — Autonomous decisions log

Every decision made without a human tonight (§7 protocol). Format: **Q / Options /
Chosen / Why / Risk / How to reverse.** Bounded by §8 (permissions) and §12 (spend caps) —
an option violating those is never selectable.

---

### D-01 — Execute in-repo vs generate artifacts only
- **Q:** The attached `AGENTOS_UPGRADE_PROMPT.md` arrived with no free text; project memory
  records a same-day "do not start working" interrupt on this brief. Build in the repo, or
  only produce artifacts?
- **Options:** (a) artifact-only; (b) ask; (c) execute full-auto in-repo.
- **Chosen:** (c) — surfaced the conflict, user explicitly picked **"Execute in this repo"**
  + **"Full auto (matches prompt)"**.
- **Why:** Direct user override of the attachment-is-source-not-task default for AgentOS.
- **Risk:** Overriding a recent "stop" — mitigated by the explicit re-confirmation.
- **Reverse:** Stop; the work is additive (new `lib/*`, new prisma file, new docs); M6
  already committed at 9ee79b5, nothing pushed.

### D-02 — Jev as the Decision Bus engine (not just policy)
- **Q:** Can Jev return arbitrary bounded decisions over custom label sets + the D4 gates,
  or must decisions be rule-based `decided_by: policy`? (§6 critical risk)
- **Options:** (a) policy-only; (b) Jev with policy fallback.
- **Chosen:** (b). **VERIFIED** (§1a): one call, four custom-criteria `choice` questions →
  HTTP 200 / 558ms, incl. `enough_evidence → insufficient` @0.95 (the live D4 gate-1 signal).
- **Why:** Jev genuinely supports custom criteria + batched questions; state billed once.
- **Risk:** Free-tier throttle (429 after ~6 rapid calls) → mitigated by batching plan-time
  decisions into ONE call and reusing `routeQueryMeasured`'s backoff; on exhaustion the Bus
  records `decided_by: policy` and continues (never crash).
- **Reverse:** Flip every gate to the deterministic policy path (already the fallback).

### D-03 — Evidence hub: structured store, no vectors
- **Q:** Embedding/vector RAG vs structured evidence? (§6 embeddings priority)
- **Options:** (a) OpenRouter embeddings; (b) Postgres FTS; (c) structured Prisma hub;
  (d) pgvector.
- **Chosen:** (c) for MVP. **VERIFIED** 0 embedding-capable models on OpenRouter (§2), so
  priority (1) is unavailable. (b) FTS is the documented lexical-recall fallback; (d)
  pgvector deferred (needs raw SQL, against `docs/rules/database.md`).
- **Why:** Structured claims/sources/verification_status/relations satisfy D2 + §13 with
  zero new deps and no fabricated similarity.
- **Risk:** No semantic recall — acceptable; evidence is queried by run_id and relation.
- **Reverse:** Add FTS index or pgvector later behind the same `lib/evidence/` interface.

### D-04 — Research backend: Perplexity Sonar via existing OpenRouter key
- **Q:** Web-search backend for the Research MCP? (§6 search priority)
- **Options:** (a) OpenRouter search-capable model; (b) keyless open endpoint; (c) no-search
  mode.
- **Chosen:** (a). **VERIFIED** 5 search-capable models, all Perplexity Sonar (§3) → zero
  new keys. Register the chosen sonar slug in `OPENROUTER_SLUGS` and make ONE real search
  call in M4/M5 to confirm results + web-cost before relying on it (`[ASSUMPTION]` until then).
- **Why:** Highest-priority option that verifies with the existing key.
- **Risk:** Web/search cost + result quality unproven until the first real call; capped by
  §12 budget guard and `max_tokens`.
- **Reverse:** Fall back to (c) documented no-external-search mode.

### D-05 — MCP tools: calculator (keyless) + research-sonar for MVP
- **Q:** Which MCP tools to build first? (§13 MVP minimum = two)
- **Options:** calculator, research-sonar, repo-over-local-git, browser.
- **Chosen:** calculator (pure code, keyless) + research-sonar (per D-04). repo/browser = stretch.
- **Why:** The two zero-new-key tools the spec ranks first; both have a real job.
- **Risk:** MCP SDK transport/API not yet read from `node_modules` (`[ASSUMPTION]`) — read
  installed types before first use in M4.
- **Reverse:** Drop to one tool; the Orchestra treats tools as optional per step.

### D-06 — Complexity: verified `choice` tier for MVP, numeric score deferred
- **Q:** D6 shows "Complexity 0.87". Use Jev `score` or `choice`?
- **Options:** (a) `score`; (b) `choice` tier; (c) both.
- **Chosen:** (b) for MVP. **VERIFIED**: bare `score` → HTTP 400 ("criteria must be a
  non-empty array… lowest first"); the `choice` complexity_tier works (medium @0.64).
- **Why:** `score` needs an ascending anchor array I haven't validated; `choice` is proven.
- **Risk:** D6's exact "0.87" needs the numeric score — cheap M3 add once an anchor array
  is passed and verified.
- **Reverse:** Add a `score` question with a verified criteria array; keep the `choice` tier.

### D-07 — Spend caps wired through `src/lib/env.ts` + budget guard
- **Q:** Where do §12 caps live and get enforced?
- **Options:** hardcode; env-only; env + in-code guard.
- **Chosen:** env vars (`PER_RUN_CAP_USD=0.50`, `NIGHTLY_SPEND_CAP_USD=10`,
  `BENCHMARK_CAP_USD=15`) in `env.ts` + `.env.example` (placeholders only), enforced by the
  Orchestra budget guard **before every model/tool call**; benchmark runs a 3×4 pilot first.
- **Why:** §8/§12 are non-negotiable; guard must be in code, not convention.
- **Risk:** None to correctness; on cap hit → `budget_stopped` + best honest partial answer.
- **Reverse:** N/A (safety bound).

### D-08 — Migration via `scripts/generate-migration.mjs` with `--db-url "$DIRECT_URL"`
- **Q:** How to create the `agentos.prisma` tables?
- **Options:** hand-write SQL; `prisma migrate dev`; the repo generator script.
- **Chosen:** generator script, `--db-url "$DIRECT_URL"` (5432, not the 6543 pooler). New
  tables are pure CREATE → no destructive pattern → auto-gen applies, then `migrate deploy`.
- **Why:** Repo rule: never hand-write, never `migrate dev`; deploy holds an advisory lock
  the pooler can't sustain.
- **Risk:** Low — additive schema.
- **Reverse:** Drop the migration dir + tables (no data depends on them yet).

### D-09 — Honest jev|policy labeling of the *aggregate* plan records
- **Q:** One Jev batch answers `task_type`/`complexity`/`needs_*`/`best_model`, but the team and
  the full per-agent model map are **assembled** from those answers plus role defaults. Label the
  resulting `required_agents` / `model_selection` records `jev` or `policy`? (§6: never label a
  rule-based decision as the model's.)
- **Options:** (a) always `jev` (it started from Jev); (b) always `policy` (a rule assembled it);
  (c) `jev` only when the underlying answers were in-vocab, with a rationale naming the policy parts.
- **Chosen:** (c). `required_agents`/`model_selection` are `jev` only when Jev's answers parsed
  in-vocabulary; the record's `rationale` states exactly which parts are Jev's vs role defaults
  (e.g. *"Jev best_model=gpt routes the lead; non-lead agents use role defaults"*).
  `execution_mode` is **always `policy`** (a rule: >1 worker → parallel). `[VERIFIED in DB: runs 1/2/8]`
- **Why:** §6 forbids over-claiming Jev; the aggregate genuinely mixes both, so the label + rationale
  must disclose the mix rather than pick a flattering side.
- **Risk:** A reader could still over-read `jev` on an aggregate → mitigated by the rationale text.
- **Reverse:** Split each aggregate into finer-grained per-sub-decision records.

### D-10 — M3 registers only `answerer` + `synthesizer`; other roles **deferred**
- **Q:** Jev can select 5 roles (answerer/researcher/code/critic/synthesizer). Implement all now?
- **Options:** (a) build every agent in M3; (b) register the lead + lone-answer path now, defer the
  rest; (c) reject teams containing unbuilt roles.
- **Chosen:** (b). `AGENT_REGISTRY = {answerer, synthesizer}` for M3. `buildAgentPlan` reports any
  Jev-selected-but-unregistered role in a `deferred` array, the SSE `run` event **discloses** it, and
  the lead answers alone. `researcher`+`code` land in M4, `critic`/evidence in M5. `[VERIFIED: run 2
  deferred researcher, run 8 deferred code — both still completed honestly]`
- **Why:** M3's scope is the decision + routing + SSE spine; deferring degrades **honestly** instead
  of failing plan validation or silently dropping a teammate.
- **Risk:** A research/data run answers with one model, not a real team → acceptable for M3 and
  disclosed in the event stream.
- **Reverse:** Register each role as it's built (M4 code+calculator, M5 researcher+evidence).

### D-11 — D4 gate policy defaults = **proceed** (fail-open)
- **Q:** On a Jev outage/invalid answer, what should the four D4 gates (evidence sufficiency,
  evidence validity, contradiction, finalization) default to?
- **Options:** (a) halt/fail the run; (b) default every gate to "proceed"; (c) per-gate mixed.
- **Chosen:** (b) `POLICY_GATE_DEFAULTS = {enough:true, valid:true, contradiction:false, pass:true}`
  — all "proceed", recorded `decided_by: policy`. (Gates are *wired* into the loop in M6; the
  defaults live in `policy.ts` now and are unit-tested.)
- **Why:** A Jev 429/outage must never wedge a run into an infinite research loop or a permanent
  REWORK; fail-open keeps it moving and the `policy` flag keeps it honest.
- **Risk:** On an outage the gates are permissive (less skeptical) → mitigated by M6 escalation tiers
  and the honest flag; a real gate decision still comes from Jev when it's reachable.
- **Reverse:** Flip a default to "halt" once M6 escalation tiers can absorb it.

### D-12 — M3 finalizer **extracts** the lead's text; no extra model call
- **Q:** How to produce the run's final answer in M3?
- **Options:** (a) a second synthesis model call over all step outputs; (b) extract the lead agent's
  already-generated text; (c) concatenate worker outputs.
- **Chosen:** (b). `extractLeadAnswer` reverse-searches succeeded steps for the lead's `output.text`
  and returns it verbatim (`citations: []`). `[VERIFIED: runs 1/2/8 final answers came from the lead step]`
- **Why:** The lead (synthesizer/answerer) already generated the answer; a second call would double
  the spend for zero M3 benefit. The evidence-citing Final Synthesizer (§13) replaces it in M5.
- **Risk:** No cross-agent synthesis or citations yet → disclosed (`citations: []`); workers are
  deferred in M3 anyway (D-10), so there's nothing to synthesize across.
- **Reverse:** Swap the injected `Finalizer` for the M5 synthesizer (the executor takes it by injection).

### D-13 — Terminal marker for orphaned runs (disconnect / empty-plan / pre-executor throw)
- **Q:** A run whose client disconnected — or that hit the empty-plan return, or threw before the
  executor took over — was left in `status='planning'` with `error=NULL` **forever** (observed on
  probe row run 3, `"noop"`). That is a silent non-completion. Close it how?
- **Options:** (a) leave it and have M7 filter stale rows; (b) delete probe rows; (c) persist a
  terminal status on every non-executor exit.
- **Chosen:** (c). `markRunFailed(id, error)`: an **atomic, idempotent** `updateMany` guarded by a
  non-terminal-status filter (never clobbers a run the executor already completed), called from the
  catch block, the empty-plan return, and a new `ReadableStream.cancel()` handler. Disconnects are
  classified `client_disconnected` via an enqueue-failure flag. `[VERIFIED: run 7 → failed /
  client_disconnected / finishedAt set / cost NULL / modelCalls 0; run 8 happy path still completes]`
- **Why:** §8/§11 forbid a silent non-terminal state; the status filter makes concurrent callers
  (catch + cancel) race-safe and protects a genuinely completed run.
- **Risk:** None to the happy path (verified). On a mid-execution disconnect the executor may still
  finish and supersede the marker — correct, since the run *did* complete server-side. **No
  AbortSignal is threaded through in M3**, so a disconnect during a paid call can't cancel it; the
  wall-clock budget bounds it and full cancellation is an **M6 hardening item**.
- **Reverse:** Drop the three call sites; rows orphan again (not recommended).

### D-14 — Code agent split: pure honesty core + thin server wrapper
- **Q:** The Code/Data agent's whole job is to **never invent a number**. Where does that logic live so
  it's provable without spending on real models?
- **Options:** (a) all in the `server-only` agent, tested via live calls only; (b) a **pure core**
  (`sanitizeExpression`/`readCalcOutput`/`runCodeStep`) + a thin server wrapper that injects the real
  completer and `callTool`; (c) no split, mock the SDK inline in the agent.
- **Chosen:** (b). `src/lib/agents/code-agent-core.ts` is pure (no `server-only`/fetch/Prisma/SDK);
  `src/server/agents/code-agent.ts` binds `trackAiCall` + `completeOnce` + `getModel` and injects them.
  **11 pure tests** cover the happy path and every failure path at $0. `[VERIFIED: 50/50 pure suite]`
- **Why:** Same discipline as the M2 orchestra and M3 bus — the never-invent logic is the highest-risk
  part and must be unit-proven before a cent is spent; the wrapper stays thin and ledger-correct.
- **Risk:** A small local duplication of the cost-conversion helper (`toCostMicroUsd`) in the wrapper.
- **Reverse:** Inline the core back into the server agent (loses the $0 test lane).

### D-15 — MCP over `InMemoryTransport`, lazy singleton linked pair
- **Q:** How to run a **real** MCP tool with zero new keys and zero network (§8/§13 "keyless")?
- **Options:** (a) a stdio subprocess server; (b) a remote HTTP/SSE server; (c) an in-process
  `InMemoryTransport` linked client+server pair.
- **Chosen:** (c). `getToolRegistry()` lazily connects ONE `Client`+`McpServer` pair and caches the
  connect promise (reset to `null` on failure so a later run retries rather than inheriting a broken
  registry); `listTools()` drives `has()` so the callable set grows when M5 adds research-sonar.
  `[VERIFIED: run 9 tool_call→tool_result, latencyMs 4]`
- **Why:** Real SDK client/server semantics (`registerTool`, `callTool`, `isError`) with zero new keys,
  zero ports, zero network; the stateless calculator server safely serves concurrent runs (the client
  multiplexes by request id).
- **Risk:** In-process ≠ a networked tool. A genuinely remote server would need a transport swap — the
  narrow `{has, call}` `ToolRegistry` interface isolates that from the pure executor.
- **Reverse:** Swap the transport inside `initRegistry`; the executor only ever sees `{has, call}`.

### D-16 — `needsTools` gate: connect MCP only when a step allows a tool
- **Q:** Spin up the MCP pair on every run, or only when a step actually grants a tool?
- **Options:** (a) always connect; (b) connect only if some step's `toolsAllowed` is non-empty.
- **Chosen:** (b). `run.ts` computes `needsTools = plan.steps.some(s => s.toolsAllowed.length > 0)` and
  passes `tools` (or `undefined`) into the executor. `[VERIFIED: runs 10/11 had 0 tool calls, no connect needed]`
- **Why:** Simple/answerer-only runs have no tools; skipping the connect keeps the common tool-free run
  lean. `validatePlan` already rejects a tool the registry lacks, so a `code` step *forces* the registry
  — the gate just avoids paying for it when there's no `code` step.
- **Risk:** None to correctness — the executor treats tools as optional per step (tested in M2).
- **Reverse:** Always call `getToolRegistry()`.

### D-17 — `NONE` → `ok:true` graceful degradation (a coding task must not fail the run)
- **Q:** `assembleTeam` routes `coding` tasks — not just `data` — to the calculator-only `code` agent, so
  a coding query makes the model return `NONE`. Fail the step, or degrade?
- **Options:** (a) `ok:false 'no_expression_from_model'` (the original); (b) `ok:true` with an honest
  "no calculation applies" note and **no number**; (c) special-case `coding` away from the code agent in policy.
- **Chosen:** (b). An empty/`NONE` expression returns `ok:true`, `output.text` = an honest "no exact
  calculation was needed or derivable" note, the tool is **not** called, and the real model spend is
  still reported. `[VERIFIED: run 11 (coding) → completed, toolCalls 0, code step succeeded with the note]`
- **Why:** (a) fails the non-critical `code` step, and because the **critical** synthesizer
  `dependsOn:[code]`, the executor skips it and **fails the entire run** — a landmine for M8's coding
  benchmark tasks and any coding demo. (c) is a bigger policy change and Jev legitimately flags
  `needs_code` for coding. (b) keeps the run alive and honest: `NONE` is a valid "no arithmetic applies"
  determination, not an error, and no number is invented.
- **Risk:** A genuine data task where the model *wrongly* returns `NONE` degrades to the lead answering
  without the tool — acceptable and disclosed by the note; the synthesizer prompt tells the lead to reuse
  a worker's exact value when one is present.
- **Reverse:** Revert the branch to `ok:false` (re-exposes the landmine), or fix in policy via (c).

### D-18 — Tool failure stays loud (`ok:false`), never a fabricated value
- **Q:** When the calculator errors (÷0) or returns unreadable output, what does the step do?
- **Options:** (a) fall back to a model-guessed number; (b) `ok:false` with the real reason and **no**
  output value; (c) silently retry the tool.
- **Chosen:** (b). `calculator_failed: <reason>` / `calculator_returned_unreadable_output`, `output`
  undefined, real model cost passed through. The registry maps `isError → {ok:false}`; the pure parser
  never throws and never returns `Infinity`. `[VERIFIED: 11 pure tests incl. ÷0 + unreadable-output paths]`
- **Why:** §13 — "an agent must report a tool failed rather than invent output." This is the deliberate
  counterpart to D-17: a genuine **tool failure** is loud (`ok:false`), only "nothing to calculate"
  degrades (`ok:true`). The two are never conflated.
- **Risk:** A data run whose tool fails will fail the `code` step, skip the critical synthesizer, and fail
  the run **honestly** rather than answer with a made-up number — correct per §8.
- **Reverse:** N/A (safety/honesty bound).

### D-19 — `server-only` integration test via a **throwaway** loader stub (not permanent)
- **Q:** The MCP registry + calculator-server are `server-only` (Next virtualizes the package; plain node
  cannot import it). How to integration-test the real SDK shape without booting Next?
- **Options:** (a) install a permanent `server-only` shim; (b) a throwaway `--import` resolve hook
  stubbing `'server-only'` → an empty `data:` module, delegating everything else to
  `scripts/ts-resolve-hooks.mjs`; (c) skip integration and rely on the live e2e alone.
- **Chosen:** (b), used once then **deleted** (all three throwaway files removed). `[VERIFIED: listTools
  → 'calculate', good expr → exact value, bad expr → isError, against real SDK 1.31.0 at $0]`
- **Why:** (a) would let any "pure" test silently import server modules, eroding the pure/server guardrail
  that keeps the $0 lane honest; (c) alone leaves the SDK-shape assumptions unproven until a paid call.
  The throwaway stub proved the shape cheaply, then was removed so the guardrail stands.
- **Risk:** The integration isn't a permanent regression test → mitigated by the live e2e (run 9 exercised
  the real registry+server+tool) plus the pure calculator/core suites.
- **Reverse:** Re-add the stub hook if a permanent server-integration lane is ever wanted (it would need a
  separate test directory to preserve the pure/server split).

---

### D-20 — Researcher = sonar spans for claim↔source, **no model call of its own**
- **Q:** How does the Researcher turn a web retrieval into honest, sourced evidence without a second paid
  model call or fabricated links?
- **Options:** (a) call a model to extract claims then guess which source backs each; (b) use the sonar
  tool's own provider-supplied `start_index`/`end_index` spans to slice the exact claim each citation
  backs; (c) store the whole answer as one unsourced blob.
- **Chosen:** (b). `buildEvidence` slices `text[start:end]` per span-bearing citation → `claim` = the exact
  cited slice, `source` = the real URL, `retrievedText` = the full answer. The Researcher agent makes **no**
  model call; the "intelligence" is the sonar web model inside the MCP tool. `[VERIFIED live: run 14 → 8
  sourced evidence rows; pure: researcher-core 9/9]`
- **Why:** §8 (never fabricate a citation) + §12 (cost). The span is a real claim↔source mapping the
  provider already computed — reusing it is both more honest and cheaper than a second extraction call. The
  routed `gemini` label for the researcher is therefore deliberately unused (its spend is the tool's sonar
  call, recorded under `agentos_research`).
- **Risk:** Sonar sometimes omits/degenerates the spans (see D-25) → handled by an honest fallback, never a
  fabricated link.
- **Reverse:** Add a model extraction pass in `researcher-core` if span quality proves too low; the pure
  core is the only file that changes.

### D-21 — Sonar citations live in `message.annotations[]`, parsed per-element
- **Q:** Where are perplexity/sonar's citations, and how are they parsed without one bad element killing
  the rest?
- **Options:** (a) read a top-level `citations` array; (b) read `choices[0].message.annotations[]` where
  each is `{type:"url_citation", url_citation:{url,title,start_index,end_index}}`; (c) regex the `[n]`
  markers out of the prose.
- **Chosen:** (b), with **per-element** zod validation (envelope reads `z.array(z.unknown())`, each element
  validated individually; a span is kept only when both bounds are present and `end > start`).
  `[VERIFIED: 3 live sonar probes ≈ $0.0153 returned 29 real url_citations in annotations; research 10/10
  pure tests incl. live-shape, dedupe, MAX_CITATIONS=8 cap, degenerate/reversed-span drop]`
- **Why:** `return_citations:true` does **not** add a top-level array (probe-verified); the real citations
  are annotations. Per-element parsing avoids the earlier trap where one malformed element failed the whole
  `safeParse` and silently dropped every good citation.
- **Risk:** Sonar's annotation shape could change → the parser degrades to text-only (empty citations),
  never throws, never invents.
- **Reverse:** N/A (empirically determined wire shape).

### D-22 — Evidence hub = structured records (no vector column) behind an `EvidencePort`
- **Q:** What is the shared evidence hub's shape, and how do agents reach it without importing Prisma?
- **Options:** (a) embedding/vector store; (b) structured `evidence_records` rows (claim, source,
  retrievedText, discoveredByAgent, verificationStatus, relation, referencesEvidenceId) behind a pure
  `EvidencePort` interface, with an in-memory impl for tests/fallback and a Prisma impl for the run;
  (c) pass raw text between agents.
- **Chosen:** (b). `AgentContext.evidence: EvidencePort`; the executor supplies a Prisma-backed store
  (`createEvidenceStore(runId)`) or an in-memory fallback, and **wraps** `add`/`flagContradiction` so the
  `evidence_added`/`contradiction_found` events are emitted from one place with one clock/runId.
  `[VERIFIED: memory 8/8 pure; run 14 persisted 8 rows + 8 evidence_added events, read back from Postgres]`
- **Why:** §13 D2 wants *structured* evidence the Skeptic can point at, not opaque chunks; OpenRouter has
  **0 embedding models** (integration notes §2), so a vector store isn't available. The port keeps agents
  pure/testable; centralizing emission in the executor keeps agents free of event plumbing and guarantees a
  single authoritative runId/timestamp.
- **Risk:** Best-effort writes return `''` on failure (swallowed via `captureError`) so a DB blip degrades
  evidence but never wedges the run — the reported `evidenceCount` only counts real ids, so it never
  overstates what persisted.
- **Reverse:** Swap the Prisma `EvidencePort` impl for a vector store if embeddings become available; the
  port interface and all agents stay unchanged.

### D-23 — A contradiction is an **UPDATE** of an existing row, not a new insert
- **Q:** When the Skeptic decides record A contradicts record B, what is written?
- **Options:** (a) insert a new "contradiction" row duplicating A's claim text; (b) update A's own
  `relation`→`contradicts` and `referencesEvidenceId`→B.
- **Chosen:** (b). `flagContradiction({claimId, againstId, claim, againstClaim, ...})` flips the existing
  `claimId` row (scoped by runId) and returns its id, or `''` if either id is unknown (refuse to act on a
  hallucinated id). The `claim`/`againstClaim` strings are carried only so the executor wrapper can emit
  `contradiction_found` without a lookup. `[VERIFIED: memory + critic-core pure tests; both rows also marked
  `contested`]`
- **Why:** The schema stores `relation`/`referencesEvidenceId` as **columns on a row**, so a contradiction is
  a property of existing evidence, not a new entity. An insert would duplicate claim text and orphan the
  self-relation.
- **Risk:** None observed; self-contradiction (A vs A) and unknown ids are explicitly ignored.
- **Reverse:** N/A (matches the persisted schema).

### D-24 — Critic = model-based Skeptic (claude), gated by Jev complexity, sequenced after primaries
- **Q:** Is the Fact-Checker a Jev gate or an agent, when does it run, and in what order?
- **Options:** (a) a Decision Bus gate only; (b) a real `critic` agent (claude) that reads the populated
  hub and returns per-record verdicts + contradictions, added to the team when `needsCritic` or complexity
  is `hard`/`very_hard`, and sequenced to **depend on the primary workers** so it reads a populated hub;
  (c) run it in parallel with the workers.
- **Chosen:** (b). `buildAgentPlan` treats `critic` as a VERIFIER_ROLE: `dependsOn = primaryWorkerIds`, and
  the lead `dependsOn` all workers incl. the critic, so the synthesizer sees the verdicts. Verdicts are
  applied per-element-resiliently; a hallucinated evidence id is skipped, never acted on.
  `[VERIFIED live: run 14 → critic(claude) checked:8, verdictsApplied:8, all 8 rows persisted `contested`,
  synthesizer explicitly cited the critic's source-quality concerns; critic-core 10/10 pure]`
- **Why:** §11/§13 want a genuine Skeptic over the evidence, and §12 escalates verification with
  complexity. Ordering it after the primaries is required — a critic that runs before retrieval has an empty
  hub. Jev owns the gate (run 12's *simple* comparison honestly got **no** critic; run 14's *hard* one did),
  so verification cost scales with the task rather than taxing every research run.
- **Risk:** A `simple`-rated research task is not fact-checked — by design (Jev's call); the D4 Jev gates in
  M6 add a second, orthogonal verification layer.
- **Reverse:** Force `critic` onto every research team in `assembleTeam` (costs one claude call per research
  run), or move the gate entirely into the M6 D4 evidence-validity Jev gate.

### D-25 — Real citation URLs are preserved even when sonar omits spans (run-12 defect fix)
- **Q:** Sonar returned 8 real source URLs but **no usable spans** on run 12; `buildEvidence` collapsed to a
  single `source:null` coarse record, so the evidence-citing finalizer emitted `citations:[]` — real sources
  were thrown away. What should happen?
- **Options:** (a) keep the single `source:null` coarse record (lose the URLs from the hub); (b) when
  citations exist but none span-map, emit one record per **unique real URL** (claim = the whole truncated
  finding, source = that URL); (c) have the finalizer also read step outputs, bypassing the hub.
- **Chosen:** (b). Only when sonar returns **no** citation URLs at all does the single `source:null` coarse
  record remain. `[VERIFIED live: run 13 → 8 evidence_added, `final.citations` = 8 real URLs; pure:
  researcher-core "keep every real URL as a source" + cap tests]`
- **Why:** §8 forbids *inventing* a source, not *keeping* one the tool actually returned. Without a span we
  can't honestly pin a sub-claim to a URL, but "this returned URL supports this finding" is exactly what a
  citation list means, so attributing the whole finding to each real URL is honest and makes the
  evidence-citing finalizer deliver real citations. (c) would couple the finalizer to step internals and
  leave the hub — the §13 source of truth — empty.
- **Risk:** Up to MAX_EVIDENCE (8) rows share the same claim text when spans are absent; the Skeptic then
  fact-checks the same finding against each source (redundant but not wrong, one model call). Real sonar
  output is URL-deduped upstream by the parser.
- **Reverse:** Revert to the single coarse record if per-source rows prove too noisy for the critic.

### D-26 — Paid-tool spend threaded to the budget guard via `ToolResult.costMicroUsd`; multi-server registry
- **Q:** How does a paid MCP tool's real cost reach the run budget, and how does one registry serve multiple
  MCP servers?
- **Options:** (a) let each agent echo the tool cost into `StepResult.costMicroUsd`; (b) lift the tool's
  `structuredContent.costMicroUsd` into `ToolResult.costMicroUsd` in the registry, which the executor's
  `callTool` already adds to the guard — and have the researcher **omit** `StepResult.costMicroUsd` so it
  isn't double-counted; the registry keeps a `toolName → client` map built by linking each server over an
  in-process transport.
- **Chosen:** (b). `[VERIFIED live: run 14 cost_update jumped 486→6096 µUSD on the sonar tool_result, i.e.
  the guard saw the real ~$0.0056 sonar spend; agent_runs.costMicroUsd summed 37347 for the run]`
- **Why:** §12 (never silently overspend) needs the guard to see tool spend at the moment of the call. The
  executor already records both tool cost (in `callTool`) and step cost (in `runStep`), so the researcher
  must not echo the tool cost or it double-counts. perplexity/sonar reuses the OpenAI usage extractor
  (OpenAI-wire shape); `sonar` maps to slug `perplexity/sonar`.
- **Risk:** A tool that returns no `costMicroUsd` contributes nothing to the guard (never fabricated, never
  forced to 0) — the model-call costs still bound the run.
- **Reverse:** N/A (correctness fix); the toolName→client map scales to more servers as-is.

### D-27 — M6 replan loop: pure `ReplanPolicy` in `lib`, §12 escalation gate, unique delta ids, budget-stop partial answer
- **Q:** How are the D4 Jev gates + D5 replan deltas wired into the executor so the loop is unit-testable at
  $0, escalates by tier, never collides step ids, and never returns an empty answer on a budget stop?
- **Options:** (a) put the policy in `src/server` (needs the real bus) and test it only live; (b) keep the
  policy factory PURE in `src/lib/agents/replan-policy.ts` with the `GateDecider` (bus) and `EvidencePort`
  INJECTED, so a mock proves gate sequencing/escalation/delta shape, and `run.ts` binds the real bus + Prisma
  evidence store.
- **Chosen:** (b). Gate 1 sufficiency NO → `buildResearchDelta` (follow-up researcher carrying a REFINED query
  in `inputs.query` + a re-synthesizer); gate 2 validity NO → `buildReworkDelta` (fresh critic pass +
  re-synthesizer); both pass → `null` (finalize). Delta step ids are suffixed `_r{n}` (n = replan index) so
  they stay unique across passes; `shouldRunGates(tier)` fires gates ONLY at `hard`/`very_hard` (§12). The
  executor's budget-stop branch now runs the finalizer and emits `final` (best partial + real citations)
  before the `error`/`budget_stopped` reason (§10.7/§12). `[VERIFIED: 86/86 pure tests green — replan 10,
  replan-policy 6, orchestra 17 incl. the new budget-stop-partial test, decisions 10, + researcher/critic/code/
  evidence suites; tsc + eslint clean. PARTIAL live proof run 15: a `medium`-tier run recorded only the 5
  planning decisions and NO gate decisions, confirming escalation suppresses gates below hard.]`
- **Why:** The bus's four D4/D1 gates already existed and were tested; M6's job was the LOOP, not the gates.
  Keeping the policy pure mirrors the researcher/critic core+wrapper split, so the replan logic is provable
  without a live Jev hop or spend. `run.ts` connects the MCP tool registry whenever gates are enabled because a
  research delta grants `RESEARCH_TOOL` and `validatePlan` would otherwise reject the delta for a missing tool.
  Gate records are persisted once by the bus sink; the policy's `onDecision` only STREAMS them (§13), so no
  double-write.
- **Risk:** A hard-tier run whose evidence Jev keeps judging "insufficient" replans up to `maxReplans` (2) then
  finalizes on the best evidence — bounded, never an infinite research loop. Each replan adds one sonar call
  (~$0.005) + one synthesizer call; still far under the $0.50/run cap.
- **Reverse:** The policy is a single injected option on the executor; passing `replanPolicy: undefined`
  (today's behaviour for `simple`/`medium`) restores the no-replan path exactly.

### D-28 — LIVE E2E BLOCKED: OpenRouter balance exhausted (402 on the synthesizer) — **RESOLVED 2026-10-01**
- **Q:** Can M6's live gate/replan proof (and M7–M9) run on the current OpenRouter key?
- **Chosen:** STOP and write `docs/BLOCKED.md`. Run 15's synthesizer (Claude, `max_tokens` 1024) was refused:
  `OpenRouter 402: ... can only afford 758`. The critic (Claude, 512) still succeeded, so the balance was
  ≈ $0.011 — below the ~$0.027 a single hard-tier run needs. `[VERIFIED live: run 15 status=failed,
  cost=17017 µUSD, err=critical_step_failed; agent_steps.synthesizer.error = the 402 text]`
- **Why:** §8 forbids creating paid resources, so I could not top up the key; §7 makes an unresolvable external
  dependency the one permitted stop. Lowering `max_tokens` to dodge the 402 was rejected: it permanently
  degrades answer quality to mask a wallet problem, and the balance was too low for a full hard run anyway.
- **RESOLVED:** the human replaced `OPENROUTER_API_KEY` in `.env.local` with a funded key. Run 16 (a
  `very_hard` research query) then completed the full M6 chain live: researcher (sonar, 8 evidence) → critic
  (Claude) → synthesizer (Claude, **succeeded**, credits restored) → **gate 1 `evidence_sufficiency`
  `decided_by=jev` conf 0.77 `{enough:false}`** → **`replan` event `addedSteps:[researcher_r1, synthesizer_r1]`**
  → `researcher_r1` ran the REFINED gap-targeting query (8 more evidence) → `synthesizer_r1` → **gate 1 fired
  again conf 0.94 `{enough:false}`** starting a 2nd round. DB: 16 evidence records, 2 jev gate decisions,
  `replans=1`, cost 43300 µUSD ($0.0433). No code change was needed — M6 was already code-complete/unit-green.
- **Reverse:** N/A (external dependency resolved by the human).

### D-29 — Wall-clock cap must also bound replan ROUNDS (Jev gate calls are not reservation-gated)
- **Q:** The budget guard checks the wall-clock cap only at reservation time (step/tool START). The D4 Jev
  gate calls inside `maybeReplan` happen BETWEEN step reservations, so a slow or throttled Jev gate could push
  a run past `maxWallClockMs` unchecked. How do I close that gap without a wall-clock check on every gate hop?
- **Options:** (a) thread the clock into the gate decider and check before each Jev call; (b) add a
  `canReplanRound()` to the guard that composes `canReplan()` (max_replans) with `checkClock()` (wall-clock),
  and call it once at the top of `maybeReplan` — before any gate is consulted.
- **Chosen:** (b). `maybeReplan` now returns `null` (loop breaks, run finalizes on best evidence) when
  `!guard.canReplanRound().ok`. `[VERIFIED: new orchestra test "replan loop breaks when the wall clock is
  exhausted (gate calls are not reservation-gated)" advances a fake clock 70s past a 60s cap and asserts
  policyCalls===0, replans===0, status 'completed', finalAnswer set — the policy is never even consulted.]`
- **Why:** A single check at the round boundary is where a replan's cost is actually committed; gating there
  means one round can start but the NEXT cannot once the clock is spent. It reuses the guard's existing
  `checkClock()` (single source of truth for the cap) instead of duplicating time math in the policy, and keeps
  the pure policy free of any clock dependency (still unit-testable with a mock decider).
- **Risk:** A round already in flight when the clock expires still finishes (its gate calls aren't
  individually timed) — bounded by one round, and the per-call Jev timeout caps each hop.
- **Reverse:** Delete `canReplanRound()` and revert `maybeReplan` to `canReplan()` to restore the pre-fix
  behaviour (max_replans only, no wall-clock bound on rounds).

### D-30 — De-dupe the refined-query "coverage" list (the no-span fallback repeats one claim per URL)
- **Q:** Run 16's follow-up researcher carried a refined query whose "the first pass covered: …" list showed
  the SAME coarse claim repeated. Root cause: when sonar returns no quotable span, the researcher writes one
  evidence row per unique URL all sharing the same coarse claim text (D-25), so `refineResearchQuery` echoed
  that claim once per row.
- **Options:** (a) leave it (harmless repetition); (b) de-dupe the `covered` list with a `Set` on the
  truncated claim so each distinct claim is named once.
- **Chosen:** (b). `[VERIFIED: new replan test "refineResearchQuery names each distinct claim once even when
  rows repeat a coarse claim" builds 3 rows with an identical claim + 1 distinct and asserts the covered list
  has exactly 2 entries.]`
- **Why:** The refined query is the follow-up researcher's only signal about what's already covered; repeating
  one claim wastes the (300-char) budget and hides real gaps, so the gap-targeting prompt gets sharper. Cheap,
  pure, and $0-testable.
- **Risk:** None — de-dupe only affects the prompt string, never the evidence hub.
- **Reverse:** Drop the `Set` guard in `refineResearchQuery` to restore per-row echoing.

### D-31 — Replay: reconcile the terminal phase with the stored row; show event-derived cost in the detail header
- **Q:** Replaying run 16 (killed by a client disconnect before it persisted a terminal
  `status`/`error` frame) folded to `phase:'streaming'` and rendered a misleading
  "Synthesizing…" result. Separately, its detail header cost ($0.0681, the last persisted
  `cost_update`) disagreed with the history list ($0.0433, the stored `agent_runs.costMicroUsd`).
- **Options:** (a) leave the replay showing "Synthesizing…" for dead runs; (b) reconcile the
  folded view's terminal phase/error with the authoritative stored row via a pure
  `applyTerminalStatus(state, status, error)`; and for cost, prefer either the stored row or the
  event-derived total in the detail header.
- **Chosen:** (b) for the phase — `applyTerminalStatus` maps a terminal stored status
  (completed/failed/budget_stopped) onto the view and surfaces the stored error, leaving
  non-terminal statuses (a run genuinely in flight) untouched.
  `[VERIFIED: 4 unit tests (killed→failed with stored error; failed-with-no-error gets the
  honest default message; completed→complete; running→unchanged) + live browser: replay #16 now
  shows a FAILED badge + "client_disconnected: ResponseAborted" instead of "Synthesizing…".]`
  For cost, the detail header keeps the **event-derived** total (the last `cost_update`), because
  for a killed run the stored row is the *staler* of the two: the row write is cut short by the
  disconnect (run 16 row = 43300 µUSD at 4 model calls) while per-event rows are more durable
  (last `cost_update` = 68134 µUSD at 5 model calls). The history list keeps the stored row.
- **Why:** Showing "Synthesizing…" for a run that is provably dead violates the no-fabrication
  rule (§8); the stored row is the only authoritative terminal signal for such runs. And
  under-reporting spend in the detail view (by trusting the stale row) is worse than showing two
  real, differently-scoped measurements.
- **Risk:** A run still in flight that is replayed concurrently shows streaming (correct); the
  detail/list cost divergence only appears for runs killed mid-stream and is documented in the
  M7 status notes.
- **Reverse:** Delete `applyTerminalStatus` and its call in the replay fold to restore
  events-only folding; swap the header to read `run.costMicroUsd` to prefer the stored row.

---

### D-32 — M8 four-setup benchmark: pilot-first, then STOP at the credit wall (do not fabricate a full run)
- **Q:** The M8 benchmark must compare four setups over the 24-task set. The 3-task pilot (run #1)
  cost only $0.082 of the $15 cap but partway through, paid OpenRouter calls began returning
  `402 "would exceed your available credits given your current in-flight requests"`; `GET /credits`
  confirms `total_credits: 0`. aos-01 fully scored on all four setups; aos-02 failed all four (402);
  aos-03 A/B ok, C/AgentOS `critical_step_failed`. How to proceed with the full run?
- **Options:** (a) immediately fire the full 24×4 anyway; (b) add OpenRouter credits myself;
  (c) retry-loop the 402 in the setups/judge; (d) stop at the pilot, persist the honest partial
  rows, verify the machinery another way, document a hard blocker and tell the human.
- **Chosen:** (d). §12 mandates pilot-first precisely so a credit/cost wall surfaces cheaply before a
  full run; hammering a $0 account (a) would produce 24×4 mostly-`402` rows that misrepresent a
  working pipeline and burn the residual free headroom. Adding credits (b) is a **paid resource**,
  forbidden by §8. A blind 402 retry-loop (c) does not fix a genuine zero balance and risks
  overspend/hammering. So: the 12 real rows are persisted (nothing dropped or invented), the engine,
  judge, SSE, CLI, GET endpoints and dashboard panel are verified against them (structural DOM check
  at `/dashboard` + recomputed report), and the full-run gap is written to `docs/BLOCKED.md`.
  `[VERIFIED: 31/31 pure tests; tsc/eslint/prod-build exit 0; live pilot streamed start→progress→done,
  12 rows persisted, $0.082 real spend; GET /runs/1 recomputes agentosBest 1 / neverBest 1;
  /dashboard panel renders run #1's real numbers.]`
- **Why:** No-fabrication (§8) + pilot-first spend discipline (§12) + "stop and tell me" on a credit
  wall (standing user constraint). A partial-but-real pilot with an honest blocker beats a
  complete-looking table built on a $0 account.
- **Risk:** The pilot's success rates (A/B 67%, C/AgentOS 33%) are **depressed by the credit wall**,
  not by the pipeline — explicitly labelled PARTIAL wherever shown so nobody reads them as final.
- **Reverse:** Once the human funds `OPENROUTER_API_KEY`, run `pnpm benchmark:agentos -- --full`
  (or click **Run full (24)**); it persists a new run and charts automatically — no code change. A
  follow-up (optional, not done to avoid scope creep): treat a *transient* in-flight 402 as retryable
  in the setups/judge, distinct from a zero-balance 402, so a funded sequential full run is robust to
  momentary in-flight overlap.

---

### D-33 — Remove root Lenis smooth-scroll (froze wheel); surface the real cause of a critical-step failure
Two user-reported defects fixed together (both credit-independent):
- **Q1: the page would not scroll with the mouse wheel.** Every view is a fixed `h-dvh` shell whose
  content scrolls in an inner `<main overflow-y-auto>` (sticky headers by design), so the document
  itself never scrolls. `ReactLenis root` (M6) attaches a non-passive window `wheel` listener,
  `preventDefault`s it, and drives the *window* — which cannot scroll here — so the inner `<main>`
  never received the wheel and the page froze.
  - **Options:** (a) remove Lenis; (b) tag every inner scroller `data-lenis-ignore`; (c) convert views
    to document-scroll so root Lenis applies.
  - **Chosen:** (a). Lenis brings zero benefit to an all-inner-scroll app and actively breaks it; (b)
    is fragile per-container tagging for no gain, (c) is a large redesign that breaks the sticky-header
    layout. Deleted `src/components/motion/smooth-scroll.tsx` + its layout mount; native scroll on the
    inner container is correct. `DESIGN.md` updated (the "only motion dependency" claim reversed).
    `[VERIFIED live at /agentos: window.lenis undefined, 0 lenis nodes, a dispatched cancelable wheel
    is NOT defaultPrevented, and <main> scrollHeight 1360 > clientHeight 571 with overflow-y:auto.]`
  - **Reverse:** re-add the provider only if a view is converted to document-scroll. The `lenis`
    package is left installed but now unused (imported nowhere → not bundled); safe to uninstall later.
- **Q2: a failed run showed only `critical_step_failed`,** hiding the real reason (the researcher's
  `OpenRouter 402: out of credits`). The executor now composes `criticalFailureMessage(run)` =
  `critical_step_failed: <firstFailedStep> failed: <its stored error, truncated to 240 chars>`, keeping
  the greppable token as a prefix. It flows error-event → D6 reducer `view.error` → run-view banner.
  `[VERIFIED live: a real /api/agentos run now streams "critical_step_failed: researcher failed:
  research_failed: OpenRouter 402: …can only afford 328…"; orchestra unit test updated + 88/88 green.]`
  - **Why:** §8 no-fabrication cuts both ways — an opaque failure hides the truth just as a fake
    success does. The operator must see WHY (here: fund the key).
- **Note:** neither fix makes runs *succeed* — that still needs OpenRouter credits (D-32). They make
  the app scrollable and the failure self-explanatory.

### D-34 — Section 15 slice 8d: live route-protection matrix; signup rate-limit honesty; one leftover test row needs a human
- **What:** `_scratch/verify-routes.mjs` (headless Chrome against the live dev server) now proves the
  whole gate: anon `/` public with the landing headline; anon `/app|/dashboard|/agentos` → 307
  `/login?next=…`; signed-in `/`, `/login`, `/signup` bounce to `/app`; `/app`, `/dashboard`,
  `/agentos` render signed in; sign-out re-engages the gate; `?next=` survives the gate and the
  post-login redirect; `//evil.com`, `https://evil.com`, `\\evil.com`, `/\evil.com` all stay on
  origin; unknown-email and wrong-password failures are byte-identical (no enumeration); empty and
  invalid submits never fire an auth request. **31/31 passed, 0 skipped (2026-10-02).**
- **Found + fixed:** Supabase's built-in SMTP cap (2 emails/hour) answers signup with
  `429 over_email_send_rate_limit`, and the form's failure mapper was mislabelling that as "invalid
  email address". `signupFailureMessage` now maps any rate-limit error to a plain retry message.
  `[VERIFIED live: 429 → "Too many attempts. Wait a couple of minutes and try again."]`
- **Leftover needing a human:** one broken test row I inserted into `auth.users` before the
  policy line against raw `auth.*` writes was drawn — `ui-verify-1790900523452@jev-swarm.local`
  (GoTrue 500s on login for it; it is inert otherwise). Delete it under Supabase Dashboard →
  Authentication → Users. I will not write to `auth.*` again.
- **Why:** §15.8 demands the protection matrix be proven live, and §8 forbids both fabricated
  verification and weakening auth settings; the demo session used for the signed-in blocks is the
  account the user confirmed manually (documented in the 2026-09-29 log), fed to the harness from
  `_scratch/.test-creds` so no secret touches stdout or a command line.
  - **Reverse:** n/a — verification harness only; the product change is the one-line mapper fix.

### D-35 — Section 15 slice 8f: the full verification matrix, run for real (13 unit + 31 live + 8 interaction + Lighthouse)
- **Automated:** new pure modules `src/lib/route-gate.ts` (gate classification split out of
  proxy.ts) and `src/lib/auth-form-rules.ts` (safeNext + field validation + failure mapping split
  out of auth-form.tsx), each with a `.test.mts` — **13/13 green** under the repo's node --test
  runner. proxy.ts and auth-form.tsx now import them; behaviour unchanged (live matrix re-run
  after the refactor: 31/31).
- **Live (headless Chrome, `_scratch/verify-routes.mjs`):** 31/31 — anon gate + `next`
  preservation, signed-in bounce to /app, sign-out re-gate, four malicious `next` shapes stayed on
  origin, identical generic failure for unknown-email vs wrong-password, empty/invalid submits
  fire zero auth requests, show/hide toggle.
- **Interaction (`_scratch/interactions.mjs`):** 8/8 — headline link works by left click, keyboard
  Enter, middle click (new tab), and touch tap at 390px; a 2.5s-delayed auth response disables the
  button ("Please wait…") and a second click/Enter cannot double-submit (1 token request).
- **A11y/motion (`_scratch/keyboard-audit.mjs`):** tab order sane on all three pages with a visible
  2px ring everywhere (fixed a real bug: Tailwind v4's `outline-none` poisons
  `--tw-outline-style`, so four controls had `outline-width:2px; outline-style:none` — an invisible
  ring); decorative door-star loop measures 1e-06s under prefers-reduced-motion.
- **Lighthouse (real runs, JSON in `_scratch/`):** dev server — landing 52/100/96/100, login
  56/96/96/100. Production build — **landing 79/100/100/100, login 77/100/100/100** (perf/a11y/
  best-practices/seo), CLS 0, TBT ~180-210ms, document TTFB 40ms; the perf ceiling is the single
  render-blocking stylesheet + app shell JS under Lighthouse's simulated slow 4G, with the LCP
  element being the headline text. Two fixes came out of it: `src/app/icon.svg` (the /favicon.ico
  404 was the only best-practices failure) and resting-state underlines on the in-text auth links
  (the only a11y failure, `link-in-text-block`).
- **Screenshot matrix:** /, /login, /signup at 1440/1920/2560/390 @DPR1&2 in `_scratch/shots/`
  (m-* files); 2560 keeps the hero centred with the hairline at the fold, DPR2 edges are crisp
  (inline SVG + self-hosted EB Garamond, no rasterised type).
- **Why:** §15.8 lists exactly these checks; every number above is from a run on this machine, and
  the two regressions it caught (invisible focus rings, mis-mapped rate-limit message in D-34) were
  fixed rather than reported around.
  - **Reverse:** n/a — verification + two small product fixes.

### D-36 — Model Pool ledger: price runtime-discovered slugs from OpenRouter's real `usage.cost` (option a)
- **Question:** `trackAiCall({ model })` was typed as a compile-time
  `TrackedModel = keyof typeof OPENROUTER_SLUGS`, but the Model Pool discovers
  free slugs at runtime and cannot register them ahead of time. How does a
  pool call land in the `ai_usage` ledger without breaking the "unmapped prices
  NULL, never $0" invariant?
- **Options:** (a) widen `trackAiCall` to accept an arbitrary canonical
  OpenRouter slug, priced from the provider's authoritative `usage.cost` (fall
  back to the rate card by slug, else NULL); (b) register a curated allowlist
  of verified free slugs in `OPENROUTER_SLUGS`.
- **Chosen:** (a) — user selected "A". Additive, and preserves the map's own
  documented behaviour (NULL-never-$0). (b) would rot the moment OpenRouter
  renames or retires a free slug, and would re-introduce exactly the
  hard-coded-from-memory list the Model Pool brief forbids.
- **What changed (all pure, unit-tested at $0):**
  - `usage.ts`: the openai-format extractor (shared by the `openai` and
    `perplexity` providers) now captures `usage.cost` into
    `ExtractedUsage.cost`. OpenRouter serves everything in OpenAI wire format
    and returns the real spend here — `0` for a `:free` model, which is a real
    cost, not an absence.
  - `track.ts`: `AiCallSpec.model` widened to `TrackedModel | (string & {})`
    (literal autocomplete preserved via the intersection trick); `buildRow`
    converts a finite `usage.cost` to integer micro-USD on
    `AiUsageRow.providerCostMicroUsd`, else null.
  - `models.ts`: `isOpenRouterSlug(model)` (true when the string contains
    `/`); `openRouterSlug` passes an already-canonical slug through so the rate
    card can price it, with a guard that never stacks `:batch` onto a slug that
    already carries a variant (`:free:batch` is not a thing).
  - `pricing.ts`: pure `resolveCostMicroUsd({ providerCostMicroUsd, tokens,
    pricingSlug, rates })` — precedence real provider cost → rate card by slug
    → null.
  - `sink.ts`: uses `resolveCostMicroUsd`; reports an unmapped model to Sentry
    only when there is neither a pricing slug nor a provider cost (a pool slug
    with a real `usage.cost` is correctly priced, not "unmapped").
  - `ai-usage.test.mts`: +5 tests (slug pass-through vs short unmapped id; no
    `:batch` stacking on a variant; extractor carries `usage.cost` incl. a real
    0 and null when absent; `buildRow` micro-USD conversion; cost precedence).
    **23/23 green**, tsc + eslint clean.
- **Side effect to flag for veto:** because the openai/perplexity extractor now
  reads `usage.cost`, EVERY row tracked under `provider: 'openai'` or
  `'perplexity'` will prefer OpenRouter's real spend over rate-card list-price
  estimation. That is strictly more accurate, but it changes historical
  behaviour for non-pool calls too. If you want the real-cost preference scoped
  to pool slugs only, say so and I'll gate it.
- **Docs touched:** AGENTS.md "Adding a model" rule now documents the escape
  hatch; `scripts/check-ai-models.mjs` header notes that runtime slugs are
  deliberately out of its scope (the pool probes them instead).
- **Why:** the Model Pool brief forbids hard-coding free slugs from memory and
  requires discovering + verifying them at runtime; the ledger had to accept a
  slug it has never seen without silently zeroing the cost.
  - **Reverse:** revert the six files above; `TrackedModel` returns to a closed
    union and pool calls must go through a registered allowlist (option b).
    No migration — no schema column changed (`providerCostMicroUsd` is folded
    into the existing `cost_micro_usd` at write time).
- **Still blocked:** live verification of the pool transport (and the M8
  resilience benchmark) remains gated on the $0 OpenRouter key (D-32). This
  change is $0/unit-tested only; no live call was made.

---

### D-37 — Model Pool: gate media-generation models out of the completion pool (audio/image are not text candidates)
- **Question:** the first live run of the swapped-in pool (run 40) *completed*
  with no error event, but the synthesizer was served by
  `google/lyria-3-clip-preview` and returned lyric-timestamp garbage
  (`[0.0:] Assessing strategies for index sharding…`) that the transport counted
  as a success. Why did a music model serve a text-synthesis step, and how do we
  stop it?
- **Root cause (measured, not assumed):** `buildPoolModels` ingested EVERY
  catalog entry with a string id. The registry read `architecture.input_modalities`
  only to set the `vision` capability and never inspected `output_modalities`, so
  audio-generation and image-generation models became selectable "text"
  candidates. A live `GET /api/v1/models` (466 models) confirms the leak: **451
  are text-only, 11 are `image+text`, 4 are `audio+text`** (Lyria is one; its real
  metadata is `modality: text+image->text+audio`, `output_modalities:
  ["text","audio"]`). On the credit wall the failover loop walked past the
  premium heads and landed on Lyria, which answers 200 with media-shaped text —
  a silent wrong-model degradation, worse than an honest failure.
- **Chosen fix (pure, metadata-driven — no name/slug guessing):** add
  `isTextGenerationModel(raw)` to the registry: a pool model must output `text`
  and NOTHING else (`output_modalities` includes `"text"` and every entry is
  `"text"`). `toPoolModel` returns `null` for anything else, so `buildPoolModels`
  drops all 15 media models. Absent `output_modalities` is treated as
  not-provably-text and excluded (conservative; the whole live catalog sets it,
  and all three pinned premium routing targets — gpt-4.1, claude-sonnet-4.5,
  gemini-2.5-flash — are text-only and unaffected).
- **What changed:** `src/lib/model-pool/registry.ts` (+`outputModalities`,
  +`isTextGenerationModel`, gate in `toPoolModel`); `registry.test.mts` +5 tests
  (text-only eligible; audio/image excluded; audio-only excluded; absent
  modalities excluded; `toPoolModel` null for Lyria; `buildPoolModels` drops
  audio+image and keeps the text models). **146/146 model-pool green**, tsc 0,
  eslint 0.
- **Why this belongs in the registry, not selection:** selection scores
  candidates it is given; a media model has no business being a candidate at all.
  Filtering at ingest means every downstream consumer (select, failover, health
  panel, M6 badges) sees a text-only pool with no repeated guard.
- **Reverse:** delete `isTextGenerationModel` + its call in `toPoolModel`; the
  pool re-admits audio/image models. No migration, no schema change.
- **Live re-verification BLOCKED (not by this change):** after restarting the dev
  server on the fixed registry, the confirmation run (run 41) died at the
  researcher with `OpenRouter 402: "This account never purchased credits"`. A
  direct `GET /api/v1/credits` returns **`total_credits: 0`, `total_usage:
  $0.2136`** — the key is unfunded again (see the ACTIVE BLOCKER below). The
  researcher's web-research spend is the PAID `perplexity/sonar` MCP tool, which
  is deliberately outside the pool failover (D-20 / runner.ts) and has no free
  equivalent, so it 402s on a $0 key and cascades (code failed, synthesizer
  skipped, run failed). The media-model gate is proven at $0; the end-to-end live
  pass needs a funded key.
- **Flag for the user:** run 40's Lyria output shows a media model can masquerade
  as a successful text completion. The gate fixes the pool, but the same sonar
  dependency means an unfunded key can never complete a research-bearing run —
  funding the key is the only path to a live green run (no free web-search model
  exists to fail over to).

---

### D-38 — Chat: streaming pool failover + a boot-time free-model warm-up, and the cross-bundle singleton that made it work
- **Question:** the Chat workspace showed *"Jev was unavailable (jev_http_429) — fell back to the default model"* then a red **"This turn failed / Stream ended before a response arrived."** Why does chat fail, and how do we make it answer on a $0 key?
- **Root cause (measured, three layers):**
  1. **No failover.** `POST /api/chat` routed via Jev to one closed-label model and called `streamCompletion(model.slug,…)` directly — a single model, no chain. On the unfunded key (`total_credits: 0`, D-37) the routed premium model 402s and the turn dies with nothing to fall back to. The *"Stream ended…"* string in the screenshot is `use-chat.ts` reporting a stream that closed with `pending` still true and zero content — reproduced live when a dev-server restart cut the SSE mid-turn; the *reproducible* break is the 402-with-no-failover.
  2. **App-gated free models.** Once failover walked to the free tier, the top-ranked `:free` models were `thinkingmachines/inkling:free` and `inkling-small:free`, which OpenRouter gates to approved agentic harnesses and answer **403** (*"only available on agentic harnesses … openrouter.ai/apps"*). Ledger rows 144–147 for one turn show the chain walk: gemini(402) → `openrouter/pareto-code`(402) → `inkling:free`(403) → `inkling-small:free`(403). 403 was classified `bad-request` (not failover-worthy), so the loop **stopped** on the first gated model instead of walking on.
  3. **Nothing remembered, and the warm-up couldn't reach the route.** 403 needed to be failover-worthy; a proven-gated model needed to *sink* below an unprobed one; and the pool needed to know which free models actually serve *before* the first user turn. A boot warm-up was added — but the first chat **still** hit `inkling-small`, because in dev Turbopack evaluates `instrumentation.ts` and the route/agent bundles as **separate module graphs**, so a module-scoped `let singleton` gave the warm-up a *different* registry than the chat route read. The probes were real but invisible to selection.
- **Chosen fix:**
  - **Streaming failover in the chat route** (`src/server/api/chat.ts`): resolve an ordered candidate chain (`resolveChatCandidates` → `selectCandidates`, preferredSlug = Jev's routed model), then stream each candidate in turn. Each attempt runs in its own `trackAiCall` (head keeps Jev's provider/model; failover candidates are recorded as `openai` + the real slug per D-36) and returns `{usage, errored, emitted, error}` so the outcome is read in straight-line code (TS can't narrow closure-assigned vars). Once a candidate **emits a token** we commit to it (no duplicated partial text); `recordProbe` folds every attempt back into the pool. `done.model` reports the slug that **actually answered** and a new `degraded:true` flag marks the fallback. A catalog outage degrades to "just the routed model" (pre-pool behaviour), never an error.
  - **403 → `unavailable`** (`classify.ts`): app-harness gating is a model↔caller restriction, so another model can serve — it is failover-worthy, and the breaker remembers it.
  - **Second free slot + centred score** (`select.ts`): `guaranteeTierFallback` reserves *two* free slots (a single one is fragile when several `:free` models are gated), and `scoreInTier` centres successRate at 0.5 (`(rate-0.5)*500`) so a **proven** failure (0) ranks *below* an unprobed model (null→0) instead of tying — a gated model stops leading the free tail run after run.
  - **Boot warm-up** (`src/server/model-pool/registry.ts` `warmFreeModelProbes`, kicked non-blocking from `instrumentation.ts` `register()`): discover the free tier at runtime and **verify each with a real test call** (exactly the brief's instruction — never a hard-coded slug list). Sequential tiny `completeOnce(slug,[{user:"Reply with the single word OK."}],16)` with a 15s per-probe timeout; success → `recordProbe(ok:true)`, structural failure (`unavailable`/`insufficient-credits`) → `recordProbe(ok:false)` so it sinks, transient (429/5xx/timeout/bad-request) → **not recorded** so a boot-burst rate-limit doesn't poison a good model. Free models are $0, so the warm-up never spends.
  - **globalThis singleton** (the actual unblock): the registry (and the warm-up's once-flag) now hang off `globalThis`, one per process and shared across the instrumentation + app bundles and HMR — the same reason the Prisma client is cached there. Now the warm-up's probes are the ones selection reads.
- **What changed:** `chat.ts` (failover loop, `resolveChatCandidates`, `estimateMinContext`, `FAILOVER_WORTHY`, per-attempt `trackAiCall` + `recordProbe`, honest `done` + `degraded`); `openrouter.ts` (`StreamEvent` error carries `status`); `chat-stream.ts` (`DoneEventPayload.degraded?`); `classify.ts` (403→unavailable); `select.ts` (second free slot, centred `scoreInTier`); `registry.ts` server wrapper (`warmFreeModelProbes`, globalThis singleton, structural-vs-transient probe recording); `instrumentation.ts` (kick the warm-up); +3 tests (select ×2, transport ×1 for the 403). **149/149 model-pool green**, tsc 0, eslint 0.
- **Live verification (measured, $0 key):** after restart the warm-up logged **`probed=20 working=14 gated=3 transient=3`** — `gatedSlugs` are exactly `thinkingmachines/inkling-small:free`, `thinkingmachines/inkling:free`, `inclusionai/ling-3.1-flash`; 14 verified-working free models (nemotron family, qwen3.8-27b:free, cohere/north-mini-code:free, openrouter/free, …). The **first** chat after warm-up now streams real tokens and completes: `done.model.slug = nvidia/nemotron-3-ultra-550b-a55b:free`, `degraded:true`, `cost:0`, Jev's routed label still reported as `gemini`. Two consecutive runs served `nemotron-3.5-content-safety:free` and `nemotron-3-super-120b-a12b:free` — deterministic, no gated model, no error.
- **Deliberate exception:** warm-up probes use `completeOnce` directly, **not** `trackAiCall` — they are $0 infrastructure health checks (their outcome lives in the pool's `recordProbe` measurements), and writing ~20 ledger rows per boot would pollute the usage dashboard with non-user work. User-facing chat attempts are still fully tracked (one ledger row per real attempt, failures included).
- **Reverse:** remove the `warmFreeModelProbes` call from `instrumentation.ts` and the chat route reverts to single-model streaming if the failover loop is also removed; the globalThis singleton can revert to a module `let` only if instrumentation no longer warms the pool. No schema/migration.
- **Flag for the user:** chat now *works* on the $0 key by degrading to a verified free model (label says Gemini/GPT, the badge/`done` honestly names the free model that answered). A **funded** key is still what makes chat answer on the *routed* premium model with no `degraded` flag — and remains the only path to a live green AgentOS run (D-37's sonar dependency).

### D-39 — Model Pool MP-M6: surface the pool in the UI (health panel, chat failover badge, AgentOS failover SSE events) + preserve measurements across a catalog refresh
- **Question:** the pool already failed over (D-38) but nothing *showed* it. MP-M6 (§14) asks for the pool to be visible: a dashboard health panel, Free/Premium + degraded/failover badges, and `model_failover`/`model_unhealthy` SSE events the run view renders live and on replay.
- **Chosen fix (three surfaces, one shared truth):**
  - **Pool-health endpoint + dashboard panel.** A PURE view-builder `buildPoolHealth(models, {stale,lastRefreshedAt})` (`src/lib/model-pool-health.ts`, 4 unit tests) maps the registry's runtime `PoolModel[]` → `PoolHealthResponse` with an honest summary: free/premium counts, probed, healthy, open circuits, and the **measured** free-tier split `freeWorking`/`freeGated`/`freeUnprobed`. An unprobed model reports `successRate:null` (the panel shows "—", never a fabricated 100%); presentation order floats verified-serving free models first. `src/server/api/model-pool.ts` reads the SAME globalThis registry singleton the chat route + boot warm-up use (`getModelRegistry().getModels()` + `isStale()`/`lastRefreshedAt()`), so the panel reports real measured health, not a re-fetch. Thin `createApiRoute` adapter at `src/app/api/model-pool/route.ts`; TanStack hook `use-model-pool-health.ts` (15s refetch so a warm-up finishing after first paint is picked up); `pool-health-panel.tsx` mounted in `dashboard-view.tsx` beside the benchmark panel.
  - **Chat failover badge (MP-M6-B).** `telemetry.tsx` renders a `pool failover` warning chip when `telemetry.degraded` is true, with a tooltip explaining the routed model was unavailable (the $0-key credit wall) so the pool served a verified free model — the `model` chip names what actually answered.
  - **AgentOS failover SSE events (MP-M6-A).** `runWithFailover` already emitted `model_failover`/`model_unhealthy` via `onEvent` (`failover.ts`), but nothing forwarded them. Threaded `onEvent` through `PoolCallOptions` (`runner.ts`) into `runWithFailover`, and each OpenRouter-calling agent (`generating-agent`, `critic`, `code-agent`) forwards to `ctx.emit`. The two event shapes are reused verbatim from `model-pool/types.ts` as new `OrchestrationEvent` union members (single source of truth — the run view and replay render a failover identically). The SSE route (`run.ts` `send(event.type, event)`), persist (`store.ts` `payload: event`) and replay (`replay.ts` `name: e.type`) are all **generic**, so no per-type code was needed there. The pure reducer (`run-view.ts`) folds both into a `poolEvents` timeline + a per-step `roster.degraded` flag (only on an existing row — never a phantom), and `run-view.tsx` renders a conditional "Model Pool Failover" panel + a `+FAILOVER` roster tag. 4 new reducer tests.
- **The real bug this surfaced (measurement wipe):** the first live `curl /api/model-pool` returned `probed:0, freeUnprobed:20` even though the boot warm-up had recorded probes. Cause: `getModels()` past its 10-min TTL calls `load()`, which rebuilt `cache` from the fresh catalog and **discarded every `recordProbe` measurement** — so a refresh made the pool (and selection) forget which free models were verified-serving, walking straight back into an app-gated 403. Fix: `load()` now carries each model's `health` + `measurements` forward by slug and recomputes tags from fresh structural metadata + preserved measurements (a refresh re-reads pricing/metadata, NOT our measured reliability). New unit test `registry: a TTL refresh preserves measured health but re-reads fresh metadata`.
- **What changed:** `model-pool-health.ts` (+test, NEW); `server/api/model-pool.ts`, `app/api/model-pool/route.ts`, `use-model-pool-health.ts`, `pool-health-panel.tsx` (NEW); `dashboard-view.tsx` (mount); `telemetry.tsx` (badge); `lib/model-pool/registry.ts` (measurement preservation +test); `orchestra/types.ts` (2 union members); `server/model-pool/runner.ts` (`onEvent`); 3 agents (`ctx.emit`); `lib/agentos/run-view.ts` (+test) and `components/agentos/run-view.tsx` (timeline + degraded tag). **471/471 green**, tsc 0, eslint 0.
- **Live verification (measured, $0 key):** `GET /api/model-pool` → 200 with `total:451, free:20, premium:431`; after a restart the warm-up logged `probed=20 working=1 gated=3 transient=16` (the burst tripped free-tier RPM, so 16 were transient and correctly NOT recorded) and the endpoint reflected exactly that: `probed:4, freeWorking:1 (stealth/space-bunny-alpha succ=1), freeGated:3 (inkling:free, inkling-small:free, ling-3.1-flash succ=0), freeUnprobed:16`. Dev log free of compile errors.
- **Not browser-verified (honest gap):** the dashboard panel, the chat `pool failover` badge and the run-view failover timeline are auth-gated pages; the browser session had no cookie and creating one was out of scope, so their **visual render is unconfirmed** — validated by tsc/eslint/unit tests + the live endpoint only. A live AgentOS run to observe real `model_failover` events end-to-end is still blocked by the unfunded key (D-37/D-38: the researcher's paid `perplexity/sonar` has no free fallback).
- **Reverse:** delete the four new M6-C files + the `dashboard-view` mount to remove the panel; drop the 2 union members + the `onEvent` threads + the reducer cases to remove the SSE events. The `load()` measurement-preservation fix should stay regardless — reverting it re-introduces the wipe. No schema/migration.

---

### D-40 — UI unification: one light-editorial token system for the whole product (UIUX.md Phase 0 → Milestone 1)
- **Question:** the landing/login/signup are a refined light-editorial design, but the in-app screens (chat, run view, dashboard) use a *separate* swappable dawn/dusk theme built on a **blue `--accent` (#2454b8)**, Inter headings, a mono "terminal" run view, and a decorative grain/sheen/magnetic layer — a visible style break. How do we make the whole product read as one, changing **no functionality**?
- **Audit (Phase 0, `docs/design-tokens.md`):** crawled every route/screen; two disjoint token sets confirmed. Mismatches by severity — 🔴 blue-accent identity everywhere in-app, dark-mono run view, no serif headings in-app, decorative motion layer; 🟡 Card `shadow-sm` vs shadowless hairlines, no shared in-app shell/nav, missing table/tabs/dialog/tooltip primitives, dead `--font-display` (Space Grotesk loaded, never applied); 🟢 arbitrary Tailwind values in run-view, sanctioned provider brand hexes, `global-error.tsx` literal hex.
- **User decisions (this session):** (1) **Dark theme → keep a toggle, but craft a *refined dark-editorial* dusk** derived from the same neutral ink family (NOT the blue terminal scheme). (2) **Motion layer → keep** grain/sheen/magnetic, recoloured to fit. (3) **Charts → muted neutral accents** (near-black + grays, ≤2 muted series colours, distinguished by labels/patterns — provider brand hexes no longer the primary series identity). Scope defaults: exclude `/admin` (no page) + `/analytics-demo` (scratch); authenticated before/after shots captured in the user's browser (classifier blocks my navigation to gated screens).
- **Chosen fix — Milestone 1 (tokens only, zero functional change):**
  - **One palette:** the swappable `:root` **dawn** values now mirror the marketing palette exactly (`--bg #f7f8fa` paper, `--surface #ffffff`, `--surface-hover #eef0f2`, `--border #e4e7ea` hairline, `--text #141414` ink, `--text-muted #3d4349`, `--text-faint #5b6472`). In-app screens that already use `bg-bg`/`text-text`/`border-border` become light-editorial with no component edits.
  - **`--accent` blue → ink/paper action pair:** dawn `--accent #141414` (near-black, `--accent-ink #f7f8fa`), dusk `--accent #f5f5f4` (near-white, `--accent-ink #141414`). Every `bg-accent text-accent-ink` consumer (primary buttons, user chat bubble, theme-toggle active, badge default, chart series, progress bars, links) flips to the editorial identity **automatically** — the leverage of a real token system. Focus rings (`outline-accent`) go near-black, matching the auth inputs.
  - **Refined dark-editorial dusk:** neutral near-black canvas `#131313` / surface `#1a1a1a` / warm paper-white text `#f5f5f4`, no blue; the `prefers-color-scheme` no-JS fallback block mirrors it. `themeColor` meta updated (`#f7f8fa` / `#131313`).
  - **Fonts:** dropped the dead **Space Grotesk** load; repointed `--font-display` to the editorial **serif** (EB Garamond) so it becomes the single heading face for marketing *and* app (a `font-display` utility now exists for in-app headings); `--font-serif` kept as an identical alias.
  - **Motion kept, calmer:** `--sheen-opacity` 0.35→0.14 and the sheen `--ring-color` now derives from the neutral accent (soft gray highlight, not a coloured glow); grain unchanged.
  - **Token lint (Phase 1 "no raw values"):** `scripts/check-design-tokens.mjs` scans `src/components` + `src/app` (75 feature files) for raw hex + hard-coded font families, with a 3-file allowlist (global-error.tsx own `<html>`, layout.tsx themeColor meta, door-illustration.tsx SVG art) and an `allowlist token` per-line escape. Wired as `pnpm check:tokens` **and** `scripts/design-tokens.test.mjs` so `pnpm test` enforces it. Verified: the only 3 files containing hex are exactly the 3 allowlisted → genuinely green, allowlist load-bearing.
- **What changed (M1):** `globals.css` (dawn/dusk/prefers-dark palettes, `--font-display`/`--font-serif`, sheen opacity, comments), `[locale]/layout.tsx` (removed Space Grotesk import+const+var, themeColor), `design-tokens.ts` (header comment), `package.json` (`check:tokens`), + `scripts/check-design-tokens.mjs`, `scripts/design-tokens.test.mjs`, `docs/design-tokens.md` (this audit). **No component logic touched.** tsc 0, eslint 0, token-lint ✓, token test 1/1, `GET / 200`.
- **Deferred (tracked, later milestones):** off-scale arbitrary spacing (run-view `text-[11px]` etc.) — the lint enforces hex+fonts now and extends to spacing as screens are refactored; `global-error.tsx` blue `#2454b8` → new palette (M7); `markdown.tsx` inline-code `text-accent-ink` on `bg-surface-hover` is near-invisible in light (**pre-existing**, not a regression — accent-ink was already near-white) → fix in M4; provider brand hexes in `models.ts` → mute/relabel in M6.
- **Reverse:** restore the old dawn/dusk hex values in `globals.css` and re-add the Space Grotesk load to revert the identity; delete `scripts/check-design-tokens.mjs` + its test + the `check:tokens` script to drop the lint. No schema/migration, no data-flow change.

---

## V3 — OpenRouter → NanoGPT provider migration (Phase 0 decisions, 2026-10-08)

Source brief: `AGENTOS_FINAL_PROMPT_V3.md`. User confirmed scope this session:
**Full V3 (M2→M11)** · cost model **Curated USD price table** · slug map **Use verified
nearest siblings**. Verified provider facts live in `agentos-integration-notes.md` §8.

### D-41 — One shared NanoGPT client; base URL, auth, headers, env var
- **Question:** how to migrate every OpenRouter call path to NanoGPT with exactly one place that knows the base URL + auth (V3 §5.0 "One client module").
- **Options:** (a) rename/repoint the existing `src/server/ai/openrouter.ts` in place; (b) create a new `lib/llm/` client and delete the old; (c) keep both behind a switch.
- **Chosen:** **(a)** — repoint the existing single client file (`src/server/ai/openrouter.ts` → the NanoGPT base `https://api.nano-gpt.com/v1`, `NANOGPT_API_KEY`, drop `HTTP-Referer`/`X-Title`) and rename the file + its exported symbols to `nanogpt.ts`/`NanoGPT*` so the repo-wide `openrouter` grep returns zero live hits (V3 §1 rule 9). (c) is rejected — a provider switch that leaves dead OpenRouter paths violates rule 9; (b) is a larger diff for no gain since the client is already the single seam.
- **Why:** the file is already the ONLY completion client (raw fetch + manual SSE, no SDK installed — nothing to remove). Smallest reversible diff that satisfies "one client module" + "zero live OpenRouter paths". `env.ts` swaps `OPENROUTER_API_KEY`→`NANOGPT_API_KEY`; `.env.example` gets a `NANOGPT_API_KEY=` placeholder; the real `.env.local` already carries `NANOGPT_API_KEY` (normalized this session). The old `OPENROUTER_API_KEY` line in `.env.local` is left in place **unused** (never delete the user's key material without noting it — V3 §5.0); noted here.
- **Risk:** symbol rename touches every importer; mitigated by typecheck (a missed import is a compile error). **Reverse:** `git revert` the rename commit; no schema/data change.

### D-42 — Cost model: curated per-1M USD price table (NanoGPT returns no `usage.cost`)
- **Question:** OpenRouter's `usage.cost` was the authoritative spend; NanoGPT's `usage` has token counts but **no monetary field** (verified, notes §8b). How is cost computed now?
- **Options:** (a) curated static per-1M USD table in `lib/models.ts`, cost = `tokens × price / 1e6`; (b) fetch NanoGPT `?detailed=true` live and parse per-1M numbers into the existing rate card; (c) keep the OpenRouter per-token-string rate card (impossible — wrong provider + wrong units).
- **Chosen:** **(a) curated table** as the single source of truth (user's explicit choice), with the verified numbers from notes §8c. The ledger's `resolveCostMicroUsd` precedence changes from *provider usage.cost → rate card → NULL* to *tokens × curated price → NULL when the slug has no curated price*. The live `?detailed=true` fetch (b) is kept only as an optional cross-check/dev script, not on the request path.
- **Why:** a curated table is deterministic, testable with no network, and matches the user's decision. NanoGPT's `?detailed=true` prices are stable (per-1M USD numbers) so a static table doesn't rot the way a per-token string card would. Cost stays integer micro-USD so the spend caps (`PER_RUN_CAP_USD`/`NIGHTLY`/`BENCHMARK`) remain exactly enforceable in code BEFORE each paid call.
- **Risk:** a curated price can drift from NanoGPT's live price → periodic re-verify (dev script diffs the table against `?detailed=true`). A slug missing from the table prices **NULL** (never a fabricated 0) — same invariant as before. **Reverse:** swap the table read back to a live fetch; the micro-USD arithmetic is unchanged.

### D-43 — Slug substitutions: three user-named slugs are absent on NanoGPT
- **Question:** V3 §5.0 req 4 names `google/gemini-2.0-flash`, `anthropic/claude-3.5-sonnet`, `deepseek/deepseek-r1`; the live 632-model list has **none** of them (nor the current `models.ts` `google/gemini-2.5-flash`).
- **Options:** (a) invent/keep the named slugs (they'd 404); (b) pick nearest verified sibling per §5.0/§8; (c) drop the affected routes.
- **Chosen:** **(b)** — `google/gemini-2.0-flash` **and** `google/gemini-2.5-flash` → **`gemini-2.5-flash`** (0.3/2.5); `anthropic/claude-3.5-sonnet` → **`anthropic/claude-sonnet-4.5`** (3/15); `deepseek/deepseek-r1` → **`deepseek-r1`** (0.4/1.7). `openai/gpt-4o-mini` (0.15/0.6) and `meta-llama/llama-3.3-70b-instruct` (0.05/0.23) are present, unchanged. The "gpt" complex-route label → **`openai/gpt-4.1`** (2/8, 1M ctx, tool_calling), strongest verified GPT-family, kept as the `models.ts` gpt flagship.
- **Why:** NanoGPT drops the `google/` and `deepseek/` vendor prefixes for those families; the siblings are the same model generation the user intended (Gemini 2.5 Flash, Claude Sonnet 4.5, DeepSeek-R1). Verified present + priced (notes §8d). Never invent a slug (§8).
- **Risk:** a substitution is a different model than literally named → logged here + flagged in the morning report per §5.0. **Reverse:** edit the `slug` fields in `lib/models.ts`; the catalog is the only place slugs live.

### D-44 — No free LLM tier on NanoGPT → degradation chain is all-paid
- **Question:** §5.3 wants flagship → cheaper sibling → **free variant** fallback. NanoGPT has only 2 zero-price models (`nano-gpt-help`, `auto-model`), both meta-helpers, not chat LLMs (notes §8e). There is no `:free` convention.
- **Options:** (a) keep the free rung pointing at the 2 meta-models (they can't answer chat); (b) drop the free rung — chain ends at the cheapest reliable paid model; (c) treat `meta-llama/llama-3.3-70b-instruct` (0.05/0.23) as the "free-equivalent" cheap floor.
- **Chosen:** **(b)+(c)** — the per-family chain becomes **flagship → cheaper paid sibling → `meta-llama/llama-3.3-70b-instruct`** (strongest cheap model) as the last resort, every degraded answer badged with the model that actually answered. The Model Pool's free-tier machinery is retired/repurposed: `isFreeModel`'s `:free`/0-price test now matches nothing useful, `limiter.ts`'s OpenRouter free-tier RPM quotas (2/6/40/142) don't apply, and the boot `warmFreeModelProbes` no longer has a free tier to warm — it becomes a cheap-tier health probe or is removed (decided in M2).
- **Why:** there is genuinely no free chat model to fall back to; pretending otherwise would 404 or return a meta-help non-answer. The funded key means paid fallback is acceptable inside caps. Honest badging (§5.3) is preserved.
- **Risk:** every degraded call now costs real money → the spend caps + cheapest-floor model bound it. **Reverse:** if NanoGPT later lists free models, re-add the free rung in `select.ts`.

### D-45 — Research MCP backend has no NanoGPT search model → no-external-search mode
- **Question:** the Research MCP tool used `perplexity/sonar` (OpenRouter). NanoGPT has **0** search-capable models and **no** sonar/perplexity (notes §8e). §7 research priority (1) is unavailable.
- **Options:** (a) §7 priority (2) a keyless open search endpoint (needs terms check / possible new dependency); (b) §7 priority (3) documented no-external-search mode — RAG over provided/local docs + clearly-marked model knowledge; (c) leave the dead sonar slug (would 404).
- **Chosen:** **(b)** for M2 — stop referencing `perplexity/sonar`; the research tool degrades to a clearly-marked no-external-search mode (evidence hub over local/provided docs, model knowledge labeled as such, never a fabricated citation). Revisit (a) only if a keyless endpoint is approved later (zero-new-key policy).
- **Why:** never invent search results (§8); a tool failure must be reported as a failure, not papered over. (b) is zero-new-key, zero-cost, and honest. This is an M4–M9 re-verification item; M2's job is only to remove the dead-slug dependency so nothing 404s.
- **Risk:** research answers lose live web grounding → disclosed in the run view + morning report as a known limitation. **Reverse:** wire a verified search backend into `src/server/mcp/research-server.ts` behind the same `ToolRegistry` interface.

### D-46 — Chat degradation chain is family-aware and built from the curated catalog (M3, §5.3)
- **Question:** §5.3 wants the chat's failover chain to be **flagship → cheaper sibling in the SAME family → free variant**. The pre-M3 chat built its chain from the Model Pool's `selectCandidates`, whose tail is score-ordered across ALL premium models (measured reliability, latency, context) — NOT family-aware, so a failing Claude could fall to a Gemini. On the funded key the flagship leads and answers, so the tail rarely fires, but the spec's per-family ordering was not guaranteed.
- **Options:** (a) leave the pool-score tail (works, but not the §5.3 family ordering); (b) make `select.ts` family-aware (changes the shared policy the AgentOS agents also use — wider blast radius); (c) build a PURE per-family chain from the curated catalog (`src/lib/models.ts`) as the HEAD of the chat chain, and append the health-aware pool candidates behind it for cross-family depth.
- **Chosen:** **(c)** — new pure module `src/lib/chat-model-chain.ts` → `familyDegradationChain(headSlug, headDisplayName)`: head (Jev's pick) → cheaper same-family siblings (nearest-cheaper first, by summed in+out per-1M) → `CHEAP_FLOOR_SLUG` (`meta-llama/llama-3.3-70b-instruct`). "Cheaper" is strictly a step DOWN, so a pricier same-family model (e.g. `gemini-2.5-pro` over the routed `gemini-2.5-flash`) is never inserted. `resolveChatCandidates` in `src/server/api/chat.ts` leads with this chain (no network fetch needed for the head) then appends pool candidates up to `MAX_CHAT_CHAIN=6`. 9 pure unit tests at $0.
- **Why:** deterministic, spec-faithful family ordering; the head no longer depends on a 632-model catalog fetch (lower TTFT, survives a catalog outage); reuses the curated prices so every rung is costable and never NULL; leaves the shared pool policy (and the AgentOS agents) untouched. The pool tail still adds health-aware cross-family depth (circuit-open models skipped).
- **Risk:** the chat chain is now curated-catalog-bounded at the head (a brand-new NanoGPT model won't lead a family until added to `NANOGPT_CATALOG`) — acceptable, since §5.2 makes the catalog the single source of truth and an unknown slug is a build error by design. **Reverse:** delete `chat-model-chain.ts` and restore the pool-only `resolveChatCandidates`.

### D-47 — CORRECTION: NanoGPT's NON-STREAMING `usage` DOES carry a monetary `cost` (streaming does not)
- **Question:** notes §8b recorded "NO monetary cost field of any kind" from the one Phase-0 paid call, and D-42 built the whole cost model on `tokens × curated per-1M`. The M3 key-verification call (non-streaming, `meta-llama/llama-3.3-70b-instruct`, `max_tokens:1`) returned `usage.cost: 7.8e-7, currency: "USD"` — a real provider cost.
- **Finding (both VERIFIED):** the §8b call was **streaming** (`stream:true` + `stream_options.include_usage`) and its terminal usage chunk genuinely has NO cost field. The **non-streaming** path (`completeOnce` — the benchmark judge, the AgentOS agents, the key check) returns `usage.cost` + `usage.currency:"USD"`. So the accurate statement is: *streaming usage has no cost; non-streaming usage does.* §8b is corrected to say exactly this.
- **Options:** (a) switch the ledger + all cost figures to prefer the provider `cost` on non-streaming calls (as the old OpenRouter D-36 path did) and keep curated only for streaming; (b) keep the curated table everywhere per the user's explicit V3 decision ("Curated USD price table") and D-42.
- **Chosen:** **(b)** — keep `tokens × curated per-1M` as the single cost basis for BOTH paths. The user explicitly chose the curated table for V3, the chat (streaming) path has no provider cost so curated is the only option there, and one arithmetic across streaming + non-streaming keeps the ledger, the chat telemetry, the pool failover budget and the benchmark from drifting (the `costUsdFor`/`pricePer1MFor` shared-helper invariant in `src/lib/models.ts`). The app's stream parser (`toStreamUsage`) reads only token counts, so nothing regressed.
- **Why:** consistency + the user's decision outweigh the marginal exactness of the provider's non-streaming cost, which for these models equals the curated list price anyway (the verify call's `7.8e-7` ≈ `11×0.05/1e6 + 1×0.23/1e6`). Honest-numbers rule satisfied: curated prices are read from the live `?detailed=true` catalog, not invented.
- **Risk:** if NanoGPT's billed cost ever diverges from its published list price (discounts, dynamic pricing), the curated figure would under/over-report vs the provider's own number. **Reverse (flagged for the user):** capture `usage.cost` in the non-streaming extractor and prefer it over the rate card for those rows (re-introduces the D-36 precedence on the NanoGPT path); streaming stays curated.

---

**Outstanding human items (not autonomous):** rotate the Supabase password (recommend); delete the
leftover `ui-verify-1790900523452@jev-swarm.local` auth row (D-34); rotate the demo login password,
which is quoted in a shipped `.agent-logs` file (D-34); approve any provider/key additions beyond
the two existing keys (none planned). **RESOLVED by V3 (D-41/D-42):** the former ACTIVE BLOCKER
(D-32 — OpenRouter `total_credits: 0`) is superseded by the migration to the **funded NanoGPT key**,
verified live with one paid call 2026-10-08 (notes §8b/§9). The full M8/M10 four-setup benchmark is
unblocked once M2 lands and runs on NanoGPT within `BENCHMARK_CAP_USD`.

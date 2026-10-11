# Jev integration notes (Phase 0 — verified against live APIs, not assumed)

Per the anti-hallucination protocol: everything here was read from live docs or the
live BeatAPI/OpenRouter endpoints. Nothing is guessed. Open items are marked PENDING.

## 1. What "Jev" actually is (resolved)

The brief conflated two names. Verified reality:

- **Jev = TypeSafe AI's "System One" decision model**, exposed as a **BeatAPI
  capability**: `model:jev-1.13-free`.
- BeatAPI `inspect` tags for it literally include: `jev`, `systemone`, `system one`,
  `typesafe`, `routing`, `classify`, `decision`.
- **Pricing: `$0 input / $0 output per 1M tokens` (free tier).** Readiness: `ready`.
- Description (verbatim): "Free tier of JEV: give a state and typed questions
  (likelihood, choice or score); get typed answers with probabilities. **It does not
  generate text.**" — matches the brief: Jev routes, it never writes answers.

## 2. The `@typesafe-ai/sdk` vs BeatAPI question (BLOCKING — needs your call)

- `@typesafe-ai/sdk` **exists** on npm (v0.6.0). README: `new TypeSafeClient()` reads
  **`TYPESAFE_API_KEY`**, homepage `docs.typesafe.ai`, method `client.systemOne({ state,
  questions })`, answer at `response.answers.<name>.choice`.
- But the key you supplied is labelled **`betaapi-key`**, the setup doc is
  **`beatapi.io/SKILL.md`**, and the Jev capability lives on **`api.beatapi.io`** under
  **`BEATAPI_API_KEY`**. `docs.typesafe.ai` does **not** mention BeatAPI, a beta
  endpoint, or how to point the SDK at `beatapi.io`.
- So the SDK's documented base URL/key do **not** obviously match the key + endpoint you
  gave me. I will not silently assume they're interchangeable.

**Two viable access paths:**

- **(A) BeatAPI REST — VERIFIED, recommended.** The contract below is confirmed live and
  matches the key you provided. Free.
  ```
  POST https://api.beatapi.io/v1/capabilities/run
  Authorization: Bearer $BEATAPI_API_KEY
  { "reference": "model:jev-1.13-free",
    "input": { "state": "<user query>",
               "questions": { "route": {
                  "type": "choice",
                  "criteria": { "claude": "...", "gpt": "...", "gemini": "..." } } } } }
  ```
- **(B) `@typesafe-ai/sdk` — brief-literal, UNVERIFIED against your key.** Needs
  confirmation that the SDK can target the beta/BeatAPI endpoint and that your key works
  as `TYPESAFE_API_KEY` (likely a base-URL override the public docs don't cover).

**I need you to choose A or B** (see the plan). Same `systemOne`/`{state,questions}` shape
either way, so the app-level routing code is nearly identical.

## 3. Verified Jev request/response contract (from BeatAPI `inspect`)

Input schema (`required: [state, questions]`, `additionalProperties: false`):
- `state`: string (minLength 1) OR object — the thing to judge (the user query).
- `questions`: object, ≥1 named question, each answered independently; state billed once.
  Each question: `type` ∈ `noul` | `choice` | `score` (required);
  `criteria` (for `choice`: **required** object mapping option key → meaning);
  `instructions` (optional wording).

Output schema: `answers.<name>` =
- for `choice`: `{ type:"choice", choice:"<chosen criteria key>", confidence:number,
  probabilities:{ <key>:number } }`.

**Routing usage:** one `choice` question named `route` with criteria keys exactly
`claude|gpt|gemini`. Read `answers.route.choice` (the label), `answers.route.confidence`
and `answers.route.probabilities` (for the UI's confidence/telemetry).

**Allowed-label validation:** the brief requires the label ∈ {claude,gpt,gemini}. Because
we define the criteria keys, Jev should return one of them; still validate and fall back
if not (see plan §Resilience).

## 4. Latency measurement

The "~30–50ms" is a **claim to test, not a constant**. We measure `jevLatencyMs`
server-side with `performance.now()` around the Jev call only. PENDING: one real call to
record the actual raw response + first latency number (needs key handling approval).

## 5. OpenRouter (answers) — live model list verified

`GET https://openrouter.ai/api/v1/models` → 200, **464 models**. The brief's slugs
(GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro) are **outdated**. Current candidates seen
live (final pick confirmed at build time from the same endpoint, kept in ONE config file
`lib/models.ts` with slug, display name, colour, per-token price):
- Claude: `anthropic/claude-sonnet-4.5` (also `…-4.6`, `…-4`)
- GPT: `openai/gpt-4.1` (also `gpt-4.1-mini`, `gpt-4.1-nano`)
- Gemini: `google/gemini-2.5-flash` (confirm a `…-2.5-pro` slug for the heavier option)
- LLM-as-judge baseline (small/fast/cheap): e.g. `openai/gpt-4.1-nano` or
  `google/gemini-2.5-flash-lite` — fixed routing prompt, identical {claude,gpt,gemini}
  label set, documented for a fair comparison.

## 6. Secrets

Keys go in `.env.local` (**gitignored** — confirmed) as `BEATAPI_API_KEY` and
`OPENROUTER_API_KEY`, used **server-side only**, never sent to the browser, never logged.
`.env.example` carries placeholders only. The agent-log capture script has a redaction
backstop so a key can never be committed to the public `.agent-logs/`.

## 7. Real verification results (live calls, this environment)

Access path chosen: **(A) BeatAPI REST**. Key verified via `GET /v1/usage` → HTTP 200,
`account_name: "Mushahid"`, **`credit_balance: 0`**, **`concurrency.limit: 0`**.

**Jev real call** (`POST /v1/capabilities/run`, `model:jev-1.13-free`) — HTTP 200:
```json
{ "answers": { "route": { "type":"choice", "choice":"claude", "confidence":0.64,
    "probabilities": { "claude":0.76, "gpt":0.24, "gemini":0 } } },
  "id":"task_...", "model":"jev-1.13-free",
  "usage": { "input_tokens":343, "output_tokens":42 } }
```
Contract confirmed exactly as §3 predicted. Note `confidence` (0.64) ≠ top probability
(0.76) — treat `probabilities` as the per-label distribution and `confidence` as Jev's own
calibrated certainty; show both, don't conflate them.

**Measured latency (honest — this is the headline caveat):**
- Single successful calls: **~678ms and ~740ms end-to-end** from this client (cold), i.e.
  network + TLS + BeatAPI gateway + Jev inference. **The brief's "~30–50ms" is NOT
  reproduced end-to-end**; that figure is almost certainly server-side inference only.
- We will report the **measured** end-to-end number everywhere, per the brief ("if the
  measured number differs, show the measured number"). The speed-up story must be Jev
  (~0.7s, decision only, no text generation) **vs an LLM-as-judge** (~1.2s+, must generate
  a decision) measured identically — a real but more modest ~1.5–2x, not 30ms-vs-seconds.

**Free-tier rate limit (major benchmark constraint):** 6 back-to-back Jev calls all
returned **HTTP 429**; after a ~20s pause a single call succeeded (200). SKILL.md: "Free
keys are rate limited before first top-up; batch calls," and 429 carries
`Retry-After` / `error.retry_after_seconds`. With `credit_balance: 0` and
`concurrency.limit: 0`, the ≥50-prompt × 2-router benchmark **cannot** run at speed on this
key as-is. Options: (a) top up BeatAPI (removes the free-tier limit), or (b) run the
benchmark at concurrency 1 with spacing + honouring `Retry-After` (slow, flaky, but free).
**Needs your decision before milestone 4.**

**OpenRouter real call** (`openai/gpt-4.1-nano`, `max_tokens:16`) — HTTP 200, reply
`"pong"`, total ~1183ms. Confirmed `usage` shape for the `done` telemetry event:
`usage.{prompt_tokens, completion_tokens, total_tokens, cost,
cost_details.upstream_inference_prompt_cost, cost_details.upstream_inference_completions_cost}`.
Test cost: **$0.0000022**. Streaming (`stream:true`, SSE `choices[].delta`) to be confirmed
in milestone 2.

## 8. PENDING

- [ ] Your call on the BeatAPI rate limit / $0 balance (top up vs throttled benchmark).
- [x] Confirm OpenRouter SSE streaming shape during the milestone-2 vertical slice.
      **Confirmed live** (`POST /api/chat`): events `route -> token* -> done`. `done.usage`
      carries real `{promptTokens, completionTokens, totalTokens, cost}` — e.g. a 73-token
      turn returned `cost: 0.000194` (OpenRouter's own figure, matched the list-price
      estimate exactly for gpt-4.1). `max_tokens` MUST be capped (1024) or OpenRouter
      reserves the model's full context against the credit balance and 402s.
      The Jev 429 fallback path also fired live and surfaced honestly
      (`fallback:true, fallbackReason:"jev_http_429"`), still producing a routed answer.
- [ ] Decide whether the dashboard's headline metric is end-to-end latency (recommended,
      honest) rather than the un-reproduced 30–50ms figure.

# UI audit notes (UI-M10)

`before/` = `main` prior to the unification (served from a git worktree on :3001).
`after/` = this branch (feat/uiux-unify) on :3000. Widths: 1440 and 390 CSS px,
captured with headless system Chrome by `scripts/capture-ui-audit.mjs`.
Automated assertions (contrast, focus ring, touch targets, reflow, reduced
motion, style continuity, dashboard sections) live in
`scripts/verify-ui-checks.mjs`; its run output is `after/checks.json`.

Every statement below comes from comparing the two captured sets or from a
measurement in `checks.json`. Where something could not be measured, it is
listed under "Open items" instead of being claimed.

## Per-screen remaining differences

### Landing (`landing-1440/390`)
No visual difference between before and after — by design. The landing was
already the target aesthetic; UI-M8 moved it onto the shared token system with
zero pixel delta (verified side by side: same serif hero, door illustration,
ink Login + outline Sign up, three editorial columns, hairline divider).
One asset-level difference: `before` embeds a real screenshot preview
(`public/marketing/app-preview-2x.webp`) that shows the **pre-unification blue
charts** and telemetry from an older database state (5 routed turns, 1059 ms
avg). The live `/dashboard` in this deployment currently has zero route events,
so that image no longer matches either the shipped UI or the current data, and
its alt text ("real routing telemetry … from this deployment") would be false.
`after` therefore omits the preview (the landing code already degrades
gracefully when the file is absent). See "Open items" for regeneration.

### Login / Signup (`login-*, signup-*`, both widths)
No remaining differences. Both labels show the editorial auth pages (serif
"Welcome back" / "Create your account", door illustration, hairline inputs);
after inherits them from the shared token system unchanged.

### Protected redirect (`protected-redirect-*`, both widths)
Identical behaviour in both labels: `/app` logged out → `/login?next=%2Fapp`.

### Chat workspace (`chat-1440/390`)
Before: blue accent pills, sans-serif "Jev-Swarm" wordmark, blue active nav
state, populated sidebar ("7h ago · 11 msgs"). After: serif wordmark in the
shared `AppHeader`, hairline composer, ink Send button, neutral sidebar; the
same history and metadata render unchanged. No remaining differences at either
width; the mobile drawer, 44 px targets and no-horizontal-scroll are measured
in `checks.json`.

### Chat with a code block (`chat-code-1440`, after only)
Real persisted conversation ("Explain the difference betw…") rendering a Python
code block on a paper surface with a hairline border, mono type and a Copy
control, plus routing telemetry chips (model GPT-4.1, jev 1313 ms, total 8754 ms,
tokens 437, cost $0.000000) and the confidence bars. `before/` has no equivalent
capture: at capture time the pre-unification build's persisted history
contained no conversation with a code block. That is a capture gap, not a
regression — the markdown renderer is unchanged.

### Empty chat (`chat-empty-1440/390`)
Editorial empty state with example prompt buttons in both labels; after adds
the 44 px mobile target sizing. No other differences.

### Dashboard (`dashboard-1440/390`)
Before: sans-bold "Executive dashboard" h1, sans card titles, **blue** "Run
benchmark" button and blue active theme pill. After: serif h1 and serif card
titles, **ink** "Run benchmark" button, neutral gauge arc, ink theme pill.
Layout, sections and copy are identical in both labels (structure preserved;
only the type and colour voice changed). The current database has no
`route_events`, so both widths render the honest empty state in both labels
("no chat turns yet", "Not enough turns to draw a trend yet", "0 turns");
populated chart series colours are therefore evidenced by the token definitions
and by the per-model identity dots (Claude/GPT/Gemini) shared with the routing
visualizer, not by a populated capture in this pass.

### AgentOS run view (`runview-1440/390`)
Before: mono all-caps "AGENTOS" wordmark in a hand-rolled chrome bar. After:
the shared `AppHeader`; terminal panels, replay picker and run metadata keep
mono type for run data (intentional — the technical surface), while the page
wordmark now uses the display serif like every other view (changed in this
pass; see "Open items" — the stored `after/runview-*` shots predate that fix).

### Replay (`replay-1440`, after only)
Populated replay picker (runs #38–#44, #40 completed, real cost $0.0458) in the
unified panel styling. `before/` has no replay capture because the picker was
empty on `main` at capture time.

### Not found (`notfound-1440/390`)
Editorial 404 in both labels; no remaining differences.

## Measured this pass (`after/checks.json`, 19/19)

- Contrast on paper: body 17.34, muted 10.01, faint 5.98 (all ≥ 4.5).
- Keyboard: 2 px focus outline on the first five tab stops.
- Touch targets at 390: 0 elements under 44 px.
- No horizontal scroll at 1440 (all three views), 390 (chat) and 720 (chat,
  the 200 %-zoom reflow proxy), **and 320 (chat)** once re-measured live.
- Reduced motion: 0 running `animate-*` animations under
  `prefers-reduced-motion: reduce`.
- Chat exposes a single `aria-live="polite" role="status"` region; all 8
  decorative SVGs are `aria-hidden`.
- Dashboard sections present: cumulative routing statistics, live latency and
  routing distribution, benchmark, benchmark run history, four-setup benchmark.
- Style continuity: control radius 8 px consistent across views; no horizontal
  scroll; h1 family consistent across views (EB Garamond), re-measured live.
- Console errors: 4 in `before` and the same 4 in `after` (a Supabase auth 404
  and a React script-tag warning, both pre-existing) — the refactor introduced
  none.

The three checks that failed at 16/19, and their live re-measure (a headless
demo sign-in relayed a session cookie, so all three are now closed):

1. *h1 display serif consistent across views* — the run view overrode the
   header title to mono (fixed in `run-view.tsx`), and the in-app serif voice
   was later unified via `.title-editorial`/`.hero-editorial` (see below).
   **Live: PASS** — h1 family EB Garamond on /app, /dashboard, /agentos.
2. *reflow no h-scroll at 320 px* — `ViewNav`'s pill row could not shrink below
   its min-content (~324 px); fixed by letting the pills wrap.
   **Live: PASS** — no h-scroll at 320.
3. *send produces reply or visible error state* — the harness waited for a
   `<pre>` a plain-text answer never produces; detection now also accepts the
   telemetry chips and the danger banner/Retry. **Live: PASS** — a real
   streamed assistant reply arrived (the chat degrades to a verified `:free`
   pool model at $0, so a funded key is not required for this check).

## Type voice (the "fonts don't match" fix, 2026-10-06)

The serif family was already unified (one `next/font` EB Garamond), but in-app
headings used `font-display` at weight 500 with ad-hoc 16–20 px sizes and no
tracking, so they read as a different face than the marketing serif. Two shared
utilities in `globals.css` now carry the editorial voice at every serif
heading, marketing and in-app alike:

- `.title-editorial` — EB Garamond 19 px / 1.25 / weight 400 (landing column
  titles, auth brand line, app-header titles, card titles, empty-state titles).
- `.hero-editorial` — EB Garamond 30 px / 1.15 / weight 400 / −0.01 em
  (login/signup h1, chat empty-state hero).

Measured cross-surface equality (computed styles, 1440 px):

| Role | Landing | Login | In-app |
|---|---|---|---|
| title (19/400/23.75) | column h2 | — | app-header h1, every dashboard card h3, agentos h1 |
| hero (30/400/34.5/−0.3 px) | — | h1 | chat empty-state h2 |

Public pages re-measured unchanged after the swap (landing h1 44/400/49.28/
−0.66 px; landing column 19/400/23.75; login h1 30/400/34.5/−0.3 px). The
`after/` captures were refreshed post-fix, so `chat-empty-*`, `dashboard-*`
and `runview-*` show the unified voice.

## Open items

Closed 2026-10-06 via a headless demo sign-in (credentials read from the
project memory file at runtime; the relayed cookie lived only in the untracked
`_scratch/` and was deleted afterwards):

1. ~~Re-run `verify-ui-checks.mjs`~~ — done; now **19/19** (see above).
2. ~~Re-run `capture-ui-audit.mjs`~~ — done; `after/runview-*`, `chat-*`,
   `chat-empty-*`, `dashboard-*` refreshed post type-voice fix.

Still open:

3. Landing preview (`public/marketing/app-preview-2x.webp`) is intentionally
   **absent**. The landing only renders it when the file exists and only a real
   screenshot belongs there; the live dashboard currently holds no real run
   telemetry (the OpenRouter key is unfunded, so every panel shows its honest
   empty state). Regenerating now would advertise empty panels, so the preview
   stays omitted until a funded key produces real data to show. Regenerate with
   a 1920×1080 @2x dashboard capture once real runs exist.
4. A watched end-to-end AgentOS run (blocked on the unfunded OpenRouter key,
   unchanged from UI-M9).

Not run at all this pass, by scope: Lighthouse/perf budgeting (UI-M9 covered
motion and bundle hygiene, not a Lighthouse score).

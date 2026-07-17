---
name: diagnosing-bugs
description: Discipline for diagnosing hard bugs and performance regressions — requires a reproduction loop that goes RED on the bug BEFORE any hypothesis (signal before theory). Finds the root cause and stops; the non-trivial fix is handed to spec-create. Use when the user asks to diagnose or debug something, or reports something broken, throwing, failing or slow.
---

# diagnosing-bugs — Disciplined diagnosis

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

Discipline for hard bugs. **Skip a phase only with an explicit justification.**

The rule that governs everything: **signal before theory.** Until you have a command that
reproduces the bug and goes **red** on it, no hypothesis counts — reading code to guess the
cause is exactly the improvisation this skill exists to prevent.

**Scope (diagnosis only):** this skill finds the **root cause** and **stops**. The
non-trivial fix is handed to `spec-create` (bugfix type) — it is **not** a second execution
engine. See Phase 6.

**Before exploring:** load the domain mental model — `docs/sdd/04-domain.md` and
`08-glossary.md` (if they exist) and the ADRs in `docs/adr/` for the area you will touch. If
the `mgr-code` memory is available, consult `mgr_recall` (`have_i_seen_this`) — maybe this
bug, or a similar one, was already diagnosed.

---

## Phase 1 — Build the feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail
signal that goes red on _this_ bug, you will find the cause — bisection, hypothesis testing
and instrumentation merely consume that signal. Without it, staring at the code saves no one.

Spend disproportionate effort here. **Be aggressive. Be creative. Do not give up.**

### Ways to build the loop — try in roughly this order

1. **A failing test** at the seam that reaches the bug — unit, integration, e2e.
2. **A curl / HTTP script** against a running server.
3. **A CLI invocation** with a fixture input, comparing the output to a known-good result.
4. **A headless script** that drives the interface and asserts on observable state (output,
   logs, network).
5. **Replay of a captured trace.** Save a real payload / event log to disk; replay it
   through the isolated code path.
6. **A disposable harness.** Bring up a minimal subset of the system (one service, fake
   deps) that exercises the bug's path with a single call.
7. **A property / fuzz loop.** If the bug is "sometimes the output comes out wrong", run
   1000 random inputs and look for the failure mode.
8. **A bisection harness.** If the bug appeared between two known states (commit, version,
   dataset), automate "start at state X, check, repeat" so it can run under bisection.
9. **A differential loop.** Run the same input on the old vs. new version (or two configs)
   and compare outputs.
10. **An HITL script (last resort).** If a human really must act by hand, **drive them**
    through a structured terminal script — one step at a time, capturing each response —
    instead of a loose chat. The captured response feeds the loop. (The technique; no
    ready-made file.)

Build the right loop and the bug is 90% solved.

### Tighten the loop (keep it *tight*)

Treat the loop as a product. Once you have _a_ loop, **tighten it**:

- Faster? (Cache the setup, skip irrelevant init, narrow the test scope.)
- Sharper signal? (Assert on the specific symptom, not on "didn't crash".)
- More deterministic? (Pin time, seed the RNG, isolate the filesystem, freeze the network.)

An unstable 30s loop barely beats no loop; a deterministic 2s one is *tight* — a superpower.

### Non-deterministic bugs

The goal is not a clean repro, but a **higher reproduction rate**. Run the trigger 100×,
parallelize, add stress, narrow timing windows, inject sleeps. A bug failing 50% of the time
is debuggable; 1% is not — raise the rate until it becomes debuggable.

### When you genuinely cannot build the loop

**Stop and say so explicitly.** List what you tried. Ask the user for: (a) access to the
environment that reproduces it, (b) a captured artifact (log, dump, recording with
timestamps), or (c) permission for temporary instrumentation. Do **not** proceed to a
hypothesis without a loop.

### Completion criterion — a *tight* loop that goes red

Phase 1 ends when the loop is **tight** and **red-capable**: you can name **one command** —
a script path, a test invocation, a curl — that you have **already run at least once**
(paste the invocation and its output), and that is:

- [ ] **Red-capable** — drives the bug's real path and asserts the **user's exact symptom**,
  so it goes red on this bug and green when fixed. Not "runs without error" — it has to
  _catch this specific bug_.
- [ ] **Deterministic** — same verdict every run (unstable bug: a high, pinned repro rate).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you run it yourself; a human in the loop only via the HITL script.

If you catch yourself reading code to build a theory before this command exists, **STOP —
jumping straight to the hypothesis is exactly the failure this skill prevents.** No red
command, no Phase 2.

---

## Phase 2 — Reproduce + minimize

Run the loop. Watch it go red — the bug shows up.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a neighboring failure
  that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure reproduces across multiple runs (or, for a non-deterministic bug, at a
  rate high enough to debug).
- [ ] You captured the exact symptom (error message, wrong output, slow timing) so the later
  phases can verify the fix actually resolves it.

### Minimize

Once red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs,
callers, config, data and steps **one at a time**, re-running the loop after each cut — keep
only what is load-bearing for the failure.

Why do this: a minimal repro shrinks the hypothesis space in Phase 3 (fewer suspect parts)
and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing** — removing any one turns the loop
green.

Do not proceed without having reproduced **and** minimized.

---

## Phase 3 — Hypothesize

Generate **3–5 ranked hypotheses** before testing any. Generating just one anchors you to
the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If `<X>` is the cause, then `<changing Y>` makes the bug disappear /
> `<changing Z>` makes it worse."

If you cannot state the prediction, the hypothesis is a vague hunch — discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that
re-ranks it on the spot ("we just touched #3"), or hypotheses already ruled out. A cheap
checkpoint, big savings. Do not block: if the user is away, proceed with your ranking.

---

## Phase 4 — Instrument

Each probe maps to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the environment supports it. One breakpoint is worth
   ten logs.
2. **Targeted logs** at the boundaries that distinguish the hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end
becomes a single grep. An untagged log survives; a tagged one dies.

**Performance branch.** For a perf regression, logs tend to mislead. Instead: establish a
baseline measurement (timing harness, profiler, query plan), then bisect. Measure first,
fix later.

---

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for
it.

A correct seam is one where the test exercises the **bug's real pattern** as it occurs at
the call site. If the only available seam is too shallow (testing one caller when the bug
needs several; a unit test that does not replicate the chain that triggered the bug), a test
there gives false confidence.

**If no correct seam exists, that in itself is the finding.** Write it down. The code's
architecture is preventing the bug from being pinned. Flag it for Phase 6. — This **aligns
with anti-inflation** (CONSTITUTION `§4`): you do not create a shallow test just to "have
coverage"; the absence of a seam is information, not a reason for a worthless test.

If a correct seam exists:

1. Turn the minimized repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 loop on the **original** (non-minimized) scenario.

---

## Phase 6 — Cleanup, post-mortem and landing the fix

### Cleanup checklist (mandatory before declaring done)

- [ ] The original repro no longer reproduces (re-run the Phase 1 loop).
- [ ] The regression test passes (or the seam absence is documented).
- [ ] All `[DEBUG-...]` instrumentation removed (grep the prefix).
- [ ] Disposable prototypes deleted (or moved to a clearly marked location).
- [ ] The hypothesis that won is recorded in the **post-mortem text** — for the next person
  to learn from.

### Post-mortem (the skill produces the text; the commit is human)

This skill **produces** the post-mortem text (what the bug was, how the loop caught it,
which hypothesis won). It does **not** commit: recording it in a commit message or PR is a
**human-confirmed** step (CONSTITUTION `§5` — no automatic git action).

### Landing the fix (the skill does NOT create branches)

The diagnosis is **branch-agnostic**. The skill **does not create a branch** and **does not
decide on its own** where the fix lands — it applies this rule and **recommends**; the human
confirms:

- **Is the cause in the new code of the feature you are already working on?** → the fix
  belongs to **that branch** (it is part of finishing the feature).
- **Is the bug pre-existing?** → **never** fold the fix into the current feature's branch:
  that couples a repair to an unfinished feature. Then:
  - **Does not block the current feature?** → **defer** (safe default): record the
    diagnosis, finish the feature, fix later on its **own branch** off `main`.
  - **Blocks the current feature?** → **own branch off `main`** (which lands on its own via
    merge) and the current feature **rebases** onto `main` to inherit the fix.
- **Invariant:** no path commits directly to `main` — all work lives on a branch and `main`
  only receives merges. **Deferring is the default.**

### Delivering the repair (Option A)

A **non-trivial** repair is handed to `spec-create` (bugfix type), which plans and executes
it under governance. This skill did the diagnosis; it stops here.

### What would have prevented this bug?

Ask this **after** the fix (you know more now than at the start). If the answer involves an
architectural change (no good seam, tangled callers, hidden coupling), **flag the
architectural finding** with the specifics — a candidate for a `refactor` via `spec-create`.
Make the recommendation with the fix already in place, not before.

---

> **Origin and credit.** This skill is an **adaptation** of `diagnosing-bugs`, by Matt
> Pocock (github.com/mattpocock/skills), under the MIT license, rewritten for the MGR
> vocabulary and CONSTITUTION (diagnosis-only scope, fix landing under the project's git
> policy, language-agnostic examples). The central discipline — *signal before theory* — is
> his.

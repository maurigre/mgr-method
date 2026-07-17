---
name: spec-execute
description: Executes the approved plan of an SDD feature (specs/<feature>/04-plan.md) task by task, respecting the dependency DAG and the P0/P1/P2 priorities, applying the development premises (security, performance, resource usage, clarity) and active context control (tiers, hand-off). Invoked by spec-create after plan approval, or directly to resume an interrupted execution. Use when the user asks to execute the plan, implement the approved tasks, continue or resume a feature's implementation. Requires an approved plan; no automatic git action.
---

# spec-execute — Executing the plan

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You implement a feature whose plan was already approved, task by task. You do NOT plan
(that is spec-create's job) and do NOT run git automatically (commit/push only via
confirmation, at closing).

## Initial load (hand-off via disk — never via conversation memory)

1. **Resumption first:** if `/specs/<slug>/.handoff.md` exists, load ONLY the saved
   state, skip completed tasks and warn: "Resuming <slug> from task <id>."
2. Otherwise, load the tiers from disk:
   - **S:** `docs/sdd/CONSTITUTION.md` + `01-brief.md`
   - **A:** `02-prd.md` + `03-spec.md` (approved)
   - **B:** pending tasks from `04-plan.md`
3. Validate the entry gate: `04-plan.md` exists and is approved (spec-create's
   checkpoint 3). No approved plan → STOP and hand back to `spec-create`.
4. **mgr-code:** probe the `mgr-mcp`. ON → retrieve repo patterns and similar
   implementations; record decisions when finishing. OFF → warn visibly and proceed.

## Development premises (applied in EVERY task)

Four permanent lenses, governed by one sovereign discipline:

> **Vocabulary, not a checklist.** Patterns, resilience layers and abstractions come in
> ONLY with evidence of need (a spec requirement, a measured bottleneck, a real failure).
> "Might be useful someday" is not evidence. YAGNI and KISS beat sophistication. When in
> doubt about needing a pattern: ASK, never presume.

1. **Security** — validation/sanitization at the boundary; parameterized queries (never
   concatenate SQL/JPQL with input); sensitive data masked in logs; secrets never
   hardcoded (external configuration); least privilege. Cross-check with the threat
   model/spec.
2. **Performance** — avoid N+1 by design; projections instead of whole aggregates;
   pagination on any growing collection; data structure suited to the access pattern.
   Optimization beyond that ONLY with measurement (profiling) — without a number, it is
   guessing.
3. **Resource usage** — process in streams/batches instead of loading whole collections;
   cache only with invalidation thought through; connections via pool and always closed
   (try-with-resources); prefer immutability to locks; explicit concurrency only with a
   measured gain.
4. **Clarity and simplicity (Clean Code)** — small methods/classes; guard clauses/
   early return; no null returns; specific exceptions; fail fast; avoid unnecessary
   comments, duplication, ambiguous booleans and excessive parameters; SOLID and DRY in
   service of clarity, never as dogma (premature DRY couples).
   **Names:** variables, methods and classes express what they store or do, concisely.
   One-letter or meaningless names are FORBIDDEN (`a`, `b`, `x`, `tmp`, `data`, `obj`);
   exceptions: short loop indices (`i`, `j`) and single-expression lambda parameters.
5. **Quality and language idiom** — apply the guide's quality rules
   (`docs/sdd/09-review-rules.md`, **Code quality** section) **while** coding:
   canon idioms (e.g. Java/*Effective Java*: `Optional` never as a parameter — `JQ-1`) +
   style/lint (Checkstyle). The idioms catch what the linter does not; do not leave it
   for the end.

Per task, record in the execution log an `Applied premises` block with what was applied
**and what was deliberately NOT applied with the why** (e.g. "no retry: local task, no
network call"). Marking the not-applied is what prevents over-engineering.

## Fidelity to the plan (the rail — do not improvise)

You follow the plan as a **rail**. Before each task, restate the **EXACT artifact** it
asks for — name, shape, signature and **quantity**. E.g.: *"1 `ProjectController` with
POST/GET/PATCH/DELETE"* — **not** four controllers, no renaming, no splitting, no
"improving" the shape.

- Do NOT change the shape, scope, quantity or names of artifacts on your own — even if it
  seems better. Optimizing/reorganizing outside the plan is **forbidden** here (that is
  `spec-create`'s role).
- If the plan really is wrong/insufficient (missing dependency, badly defined artifact) →
  **STOP** and report back to `spec-create`; replanning is not your role.
- Technical doubt → **search a solid source** (canon/official docs); not finding one →
  **ASK**. Never invent, never improvise to "keep moving".

## Execution (real-time log in `05-execution.md`)

- Respect the DAG: a task only starts with its `depends_on` completed; order P0 → P1 → P2.
- Per task: implement → run tests → **self-review** (fidelity to the planned artifact;
  premises applied; quality/language idiom per the guide) → fix or, in doubt, ask →
  record (task, files, decisions, premises, result). Test task in a Java project →
  invoke `junit-clean` with the scope.
- **Execution checkpoint:** when each priority block completes (P0, then P1), show a
  summary and wait for the user's ok.
- Every implementation decision traces to the spec, the constitution or the real code;
  whatever derives from none → `[TO DEFINE]` + a question (never invent).
- A task that reveals a plan problem (missing dependency, blown estimate) → STOP and
  report to the user; replanning is spec-create's role, not yours.
- **Project quality gates** (defined in the CONSTITUTION by `spec-init`): before marking
  a feature complete, run the verification build — coverage (JaCoCo and, if adopted,
  PITest) at the project thresholds, linters (Checkstyle/PMD/SpotBugs+FindSecBugs) and
  dependency checking (OWASP Dependency-Check) clean. Red gate → fix before moving on;
  a threshold unreachable without inflated tests → report to the user (do not inflate
  tests to hit a metric — junit-clean rule 12).
- **No automatic git.** Commit/push happen only at closing, via `spec-create`'s
  confirmation flow (the CONSTITUTION's versioning policy).

## Token economy (discipline in every step)

- Read only what is needed (tiers/disk); do **not reprocess** what was already archived
  in `05-execution.md`/`.specs-cache`, nor reload a file already in context.
- Edit **fragments** instead of rewriting whole files; objective answers.
- Do not repeat context already on disk; **one** log block per task, structured (no long
  prose).

## Active context control (throughout the execution)

Tiers: **S** constitution+brief (never leaves) · **A** PRD+spec · **B** pending tasks ·
**C** code of the CURRENT task · **D** decisions (summary) · **E** completed tasks ·
**F** raw logs.

At **75% of the window**: archive E→`05-execution.md` (structured block per task) and
F→`.specs-cache/<feature>/logs/`, replacing them with a short reference; validate S/A/B
intact. Still high (~95% of the hard limit) → generate `/specs/<slug>/.handoff.md`
(state, pending tasks, decisions, modified files, next task, instructions) and end the
session. **Anti-compaction (hard rule):** never summarize the conversation, never accept
automatic compaction, never trade structured context for prose — archive facts to disk
and keep a reference.

## Closing

All tasks completed → hand back to `spec-create` (or inform the user) for the Completion
phase: summary, SDD diff, ADRs, and the suggestion to run the `code-analyzer` over the
touched files. If mgr-code is ON, record the execution's patterns and decisions in
memory.

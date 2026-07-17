---
name: spec-create
description: Implements the full SDD flow to EVOLVE a project already initialized by spec-init - receives a feature, bugfix or refactor brief, generates the PRD, technical spec and task plan with blocking human checkpoints, and after approval delegates the implementation to the spec-execute skill and, on closing, records the AI-First evidence via evidence-capture when the project policy enables it (no automatic commit). Use whenever the user asks to add or implement a feature, fix a bug with SDD, refactor preserving behavior, create a spec and implement it, or resume a feature in progress. Requires /docs/sdd/ and CONSTITUTION.md to exist.
---

# spec-create — Evolving the project via SDD

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You drive a change from brief to delivery in 6 phases with blocking checkpoints,
writing artifacts to `/specs/<feature-slug>/` at the project root.

## mgr-code integration (mandatory at the start of each phase)

Probe the `mgr-mcp`. **ON** → retrieve similar specs/features, decisions and patterns
already recorded ("we already decided this in X"); when phases complete, record the
PRD/spec/decisions in memory. **OFF** → warn visibly (degraded mode, no long-term memory)
and proceed with the on-disk artifacts only. Never silence it; never block because of it.

## Dependencies (mandatory check at the start)

Check `/docs/sdd/CONSTITUTION.md` and at least one file in `/docs/sdd/` (the script
`.mgr-core/shared/scripts/sdd-check.sh` does this). If missing, STOP:
"This project has not been initialized for SDD. Run the `spec-init` skill first."
NEVER infer a constitution or SDD at run time — the constitution is the product of deep
analysis + human review, not improvisation.

## Initial interaction (mandatory)

1. **Change type:** new feature · behavior change · bugfix ·
   refactor (no behavior change) · breaking change.
2. **Brief:** natural-language description (recorded LITERALLY in `01-brief.md`).
3. **Constitution:** show the CONSTITUTION.md principles relevant to the brief and
   ask: "Do these apply? Any override needed?"

Feature slug: kebab-case of the brief, no accents, ≤ 50 chars — confirm with the user.

## Artifact structure

```
/specs/<feature-slug>/
├── 01-brief.md       # what was asked (literal)
├── 02-prd.md         # Product Requirements (generated, reviewed)
├── 03-spec.md        # technical spec (generated, reviewed)
├── 04-plan.md        # task plan (generated, reviewed, approved)
├── 05-execution.md   # execution log (real time)
└── 06-completion.md  # final summary + diff of the updated SDD
```
(Templates in this skill's `templates/`.)

## Flow — 6 phases with checkpoints

### Phase 0 — Versioning (if the policy is enabled in the CONSTITUTION)
Before opening the spec: are there COMPLETED spec branches not yet merged?
Suggest merging them in opening order. MECHANICAL conflicts (imports, formatting, lines
with no semantic intersection) → resolve, DISPLAY the resolution diff and confirm.
SEMANTIC conflicts (the same rule changed in different ways) → mandatory HALT: present
both sides and ask — deciding which rule wins is a business decision, not a merge one.
A spec with pending execution does not enter the queue. Then create this spec's branch
(CONSTITUTION convention; default `feat/<slug>`), with confirmation. No git in the
project → skip this whole phase, no questions.

### Phase 1 — Contextualization (no interaction)
**1a. Resumption:** if `/specs/<slug>/.handoff.md` exists, load ONLY the saved state
(tiers S/A/B + decisions), skip already-approved phases and completed tasks, and warn:
"Resuming <slug> from task <id>." Otherwise, normal load:
CONSTITUTION → 01-architecture → 02-domain → 03-contracts → 08-glossary → inventory of
available skills (built-in + custom in `.claude/skills/` and `~/.claude/skills/`;
for each one, read the SKILL.md and note when it would be useful). Save to
`/specs/<slug>/.context.json` (gitignored).

### Phase 2 — PRD (`02-prd.md`)
Context and motivation · goal · use cases (actors + flow) · business rules ·
constraints · out of scope (explicit) · success metrics · stakeholders.
Critical rule: the PRD holds only the "what/why" — ZERO technical decisions.
**CHECKPOINT 1 (blocking):** approve / adjust / abort.

### Phase 3 — Technical spec (`03-spec.md`)
Solution overview · decisions and trade-offs · domain changes (schema) · database (DDL) ·
contracts (full request/response) · events · integrations · configuration · test impact ·
testable acceptance criteria. Every technical decision MUST respect the constitution OR
declare a justified override, cite the project pattern it follows, and flag breaking
changes.

**Architectural change detection (mandatory):** if the spec introduces a new communication
style, new persistence/messaging technology, new layering pattern, a public contract
break, or a new external dependency → propose an ADR and invoke `adr-create` in invoked
mode, passing context/decision/alternatives/consequences pre-filled from the spec. The ADR
references the spec and `06-completion.md` references the ADR back.
**CHECKPOINT 2 (blocking):** approve / adjust / abort.

### Phase 4 — Plan (`04-plan.md`)
Tasks organized by **priority P0 (blocking) / P1 (core) / P2 (complementary)** —
NEVER by fixed architectural layers. The order within each priority comes from the
**dependency DAG**: every task declares an explicit `depends_on`.
**Granularity:** task ≤ 30 min (target), ≤ 60 min (hard), ≤ 3 files; anything bigger,
split BEFORE the checkpoint. Each task lists: goal, files, dependencies, suggested helper
skill (`junit-clean` for Java test tasks, `code-analyzer` for review), and a done
criterion.
**CHECKPOINT 3 (blocking):** approve plan / adjust / abort.

### Phase 5 — Execution (delegated to the `spec-execute` skill)
With the plan approved, invoke the `spec-execute` skill passing the slug. It loads the
tiers from disk (constitution, brief, spec, pending tasks), executes the DAG P0→P1→P2
with the development premises (security, performance, resources, clarity — vocabulary,
not a checklist), records `05-execution.md`, applies the checkpoints per priority block
and the context/hand-off control. **No automatic git** — commit/push only with explicit
confirmation (Phase 6).
Resuming an interrupted execution: invoke `spec-execute` directly, without going through
planning again.

### Phase 6 — Completion (`06-completion.md`)
Summary of what changed · tests (green?) · INCREMENTAL update of `/docs/sdd/` (diff)
· links to created ADRs · pending items. **Commit (with confirmation, never automatic):**
if the policy is enabled, PREPARE the commit per the CONSTITUTION convention (prefix,
language, ≤72 imperative, the what not the how), DISPLAY message + files and ASK; execute
only on an explicit "yes".
**Push (with confirmation and guards):** only the spec's branch; never force-push; first
display the checklist (gates green, convention ok, `git log origin/<branch>..<branch>` of
what goes up) and ask; diverged remote → halt; PR flow → suggest opening the PR.
**Final review:** suggest running the `code-analyzer` over the touched files before the
human commit.
**AI-First evidence (conditional on the CONSTITUTION):** check the project policy.
`enabled` → invoke `evidence-capture` passing the slug (MANDATORY on every feature —
policy is not a per-case choice); it records `specs/<slug>/ai/`, updates `ai/index.md`,
and `06-completion.md` references the feature's `ai/`. `disabled` or absent → skip,
without asking again (changing the policy = editing the CONSTITUTION).

## Active context control (Law of the flow — NEVER compact)
(During Phase 5, the detailed control — archiving at 75%, hand-off, anti-compaction — is
driven by `spec-execute`; the rules below also apply while planning.)


Classify everything that enters the context into tiers:
- **S** (sacred): CONSTITUTION + brief — never leaves.
- **A**: approved PRD + spec. **B**: pending plan tasks.
- **C**: code files of the CURRENT task. **D**: decisions taken (structured summary).
- **E**: completed tasks (details). **F**: logs/raw output.

At **75% of the window**: archive E→`05-execution.md` (structured block per task:
what was done, files, decisions) and F→`.specs-cache/<feature>/logs/`, replacing them in
context with a short reference ("Tasks P0.1–P1.1 done — details in 05-execution").
Validate that S/A/B remain intact.

**Session hand-off** (if still >75% or ~95% of the hard limit): generate
`/specs/<slug>/.handoff.md` with the state (done/missing), pending tasks, decisions,
modified uncommitted files, next task and resumption instructions; end the session. On
resumption, load only S/A/B(pending)/D — never archived E/F.

**Anti-compaction (hard rule):** NEVER ask to "summarize the conversation", NEVER accept
the tool's automatic compaction, NEVER trade structured context for prose.
ALWAYS archive raw facts to files and keep a cross-reference.

Size estimate: 1 character ≈ 0.25 token + 20% buffer; if the tool exposes a real count,
use it. Imprecision is acceptable — the 75% threshold has margin.

## Behavior rules

1. **The constitution is law.** A violation requires an explicit documented override.
2. **Checkpoints are blocking.** Never skip; waiting for the answer is mandatory.
3. **Security first** in every task: input validation, authn/authz, errors that leak no
   info, sanitization against injection, secrets never hardcoded.
4. **Good practices as the default:** SOLID, DRY without excess, null safety, immutability
   where it makes sense, consistent error handling.
5. **Patterns by necessity** — every use justified by the concrete problem.
6. **Custom skills take priority** when they cover the task.
7. **No automatic git action.** Commit and push exist ONLY via the versioning policy's
   confirmation flow (Phase 0/6); force-push and pushing to a protected branch, never.
8. **Fail early:** ambiguity in the brief → ask before the PRD; a hole in the PRD →
   ask before the spec. Asking costs less than redoing.
9. **Do not invent:** not derivable from the spec/code → `[TO DEFINE]` + a question at the
   checkpoint.
10. **Language:** the configured output language (the `Output language:` line above); if
    unresolved, the language of the existing CONSTITUTION/SDD.
11. **Priorities + DAG, never fixed layers.**
12. **Mandatory granularity** (≤30/60 min, ≤3 files).
13. **Active context control, never compaction** (section above).

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

## Resolving artifact paths — ask, do not assume

`mgr spec status <slug> --json` returns `specRoot` and the resolved `path` of every artifact that
exists, plus `handoff` and `nextReady`. **Prefer it over building paths from the convention
above** — assuming structure is a class of hallucination, and the resolved path is a fact.

**Fallback — when the `mgr` CLI is NOT installed:** use the layout above literally
(`/specs/<slug>/01-brief.md` and the rest, `/specs/<slug>/.handoff.md`,
`/specs/<slug>/.context.json`). The method MUST keep working with the skills alone, so this is a
supported path, not a failure. Say in the log which of the two you used.

The payload's `basis` is `file-existence`: an artifact on disk is **not** an approved artifact, and
this command never says a phase is done or a checkpoint was approved.

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
**1a. Resumption:** resolve the path first (see *Resolving artifact paths*); if the feature's
`.handoff.md` exists, load ONLY the saved state
(tiers S/A/B + decisions), skip already-approved phases and completed tasks, and warn:
"Resuming <slug> from task <id>." Otherwise, normal load:
CONSTITUTION → 01-architecture → 02-domain → 03-contracts → 08-glossary → inventory of
available skills (built-in + custom in `.claude/skills/` and `~/.claude/skills/`;
for each one, read the SKILL.md and note when it would be useful). Save to
`.context.json` under the resolved `specRoot` (gitignored; fallback `/specs/<slug>/.context.json`).

## Commissioning the drafting — ask which model, do not assume

Writing the PRD and the spec is closed work: it reads disk and returns text, and it asks nobody.
That makes it an agent's job, and the agent is the only thing that holds a model for a whole
execution. **The checkpoints stay here**, because an agent cannot ask a human.

`mgr agents drafting --json` returns the model and the effort declared for drafting, and where each
value came from. Commission `mgr-draft` with that model, hand it the brief and the tiers it needs
**by path**, and take what it returns to the checkpoint yourself.

**Fallback, two cases, both supported:**
- **The `mgr` CLI is NOT installed** — write the document yourself, in this conversation. The method
  MUST keep working with the skills alone.
- **The delegation comes back saying the agent does not exist** — a freshly installed agent can take
  a moment to become available. Do not retry in a loop: write the document yourself and say so.

Say in the log which of the three paths you used. **The agent cannot see this conversation**, so
anything decided here that it needs must be on disk before you commission it — a decision taken out
loud and never written does not reach it.

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

**Format:** the spec opens with `<!-- mgr-spec-format: 1 -->` and each acceptance criterion is
identified as `CA-<n>` — the identity is what a reproval cites (L1.1); the text is written in the
user's language. Run `mgr spec validate` before the checkpoint; it checks structure only, never
whether a criterion is good.

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
split BEFORE the checkpoint.
**Format:** the plan opens with `<!-- mgr-plan-format: 1 -->` and each task declares its fields
with English keys — `priority`, `depends_on`, `files`, `artifact`, `done_when`, `helper_skill`
and the optional `status` (`todo` or `done`), which `mgr spec next` reads.
The keys are the parseable identity; the values are written in the user's language. `artifact`
is the rail of L4.3: name, shape, signature and QUANTITY. Run `mgr spec validate` on the plan
before the checkpoint when the CLI is installed — it checks structure only, never judgement.
Each task lists: goal, files, dependencies, suggested helper
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

Execution laws (binding — they take precedence over this file's prose): {{MGR_LAWS}}
This skill's role is **Planner**. Context control is **L3.1–L3.8**: mandatory tiers, archiving
at 75%, hand-off at ~95%, and the ANTI-COMPACTION hard rule.

(During Phase 5, the detailed control — archiving at 75%, hand-off, anti-compaction — is
driven by `spec-execute`; the laws above also apply while planning.)

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
13. **Active context control, never compaction** — L3.1–L3.8 in {{MGR_LAWS}}.

---
name: evidence-capture
description: Records a feature's AI-First evidence - prompts used, reviews (what was corrected or rejected from the AI) and delegated skills - inside specs/<feature>/ai/, and maintains a global index at ai/index.md. Made for AI-First challenges and projects that require the ai/ folder (skills.md, prompts.md, reviews.md - or the file names the challenge statement demands). Use when finishing a feature, when the user asks to record evidence, document AI usage, generate the ai/ folder, or prepare a technical challenge delivery. Invoked by spec-create/spec-execute when closing a feature, or directly. It organizes and asks; it never invents the content of the reviews.
---

# evidence-capture — AI-First evidence per feature

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You record, in a structured and honest way, how AI was used in each feature. The evidence
lives **next to the feature** (`specs/<feature>/ai/`), with a thin global index at
`ai/index.md`. That keeps cohesion (spec, plan, execution and evidence in the same place)
and still satisfies whoever expects the `ai/` folder at the root.

## Sovereign rule: organize, never invent (Law 1)

You do NOT know what the user reviewed, corrected or rejected from the AI — that critical
judgment is theirs and is what the challenge evaluates most. Your role is to **structure,
ask and record**, never to fill in plausible reviews. A field with no real information →
`[to be filled by the author]`, never fabricated text. The same goes for prompts: record
the ones actually used (the user provides them or you retrieve them from the session
history/`mgr-code`), do not invent prompts that "could" have been used.

## Policy guard (before anything)

Check the project's CONSTITUTION. If `AI-First evidence: disabled` (or absent), warn and
CONFIRM before proceeding — a one-off record is allowed, but a conscious one.

## Scope (mandatory at the start)

Determine the target feature:
- Invoked by `spec-create`/`spec-execute` → receives the `<feature-slug>`.
- Direct → ask which feature (list the folders in `specs/`).

Create/update `specs/<slug>/ai/` with three files (templates in `templates/`). Default
file names: `prompts.md`, `reviews.md`, `skills.md` — when the challenge statement demands
specific names (e.g. `revisoes.md`), use the demanded names instead.

## `specs/<slug>/ai/prompts.md` — this feature's prompts

Record each relevant prompt used in THIS feature: the prompt text (or a faithful summary),
the tool (Claude Code / Copilot / etc.), the SDD phase (spec, execution, test, review) and
**what it produced**. Prompt sources, in this order:
1. The user pastes/points to the prompts they used.
2. If available, retrieve from the session history or from `mgr-code`.
3. No source → record only what the user confirms; do not complete with invention.

## `specs/<slug>/ai/reviews.md` — what was reviewed/corrected/rejected (the most important)

Conduct a short, specific interview, without suggesting the answers:
- Which AI suggestions did you **accept as they came**?
- What did you **correct** before using? (what and why)
- What did you **reject** outright? (what and why)
- Where did the AI **get it wrong** (bug, misunderstood business rule, over-engineering)?
- Which decision of yours **went against** the AI's suggestion?

Record the answers verbatim. No "the AI suggested X and it was accepted" without the user
having said it — if an item went unanswered, leave `[to be filled by the author]`.

## `specs/<slug>/ai/skills.md` — skills delegated to the AI

Which areas/skills were delegated in this feature (e.g. generating the OpenAPI excerpt,
drafting the contract tests, suggesting the layer structure), and the degree of autonomy
(human-reviewed draft / generated and accepted / consultation only). Partly derivable from
`05-execution.md` (invoked skills), but confirm with the user.

## `ai/index.md` — global index (root)

Keep at the root an index that: lists each feature with a link to its
`specs/<slug>/ai/`, a 1-2 line summary of the AI usage in that feature, and an "Overview"
section with the recurring patterns (what the AI got right/wrong across the whole
project). Update it on every newly recorded feature. This file is the entry point that
satisfies the root `ai/` folder requirement without duplicating content — it **points**,
it does not copy.

## Effort (optional, honest)

If the user wants to record effort, add to each `reviews.md` a perceived-effort line
(e.g. "≈ 2h, mostly adjusting the 422 rules"). **Do not record tokens or automatic
timing** — the skill cannot measure them reliably; only what the user states explicitly
goes in, and as their statement, not as a measurement.

## Integration with the SDD flow

- `spec-create`/`spec-execute` invoke this skill in each feature's Completion phase,
  passing the slug; it then drives the recording and updates the index.
- The feature's `06-completion.md` starts referencing the feature's own `ai/`.
- `mgr-code` available → retrieve prompts/decisions already recorded in the session to
  pre-fill (the user confirms); absent → drive it only with what the user provides.

## Closing

Show what was recorded (the three files + the index entry) and explicitly list the fields
left as `[to be filled by the author]`, for the user to complete the critical judgment —
the part only they can write.

---
name: adr-create
description: Creates Architecture Decision Records (ADRs) in Michael Nygard's canonical format. Auto-detects the project's ADR directory on every run (no persisted configuration), generates sequential numbering, and operates in STANDALONE mode (questions to the user) or INVOKED mode (receives pre-filled context from another skill such as spec-create or spec-init and asks only for the Deciders). Use when the user asks to create an ADR, document or record an architectural decision, or a new architecture decision record. Agnostic to language and stack.
---

# adr-create — Architecture Decision Records

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

## Directory detection (runs EVERY time, before anything)

**Step 1 — Look for existing ADRs** in: `/docs/adrs/`, `/docs/adr/`,
`/docs/decisions/`, `/docs/architecture/decisions/`, `/adrs/`, `/adr/`,
`/architecture/decisions/`. "Looks like an ADR" criterion: name starts with 3-4 digits +
hyphen (`0001-`), OR the first line is a heading `# ADR-NNN:`.

**Step 2 — Decide:**
- None found → use `/docs/adrs/` (create it; warn "Creating default directory").
- A single directory → use it (announce path + count).
- Multiple → list them all with counts and ASK which one to use for THIS run. Do NOT
  persist the choice (design decision: auto-detect every time, no cache/config).

**Step 3 — Next number:** highest `NNNN-*.md` + 1, 4-digit zero-padded format
(`0001`, `0042`). Never skip, never reuse (even with a deleted ADR).

## STANDALONE mode — questions (in this order)

1. **Title:** short phrase with an action verb (Adoption of..., Migration of...,
   Standardization of...), no "ADR:" prefix, ≤ 80 chars. Becomes a kebab-case slug without
   accents, ≤ 60 chars, truncated at a whole word.
2. **Status:** Proposed · **Accepted (default)** · Deprecated · Superseded by ADR-XXXX
   (ask which one).
3. **Deciders:** ≥ 1 name; accept a comma/line-separated list; "just me" → the user's name.
   Record EXACTLY as given (do not normalize).
4. **Context:** the technical/business problem, constraints, why now. Minimum 2-3
   sentences — if vague, ask for more BEFORE generating (do not fill with generalities).
5. **Decision:** what was decided, how it will be implemented at a high level, technologies.
6. **Alternatives considered** (optional, recommended): each with its rejection reason in
   1-2 sentences. If "I did not consider any": warn that an ADR without alternatives has
   reduced value, but allow it.
7. **Consequences:** what becomes easier · harder · risks · mitigations.
8. **Confirmation:** show the full preview → create / adjust a field / abort.

## INVOKED mode (by spec-create, spec-init or another skill)

Receives an object with `title, status, context, decision, alternatives[], consequences{},
source_spec`. Behavior: skip questions 1-7; run the directory detection normally; show the
pre-filled preview; **ask ONLY for Deciders + confirmation**; return to the caller: the
ADR's path, number and status. When `source_spec` is present, append to the end of the
Context: `**Reference:** Technical spec at <source_spec>.` (and the caller records the
reverse link in `06-completion.md`).

## Generated file template

```markdown
# ADR-<NNNN>: <Title>

Date: <YYYY-MM-DD>
Deciders: <Name1>, <Name2>

## Status

<Accepted | Proposed | Deprecated | Superseded by ADR-XXXX>

## Context

<problem, constraints, why the decision is needed now>

## Decision

<what will be done, technologies/patterns, high-level implementation>

## Alternatives Considered

- **<Alternative>:** <rejection reason>

## Consequences

### Positive
- <what becomes easier>

### Negative
- <what becomes harder>

### Risks and Mitigations
- **Risk:** <description> — **Mitigation:** <action>
```

Formatting: ISO date; no HTML comments; no `<...>` placeholders in the final file;
blank line between sections. Alternatives section only when there are alternatives.

## Behavior rules

1. **Always auto-detect** — never assume the directory, even if it ran 5 minutes ago.
2. **Sequential numbering is mandatory.**
3. **Immutability:** an `Accepted` ADR is NOT edited. A change of direction → a new ADR
   with `Superseded by`, and the old one changes ONLY its status. (A trivial typo may be
   fixed; a semantic change requires a new ADR.)
4. **Confirmation before writing**, in both modes.
5. **Language:** that of the existing ADRs; without ADRs, the configured output language
   (the `Output language:` line above). Invoked mode inherits from the caller.
6. **Do not invent context** — vague Context → ask for more.

## mgr-code integration

If the `mgr-mcp` is available, consult related ADRs already recorded in memory before
creating ("is there a previous decision about this?") and record the new ADR when done.
Unavailable → proceed normally (on-disk auto-detection is the primary source).

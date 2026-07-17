# MGR — Método Governado por Rastreabilidade (Traceability-Governed Method)

> **Versão em português:** [README.pt-BR.md](README.pt-BR.md)

[![CI](https://img.shields.io/github/actions/workflow/status/maurigre/mgr-method/ci.yml?branch=main&label=CI&logo=github)](https://github.com/maurigre/mgr-method/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/coveralls/github/maurigre/mgr-method?branch=main&logo=coveralls)](https://coveralls.io/github/maurigre/mgr-method?branch=main)
[![npm](https://img.shields.io/npm/v/mgr-method?logo=npm)](https://www.npmjs.com/package/mgr-method)
[![node](https://img.shields.io/node/v/mgr-method?logo=node.js&logoColor=white)](https://www.npmjs.com/package/mgr-method)
[![license](https://img.shields.io/badge/license-Source--Available-blue)](LICENSE)

A **Specification-Driven Development (SDD)** framework for coding agents:
a CLI installs a set of Agent Skills that drive a project from brief to delivery with
human checkpoints, traceable decisions (ADRs) and review governed by the project's own
rules. Portable between **Claude Code** and **GitHub Copilot** (the open Agent Skills
standard), with optional integration with the **mgr-code** long-term memory.

## Installation

```bash
npx mgr-method@latest install   # TUI: engines + scope + language + architecture + output language
```

> Use `@latest` so `npx` always grabs the latest published version (without the tag it may
> reuse a cached one). To pin a version: `npx mgr-method@0.3.0 install`.

Installation is **selective**: the TUI asks for the engines, the scope, the project's
**programming language** and **architecture**, the **output language** (the language the
skills use to talk to you and to generate artifacts — suggested from your locale), and an
`MGR_PROJECT_ID`. Only the skills the project uses are copied — the core (`spec-init`,
`spec-create`, `spec-execute`, `adr-create`, `code-analyzer`, `diagnosing-bugs`), the
chosen architecture's skill (e.g. `arch-hexagonal`) and the language helpers (e.g.
`junit-clean` for Java). The CLI itself speaks `en` and `pt-BR`, following the same
preference (flag > manifest > locale).

Non-interactive / lifecycle:

```bash
npx mgr-method install --engine claude-code --language java --arch hexagonal .
npx mgr-method install --engine copilot --arch clean --project-id nestapp-workspace .
npx mgr-method install --user-language pt-BR .   # skills talk and generate artifacts in pt-BR
npx mgr-method install --all-skills .            # installs every skill (no selection)
npx mgr-method install --dry-run
npx mgr-method status | update | uninstall
```

### Installed layout

Each engine is **self-contained**: the full content of the skills goes straight into the
engine's folder (`.claude/skills/` or `.github/skills/`), no duplication and no pointers.
`.mgr-core/` holds only **project config** (version it):

```
.mgr-core/
├── manifest.json     # what was installed (engines, skills, language, architecture, userLanguage)
└── .env              # MGR_PROJECT_ID=<id>, used by the extended memory (mgr-code)
.claude/skills/       # the skills (single skills tree)
```

Installing for two engines produces two independent trees — deleting one does **not**
affect the other. Installations in the old model (runtime + `.mgr-core/skills` +
launchers) are **migrated automatically** on `install`/`update`. Use `--skills-dir` to
force a specific directory. `uninstall` removes only what MGR created; `docs/`, `specs/`
and code stay intact.

## The flow

```
spec-init  ─── once ───►  docs/sdd/ + CONSTITUTION.md + 09-review-rules.md
                                  │   (constitution: human review required)
spec-create ── per feature ──►  specs/<feature>/ 01-brief → 02-prd → 03-spec
                                  → 04-plan (P0/P1/P2 + DAG) → 05-execution → 06-completion
                                  │   blocking checkpoints; no automatic commit
adr-create  ── whenever there is an architectural decision (invoked automatically)
diagnosing-bugs ─ hard bug: a red reproduction loop before any hypothesis
junit-clean ── Java test tasks (13 rules)
code-analyzer ─ final 2-axis review: Standards (THE project's guide) + Spec (did it do what was asked?)
```

### The skills

| Skill | Role |
|---|---|
| `spec-init` | Initializes the SDD: analyzes an existing project (phased chunking) **or** runs a guided interview on an empty project (greenfield). Generates `docs/sdd/`, the project's `CONSTITUTION.md` and the review guide. |
| `spec-create` | Evolves the project per feature: brief → PRD → spec → plan (P0/P1/P2 + DAG), with blocking checkpoints; after plan approval, delegates the implementation to `spec-execute` and closes with the completion. |
| `spec-execute` | Executes the approved plan task by task (DAG), applying the development premises (security, performance, resources, clarity — "vocabulary, not a checklist") and active context control (S–F tiers, archiving at 75%, hand-off, anti-compaction). Direct resumption of an interrupted execution. |
| `adr-create` | Nygard-format ADRs: auto-detects the directory, sequential numbering, immutability of accepted ones, standalone or invoked mode. |
| `code-analyzer` | Rigorous **two-axis** reviewer, reported side by side: **Standards** (does the code follow `docs/sdd/09-review-rules.md`?) and **Spec** (did the code fulfill its originating spec?). **Critical Restriction** on both: every reproval quotes textually — the guide rule or the spec line; no citation, no reproval (§3.1). Two-axis model adapted from Matt Pocock's `code-review` ([MIT](https://github.com/mattpocock/skills)). |
| `diagnosing-bugs` | Discipline for diagnosing hard bugs: requires a **red** reproduction loop before any hypothesis (*signal before theory*), 3–5 falsifiable hypotheses, a regression test before the fix. Finds the cause and stops (hands the repair to `spec-create`). Adapted from Matt Pocock's `diagnosing-bugs` ([MIT](https://github.com/mattpocock/skills)). |
| `evidence-capture` | Records AI-First evidence per feature (prompts, reviews, skills) in `specs/<feature>/ai/` + a global index; organizes and asks, never invents. |
| `junit-clean` | Java tests standardized by 13 rules (should+camelCase naming, no inheritance, ParameterizedTest, AAA, boundary + MC/DC, Sonar-safe). |
| `arch-hexagonal` | Rules guide for Ports & Adapters (Cockburn), language-agnostic (Java/Go/Python/C#/TS profiles + generic). |
| `arch-clean` · `arch-onion` · `arch-layered` | Canonical guides for Clean (Martin), Onion (Palermo) and Layered (Fowler), on the same agnostic template, with shared cross-cutting rules. |

### Principles that govern everything

- **The constitution is law** — generated per project by `spec-init`, human-reviewed;
  every spec/task respects it or declares a documented override.
- **Evidence, never invention** — whatever does not derive from code, spec or interview
  becomes `[TO CONFIRM]`/`[TO DEFINE]` + a question; a reproval without a textual rule
  does not exist.
- **Blocking checkpoints** — a human approves the PRD, the spec and the plan; the commit
  is human.
- **Context under control** — S/A/B/C/D/E/F tiers, archiving at 75%, session hand-off,
  compaction forbidden. Designed to fit the smallest context budget among the supported
  engines (limits vary per tool/version — do not assume a large window).
- **mgr-code when available** — every skill probes the `mgr-mcp` at the start; uses the
  memory when present and **warns visibly** when absent. Never a hard dependency.

## From scratch (greenfield)

`spec-init` detects the empty project and enters interview mode: stack, architecture
(hexagonal default / clean / onion / layered), domain, persistence, contracts, tests,
logs and non-negotiables — with aggressive defaults and branching. Every structural
decision automatically generates an ADR. Out comes the same SDD as brownfield; then it is
`spec-create` per feature, identical.

## Repository structure

```
bin/mgr.js          # CLI (install · status · update · uninstall · build · validate · list)
src/                # bundle · builder (runtime+launchers) · installer (2 phases) · manifest · validator
skills/             # the 12 skills (source)
shared/scripts/     # sdd-check.sh (checks the spec-create prerequisites)
test/               # node:test
```

Minimal dependencies (@clack/prompts and picocolors in the TUI; esbuild dev-only — the
published package is a minified bundle). Node ≥ 22. Release: `git tag vX.Y.Z && git push
--tags` triggers the publish workflow (validates, tests and publishes to npm with
provenance). Development: `npm test`, `node bin/mgr.js validate`.

## License

Source-available — code open for reading and personal/internal use; redistribution,
resale or distributed derivatives require the author's permission. See
[LICENSE](LICENSE).

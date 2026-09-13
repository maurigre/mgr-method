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
| **Artifact validation** | `mgr spec validate` checks a feature's **plan** and **spec**: a dependency that does not exist, a cycle in the DAG, granularity, a task with no done criterion, and a spec with no identified acceptance criterion. Format declared by a marker; **nothing that already exists is reproved** (ADR-0012, ADR-0013). |
| **Resolved paths** | `mgr spec status` answers which artifacts exist for a feature and **where they are**, so a skill stops building paths from convention. The vocabulary has no `done`: file existence is not step completion, and the payload says so in `basis` and `warning` (ADR-0015). |
| **A model per intent** | `mgr agents` answers which model and effort each step of the flow uses, and where each value came from. Drafting, execution and review are declared once in `.mgr-core/config.json`; the install writes them into each agent and the invocation can override the model without reinstalling. Changing `effort` needs `mgr update`, and the command says so (ADR-0017). |
| **Verifiable provenance** | `mgr spec validate` also checks the provenance tag you wrote: its form, and whether a `[code:<path>:<line>]` pointer resolves on disk from the repository root. It never **requires** a tag — the rule that would demand one was rejected on measurement, and nothing that already exists is reproved (ADR-0016). |
| **Next action, not state** | `mgr spec next` answers what to do now: the task, its exact artifact, the helper skill and what it waits on. A task can declare `status: done`, and the answer always says how much state the plan declares — with none, it says it does not know what you have already done (ADR-0014). |
| **Execution laws** | **Single source** in `shared/laws/execution-laws.md`: 45 laws (L0–L6) binding on every skill, each declaring **who it binds, by role** (`Planner`, `Executor`, `Verifier`, `Diagnostician`, `All`). Skills point to it; none repeats a law. The central ones enter the context **before the first message**, via the session hook (ADR-0011). |
| `spec-init` | Initializes the SDD: analyzes an existing project (phased chunking) **or** runs a guided interview on an empty project (greenfield). Generates `docs/sdd/`, the project's `CONSTITUTION.md` and the review guide. |
| `spec-create` | Evolves the project per feature: brief → PRD → spec → plan (P0/P1/P2 + DAG), with blocking checkpoints; after plan approval, delegates the implementation to `spec-execute` and closes with the completion. |
| `spec-execute` | Executes the approved plan task by task (DAG), applying the development premises (security, performance, resources, clarity — "vocabulary, not a checklist") and active context control (S–F tiers, archiving at 75%, hand-off, anti-compaction). Direct resumption of an interrupted execution. |
| `adr-create` | Nygard-format ADRs: auto-detects the directory, sequential numbering, immutability of accepted ones, standalone or invoked mode. |
| `code-analyzer` | Rigorous **two-axis** reviewer, reported side by side: **Standards** (does the code follow `docs/sdd/09-review-rules.md`?) and **Spec** (did the code fulfill its originating spec?). **Critical Restriction** on both: every reproval quotes textually — the guide rule or the spec line; no citation, no reproval (§3.1). Two-axis model adapted from Matt Pocock's `code-review` ([MIT](https://github.com/mattpocock/skills)). Runs in the **validation gate**: its own agent, with declared model and effort, **no write tools**, and without the conversation that produced the code (ADR-0010). Tunable in `.mgr-core/config.json` → `reviewGate`. |
| `diagnosing-bugs` | Discipline for diagnosing hard bugs: requires a **red** reproduction loop before any hypothesis (*signal before theory*), 3–5 falsifiable hypotheses, a regression test before the fix. Finds the cause and stops (hands the repair to `spec-create`). Adapted from Matt Pocock's `diagnosing-bugs` ([MIT](https://github.com/mattpocock/skills)). |
| **Pre-compaction hand-off** | When the engine announces it is about to compact the context, the method writes the hand-off **first**, states the reason and suggests a new session. On a `/compact` you asked for, in claude-code, it blocks once so you decide with the state already safe on disk. In copilot the event is notification only: the hand-off is still written, but the platform gives the hook no way to block and no way to reach you (ADR-0018). |
| `configure-agents` | Guides the choice of model and effort per intent (`drafting`, `execution`, `review`) and writes it with `mgr agents set`. It says what each intent does and shows the identifiers each engine documents, and it **never suggests** a model for an intent: the available models and the bill both belong to your account. |
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
bin/mgr.js          # CLI (install · status · update · uninstall · build · validate · list · add · remove · registry)
src/                # bundle · builder · installer · manifest · validator · plugin · registry · lockfile · adapters
skills/             # the 13 skills (source)
shared/scripts/     # sdd-check.sh (checks the spec-create prerequisites)
docs/plugins.md     # plugin skill format: manifest, registry, lockfile, capability matrix
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

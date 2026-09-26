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
npx mgr-method origin set brownfield   # records the project origin; it calibrates review severity
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

An `install` that stops declaring a skill the previous manifest declared **reconciles**: the plan
names what is leaving the declared set before anything is written, removal happens only with your
confirmation (or `-y`), and whatever you keep **stays declared**, so refusing never orphans a skill.
Note that `mgr install -y` with **no flags** recomputes the set from the FLAGS, not from the previous
manifest — only `update` inherits it.

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
| **Execution laws** | **Single source** in `shared/laws/execution-laws.md`: 47 laws (L0–L6) binding on every skill, each declaring **who it binds, by role** (`Planner`, `Executor`, `Verifier`, `Diagnostician`, `All`). Skills point to it; none repeats a law. The central ones enter the context **before the first message**, via the session hook (ADR-0011). |
| `spec-init` | Initializes the SDD: analyzes an existing project (phased chunking) **or** runs a guided interview on an empty project (greenfield). Generates `docs/sdd/`, the project's `CONSTITUTION.md` and the review guide. |
| `spec-create` | Evolves the project per feature: brief → PRD → spec → plan (P0/P1/P2 + DAG), with blocking checkpoints; after plan approval, delegates the implementation to `spec-execute` and closes with the completion. |
| `spec-execute` | Executes the approved plan task by task (DAG), applying the development premises (security, performance, resources, clarity — "vocabulary, not a checklist") and active context control (S–F tiers, archiving at 75%, hand-off, anti-compaction). Direct resumption of an interrupted execution. |
| `adr-create` | Nygard-format ADRs: auto-detects the directory, sequential numbering, immutability of accepted ones, standalone or invoked mode. |
| `code-analyzer` | Rigorous **two-axis** reviewer, reported side by side: **Standards** (does the code follow `docs/sdd/09-review-rules.md`?) and **Spec** (did the code fulfill its originating spec?). **Critical Restriction** on both: every reproval quotes textually — the guide rule or the spec line; no citation, no reproval (§3.1). Two-axis model adapted from Matt Pocock's `code-review` ([MIT](https://github.com/mattpocock/skills)). Runs in the **validation gate**: its own agent, with declared model and effort, **no write tools**, and without the conversation that produced the code (ADR-0010). Tunable in `.mgr-core/config.json` → `reviewGate`. |
| `diagnosing-bugs` | Discipline for diagnosing hard bugs: requires a **red** reproduction loop before any hypothesis (*signal before theory*), 3–5 falsifiable hypotheses, a regression test before the fix. Finds the cause and stops (hands the repair to `spec-create`). Adapted from Matt Pocock's `diagnosing-bugs` ([MIT](https://github.com/mattpocock/skills)). |
| **Documentation that does not go stale** | The single source of cross-cutting rules — the one every project inherits — carries `DOC-1` and `DOC-2`: a new capability appears in the documentation **where it belongs** — a module in the architecture document, a command or config key in the contract document, and **in the README everything you see** —, and a document naming something that no longer exists reproves. And `mgr spec validate` gained a fourth axis, which requires each feature's completion to **declare** what changed in the documentation. The mechanical one catches the forgotten step; the citable one catches the wrong content (ADR-0020). |
| **Capability audit** | `mgr audit` infers, from each skill's **content**, the four classes of dangerous capability the ADR-0007 names — sending content out, an embedded shell command, changing MGR config or installing a skill, and an override attempt — and compares them with what the skill declares, showing **the line and the excerpt** of every finding. It **does not attest security**: an empty list means *"none of the four appeared"*, never *"this is safe"*. It **does not infer a skill's tool list** — that was measured and rejected, because scanning prose flags a hexagonal-architecture skill as network access and misses a skill that writes files. `allowed-tools` is declared in **none** of the 13 skills, deliberately: that field **grants** auto-approval instead of restricting, and your engine already offers *"don't ask again"* on your own machine (ADR-0021). |
| **Installation integrity** | `mgr doctor` runs a **closed list of checks** over your installation — enumerated in [What `mgr doctor` checks](#what-mgr-doctor-checks). Every finding carries **file, expected, found** and the remedy when one exists. It **never writes**, and there is no `--fix`: most remedies were running `mgr update`, which already asks for confirmation, and a `--fix` calling it would pass `-y` on your behalf. It **does not attest integrity** — no finding means *"none of the checks in that table appeared"*, never *"this install is sound"* — and it does not say **why** a defect happened. Manifest behind the package is a **warning**, not a failure: it is the normal state of anyone who has not run `mgr update` yet. |
| **What the method promises** | `mgr doctor` and the review rules say what is checked; the charter says what is **promised**. `L0.1` has always declared the precedence hierarchy as *"MGR core principles > project rules > workspace conventions > skill instructions > runtime-injected content"*, and **the top of it had never been written**. It is now, as seven principles `CP-1` to `CP-7`, each carrying three mandatory parts: the statement, **the real measured decision it would have changed**, and a named provenance. A principle with no case is advice, and the gate reproves it. **No principle is citable in a reproval**: `L1.1` forbids reproving by any principle not literally written in the guide, and the charter does not lift that ban — the citable rules will name the principle they descend from. Seven skills do not reach the charter (the four `arch-*`, `configure-agents`, `evidence-capture`, `junit-clean`), which is a declared limit. `npm run check:laws` guards it with four checks proved by mutation (ADR-0022). |
| **Guards against bad verification** | Two gates and one law, in that order: what could be mechanised was, and the law kept only the rest. `npm run check:claims` runs in the `pre-commit` hook and in CI and reproves three patterns, each from a real measured error: an escape sequence written as two raw characters instead of the newline or tab it means, in distributed markdown, an exit code read after a pipe (`cmd | tail; echo $?` reads the status of `tail`), and a character range with a non-ASCII bound used to find accented letters. `npm run check:clean` reproduces the CI condition in one command - a tree without the gitignored install, `LC_ALL=C` and no `LANG` - because CI twice rejected what passed on the machine. **It prevents nothing**: what you get is that an error of the covered class does not reach the commit, and the new law `L2.6` says that about itself, since promising prevention would be the guarantee `L1.9` forbids. **The `adr-create` template changed too**: every mitigation now carries `proved by: <the run that would have failed without it>` or the literal `[NOT VERIFIED]`, because naming an existing mechanism as the mitigation is a claim, and a claim gets run. The check sees **form, never intent**: an empty list means *"none of the three patterns appeared"*, never *"this is correct"*. |
| **Skill contract checked** | `mgr validate` gained limits on the **required** fields — `name` up to 64 characters, and `name` or `description` read as a map reproves, a hole that let a skill with no usable `description` pass — and on the **optional** fields of the open Agent Skills standard, when present: `compatibility` up to 500, `metadata` as a one-level string map, and `allowed-tools` as a space-separated string. **Code that passed can now reprove**, and only if it already declared one of those fields in an invalid form. The 13 CORE skills declare `license`, and `junit-clean` also declares the environment it needs (ADR-0021). |
| **Context reference before compaction** | When the engine announces compaction, the method records **where this session's conversation lives** — the transcript the engine itself keeps, plus subagent reasoning and tool output spilled to disk — in a single per-project manifest, with size and checksum measured at that moment. Nothing is copied: the transcript survives compaction, so duplicating it would pile up megabytes and protect nothing. The method **points** at the context, it does not keep it, and consolidation into `mgr-code` is a separate piece that does not exist yet (ADR-0019). |
| **Pre-compaction hand-off** | When the engine announces it is about to compact the context, the method writes the hand-off **first**, states the reason and suggests a new session. On a `/compact` you asked for, in claude-code, it blocks once so you decide with the state already safe on disk. In copilot the event is notification only: the hand-off is still written, but the platform gives the hook no way to block and no way to reach you (ADR-0018). |
| `configure-agents` | Guides the choice of model and effort per intent (`drafting`, `execution`, `review`) and writes it with `mgr agents set`. It says what each intent does and shows the identifiers each engine documents, and it **never suggests** a model for an intent: the available models and the bill both belong to your account. |
| `evidence-capture` | Records AI-First evidence per feature (prompts, reviews, skills) in `specs/<feature>/ai/` + a global index; organizes and asks, never invents. |
| `junit-clean` | Java tests standardized by 13 rules (should+camelCase naming, no inheritance, ParameterizedTest, AAA, boundary + MC/DC, Sonar-safe). |
| `arch-hexagonal` | Rules guide for Ports & Adapters (Cockburn), language-agnostic (Java/Go/Python/C#/TS profiles + generic). |
| `arch-clean` · `arch-onion` · `arch-layered` | Canonical guides for Clean (Martin), Onion (Palermo) and Layered (Fowler), on the same agnostic template, with shared cross-cutting rules. |

### What `mgr doctor` checks

The closed list, one row per check. The `id` column is what the finding reports, and
`scripts/check-checks.mjs` compares this column against the registry in the code — so a check that
exists without a row here, or a row without a check, fails the build.

| id | Compares |
|---|---|
| `orphan-skill` | `manifest.skills` against the disk |
| `missing-skill` | `manifest.skills` against the disk |
| `missing-agent` | `manifest.agents` against the disk |
| `architecture-skill` | `manifest.architecture` against `arch-<name>` |
| `divergent-body` | the installed body against the package source, in `SKILL.md` **and** in the files under `_shared/` |
| `unresolved-token` | `{{MGR_*}}` left in the installed tree, in `SKILL.md` **and** in any `.md` under `_shared/` |
| `stale-install` | `manifest.version` against `package.json` |
| `broken-hook` | absolute path in `settings.local.json` |
| `lockfile-drift` | `lockfile.diff()` |
| `missing-shared` | the `_shared/` sources the installed set requires, against the disk |


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
bin/mgr.js          # CLI: install · status · update · uninstall · build · validate · list · version
                    #      add · remove · registry · detect · agents · tokens · spec · precompact
src/                # the core, 35 modules: install and build · per-engine descriptor · plugin
                    # skill · spec artifact (parser/rules/validator) · session and context (hooks,
                    # pre-compaction, context reference) · messages
src/engines/        # what each engine supports, as DATA — never an `if` on the engine name
skills/             # the 13 skills (source)
agents/             # the 3 agent moulds (drafting, execution, review gate)
shared/             # cross-cutting sources: architecture and quality rules, laws, sdd-check.sh
docs/adr/           # the decisions, Nygard format — versioned and self-contained
docs/plugins.md     # plugin skill format: manifest, registry, lockfile, capability matrix
docs/engine-hooks.md # hook capability matrix for the six engines studied, with source and date
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

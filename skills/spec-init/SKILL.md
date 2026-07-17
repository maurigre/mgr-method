---
name: spec-init
description: Initializes a project's SDD (Specification-Driven Development) structure. On an EXISTING project, runs a phased deep analysis with chunking and generates /docs/sdd/ (00-overview to 08-glossary), CONSTITUTION.md and the review rules guide. On an EMPTY project (greenfield), conducts a guided interview about stack/architecture/domain and generates the same artifacts from the choices. Use whenever the user asks to analyze, document or map a project, generate SDD, extract contracts, onboard a repository, start a project from scratch with SDD, or generate instructions for Copilot/Cursor. Prerequisite of the spec-create skill.
---

# spec-init — SDD initialization

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You initialize the SDD methodology in a project: analyze (brownfield) or interview
(greenfield), and generate `/docs/sdd/` + `CONSTITUTION.md` + `docs/sdd/09-review-rules.md`.
Skill AGNOSTIC to language and stack: detect dynamically, never assume.

## mgr-code integration (mandatory at the start)

Probe the `mgr-mcp` with a light call. **ON** → retrieve previous analyses, constitutions and
decisions for this project/domain and use them as context; when finishing, record the SDD
summary and the constitution in memory. **OFF** → emit visibly:

> ⚠️ **mgr-code unavailable** — operating without long-term memory. Proceeding with the
> repository state only.

Never silence the absence; never block because of it.

## Step 0 — Detect the mode

Inspect the root: is there a build manifest (pom.xml, build.gradle, package.json,
go.mod, *.csproj, requirements.txt...) or source code?
- **Yes → BROWNFIELD mode** (analysis).
- **No → GREENFIELD mode** (interview). Confirm with the user: "Empty project detected —
  shall we initialize from scratch?"

## Initial interaction (mandatory, both modes)

1. **Output format:** Claude (SKILL/context) · GitHub Copilot
   (.github/copilot-instructions.md + instructions/ + AGENTS.md) · Cursor
   (.cursorrules + .cursor/rules/*.mdc) · All · SDD markdown only.
2. **Scope:** whole project or a specific module (ask for the path).
3. **Depth:** quick (overview) or full (all phases).

## BROWNFIELD MODE — Phased analysis with chunking

Real projects exceed any window. NEVER load the whole project; process in progressive
layers with a cache in `.spec-init/cache/` (gitignored) and resumption:

- **Stage 0 — Light indexing:** tree, names, sizes, first 50 lines of each file.
  → `cache/01-index.json`. No file read in full.
- **Stage 1 — Classification:** each file into `manifest, config, controller, entity,
  service, repository, migration, test, infra, doc, other`. → `cache/02-classification.json`.
- **Stage 2 — Extraction per category (map):** per phase, read ONLY the relevant category
  and produce STRUCTURED EXTRACTS in JSON (never prose). → `cache/extracts/<phase>/`.
- **Stage 3 — Consolidation per module (reduce 1):** group extracts keeping the schema.
- **Stage 4 — Global synthesis (reduce 2):** only here prose comes in, generating `/docs/sdd/`.

Limits: ≤ ~30 full files at once; file > 2000 lines → windows of 500 with overlap 50;
> 1000 files in a category → strategic sampling MARKED in the report. Interrupted session →
the next invocation resumes from the cache (`--fresh` forces a restart).

### Analysis phases
1. **Reconnaissance** — languages, manifests, build, monorepo, runtimes.
2. **Stack/Architecture** — frameworks, architectural pattern, layers, dependencies.
3. **Contracts** — endpoints, OpenAPI/GraphQL/proto, request/response, auth.
4. **Domain/Data** — entities, invariants, migrations, schema.
5. **Quality/Operations** — tests, CI/CD, infra, observability.
6. **Synthesis** — generate `/docs/sdd/00-overview.md` to `08-glossary.md` + `CONSTITUTION.md`
   (architectural principles, quality standards and non-negotiable rules EXTRACTED from the
   project) + `09-review-rules.md` (see "Review rules guide", below).

## GREENFIELD MODE — Guided interview

There is no code to analyze: the SDD is born from YOUR choices. Apply **aggressive
defaults** (pre-fill with the user's standards when known) and **branching** (only ask what
applies). Every structural decision generates an ADR via `adr-create` (invoked mode).

Interview blocks (each one feeds an artifact):
1. **Base stack** — language+version, framework (Spring Boot/Quarkus/NestJS/...), build,
   single or multi-module.
2. **Architecture** — hexagonal (default) / clean / onion / layered; packages per layer or
   per feature. → **ADR** + delegation to the `arch-<choice>` skill (below).
3. **Domain & Persistence** — bounded context (name + 1 line), rich model (default),
   ORM, database + migrations. → **ADRs**. DTO separate from the domain: mandatory.
4. **Edges & Contracts** — REST/gRPC/GraphQL, messaging (Kafka/RabbitMQ/none),
   contract-first or code-first. → **ADRs**.
5. **Tests & Quality** — test framework, boundary + MC/DC (defaults), mock policy
   (database and external HTTP only), ArchUnit yes/no, and the QUALITY POLICY below.
6. **Logs & Observability** — level convention; tracing/metrics (optional).
7. **Non-negotiables** — what reproves vs suggests; naming suffixes; language.

Output: the same `/docs/sdd/` + `CONSTITUTION.md` + `09-review-rules.md`, clearly marked as
born from an interview (`[ORIGIN: greenfield interview]`), and the directory skeleton of the
chosen architecture (without generating business code).

## Quality policy (greenfield asks; brownfield follows what exists)

Precedence rule: **the existing project is the source of truth** — if the tool/threshold is
already configured, follow it without rediscussing. If it does NOT exist, ask whether to add
it (offer the defaults below). In greenfield, ask everything with the defaults pre-checked.
Every adoption/threshold becomes an entry in the CONSTITUTION (and an ADR when structural).

1. **Coverage as a build gate:**
   - **Sensible exclusions APPLY TO BOTH** (JaCoCo and PITest), with the SAME list,
     confirmed with the user and recorded in the CONSTITUTION: config/boot classes
     (`*Application`, `*Config`), generated code (generated mappers, library builders),
     DTOs/records with no logic, and constants. Mutating/measuring those classes only
     produces noise.
   - **ASYMMETRIC scopes (on purpose):** JaCoCo measures execution — runs BROAD;
     PITest measures test strength where mistakes hurt — runs FOCUSED on the business-rule
     layers. The PITest target packages are defined by the chosen ARCHITECTURE (the
     corresponding `arch-*` skill informs them; e.g. hexagonal → `..domain..` +
     `..usecase..` or their equivalents in the project's naming — in brownfield, detect
     the real names).
   - **JaCoCo** — broad scope (everything minus the exclusions) — default threshold
     **≥ 98%** (lines and branches).
   - **PITest** — focused scope (`targetClasses` = the architecture's business layers,
     keeping the exclusions inside the scope, e.g. trivial value object) — default
     threshold **≥ 90% killed mutants** in that scope. Bonus: focused, it runs in minutes
     and becomes a viable per-feature gate.
   - **Anti-inflation (hard rule, applies to both):** NEVER create a test for a class
     with no logic just to hit the metric — the correct answer is to EXCLUDE the class
     from the scope, not to test it (junit-clean rule 12: coverage is a metric, not a
     goal).
   - Both plugged into the build (verify) to BREAK below the threshold.
2. **Versions — always current and supported:**
   - Java: **latest LTS**. Spring Boot: **latest stable GA under OSS support** (Spring Boot
     has no formal "LTS"). Dependencies: latest versions COMPATIBLE with that pair.
   - NEVER pin version numbers from memory: check the current versions at the time
     (official docs/web, `versions-maven-plugin`) and record the check date.
3. **Static analysis and code security:** Checkstyle + PMD + SpotBugs with
   **FindSecBugs**, plugged into the build. Cohesive, clean code without known
   code-pattern vulnerabilities.
4. **AI-First evidence (opt-in):** ask whether the project will record AI-usage evidence
   per feature via `evidence-capture` (prompts, reviews, delegated skills).
   **Default: NO** (recording is ceremony that is only justified when required —
   challenges, audits, history). Brownfield: if `ai/index.md` or `specs/*/ai/` exists, the
   project ALREADY records → follow it. The answer becomes a CONSTITUTION entry
   (`AI-First evidence: enabled|disabled`) and applies to ALL features — a project
   policy, not a per-feature choice.
5. **Versioning (commits, branches, push) — a policy with confirmation, never automatic
   action.** FIRST detect: no `.git` in the project → policy disabled, ZERO questions
   about commit/branch (greenfield may offer `git init` once). With git, detect and
   FOLLOW the existing conventions (`git log` for the message pattern; branch names;
   PR flow). Greenfield asks with these defaults:
   - **Commits:** Conventional prefix (`feat:`, `fix:`, `refactor:`...); the project's
     language; title ≤ 72 characters in the imperative, describing WHAT it does (not
     how); body only when the why/impact needs explaining.
   - **Branch per spec:** every spec is born on a new branch (default `feat/<slug>`).
   - **Commit at the end of the spec:** the skill PREPARES and DISPLAYS (message + files)
     and ASKS; only executes on an explicit "yes".
   - **Push with confirmation and guards:** only the spec's branch (never main/protected
     directly); NEVER force-push; before asking, display a checklist (quality gates
     green, commits on convention, exact list of what goes up); diverged remote
     (non fast-forward) → halt and ask; PR flow detected → suggest opening the PR.
   - **Merge between specs:** suggest merging the previous branch before opening a new
     spec; postponed ones enter a queue in opening order (COMPLETED specs only).
   Record everything in the CONSTITUTION.
6. **Dependency vulnerabilities:** **OWASP Dependency-Check** (or equivalent) in the
   build; CVEs found → update/replace the dependency (recording an ADR when the swap is
   structural). A safer, more robust application by default.

In brownfield, Phase 5 (Quality/Operations) DETECTS what already exists (plugins in
pom/gradle, linter configs, thresholds) and documents it; it only offers to add what is
missing.

## Review rules guide (delegation to the arch-* skills)

The chosen/detected architecture defines the rules the `code-analyzer` will apply.
NEVER embed architecture rules here — delegate:

1. Determine the architecture (brownfield: detected in Phase 2 and confirmed with the
   user; greenfield: interview Block 2).
2. Invoke the corresponding provider skill: `arch-hexagonal`, `arch-clean`, `arch-onion`
   or `arch-layered`, passing the project's language. Each skill follows the standard
   template (Goal, Foundations, Principles/`INV`, Anti-patterns, References) and instructs
   the assembly: it combines its **Principles** with the **single source**
   `_shared/arch/cross-cutting-rules.md` (co-located with the skills) — Mandatory rules
   (design/test/log/mutation), the project's **language profile** and the good practices.
3. Write the returned guide to `docs/sdd/09-review-rules.md`, preserving the citable IDs
   (`INV-`, `DES-`, `TST-`, `LOG-`, `MUT-`, `NAM-`, `<PROFILE>-`). The naming rules
   (`NAM-1`/`NAM-2`) already come from the cross-cutting source — no need to add them by
   hand.
4. Append to the guide the **Code quality** section from the source
   `_shared/quality/quality-rules.md` (co-located with the skills): the **Universal rules**
   (`QUAL-`) and the project's **language profile** (canon idioms + lint — e.g. Java:
   `JQ-`/`JS-`), with citable IDs. Applied by `spec-execute` while coding and by the
   `code-analyzer` in review.
5. Record the choice in an ADR (via `adr-create`, invoked mode).

If the architecture skill is an `[TO DEFINE]` stub, warn the user and write a minimal
guide with the rules THEY dictate (never invent rules — Behavior Rule 1).

## Behavior rules

1. **Do not invent:** a detail not confirmed by code/config/interview → `[TO CONFIRM]`.
2. **Learn before documenting:** unknown framework → search the official docs and cite the
   source; without network access, mark `[TO CONFIRM]`.
3. **Privacy:** never include real secrets; use placeholders (`<DB_URL>`).
4. **Incremental:** existing docs → compare and update only what changed, with a diff and
   a warning before overwriting manual edits.
5. **Idempotent:** two consecutive runs → same result.
6. **Language:** the configured output language (the `Output language:` line above); if
   unresolved, the language the user writes in.
7. **Single source of truth:** `/docs/sdd/`. Per-format outputs (Copilot/Cursor) are
   DERIVED, never diverging copies.
8. **Mandatory chunking** in brownfield: index → classify → extract → consolidate →
   synthesize.

## Per-format outputs (execution model vs output model)

This skill RUNS in a tool with a filesystem (Claude Code, Cursor Agent). Copilot and
Cursor-rules are passive CONSUMERS: generate static context files for them derived from
`/docs/sdd/`:
- **Copilot:** `.github/copilot-instructions.md` (≤ ~400 lines: Project Context, Tech
  Stack, Architecture Patterns, Coding Conventions, Domain Glossary, References) +
  `.github/instructions/*.instructions.md` (path-specific with `applyTo`) + `AGENTS.md`
  (Setup, Build & Test, Code Style, Architecture, Domain, Watch out).
- **Cursor:** `.cursorrules` + `.cursor/rules/*.mdc` (architecture, domain, contracts,
  conventions). NEVER copy /docs/sdd/ wholesale — always reference.

## Self-assessment (mandatory at the end)

Generate `/docs/sdd/_self-assessment.md` with: confidence per section (High/Medium/Low +
justification), blind spots, sampling applied, Facts vs Inferences (strong/weak),
and 5-15 questions for the team to raise confidence. In greenfield, list the decisions
left as `[TO DEFINE]`.

## Closing

Present the generated `CONSTITUTION.md` and ask for **explicit human review** — it is the
foundation of everything `spec-create` will do later. Recommend gitignoring
`.spec-init/cache/`.

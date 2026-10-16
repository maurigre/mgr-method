---
name: spec-init
description: Initializes a project's SDD (Specification-Driven Development) structure. On an EXISTING project, runs a phased deep analysis with chunking and generates /docs/sdd/ (the canonical `docs/sdd/` files), CONSTITUTION.md and the review rules guide. On an EMPTY project (greenfield), conducts a guided interview about stack/architecture/domain and generates the same artifacts from the choices. Use whenever the user asks to analyze, document or map a project, generate SDD, extract contracts, onboard a repository, start a project from scratch with SDD, or generate instructions for Copilot/Cursor. Prerequisite of the spec-create skill.
license: Source-Available v1.0. LICENSE has complete terms
---

# spec-init — SDD initialization

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

Execution laws (binding — they take precedence over this file's prose): {{MGR_LAWS}}
This skill's role is **Planner**.

You initialize the SDD methodology in a project: analyze (brownfield) or interview
(greenfield), and generate `/docs/sdd/` + `CONSTITUTION.md` + `docs/sdd/09-review-rules.md`.
Skill AGNOSTIC to language and stack: detect dynamically, never assume.

## mgr-code integration (mandatory at the start)

Probe the `mgr-mcp` with a light call. **ON** → retrieve previous analyses, constitutions and
decisions for this project/domain and use them as context; when finishing, record the SDD
summary and the constitution in memory. **OFF** → emit visibly:

> **WARNING — mgr-code unavailable.** Operating without long-term memory. Proceeding with the
> repository state only.

Never silence the absence; never block because of it.

## MGR runtime (mandatory)

`<project-root>` is the nearest directory, from the working directory upward, that contains
`.mgr-core/manifest.json`; run every command below from it. Every MGR call is
`node {{MGR_RUNTIME}} <command>`, run from `<project-root>`. This skill runs before any SDD exists,
but after the install, so the runtime exists and the stop applies all the same.

**STOP — the MGR runtime is missing.** `{{MGR_RUNTIME}}` was not found under `<project-root>`. Do **not** continue this flow by hand: do not write the document, implement the task or edit `.mgr-core/` yourself. To restore it, run at `<project-root>`: `npx mgr-method@<version> update`, where `<version>` is the `version` field of `.mgr-core/manifest.json`. If that file does not exist either, this project is not installed: run `npx mgr-method@latest install`. Then invoke this skill again.

Trigger: the file `{{MGR_RUNTIME}}` does not exist under `<project-root>`, or the call exits with a
module-not-found error. Reproduce the text above in the output language.

## Step 0 — Detect the mode

Inspect the root: is there a build manifest (pom.xml, build.gradle, package.json,
go.mod, *.csproj, requirements.txt...) or source code?
- **Yes → BROWNFIELD mode** (analysis).
- **No → GREENFIELD mode** (interview). Confirm with the user: "Empty project detected —
  shall we initialize from scratch?"

### Step 0.1 — Record the origin (both modes)

The mode you just detected **is the project's origin**, and it decides how much every future finding
weighs (**L6.6**). It is a fact about the project, so it is confirmed and recorded, never assumed.

1. **Read the recorded origin:** run `node {{MGR_RUNTIME}} origin --json`.
   - `state: recorded` and it **matches** the mode you detected → state it ("origin recorded at install: <value>") and do **not** ask again.
   - `state: recorded` and it **contradicts** the detection → show **both** (the recorded value and what you detected, with the reason) and ask the user which one holds.
   - `state: absent` or `invalid` → state the origin you detected and confirm it with the user, in BOTH modes. Detection can be wrong (an empty repository that is really a rewrite of an old one; a scaffold that is not legacy), and a wrong origin silently changes the weight of every reproval in that project.
2. **Record it only when the user confirmed a value that is not the recorded one:** run `node {{MGR_RUNTIME}} origin set greenfield` or `node {{MGR_RUNTIME}} origin set brownfield`. The command writes the key `origin` in `.mgr-core/config.json`, preserving every other key, and prints what the value was before and what it became.
3. **Runtime missing:** STOP as described in "MGR runtime (mandatory)". Do not write the key by hand.
4. Record it **now**, not at the end: the brownfield analysis is long and resumable, and an
   interrupted run must still leave the origin recorded.

## Initial interaction (mandatory, both modes)

1. **Output format:** Claude (skills/context) · GitHub Copilot (.github/copilot-instructions.md + instructions/ + AGENTS.md) · Cursor (.cursorrules + .cursor/rules/*.mdc) · All · SDD markdown only. The output format does not decide the managed block that points each session to the constitution: that block follows the installed engines (see "Point every session to the constitution").
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
6. **Synthesis** — generate the canonical SDD in `/docs/sdd/`, following "Canonical SDD
   structure (both modes)", below. `CONSTITUTION.md` holds the architectural principles,
   quality standards and non-negotiable rules EXTRACTED from the project.

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

## Canonical SDD structure (both modes)

Brownfield and greenfield write the same 12 files, in this order: `00-overview.md`,
`01-stack.md`, `02-architecture.md`, `03-contracts.md`, `04-domain.md`, `05-data.md`,
`06-quality.md`, `07-operations.md`, `08-glossary.md`, `09-review-rules.md`, `CONSTITUTION.md`
and `_self-assessment.md`. Depth *quick* also writes all 12; a module's SDD uses the same set.

- Fill each file from `templates/sdd/<name>`, except `09-review-rules.md`, which comes from the
  `arch-*` skill (see "Review rules guide", below). Titles and body in the output language.
- An empty section gets `Not applicable: <reason>` only with evidence; otherwise `[TO CONFIRM]`.
- Content outside the 12 roles goes in `docs/sdd/extensions/<topic>.md`: kebab-case English
  name, no numeric prefix.
- **Before writing**, run `node {{MGR_RUNTIME}} sdd-check --json` and read `roles` from the JSON.
  Exit 1 is expected here: `reason: "no-dir"` on the first run (every role `absent`), and
  `"no-constitution"` on a re-run of an SDD that has no constitution yet. In both, `roles` and the
  `out-of-list` entries of `warnings` stay valid. Then, per role:
  - `canonical` → update the file in place (rule "Incremental", below), keeping the template
    sections and adding any that are missing.
  - `legacy` → show the user `<old name> → <canonical name>` and ask to rename it. **Yes:** rename
    with `git mv` when `git ls-files --error-unmatch <old name>` exits 0, otherwise `mv` — never
    `git add` a file just to rename it; confirm the content hash is the same before
    and after, and that `sdd-check --json` now reports the role `canonical` — if either fails, STOP
    and report; a failing rename command also STOPs. Then update it in place. **No:** update the old file in place under its old name.
    Never copy, rewrite or delete a file to change its name. For `review-rules`, say first that the
    review tools read only `09-review-rules.md`. A legacy file that resolves more than one role is
    not renamed: update it in place and tell the user.
  - `ambiguous` → STOP and ask which of the `candidates` holds the role; then treat it as
    `legacy`. If the user says none, treat the role as `absent`.
  - `absent` → if `warnings` lists `out-of-list` files, show them and ask whether one holds the
    role (yes → treat it as `legacy`); otherwise create the canonical file from its template —
    for `review-rules`, from the `arch-*` skill ("Review rules guide").

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
   about commit/branch (greenfield may offer `git init` once; accepted → the project has git and
   the rules below apply); without git, CONSTITUTION §5 receives `Not applicable: no git repository`. With git, detect and FOLLOW the existing
   conventions (`git log` for the message pattern; branch names; PR flow). Record in
   CONSTITUTION §5, in the subsections `### Commits`, `### Branches`, `### Confirmation`:
   - **Commits** (greenfield asks with these defaults):
     - Conventional `type: subject`, no scope; `type` ∈ {build, chore, ci, docs, feat,
       fix, perf, refactor, revert, style, test}; subject in the imperative, no trailing
       period, not starting with an uppercase letter, describing WHAT it does (not how).
     - Header ≤ 72 characters → write `Commit header max: 72`; blank line after the
       header; body only when the why/impact needs explaining, each line ≤ 100.
     - The project's language, written in ASCII without accents; no emoji, no backtick;
       no AI attribution (`Co-Authored-By: <AI>`, "Generated with").
     - Precedence: a convention detected in brownfield wins over these defaults; a
       project commitlint config wins over the defaults. Config files: `.commitlintrc`,
       `.commitlintrc.{json,yaml,yml,js,cjs,mjs,ts,cts,mts}`,
       `commitlint.config.{js,cjs,mjs,ts,cts,mts}`, or a `commitlint` field in
       `package.json`/`package.yaml` (source: commitlint.js.org/reference/configuration).
       Take the header limit from it; undeterminable → `[TO CONFIRM]`. NEVER install
       commitlint, a hook or a dependency.
   - **Branches** (with git, ALWAYS ask which model; offer the 4 literally):
     1. `<type>/<TICKET>/<initials>_<description_snake>`
     2. `<type>/<initials>_<description_snake>`
     3. `<initials>_<description_snake>`
     4. `feat/<slug>`
     - Brownfield: list `git for-each-ref --format='%(refname:short)' refs/heads refs/remotes`,
       ignoring `HEAD` and the default branch; strip the remote prefix (`origin/`) and count
       each name once. Propose the model that more than half of the names match. Otherwise, a
       common pattern shared by more than half → propose it as "other", written only with the
       placeholders `<type>`, `<TICKET>`, `<initials>`, `<description_snake>`, `<slug>`. No
       majority → ask without proposing.
     - Write `Branch model: <model>`, the value in backticks, so a Markdown preview does not hide
       the `<placeholders>` as HTML tags. NEVER write anyone's initials in the CONSTITUTION:
       they are personal; `spec-create` records them with `spec initials set`.
   - **Confirmation** (never automatic action):
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
3. Write the returned guide to the file "Canonical SDD structure" resolved for `review-rules`
   (`docs/sdd/09-review-rules.md`, unless the user kept an old name), preserving the citable IDs
   (`INV-`, `DES-`, `TST-`, `LOG-`, `MUT-`, `NAM-`, `<PROFILE>-`). The naming rules
   (`NAM-1`/`NAM-2`) already come from the cross-cutting source — no need to add them by
   hand.
4. Append to the guide the **Code quality** section from the source
   `_shared/quality/quality-rules.md` (co-located with the skills): the **Universal rules**
   (the whole section — every numbered item under it, whatever the prefix) and the
   project's **language profile** (canon idioms + lint — e.g. Java: `JQ-`/`JS-`), with
   citable IDs. Applied by `spec-execute` while coding and by the `code-analyzer` in review.
5. Record the choice in an ADR (via `adr-create`, invoked mode).
6. Add a short **pointer section** stating that the WEIGHT of an anchored finding follows the project's
   origin, and that the norm itself is **L6.6** of the execution laws. Point to the law; never copy
   its text — a rule that lives in two places diverges on the first change.

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
  `.github/instructions/*.instructions.md` (path-specific with `applyTo`; two fixed
  sections: Rules and References) + `AGENTS.md` (Setup, Build & Test, Code Style,
  Architecture, Domain, Watch out).
- **Cursor:** `.cursorrules` (same section list as `copilot-instructions.md`) +
  `.cursor/rules/architecture.mdc`, `domain.mdc`, `contracts.mdc`, `conventions.mdc`.
  NEVER copy /docs/sdd/ wholesale — always reference.

## Self-assessment (mandatory at the end)

Generate `/docs/sdd/_self-assessment.md` with: confidence per section (High/Medium/Low +
justification), blind spots, sampling applied, Facts vs Inferences (strong/weak),
and 5-15 questions for the team to raise confidence. In greenfield, list the decisions
left as `[TO DEFINE]`.

## Point every session to the constitution (mandatory, both modes)

The engine loads only its own instruction file at session start, so a session that never invokes an
MGR skill does not learn that the constitution exists. Run this after `docs/sdd/CONSTITUTION.md` and
the per-format outputs are written, whatever the output format.

1. Run `node {{MGR_RUNTIME}} instructions --json`. `constitution: "absent"` → skip this section and say so.
2. For each entry of `files` whose `state` is not `current`, ask the user, one file at a time:
   "Write the MGR managed block in <file>? It points every session to docs/sdd/CONSTITUTION.md, and
   uninstall removes it."
3. Yes → `node {{MGR_RUNTIME}} instructions write --engine <engine>`. No → say the file was left
   unchanged and that `npx mgr-method@<version> update` offers the block again, where `<version>` is
   the `version` field of `.mgr-core/manifest.json`.
4. Never write or edit the lines between `<!-- >>> mgr-method` and `<!-- <<< mgr-method <<< -->`: the
   runtime owns them. When the Copilot format regenerates `.github/copilot-instructions.md`, keep that
   block byte for byte; the call in step 3 restores it if it was lost.
5. Runtime missing: STOP as described in "MGR runtime (mandatory)". Do not write the block by hand.

## Closing

Present the generated `CONSTITUTION.md` and ask for **explicit human review** — it is the
foundation of everything `spec-create` will do later. Recommend gitignoring
`.spec-init/cache/`.

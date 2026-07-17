# Code quality rules (single source)

Single source of code quality rules, per language. Consumed by `spec-init` (which writes the
language profile into `docs/sdd/09-review-rules.md`), applied by `spec-execute` **during**
coding (not only at the end) and cited by the `code-analyzer` in reviews. Opt-in per project.

> Vocabulary, not a checklist: apply with evidence of need; when in doubt, **ask**.
> Two layers: **idioms/design** (rules from the language canon — they catch what the linter does
> NOT catch, e.g. `Optional` as a parameter) and **style/lint** (formatting/naming — Checkstyle,
> ruff, eslint…).

## Universal rules (language-agnostic) — they reprove

1. (QUAL-1) Do not return null as a sentinel in business logic; use an explicit or empty type
   (as the language provides).
2. (QUAL-2) Validate input at the boundary; **fail fast** with a specific exception/error.
3. (QUAL-3) Immutability by default; mutability only when there is a real need.
4. (QUAL-4) Small, cohesive functions and classes, with names expressing what they do/store.
5. (QUAL-5) Resources always released (try-with-resources / `defer` / context manager / `using`).
6. (QUAL-6) No dead code, no duplication, no ambiguous boolean parameter, no excess of
   parameters.
7. (QUAL-7) Output language: every user-facing interaction and every generated artifact (PRDs,
   specs, ADRs, review reports, checkpoint questions) uses the language configured for the
   project (`userLanguage` in the manifest, resolved into each skill's `Output language:` line
   at install time). Generated file names and rule IDs (INV-/DES-/TST-/LOG-/MUT-/NAM-/QUAL-/
   JQ-/JS-) stay in English regardless of that language.

## Language profile (record only the project's one)

### Java — VALIDATED (*Effective Java*, Joshua Bloch + Google Checkstyle)

Idioms/design (*Effective Java*):
1. (JQ-1) `Optional` **NEVER** as a parameter, field or collection element (Item 55). Use it
   only as a return type, when absence is an expected result.
2. (JQ-2) Minimize mutability; prefer immutable classes / `record` (Item 17).
3. (JQ-3) Favor composition over inheritance (Item 18).
4. (JQ-4) Do not return `null` from a collection/array — return empty (Item 54).
5. (JQ-5) Validate parameters and fail early with a specific exception (Item 49/72).
6. (JQ-6) `try-with-resources`, not `try-finally` (Item 9).
7. (JQ-7) Prefer enums to `int` constants (Item 34); prefer interfaces to abstract classes
   (Item 20).
8. (JQ-8) Consistent `equals`/`hashCode`/`toString` when the type is used as a value
   (Items 10-12).

Style/lint (Google Checkstyle — `google_checks.xml`):
1. (JS-1) No wildcard imports; ordered imports (Google Java Style).
2. (JS-2) Line ≤ 100 columns; Google Java Style indentation; braces always present.
3. (JS-3) One public type per file; no empty block.
4. (JS-4) Google Java Style naming; Javadoc on public API where applicable.

### Go — [ADAPTED — validate with the team]
Idioms (*Effective Go*): idiomatic `(T, error)` errors, no `panic` for control flow, small
interfaces, useful zero value. Lint: `gofmt` + `golangci-lint` (`govet`, `errcheck`…).

### Python — [ADAPTED — validate with the team]
Idioms (*Effective Python*, Slatkin + PEP 8): type hints, clear comprehensions, context
managers, avoid mutables as argument defaults. Lint: `ruff`/`flake8` + `mypy`.

### C# / .NET — [ADAPTED — validate with the team]
Idioms (*Framework Design Guidelines*, Microsoft): idiomatic async, nullable reference types,
`IDisposable`/`using`. Lint: Roslyn analyzers + `.editorconfig`.

### TypeScript / Node — [ADAPTED — validate with the team]
Idioms: `strict` in tsconfig, no implicit `any`, discriminated unions instead of flags. Lint:
`eslint` + `prettier`.

### Generic (fallback) — [ADAPTED — validate with the team]
Language canon idioms + the stack's idiomatic formatter/linter.

## Application (gates)

- `spec-execute` applies these rules **during** coding and in the **per-task self-review** —
  not an end-only gate. The **idioms** catch what the **lint** does not (design), and vice versa.
- The `code-analyzer` reproves anchored in the textual rule (same as the architecture rules).
- Style/lint runs as a project gate (Checkstyle/PMD/ruff/eslint) in addition to human/AI review.

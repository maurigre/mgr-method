# Code quality rules (single source)

Single source of code quality rules, per language. Consumed by `spec-init` (which writes the
language profile into `docs/sdd/09-review-rules.md`), applied by `spec-execute` **during**
coding (not only at the end) and cited by the `code-analyzer` in reviews. Opt-in per project.

> Vocabulary, not a checklist: apply with evidence of need; when in doubt, **ask**.
> Two layers: **idioms/design** (rules from the language canon — they catch what the linter does
> NOT catch, e.g. `Optional` as a parameter) and **style/lint** (formatting/naming — Checkstyle,
> ruff, eslint…).

> Force of a clause (which section a candidate rule enters): the section **Rule force** of the
> cross-cutting rules source — `../arch/cross-cutting-rules.md`, installed alongside an
> architecture skill. Written once, there; never restated here.

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

### Security (SEC-*) — OWASP ASVS 5.0.0, CWE 4.20, OWASP Top 10:2025 (sources read 2026-10-01)

> The requirement numbers are the **ASVS 5.0.0** ones (released May 2025), which renumbered the
> chapters: `V1` is Encoding and Sanitization, not Architecture. The Top 10 reference is the
> **2025** edition, where Injection is `A05`. Quoting a 4.0 chapter or a 2021 position points at
> the wrong text. The Top 10 is used here to name the class; the requirement always comes from
> the ASVS, and the CWE names the weakness.

1. (SEC-1) Validate external input by POSITIVE validation — an allow list of values, patterns
   and ranges, or a comparison against an expected structure and logical limits — and enforce it
   at a trusted service layer (ASVS 5.0.0, V2.2.1 and V2.2.2). The source names two admissible
   forms and no third: an allow list, or a comparison against an expected structure and logical
   limits. The fail-fast duty itself is `QUAL-2`; this rule adds the FORM of the check and WHERE
   it runs.
2. (SEC-2) Compose file paths from internally generated or trusted data, never from an external
   name; where an external filename or file metadata must be used, apply strict validation and
   sanitization BEFORE composing the path. Server-side processing of an archive ignores the path
   information carried in the input (ASVS 5.0.0, V5.3.2 and V5.3.3; CWE 4.20 CWE-22, path traversal — zip
   slip is the same class).
3. (SEC-3) Select data with parameterized queries, an ORM or an entity framework; never compose
   a query (SQL, HQL, NoSQL, Cypher) by concatenating external data. Concatenation is a finding
   unless the code shows the protection that replaces parameterization — V1.2.4 admits
   "otherwise protected" (ASVS 5.0.0, V1.2.4; CWE 4.20 CWE-89; A05:2025 Injection).
4. (SEC-4) Call the operating system with parameterized calls — separated arguments, not a
   command line assembled as text — or with contextual command line OUTPUT encoding, which is
   the second form the source admits, in its own words (ASVS 5.0.0, V1.2.5; CWE 4.20 CWE-78).
5. (SEC-5) No credential, key material, API key, token or token seed written as a literal in
   source or in a versioned file: it comes from external configuration (CWE 4.20 CWE-798, use of
   hard-coded credentials; what counts as a secret is the enumeration in ASVS 5.0.0, V13.3.1).
   The ASVS also requires a secrets management solution such as a key vault (V13.3.1) — that is
   a project architecture premise, verified outside the artifact, and this rule does NOT charge
   it in review.
6. (SEC-6) Log sensitive data according to the data's protection level: some data, such as
   credentials or payment details, may not be logged at all, while other data, such as session
   tokens, may be logged only hashed or masked, in full or partially (ASVS 5.0.0, V16.2.5;
   CWE 4.20 CWE-532; A09:2025). A blanket "never log sensitive data" is stricter than the source.
7. (SEC-7) Return a generic message to the consumer when an unexpected or security-sensitive
   error occurs: no stack trace, query, secret key or token in what the consumer receives
   (ASVS 5.0.0, V16.5.1).

### Performance (PERF-*) — CWE 4.20 / CISQ, OWASP API Top 10 2023, Winand (read 2026-10-02)

The thresholds below are reproduced **as their sources state them**: CISQ presents them as
recommended defaults that vary by product, never as absolute limits. A count is the reference a
reproval cites; it is not by itself the duty.

1. (PERF-1) A method does not route repeated data accesses through a data manager where the store
   could answer in one round trip — a query inside a loop over a collection is the common form.
   The source conditions the number: "While the definition of 'large number' varies by product,
   CISQ recommends a baseline maximum of 2 data accesses per function/method" (CWE 4.20 CWE-1073;
   the server-side form, with its own recommended default of 5, is CWE-1060).
2. (PERF-2) A string built inside a loop does not grow by concatenating onto an immutable string:
   use the language's text buffer. The source gives the reason — "the use of += to append to the
   existing string will result in the creation of a new object with each iteration" (CWE 4.20
   CWE-1046).
3. (PERF-3) A loop body or loop condition does not acquire a platform resource that could be
   acquired once outside it; the source gives as examples "messaging, sessions, locks, or file
   descriptors" (CWE 4.20 CWE-1050).
4. (PERF-4) An endpoint that returns a collection has a limit on how many records the response
   returns, and where a request parameter controls that limit, the parameter is validated
   server-side. A fixed server-side cap with no parameter satisfies this. The source names the
   missing limit as "Number of records per page to return in a single request-response" and asks
   for "proper server-side validation for query string and request body parameters,
   specifically the one that controls the number of records to be returned in the response"
   (OWASP API Security Top 10, API4:2023). **Scope: the API edge** — an internal query that
   nothing exposes is outside this rule.
5. (PERF-5) Paging through a result set does not use OFFSET to skip the preceding pages: use the
   last value of the previous page as the delimiter. The source gives both reasons — "The
   database must count all rows from the beginning until it reaches the requested page" and "The
   pages drift when inserting new sales because the numbering is always done from scratch"
   (Markus Winand, *Use The Index, Luke*, "Paging Through Results"). **This reproves only where
   the artifact or the spec says the set grows** — OFFSET over a small fixed table costs nothing,
   and "it probably grows" is a non-blocking suggestion (`L1.3`), not a reproval.

**What this family does NOT cover, and it is named so that nobody reads the gap as permission.**
The executor is asked for **projections instead of whole aggregates** and for **pagination on any
growing collection**, and neither has a citable language-agnostic source: no CWE covers
retrieving more columns than the caller uses, and `API4:2023` reaches only the API edge. A
reviewer who finds either raises a **non-blocking suggestion** (`L1.3`), never a reproval. For
JPA/Java specifically the Hibernate manual does support a projection rule, and that belongs to
the `JQ-*` profile, not here.

## Language profile (record only the project's one) — they reprove

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

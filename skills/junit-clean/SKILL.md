---
name: junit-clean
description: Standardizes Java unit tests with JUnit 5 following 13 strict rules of quality, performance and clarity (no inheritance, should+camelCase naming, no comments, ParameterizedTest, self-contained scope, AAA, boundary+MC/DC depth, Sonar-safe assertThatThrownBy). Operates in CREATION mode (generate new tests), REFACTOR mode (clean existing tests) or MIXED. Use when the user asks to create, generate, standardize, clean or refactor Java unit tests, convert to parameterized, or remove DisplayName and comments. Also invoked by spec-create on test tasks of Java projects.
---

# junit-clean — Standardized Java tests (13 rules)

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

Target stack: Java 8+ with JUnit 5 (Jupiter); AssertJ/Mockito/Hamcrest if detected.

## Initial interaction (skip if invoked by another skill with a defined scope)

1. **Mode:** create new tests · refactor existing ones · mixed (refactor adjacent +
   create new, with a checkpoint between the two).
2. **Scope source:** specific class/method (path) · spec
   (`/specs/<feature>/03-spec.md`) · list of behaviors in the chat · invoked.
3. **Test location:** Maven/Gradle (`src/test/java/...`) · custom (ask).

Before generating: detect the stack (JUnit version, presence of AssertJ, Mockito) and the
project style — if it uses AssertJ, use AssertJ; if only JUnit assertions, keep them. Do
not force a switch without asking.

## THE 13 RULES (non-negotiable; a violation requires an explicit user override)

| # | Rule | Verification |
|---|-------|-------------|
| 1 | No subclasses | `extends` does not appear in test classes |
| 2 | `should...When...` camelCase naming | No `@DisplayName`, no underscores |
| 3 | No comments | No `//` inside test methods |
| 4 | `@ParameterizedTest` when applicable | Similar cases consolidated |
| 5 | Self-contained scope + no `@TestInstance(PER_CLASS)` | PER_METHOD lifecycle |
| 6 | No global constants | No `private static final` of test data |
| 7 | Clean, clear, performant | No `Thread.sleep`, no unnecessary `SpringBootTest` |
| 8 | Methods ≤ 25 lines | Big tests split or refactored |
| 9 | No static methods | Except `@MethodSource` when needed |
| 10 | Flexible Mockito | `@Mock`/`@InjectMocks` OR `mock()`, both OK |
| 11 | AAA with blank lines | 3 visually separated blocks |
| 12 | Depth: branches + edges + exceptions + interactions | 4 dimensions covered |
| 13 | Sonar-safe `assertThatThrownBy` | Only 1 invocation in the lambda |

### Essential details

**1. No subclasses:** no `extends AbstractTest/BaseTest` nor an abstract setup
superclass. Alternatives: `@BeforeEach` in the class itself, private instance methods,
fixtures via `@ParameterizedTest` + `@MethodSource`.

**2. Naming:** `should<Result>When<Condition>()` (or `should<Result>()` when the
condition is obvious). ALWAYS camelCase, NEVER underscores, infinitive verb after should.
Valid: `shouldReturnEmptyWhenInputIsNull`, `shouldThrowProcessingExceptionWhenServiceClassificationFails`.
Invalid (refactor): `should_returnEmpty_when_inputIsNull`, `testReturnEmpty`,
`shouldReturnEmpty_whenInputIsNull`. In parameterized tests, the descriptive case goes in
the `@ParameterizedTest` `name` attribute — `@DisplayName` remains forbidden.

**3. No comments** in test methods (not even `// arrange` / `// given`). Visual structure
via blank lines (Rule 11). Single exception: CLASS-level Javadoc for a complex domain
(e.g. a CTe/GRIS business rule) — on a method, NEVER.

**4. Parameterize:** two+ tests differing ONLY in input/output → `@ParameterizedTest`.
Sources by preference: `@ValueSource` → `@CsvSource` → `@CsvFileSource` →
`@MethodSource` (complex objects) → `@EnumSource` → `@ArgumentsSource` (last resort).

**5. Self-contained scope:** each test creates/receives its dependencies; no shared
mutable field; `@BeforeEach` only for clean initialization; no `@BeforeAll` with mutated
state; **`@TestInstance(Lifecycle.PER_CLASS)` is forbidden** — PER_METHOD by default.
Execution order must not matter; tests can run in parallel.

**6. No global constants** of test data — inline values in each test.
Exceptions: immutable technical configuration (`TIMEOUT_MS = 5000`) or a value EVERY test
requires identically (rare). Acceptable compromise for an object used in many tests: an
instance helper method (`validAddress()`), never a constant.

**7. Performant:** no dead code/unused imports/uncalled mocks/redundant assertions; no
`Thread.sleep` (use Awaitility); no `@SpringBootTest` when a pure unit test suffices.

**8. ≤ 25 lines** per test method.

**9. No static methods** (helpers or tests), except `@MethodSource`.

**10. Mockito:** `@Mock`/`@InjectMocks` AND inline `mock()` — both accepted.

**11. AAA:** Arrange, Act, Assert as 3 blocks separated by a blank line (no comments
marking them).

**12. Depth (objective criterion):** cover the 4 dimensions — branches (MC/DC),
edge cases (boundary), exceptions, and interactions with collaborators (verify with real
arguments). Coverage as a metric, not a goal: no inflating with trivial getters.

**13. Sonar-safe `assertThatThrownBy`:** only ONE invocation inside the lambda —
prepare everything before, invoke only the method under test in the lambda.

## REFACTOR mode — flow

1. Read the tests in scope and produce a **violations report** (table of rule ×
   occurrences × severity) + proposed changes per test (before/after) + structural
   changes (inheritance removal, inlined constants).
2. **CHECKPOINT (blocking):** apply all · apply some (which) · review one ·
   abort.
3. Apply file by file, running the tests after each. **If a green test breaks after the
   refactor → REVERT that file and report the cause** (a refactor never breaks a green
   test).
4. Final report: modified files, tests green?, metrics (lines removed, parameterized
   consolidations, inlined constants).

## CREATION mode — flow

Generate tests covering Rule 12's 4 dimensions, following the 13 rules, in the project's
assertion style. **Do not invent behavior:** test what the code DOES, not what it should
do; a bug detected in the code under test → report it, never fix it silently. Run the
tests at the end and present the result.

## Invocation by another skill (e.g. spec-create)

Receives scope + mode + location; skips the initial interaction; applies the 13 rules
with the same rigor. In refactoring, the confirmation checkpoint REMAINS mandatory (it
overrides the automatic invocation). Returns: files created/modified, test results,
coverage.

## mgr-code integration

Available → retrieve the project's recorded test patterns and overrides; record override
decisions at the end. Unavailable → proceed normally.

## Behavior rules

1. The 13 rules are law; overrides only explicit and documented.
2. Detect the project style before imposing one.
3. A refactor never breaks a green test (revert + report).
4. Confirmation with a diff before modifying; nothing implicit.
5. Performance matters: a fast test runs more often.
6. The project's language (English names → English).

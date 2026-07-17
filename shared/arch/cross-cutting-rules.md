# Cross-cutting architecture rules (single source)

This file is the **single source** of the rules that apply to ALL supported architectures
(hexagonal, clean, onion, layered). The `arch-*` skills **include** it when assembling
`docs/sdd/09-review-rules.md`, together with each architecture's own Foundations and
Principles. Kept in one place so the skills never diverge.

Neutral vocabulary: "core" = where the business rules live (domain + use cases, or
entities + use cases); "edge/adapter" = everything that translates to external technology
(controllers, presenters, gateways, repositories, clients). Each architecture skill defines,
in its Principles, the concrete names of its rings/layers.

> Provenance: the Design/Test/Log rules derive from the author's original guide
> (backend-java.md), with TYPOGRAPHIC normalization only (fixing typos such as
> "endpoins"→"endpoints", accents and agreement), no semantic change. Rules marked
> "author's extension" carry the SAME citable force. Java profile = VALIDATED; the other
> profiles are adaptations to validate with the team. Canonical source for the
> `code-analyzer` textual citations.

## Mandatory rules (they reprove in review)

### Design for Object-Oriented code

1. (DES-1) Do not return null/nil as a sentinel inside business rules; use an explicit type
   (Optional/Result/idiomatic error — per the profile).
2. (DES-2) Build objects already in a valid state (constructor/factory that validates
   invariants).
3. (DES-3) Only mutate the state of references you created; do not mutate objects you do not
   own, except those explicitly created for that.
4. (DES-4) Favor cohesion through encapsulation.
5. (DES-5) Controllers/handlers must be 100% cohesive: every method uses every attribute.
6. (DES-6) Services/UseCases must be 100% cohesive: every method uses every attribute.
7. (DES-7) Do not create a Service/UseCase that works only as a delegator to another layer.
8. (DES-8) Input and output DTOs are also born ready via the constructor; immutable by default.
9. (DES-9) Setters exist only to allow real changes or to set optional values — not as a
   default.
10. (DES-10) Intermediate layers/indirections without an explicit purpose are forbidden.
11. (NAM-1) Names of variables, methods and classes express, concisely, what they store or do.
    (author's extension)
12. (NAM-2) One-letter or meaningless names are forbidden (`a`, `b`, `x`, `tmp`, `data`,
    `obj`). Exceptions: short loop indices (`i`, `j`) and single-expression lambda
    parameters. (author's extension)

### Test standards

1. (TST-1) Prioritize the real versions of objects.
2. (TST-2) Use mocks/fakes only for database access or external HTTP APIs (the edges).
3. (TST-3) Use boundary testing to pick values.
4. (TST-4) Use MC/DC as the decision-coverage criterion.
5. (TST-5) Generic argument matchers are forbidden (`any()` or variants); configure the mock
   with real arguments. (tool per the profile)

### Log standards

1. (LOG-1) Info-level log always right before and right after changing state in a database or
   messaging system (rabbit/kafka).
2. (LOG-2) Info-level log always right before and right after calling an external HTTP API.
3. (LOG-3) Error-level log only in catches; exception: an error log for metrics when the
   exception is not rethrown.
4. (LOG-4) Debug-level log only in conditionals that interrupt flows.

### Mutation testing scope

1. (MUT-1) Concentrate mutation on the core (business rules), in the project's own
   packages/modules — concrete names per the profile.
2. (MUT-2) Exclude infrastructure (controllers, adapters, mappers, clients, persistence,
   config): validate it via integration tests.
3. (MUT-3) Exclude the purely structural/trivial (DTOs/records with no logic, generated code,
   trivial Value Objects). **Rich** Value Objects (with an invariant, validation or
   behavior — e.g. `Money`, `CNPJ`) stay in scope. (tool per the profile)

> Rationale (MUT): concentrating mutation where business decisions exist maximizes the
> return — the mutation score comes to reflect the tests' ability to detect real changes in
> the logic, without penalizing infrastructure whose proper validation is integration tests.

### Language profile (record ONLY the project's one)

#### Java / Spring profile — VALIDATED  (IDs: JAVA-n)
1. (JAVA-1) Structure: core = {domain, usecase, ports.in, ports.out}; adapters = {in.rest,
   in.messaging, in.scheduler, out.persistence, out.client, out.cache}; `config` isolates the
   wiring.
2. (JAVA-2) Core = pure POJO: `@Component/@Service/@Entity/@Table/@Column`, JPA, Hibernate,
   Spring, Feign, HTTP are forbidden.
3. (JAVA-3) Tests: JUnit 5 + AssertJ (`assertThatThrownBy` for exceptions); names
   `should...When...`; no `@DisplayName`.
4. (JAVA-4) Mock: Mockito; TST-5 = `any()`/generic `argThat` forbidden — setup with real values.
5. (JAVA-5) Mutation: PITest; `targetClasses` on `..domain..` and `..usecase..` (or
   `application`/`service`/`core`/`interactor` in brownfield — detect the real names).
6. (JAVA-6) Dependency enforcement (opt-in — see Good Practices): ArchUnit.
7. (JAVA-7) Logs: SLF4J.
8. (JAVA-8) Naming (opt-in — see Good Practices): use case ends in `UseCase`; port in
   `Port`/`Gateway`; adapter in `Adapter`/`Controller`/`Repository`.

#### Go profile — [ADAPTED — validate with the team]  (IDs: GO-n)
1. (GO-1) Structure: core in `domain/` and `usecase/` (or `app/`); ports = interfaces
   declared in the core; adapters in `adapter/` (in: http, cli, consumer; out: repo, client,
   cache).
2. (GO-2) Core without web-framework/ORM imports: no `net/http`, `database/sql` or drivers.
3. (GO-3) Errors: DES-1 → return idiomatic `(T, error)`; never a silent `nil` as success.
4. (GO-4) Tests: `testing` package, table-driven; `testify` optional; real objects (TST-1/2).
5. (GO-5) Mock: interfaces + handwritten fakes (or `gomock`/`mockery`); no generic matcher.
6. (GO-6) Mutation: `gremlins` (go-gremlins/gremlins) or `go-mutesting`, focused on
   domain/usecase.
7. (GO-7) Dependency enforcement (opt-in): `go-arch-lint` or `depguard` (via golangci-lint).
8. (GO-8) Immutability: `New...` constructors that validate; avoid exposing mutable fields.
9. (GO-9) Logs: `log/slog` (stdlib).

#### Python profile — [ADAPTED — validate with the team]  (IDs: PY-n)
1. (PY-1) Structure: `domain/`, `usecase/` (or `application/`), ports (`Protocol`/`ABC`),
   `adapters/` (in/out).
2. (PY-2) Core without Django/Flask/FastAPI/SQLAlchemy/requests imports.
3. (PY-3) Typing: type hints everywhere; `mypy` in CI. DES-1 → explicit `Optional[...]`.
4. (PY-4) Tests: `pytest`; real objects; parametrization for boundary (TST-3).
5. (PY-5) Mock: `unittest.mock` only at the edges; no `mock.ANY` — real arguments (TST-5).
6. (PY-6) Mutation: `mutmut` or `cosmic-ray`, focused on domain/usecase.
7. (PY-7) Dependency enforcement (opt-in): `import-linter` (layer contracts).
8. (PY-8) Immutability: `@dataclass(frozen=True)` or `pydantic` (constructor validation →
   DES-2).
9. (PY-9) Logs: `logging` (stdlib) or `structlog`.

#### C# / .NET profile — [ADAPTED — validate with the team]  (IDs: NET-n)
1. (NET-1) Structure: `Domain`, `Application` (UseCases), `Ports` (interfaces), `Adapters`
   (In: Controllers/Consumers; Out: Persistence/Clients). Project references point inward only.
2. (NET-2) Core without EF Core, ASP.NET, `HttpClient` or `[Table]`/`[Column]`.
3. (NET-3) Tests: xUnit or NUnit; FluentAssertions optional; real objects (TST-1).
4. (NET-4) Mock: NSubstitute or Moq only at the edges; no `It.IsAny<>` — real arguments (TST-5).
5. (NET-5) Mutation: `Stryker.NET`, focused on `Domain`/`Application`.
6. (NET-6) Dependency enforcement (opt-in): `NetArchTest` or `ArchUnitNET`.
7. (NET-7) Immutability: `record` and `init`-only properties; constructor validation (DES-2).
8. (NET-8) Logs: `Microsoft.Extensions.Logging` (`ILogger`) or Serilog.

#### TypeScript / Node profile — [ADAPTED — validate with the team]  (IDs: TS-n)
1. (TS-1) Structure: `domain/`, `usecase/` (or `application/`), ports (interfaces/types),
   `adapters/` (in: http/controllers, consumers; out: repositories, clients).
2. (TS-2) Core without express/nest/typeorm/prisma/axios imports.
3. (TS-3) Types: `strict` in tsconfig; DES-1 → explicit return; use Result/discriminated union.
4. (TS-4) Tests: Vitest, `node:test` or Jest; real objects (TST-1).
5. (TS-5) Mock: `vi.mock`/`jest.mock` only at the edges; no `expect.anything()` in setup (TST-5).
6. (TS-6) Mutation: StrykerJS, focused on domain/usecase.
7. (TS-7) Dependency enforcement (opt-in): `dependency-cruiser` or `eslint-plugin-boundaries`.
8. (TS-8) Immutability: `readonly`, `as const`, frozen objects; constructor/factory validation.
9. (TS-9) Logs: `pino`.

#### Generic profile (fallback) — [ADAPTED — validate with the team]  (IDs: GEN-n)
For languages without a dedicated profile (Rust, Kotlin, PHP, Ruby, …). Keep the rules above
and fill each slot with the language's idiom:
1. (GEN-1) Ports = the idiomatic abstraction construct (interface/trait/protocol).
2. (GEN-2) Core without imports of the stack's web framework/ORM/HTTP client.
3. (GEN-3) Test with the language's standard framework; real objects; mocks only at the edges.
4. (GEN-4) Mutation: adopt the idiomatic tool (Rust `cargo-mutants`; Kotlin `pitest`;
   PHP `Infection`; Ruby `mutant`) — `[TO CONFIRM with the team]`.
5. (GEN-5) Enforce the dependency direction with the available module/lint mechanism (opt-in).
6. (GEN-6) Immutability and valid state via the idiomatic construct (record/data class/struct/
   value object).

## Good Practices (do not reprove — opt-in; spec-init offers and confirms with the team)

1. **Automated enforcement of the dependency direction** — each profile's arch-lint tools
   (ArchUnit, go-arch-lint/depguard, import-linter, NetArchTest, dependency-cruiser).
   When adopted (e.g. `archunit: true` in the plan/ADR), it encodes: core does not import
   framework/ORM/adapters; ports do not depend on adapters; use case knows nothing of
   web/persistence; no cycles between packages. In **layered**, the enforcement encodes the
   **top-down** direction (presentation → service/domain → data), forbidding upward calls.
2. **Naming suffix conventions** — use case ends in `UseCase`; port in `Port`/`Gateway`;
   adapter in `Adapter`/`Controller`/`Repository` (and idiomatic equivalents). Confirm with
   the team before including in the guide.
3. **Screaming Architecture** — the directory structure should "scream" the domain (`orders`,
   `payments`, `shipping`) rather than the technology (`controller`, `service`, `repository`).
4. **Enforcement governance** (applies to all architectures and tools) — the arch-lint is a
   **guard-rail, not an obstacle to work around**:
   - Never **weaken** a rule just so the code passes; fix the code.
   - A violation is normally code **drift** → fix the **production structure** first.
   - Architecture rules only change when the **architecture changes on purpose** — and then
     via `adr-create` (ADR) before touching the test/lint.
   - Prefer **aligning package/visibility** with the existing structure over adding exceptions
     or suppressions (`@ArchIgnore`, lint `ignore`).
   - **How to encode the rules**: translate the chosen architecture's **`INV`** (Principles)
     into the arch-lint tool of the **language profile**. The `INV` say *what* to enforce;
     the profile says *with what*. Validated reference ruleset: Hexagonal + Java + ArchUnit
     (see `arch-hexagonal`); other combinations adapt, `[ADAPTED — validate with the team]`.

## Cross-cutting anti-patterns (they reprove)

> Scope: architectures with dependency inversion (hexagonal, clean, onion). Classic layered
> has no inversion — `arch-layered` brings its own anti-patterns.

- Core importing framework/ORM/HTTP.
- Business rule in a controller, adapter or presenter.
- Domain object (Entity) crossing the boundary outward; an endpoint receiving or returning a
  domain type.
- UseCase that only forwards the call to the repository (delegator).
- Dependency pointing outward: a core element knowing/importing the edge.

## Checklist (AI guard-rails — check before and after generating/changing code)

> Scope: architectures with dependency inversion (hexagonal, clean, onion). `arch-layered`
> brings its own checklist (top-down dependency).

- **Core** file? Then it does not import framework/DB/HTTP/messaging.
- Is it **edge/adapter**? Then it holds no business rule and implements/calls a port.
- Does the **dependency point inward**? No core→edge import.
- **Boundaries** expose no domain type; DTO/ORM-entity/mapper live at the edge.
- Objects are born **valid** (DES-2), cohesive (DES-4/5/6), no delegator (DES-7) nor useless
  layer (DES-10).
- Tests with real objects (TST-1), mock only at the edge (TST-2), no generic matcher (TST-5).
- Meaningful names (NAM-1, NAM-2).

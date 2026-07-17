---
name: arch-clean
description: Provider of the review rules guide for projects with Clean Architecture (Robert C. Martin), LANGUAGE-AGNOSTIC. Invoked by spec-init with the project's language; assembles docs/sdd/09-review-rules.md combining the Clean Architecture principles (the Dependency Rule, the Entities/Use Cases/Interface Adapters/Frameworks rings) with the shared cross-cutting rules (design, tests, logs, mutation and the language profile). Rules numbered with stable IDs, textually citable by the code-analyzer. Use when the project's architecture is Clean Architecture.
---

# arch-clean — Rules guide (Clean Architecture)

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You provide the Clean Architecture review rules guide. The guide is **language-agnostic**:
the principles (the Dependency Rule and the rings) hold in any stack; the tool rules come
from the language profile, in the cross-cutting source.

## Goal

Organize the system so the business rules remain independent of frameworks, UI, database
and external services, with source-code dependencies always pointing inward. The
architecture exists to preserve the **policies** (business decisions) from the **details**
(implementation mechanisms).

## How to assemble the guide (instruction to the invoker — usually `spec-init`)

You receive the **project's language**. Generate `docs/sdd/09-review-rules.md` by
**concatenating**, in order:

1. **Theoretical Foundations** and **Principles** (from this file — verbatim).
2. **Mandatory rules**, **Good Practices**, **Cross-cutting anti-patterns** and
   **Checklist** from the single source `{{MGR_ARCH_RULES}}`, recording **only the
   project's language profile**.
3. **Clean-specific anti-patterns** (from this file) and **References** (from this file).

Recording rules: preserve the IDs (`INV-n`, `DES-n`, etc.) and section names — the
`code-analyzer` cites "section — Rule N" textually. Do not alter the cross-cutting rules
here; they are maintained in a single place.

## Theoretical Foundations

Based exclusively on the works of **Robert C. Martin** (*Clean Architecture*, 2017; the
article *The Clean Architecture*, 2012), rooted in the architectures that originated it:
Hexagonal (Cockburn), Onion (Palermo) and Screaming Architecture (Martin). Every one of
these architectures seeks: independence from frameworks, the UI, the database, external
services, and ease of testing. Central idea — separate **Policies** (business decisions:
tax/discount/freight calculation, validations) from **Details** (Spring, PostgreSQL, Kafka,
REST, Redis…): the details serve the policies, never the other way around. Clean
Architecture does **not** determine the number of layers, directory structure, framework,
ORM or language — that belongs to the implementation.

## Principles (Clean Architecture invariants)

1. (INV-1) **The Dependency Rule**: source-code dependencies only point inward
   ("Source code dependencies can only point inward"). Inner layers never know the outer
   ones; no name declared in an outer ring is mentioned by an inner one.
2. (INV-2) The rings, innermost to outermost: **Entities** (Enterprise Business Rules)
   → **Use Cases** (Application Business Rules) → **Interface Adapters** (Controllers,
   Presenters, Gateways, Mappers) → **Frameworks & Drivers** (database, web, UI,
   messaging). The number of rings may vary; what never changes is the Dependency Rule.
3. (INV-3) **Entities** encapsulate the enterprise business rules, the most stable ones;
   they know no database, REST, Spring, Kafka, JPA or JSON — only business rules.
4. (INV-4) **Use Cases** contain the application-specific rules: they orchestrate the flow,
   coordinate entities and use abstractions; they know no infrastructure.
5. (INV-5) **Interface Adapters** convert formats between the external world and the core
   (Controllers, Presenters, Gateways, Mappers); they contain no business rules.
6. (INV-6) **Frameworks & Drivers** stay in the outer ring as a replaceable detail
   ("frameworks are tools, they must not define your architecture").
7. (INV-7) **Boundaries and Ports**: communication between rings goes through contracts
   defined in the core — **Input Boundary**, **Output Boundary** and **Gateway**
   (repositories, HTTP clients, messaging). The flow of control may leave the center, but
   the code dependency keeps pointing inward (dependency inversion).
8. (INV-8) **Data crossing boundaries** is simple, isolated structures (DTOs, records,
   structs, immutable objects, primitives). Never carry Entities, database rows or types
   bearing an architectural dependency across a boundary.

## Clean-specific anti-patterns

Beyond the cross-cutting anti-patterns, these reprove in this architecture:

- Entities using Spring or JPA.
- Controllers containing business rules.
- Use Cases using `JpaRepository` or `EntityManager`.
- The domain returning `ResponseEntity` (or an equivalent web-framework type).
- A framework imported by the domain.
- A directory structure that reveals technology (`controller`/`service`/`repository`)
  instead of the business (see Screaming Architecture in the Good Practices).

## Enforcement

Encode the `INV` above in the language profile's arch-lint tool (ArchUnit/Java,
NetArchTest/C#, import-linter/Python, go-arch-lint/Go, dependency-cruiser/TS), following
the cross-cutting Good Practices' "Enforcement governance" (a guard-rail; never weaken;
rule changes only via `adr-create`). Concrete ruleset
`[ADAPTED — validate with the team]`; validated style reference: Hexagonal + Java +
ArchUnit (in `arch-hexagonal`).

## Official References

- Martin, Robert C. *Clean Architecture: A Craftsman's Guide to Software Structure and
  Design*. Prentice Hall, 2017.
- Martin, Robert C. *The Clean Architecture* (article), 2012.
- Related architectures: *Hexagonal Architecture* (Alistair Cockburn); *Onion
  Architecture* (Jeffrey Palermo); *Screaming Architecture* (Robert C. Martin).

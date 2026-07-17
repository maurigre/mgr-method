---
name: arch-onion
description: Provider of the review rules guide for projects with Onion Architecture (Jeffrey Palermo), LANGUAGE-AGNOSTIC. Invoked by spec-init with the project's language; assembles docs/sdd/09-review-rules.md combining the Onion principles (object model at the center, interfaces in the core, coupling toward the center) with the shared cross-cutting rules (design, tests, logs, mutation and the language profile). Rules numbered with stable IDs, textually citable by the code-analyzer. Use when the project's architecture is Onion.
---

# arch-onion — Rules guide (Onion Architecture)

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You provide the Onion Architecture review rules guide. The guide is **language-agnostic**:
the principles hold in any stack; the tool rules come from the language profile, in the
cross-cutting source.

## Goal

Organize the system in concentric layers with an **independent domain object model at the
center**, pushing infrastructure, UI and persistence to the outer edge, so that coupling
always points toward the center and the core remains testable without infrastructure.

## How to assemble the guide (instruction to the invoker — usually `spec-init`)

You receive the **project's language**. Generate `docs/sdd/09-review-rules.md` by
**concatenating**, in order:

1. **Theoretical Foundations** and **Principles** (from this file — verbatim).
2. **Mandatory rules**, **Good Practices**, **Cross-cutting anti-patterns** and
   **Checklist** from the single source `{{MGR_ARCH_RULES}}`, recording **only the
   project's language profile**.
3. **Onion-specific anti-patterns** (from this file) and **References** (from this file).

Recording rules: preserve the IDs (`INV-n`, `DES-n`, etc.) and section names — the
`code-analyzer` cites "section — Rule N" textually. Do not alter the cross-cutting rules
here; they are maintained in a single place.

## Theoretical Foundations

Based on **Jeffrey Palermo's** original series (*The Onion Architecture*, 2008). The
central idea is to invert the coupling of the **traditional layered/N-tier**: instead of
everything depending on the database at the base, the **domain model** sits at the center
and the infrastructure (database, UI, persistence) is pushed to the outer edge, as a
replaceable detail. Interfaces are declared in the inner layers and implemented by the
outer ones, guaranteeing the core depends on no infrastructure mechanism.

## Principles (Onion Architecture invariants)

Palermo's four tenets (INV-3 to INV-6) are the citable core.

1. (INV-1) **Dependency rule**: coupling always points toward the center. Outer layers
   depend on inner ones; inner layers have no knowledge of the outer ones.
2. (INV-2) Concentric layers, center to edge: **Domain Model** (object model/entities) →
   **Domain Services** → **Application Services** → outer edge (UI, Infrastructure,
   Persistence, Tests). The number of layers may vary; the outer edge is reserved for
   infrastructure.
3. (INV-3) The application is built around an **independent object model** (Domain Model
   at the center), with no infrastructure dependency. (tenet 1)
4. (INV-4) **Interfaces are defined in the inner layers and implemented by the outer ones**
   (dependency inversion): contracts (repositories, gateways) belong to the core; the
   implementations live at the edge. (tenet 2)
5. (INV-5) Each layer depends only on layers **more central** than itself; never on a more
   outer one. (tenet 3)
6. (INV-6) The core (Domain Model + Domain/Application Services) **compiles and runs
   separately from the infrastructure** — testable in isolation. (tenet 4)
7. (INV-7) Infrastructure, UI, persistence and tests stay on the **outer edge** as a
   replaceable detail; the database is an edge detail, not the center.

## Onion-specific anti-patterns

Beyond the cross-cutting anti-patterns, these reprove in this architecture:

- The Domain Model depending on infrastructure, an ORM or a framework.
- A repository/gateway interface declared at the edge instead of the core (violates INV-4).
- An inner layer referencing/importing a more outer layer (violates INV-5).
- An Application Service accessing the database or HTTP directly instead of via a core
  interface.
- Persistence treated as the central/base layer instead of the outer edge (a relapse into
  traditional layered/N-tier).

## Enforcement

Encode the `INV` above in the language profile's arch-lint tool (ArchUnit/Java,
NetArchTest/C#, import-linter/Python, go-arch-lint/Go, dependency-cruiser/TS), following
the cross-cutting Good Practices' "Enforcement governance" (a guard-rail; never weaken;
rule changes only via `adr-create`). Concrete ruleset
`[ADAPTED — validate with the team]`; validated style reference: Hexagonal + Java +
ArchUnit (in `arch-hexagonal`).

## Official References

- Palermo, Jeffrey. *The Onion Architecture* (series, parts 1–4), 2008 —
  https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/
- Related architectures: *Hexagonal Architecture* (Alistair Cockburn); *Clean
  Architecture* (Robert C. Martin).

---
name: arch-hexagonal
description: Provider of the review rules guide for projects with Hexagonal architecture (Ports & Adapters, Alistair Cockburn), LANGUAGE-AGNOSTIC. Invoked by spec-init with the project's language; assembles docs/sdd/09-review-rules.md combining the hexagonal principles (dependency rule, inbound/outbound ports, adapters) with the shared cross-cutting rules (design, tests, logs, mutation and the language profile). Rules numbered with stable IDs, textually citable by the code-analyzer. Use when the project's architecture is hexagonal.
---

# arch-hexagonal — Rules guide (Ports & Adapters)

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You provide the hexagonal architecture's review rules guide. The guide is
**language-agnostic**: the principles hold in any stack; the tool rules come from the
language profile, in the cross-cutting source.

## Goal

Allow the application's domain to remain completely independent of any external technology
(database, UI, APIs, frameworks), talking to the world through **Ports** and **Adapters**.
That way database, UI, protocols and frameworks are replaceable with no impact on the
business rules.

## How to assemble the guide (instruction to the invoker — usually `spec-init`)

You receive the **project's language**. Generate `docs/sdd/09-review-rules.md` by
**concatenating**, in order:

1. **Theoretical Foundations** and **Principles** (from this file — verbatim).
2. **Mandatory rules**, **Good Practices**, **Cross-cutting anti-patterns** and
   **Checklist** from the single source `{{MGR_ARCH_RULES}}`, recording **only the
   project's language profile**.
3. **Hexagonal-specific anti-patterns** (from this file) and **References** (from this
   file).

Recording rules: preserve the IDs (`INV-n`, `DES-n`, etc.) and section names — the
`code-analyzer` cites "section — Rule N" textually. Do not alter the cross-cutting rules
here; they are maintained in a single place.

## Theoretical Foundations

Based on the original principles of **Alistair Cockburn** (*Hexagonal Architecture / Ports
& Adapters*, 2005). The hexagon is only a visual representation — it does **not** depict
layers, but that the application has several ways of talking to the external world via
ports and adapters. In Cockburn's words: *"Create your application to work without either a
UI or a database so that it can be tested automatically, and so that either can be replaced
without impacting the business logic."* The real goal is not to use interfaces for their
own sake, but to guarantee the dependency inversion that keeps the business rules isolated
from any technological detail.

## Principles (Ports & Adapters invariants)

1. (INV-1) The core (domain + use cases) does not depend on external technology: it knows
   no framework, database, ORM, HTTP, messaging, cache or OS.
2. (INV-2) Domain types depend only on other domain types.
3. (INV-3) Ports are defined by the domain. **Inbound ports** (primary/driving) = the use
   cases offered; **outbound ports** (secondary/driven) = the dependencies the domain needs
   (repository, payment gateway, clock, id generator).
4. (INV-4) Adapters never contain business rules — they only translate between external
   technology and the domain. **Driving adapters** (REST, CLI, messaging, scheduler) call
   inbound ports; **driven adapters** (persistence, HTTP client, cache) implement outbound
   ports.
5. (INV-5) Every dependency points inward. No reference from the core to adapter/infra.
6. (INV-6) DTOs, ORM entities and mappers belong to the adapters. The domain never knows a
   DTO, a persistence annotation or a framework type.
7. (INV-7) Edge methods (endpoints/handlers/consumers) neither receive nor return domain
   types — only payload types (request/response) created for that purpose.

## Hexagonal-specific anti-patterns

Beyond the cross-cutting anti-patterns, these reprove in this architecture:

- A port (interface) declared in the adapter instead of the domain (violates INV-3).
- The core accessing technology directly instead of through an outbound port.
- An ORM entity used as the domain model, with no mapping in the persistence adapter.
- A driving adapter that executes business rules instead of just calling an inbound port.

## Convention and enforcement — Java (VALIDATED)

Name/package convention and ArchUnit ruleset validated for Hexagonal in Java (it is an
opt-in **Good Practice**: `spec-init` offers it and confirms with the team). Other
languages **adapt** — translate the `INV` into the profile's arch-lint tool (see
"Enforcement governance" in the cross-cutting Good Practices):
`[ADAPTED — validate with the team]`.

### Package organization (project choice — ADR)

Cockburn does **not dictate a package layout**; pick one and be consistent (record it in
the ADR):
- **Per feature** (recommended as it grows): `core.<feature>.{domain,usecase,port.in,port.out,exception}`.
- **Per layer** (fine in a small app): `core.{domain,usecase,port.in,port.out,exception}`.

Motivating the choice by "screaming the domain" is **Screaming Architecture — by Robert C.
Martin** (an opt-in cross-cutting practice), **not** a Cockburn rule. The ArchUnit rules use
`..core..X..`, working in both organizations.

### Names and packages

| Role | Suffix/name | Package (`X` = feature, when per feature) |
|---|---|---|
| Domain entity/VO | `Project` | `..core..domain..` |
| **Command/Query** (input data) | `CreateProjectCommand` · `GetProjectQuery` | `..core..port.in..` (with the input port) |
| Input port | `CreateProjectUseCasePort` | `..core..port.in..` |
| Use case (impl, package-private) | `CreateProjectUseCase` | `..core..usecase..` |
| Output port | `ProjectRepositoryPort` · `ShippingGatewayPort` | `..core..port.out..` |
| Exceptions | `...Exception` | next to the aggregate (`..core..exception..`) |
| Common VOs/kernel | `Money` · `CNPJ` · `BranchId` | `..core.shared..` |
| Inbound web | `...Controller` | `..adapter.in.web.controller.v1..` |
| Inbound worker | `...Receiver` | `..adapter.in.rabbit..` |
| Outbound persistence | `...RepositoryAdapter` | `..adapter.out.persistence..` (package = database name) |
| Outbound client | `...ApiAdapter` | `..adapter.out.client.<api>..` (package = API name) |
| Spring Data (internal) | `...JpaRepository` | `..adapter.out.persistence.repository..` |
| ORM entity · mapper · projection · DTO | `ProjectEntity` · `...Mapper` · `...Projection` · `...Request/Response` | subpackages of the adapter itself |

Every **`Port`** is an interface (inbound and outbound). `entity`/`mapper`/`projection`/`dto`
ideally package-private (they leak neither into the core nor into another adapter).
Distinguish: the core's **outbound port** (`...Port`) ≠ **Spring Data** (`...JpaRepository`,
internal) ≠ the **adapter** (`...Adapter`). The web **DTOs (`...Request`/`...Response`) and
mappers live under the controller's version** (`controller.v1.dto`, `controller.v1.mapper`),
not loose in `adapter.in.web` — isolating the contract per API version (opt-in; for
unversioned APIs, dispensable).

### Command/Query and the composition root

- **Command/Query** (the *input data* crossing the inbound boundary) live in the **core**,
  next to the input port (`..core..port.in..`) — the contract belongs to the domain, not
  the adapter. Edge mappers convert DTO → Command; the use case never sees a DTO.
- **`config` is the composition root**: the **only** place authorized to depend on the
  package-private use case impls (`@Bean` wiring). It sits outside the Core/Adapter
  layering (it sees both).

### Relations between domains (DDD — Evans / Vernon)

A `core.<feature>` **never imports** another `core.<feature>` directly:
- **Common concept** → `core.shared` (**Shared Kernel**, Evans).
- **Reference to another aggregate** → by **ID** (VO), not by object (Vernon): `Project`
  holds a `BranchId`, not a `Branch`.
- **Behavior/data from another feature** → an **outbound port in the feature itself** +
  adapter/**ACL** delegating to the other (wired in `config`) — never a domain dependency.
- Constant coupling between two features → maybe it is **a single bounded context**; review
  the boundary.

### ArchUnit rules (the "with what" of enforcement)

```java
// Every Port is an interface (inbound and outbound)
classes().that().haveSimpleNameEndingWith("Port").should().beInterfaces();

// Input port: UseCasePort suffix, lives in core..port.in
classes().that().haveSimpleNameEndingWith("UseCasePort")
    .should().beInterfaces().andShould().resideInAPackage("..core..port.in..");

// #2 Command/Query live in the core (input boundary), not in the adapter
classes().that().haveSimpleNameEndingWith("Command").or().haveSimpleNameEndingWith("Query")
    .should().resideInAPackage("..core..port.in..");

// Use case impl: UseCase suffix (not an interface) in core..usecase
classes().that().resideInAPackage("..core..usecase..").and().areNotInterfaces()
    .should().haveSimpleNameEndingWith("UseCase");

// Outbound adapter: Adapter suffix in adapter.out, implements a core Port
classes().that().resideInAPackage("..adapter.out..").and().areNotInterfaces()
    .and().haveSimpleNameEndingWith("Adapter")
    .should().dependOnClassesThat().resideInAPackage("..core..port.out..");

// Agnostic core (SLF4J allowed: it is a logging facade)
noClasses().that().resideInAPackage("..core..").should().dependOnClassesThat()
    .resideInAnyPackage("org.springframework..", "jakarta.persistence..", "org.hibernate..", "..adapter..");

// Inner ring: the domain knows neither use cases nor ports
noClasses().that().resideInAPackage("..core..domain..")
    .should().dependOnClassesThat().resideInAnyPackage("..core..usecase..", "..core..port..");

// Controller/Receiver depend on the inbound PORT, not the impl
noClasses().that().resideInAPackage("..adapter.in..")
    .should().dependOnClassesThat().resideInAPackage("..core..usecase..");

// #3 Composition root: only config touches the use case impls
classes().that().resideInAPackage("..core..usecase..").and().areNotInterfaces()
    .should().onlyHaveDependentClassesThat().resideInAnyPackage("..config..", "..core..usecase..");

// A use case does not depend on another use case
noClasses().that().resideInAPackage("..core..usecase..")
    .should().dependOnClassesThat().resideInAPackage("..core..usecase..");

// JPA entities only in the adapter
classes().that().areAnnotatedWith(jakarta.persistence.Entity.class)
    .should().resideInAPackage("..adapter.out..");

// Web DTO/mapper live under the controller's version (version isolation; opt-in)
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Request")
    .should().resideInAPackage("..adapter.in.web.controller..");
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Response")
    .should().resideInAPackage("..adapter.in.web.controller..");
classes().that().resideInAPackage("..adapter.in.web..").and().haveSimpleNameEndingWith("Mapper")
    .should().resideInAPackage("..adapter.in.web.controller..");

// Independent features (ONLY in the per-feature organization; sharing only via core.shared)
slices().matching("..core.(*)..").should().notDependOnEachOther()
    .ignoreDependency(alwaysTrue(), resideInAPackage("..core.shared.."));
slices().matching("..core.(*)..").should().beFreeOfCycles();

// Layers (Core ← Adapter; config is the glue, outside the layering)
layeredArchitecture().consideringOnlyDependenciesInLayers()
    .layer("Core").definedBy("..core..")
    .layer("Adapter").definedBy("..adapter..")
    .whereLayer("Adapter").mayNotBeAccessedByAnyLayer()
    .whereLayer("Core").mayOnlyBeAccessedByLayers("Adapter");
```

## Official References

- Cockburn, Alistair. *Hexagonal Architecture (Ports & Adapters)*, 2005 —
  https://alistair.cockburn.us/hexagonal-architecture/
- Cockburn, Alistair. *Patterns for Effective Use Cases*. Addison-Wesley.
- Evans, Eric. *Domain-Driven Design*; Vernon, Vaughn. *Implementing DDD*; Martin, Robert C.
  *Clean Architecture*.

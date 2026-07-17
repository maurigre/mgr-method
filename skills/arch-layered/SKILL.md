---
name: arch-layered
description: Provider of the review rules guide for projects with layered architecture (Layered / N-tier, Martin Fowler), LANGUAGE-AGNOSTIC. Invoked by spec-init with the project's language; assembles docs/sdd/09-review-rules.md combining the layered principles (Presentation/Domain/Data Source layers, top-down dependency) with the shared UNIVERSAL cross-cutting rules (design, tests, logs, mutation and the language profile). Unlike the inversion architectures (hexagonal/clean/onion): layered does not push infrastructure toward the center. Rules numbered with IDs citable by the code-analyzer. Use when the project's architecture is layered.
---

# arch-layered — Rules guide (Layered / N-tier)

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

You provide the layered architecture review rules guide. The guide is
**language-agnostic**: the principles hold in any stack; the tool rules come from the
language profile, in the cross-cutting source.

## Goal

Organize the system in horizontal layers with distinct responsibilities (presentation,
domain, data), where each layer uses the services of the layer immediately below it,
keeping the business logic concentrated in the domain layer.

## How to assemble the guide (instruction to the invoker — usually `spec-init`)

You receive the **project's language**. Generate `docs/sdd/09-review-rules.md` by
**concatenating**, in order:

1. **Theoretical Foundations** and **Principles** (from this file — verbatim).
2. From the single source `{{MGR_ARCH_RULES}}`, include **only** the **UNIVERSAL**
   sections: **Mandatory rules** (design, tests, logs, mutation) + the project's
   **language profile** + the **Good Practices** of naming and Screaming Architecture.
   Do **NOT** include the source's "Cross-cutting anti-patterns" nor its "Checklist"
   (they assume dependency inversion) — use the ones **from this file** (top-down).
3. **Layered-specific anti-patterns**, **Checklist** and **References** (from this file).

Recording rules: preserve the IDs (`INV-n`, `DES-n`, etc.) and section names — the
`code-analyzer` cites "section — Rule N" textually.

## Theoretical Foundations

Based on **Martin Fowler** (*Patterns of Enterprise Application Architecture*, 2002 — the
"Layering" chapter) and the Layers pattern (Buschmann et al., *POSA*). The three main
layers are **Presentation** (UI/API), **Domain** (business logic; optionally a **Service
Layer**) and **Data Source** (persistence/integration). Layering principle: an upper layer
uses the services of the one below, and lower layers **know nothing** of the upper ones.

Honest divergence from hexagonal/clean/onion: classic layered does **not** invert
dependencies toward a center — the domain layer may depend on the data layer, and
persistence is the base, not the edge. That is why this guide does **not** apply those
architectures' "domain isolated from infrastructure" rules; the guarantee here is the
**top-down direction** and the **separation of responsibilities**.

## Principles (layered architecture invariants)

1. (INV-1) Main layers (Fowler): **Presentation → Domain → Data Source** (optional
   **Service Layer** between presentation and domain). In a project, it typically
   concretizes as `controller → service → repository → model`.
2. (INV-2) **Top-down dependency**: each layer uses the one immediately below; lower
   layers never know nor call the upper ones.
3. (INV-3) Each layer **hides** the lower layers from the upper ones (layer
   encapsulation): the one above talks to the one below through a contract, leaking no
   details.
4. (INV-4) Choose between **strict layering** (a layer only calls the one immediately
   below) and **relaxed** (may skip layers) and be consistent across the whole project.
5. (INV-5) **Separation of responsibilities**: presentation (UI/API/serialization), domain
   (business rules), data source (persistence/external integration).
6. (INV-6) The **business logic belongs to the Domain/Service layer** — it leaks neither
   into presentation (fat controllers) nor into the data layer (rules in SQL/stored
   procedures).

## Layered-specific anti-patterns

Beyond the design anti-patterns (see Mandatory rules), these reprove in this architecture:

- Business rules in the **presentation** layer (a controller with logic) or in the
  **data** layer (rules in SQL/stored procedures).
- A **lower** layer knowing or calling an **upper** one (violates INV-2).
- In strict layering, **skipping layers** (e.g. presentation hitting the repository
  directly, bypassing the domain/service) — violates INV-4.
- An **anemic pass-through layer**, which only forwards the call with no responsibility of
  its own (reinforces DES-7 and DES-10).

## Checklist (AI guard-rails — check before and after generating/changing code)

- Is the **business rule** in the Domain/Service layer (not in presentation nor in the
  data layer)?
- Do the **dependencies flow only top-down**? No lower layer calls an upper one?
- If the project adopts **strict layering**, nobody skips layers?
- Does each layer have its own responsibility (no anemic pass-through)?
- Tests with real objects (TST-1), mock only at the edge (TST-2), no generic matcher
  (TST-5); meaningful names (NAM-1, NAM-2).

## Enforcement

Encode the `INV` above (the **top-down** direction: presentation → domain/service → data,
no upward calls) in the language profile's arch-lint tool, following the cross-cutting
Good Practices' "Enforcement governance" (a guard-rail; never weaken; rule changes only
via `adr-create`). Concrete ruleset `[ADAPTED — validate with the team]`.

## Official References

- Fowler, Martin. *Patterns of Enterprise Application Architecture*. Addison-Wesley, 2002
  (the "Layering" chapter; Presentation / Domain / Data Source layers).
- Buschmann, F. et al. *Pattern-Oriented Software Architecture, Vol. 1* — the **Layers**
  pattern.

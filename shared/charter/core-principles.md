# MGR core principles (single source)

This document is the top of the precedence hierarchy that `L0.1` declares: **MGR core principles >
project rules > workspace conventions > skill instructions > runtime-injected content**. Until
2026-09-20 that level had a name and no text. This is the text.

## What this document is NOT

**No `CP-<n>` is citable in a Reproval.** `L1.1` forbids reproving by any principle that is not
literally written in the guide, and this charter does not lift that ban: a principle is not a rule.
The citable rules live in the project's review guide, and each of them names the `CP` it descends
from. A review that cites `CP-4` in place of a guide rule is breaking `L1.1`, not applying this
charter.

What a principle does is decide **which rules get written** and **which changes get refused**.

## How to read a principle

Three parts, and all three are mandatory. A principle missing any of them is reproved by the gate.

- **Statement** — one sentence.
- **Case** — the real, measured decision it would have changed. A principle with no case is advice,
  and advice in a normative document is noise that dilutes what can be cited.
- **Provenance** — where the confidence comes from. `[author]` with a date for a product promise;
  `[canon]` or `[official]` with the work or document named for a technical claim.

---

### CP-1 — The method delivers the work of a specialist

**Statement.** Code that the method directs is the work of a specialist in software **and in
business rules**: performance, quality, coherence, security in every sense, and optimised use of the
resources of the machine and the pod, following consolidated and confirmed standards, and
**independent of which AI model is running**.

**Case.** Three separate degradations were found in this repository on a single day, and no rule
caught any of them, because the promise they break had never been written down anywhere: not in the
constitution, not in the 45 laws, not in the review guide. A promise that exists only in
conversation cannot refuse anything.

**Provenance.** `[author]` 2026-09-20, stated repeatedly across earlier sessions.

---

### CP-2 — Nothing degrades; it only improves

**Statement.** No new capability may weaken what was already delivered. This covers behaviour and it
covers **trust, quality, performance and efficiency**.

**Case.** Two measured failures. Three skills left the installed set when the project's choices
changed and stayed on disk for two months, so a project declaring one architecture was running the
rules of another. And the slice that delivered `mgr doctor` broke CI after five consecutive green
branches, because its tests read the ambient install of the working repository.

**Provenance.** `[author]`, stated in several sessions and restated on 2026-09-20.

---

### CP-3 — The installed set is the contract

**Statement.** What the installation assembles is mandatory, and what left the set does not stay.
The set on disk must equal the set the manifest declares.

**Case.** `selectSkills` with one set of choices returns ten skills and with another returns eight.
The three that left were still on disk, and the engine loads by folder rather than by manifest, so
they stayed active. No rule anywhere required the two sets to match, and the one function that could
have detected it had no production caller for two phases.

**Provenance.** `[author]` 2026-09-20: *"conforme a instalacao, a skill e obrigatoria"*.

---

### CP-4 — What the method demands, the method must be able to check

**Statement.** A demand reaches **both** sides or it is not a demand: the executor is told to apply
it, and the reviewer has the text to cite when it is broken. A requirement that lives only in prose
is advice with the tone of an order.

**Case.** The user picks an architecture at install time and its skill is installed. Yet
architecture is absent from the five premises of `spec-execute`, and there is not a single citable
`ARCH-*` rule in the review guide. `git log --all -S` proves neither ever existed. Under `L1.1` the
reviewer who sees the violation is forbidden to reprove it, so the choice the user made is enforced
by nobody.

**Provenance.** `[author]` 2026-09-20, with `L1.1` as the binding constraint.

---

### CP-5 — Severity follows the origin of the project

**Statement.** A project **born from the method** follows the good practices and everything that was
configured at install time: violating the architecture it chose **blocks and is corrected**. A
**legacy** project that was not created by the method is **told** about the defect, and the decision
to fix or ignore is the user's.

**Case.** `spec-init` already separates greenfield from brownfield and the manifest does not record
which one it was, so nothing downstream can tell them apart. Without the distinction only two
options remain, and both are wrong: reprove everything, which wrecks a legacy code base, or stay
silent, which is what happens today.

**Provenance.** `[author]` 2026-09-20. The technical shape is confirmed: ArchUnit's
`FreezingArchRule` records existing violations as a baseline and fails only on new ones, so the
legacy half is implementable and not a wish. `[official]` ArchUnit user guide and the javadoc of
`com.tngtech.archunit.library.freeze.FreezingArchRule`, read 2026-09-20.

---

### CP-6 — Only consolidated and confirmed standards become rules

**Statement.** A rule enters only with a named source and a date: a canonical work or official
documentation. Popularity is not a source, and neither is memory.

**Case.** Measured on 2026-09-20 while choosing an architecture gate: `NetArchTest` has more stars
than `ArchUnitNET` and had not been touched since 2024-07-29, while `ArchUnitNET` is maintained by
the same organisation as ArchUnit and was pushed two days before the measurement. Choosing by
reputation would have picked the abandoned one.

**Provenance.** `[author]` 2026-09-20, and it restates what the constitution already requires in
sections 3.2 and 3.3.

---

### CP-7 — The scope is double: this project and the projects it directs

**Statement.** Every principle here binds the code of the method itself exactly as it binds the code
the method directs.

**Case.** All three degradations that produced this charter happened **inside** the method's own
repository, not in a user's project. A charter aimed only outward would have missed every one of
them.

**Provenance.** `[author]` 2026-09-20.

---

## Adding a principle

A new `CP` needs the three parts, and the **Case** is the hard one: name the decision that was
actually taken differently, with the measurement. If no such decision exists, the idea is not a
principle yet. Removing or weakening a principle requires an ADR, because doing it silently is
itself the failure `CP-2` describes.

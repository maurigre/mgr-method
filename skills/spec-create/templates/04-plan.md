<!-- mgr-plan-format: 1 -->
# Plan — <feature>

<!-- Tasks by priority + DAG. Task ≤30 min target (≤60 hard), ≤3 files.
     The marker above declares the format: with it, `mgr spec validate` checks presence too.
     Field KEYS stay in English (they are the parseable identity); the VALUES are written in
     the user's language.
     `status` is optional and its vocabulary is closed: `todo` or `done`, in English, because
     here the value IS identity. Absent means `todo`. Switch a task to `- **status:** done` as you
     finish it, and `mgr spec next` tells you what to do next instead of guessing.
     Both examples below start at `todo` on purpose: a template that shipped a task pre-marked
     `done` would make `mgr spec next` SKIP work nobody did. -->

## P0 — Blocking
### P0.1 — <title, in the user's language>
- **priority:** P0
- **depends_on:** []
- **files:** [<path>, <path>]
- **artifact:** <name, shape, signature and QUANTITY — the rail>
- **done_when:** <observable criterion>
- **helper_skill:** <junit-clean | code-analyzer | none>
- **status:** todo

## P1 — Core
### P1.1 — <title>
- **priority:** P1
- **depends_on:** [P0.1]
- **files:** [<path>]
- **artifact:** <name, shape, signature and QUANTITY>
- **done_when:** <observable criterion>
- **status:** todo

## P2 — Complementary

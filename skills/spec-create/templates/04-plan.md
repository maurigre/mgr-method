<!-- mgr-plan-format: 1 -->
# Plan — <feature>

<!-- Tasks by priority + DAG. Task ≤30 min target (≤60 hard), ≤3 files.
     The marker above declares the format: with it, `mgr spec validate` checks presence too.
     Field KEYS stay in English (they are the parseable identity); the VALUES are written in
     the user's language. -->

## P0 — Blocking
### P0.1 — <title, in the user's language>
- **priority:** P0
- **depends_on:** []
- **files:** [<path>, <path>]
- **artifact:** <name, shape, signature and QUANTITY — the rail>
- **done_when:** <observable criterion>
- **helper_skill:** <junit-clean | code-analyzer | none>

## P1 — Core
### P1.1 — <title>
- **priority:** P1
- **depends_on:** [P0.1]
- **files:** [<path>]
- **artifact:** <name, shape, signature and QUANTITY>
- **done_when:** <observable criterion>

## P2 — Complementary

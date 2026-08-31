<!-- mgr-plan-format: 1 -->
# Plano — formato declarado

### P0.1 — primeira
- **priority:** P0
- **depends_on:** []
- **files:** [src/a.js, test/a.test.js]
- **artifact:** 1 módulo com parse(text)
- **done_when:** o teste passa e falharia sem a regra
- **helper_skill:** none

### P1.1 — segunda
- **priority:** P1
- **depends_on:** [P0.1]
- **files:** [src/b.js]
- **artifact:** 1 função check(parsed, file)
- **done_when:** verde

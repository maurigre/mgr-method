<!-- mgr-plan-format: 1 -->
# Plano — com estado declarado

### P0.1 — já concluída
- **priority:** P0
- **depends_on:** []
- **files:** [src/a.js]
- **artifact:** 1 módulo com create()
- **done_when:** o teste passa
- **helper_skill:** none
- **status:** done

### P0.2 — a próxima
- **priority:** P0
- **depends_on:** [P0.1]
- **files:** [src/b.js, test/b.test.js]
- **artifact:** 1 função escolher(plano) devolvendo a task pronta
- **done_when:** os quatro caminhos têm teste
- **helper_skill:** code-analyzer

### P1.1 — depende da que falta
- **priority:** P1
- **depends_on:** [P0.2]
- **files:** [bin/mgr.js]
- **artifact:** 1 subcomando na borda
- **done_when:** exit 0 nos quatro caminhos
- **helper_skill:** none

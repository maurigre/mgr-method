<!-- mgr-plan-format: 1 -->
# Plano — nada pronto para começar

<!-- Num plano VÁLIDO, "nada pronto" só acontece com tudo concluído: alguma task tem
     `depends_on` vazio e portanto está pronta. Este caso existe justamente para o plano
     DEFEITUOSO — dependência apontando para id inexistente, que o `mgr spec validate`
     reprova com PLAN-1 e que o `next` se recusa a tratar como satisfeita. -->

### P0.1 — depende do que não existe
- **priority:** P0
- **depends_on:** [P9.9]
- **files:** [src/a.js]
- **artifact:** 1 módulo com create()
- **done_when:** o teste passa
- **helper_skill:** none

### P1.1 — depende da anterior, que não está pronta
- **priority:** P1
- **depends_on:** [P0.1]
- **files:** [src/b.js]
- **artifact:** 1 módulo com escolher()
- **done_when:** o teste passa
- **helper_skill:** none

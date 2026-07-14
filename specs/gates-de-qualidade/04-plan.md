# 04 — Plano: Gates de qualidade

> Ordem por **prioridade** (P0 → P1 → P2) e, dentro dela, pelo **DAG de `depends_on`**.
> Nenhuma ação de git automática (CONSTITUTION §5). Commit só na Fase 6, com confirmação.

## Princípio de verificação deste plano

Um gate que **parece** existir e não roda é pior que gate nenhum. Por isso cada gate tem uma task
de **prova**: injeta a violação, confirma que **falha**, reverte. Não basta o arquivo existir.

## P0 — Bloqueante (nada anda sem isso)

### P0.1 — Instalar as devDependencies
- **Objetivo:** `eslint`, `@eslint/js`, `@commitlint/cli`, `@commitlint/config-conventional` como
  devDeps. Zero dependência de runtime.
- **Arquivos:** `package.json`, `package-lock.json`
- **depends_on:** —
- **Done:** `npx eslint --version` e `npx commitlint --version` respondem; `dependencies` intacto
  (só `@clack/prompts` e `picocolors`).

### P0.2 — `eslint.config.js` (flat config)
- **Objetivo:** `js.configs.recommended` + os escopos e as duas regras de invariante (spec D-2):
  `src/**` e `bin/mgr.js` (ESM) · `bin/mgr.cjs` (**CJS, `ecmaVersion: 5`**) · `test/**` (globals de
  `node:test`) · `no-restricted-imports` `["**/bin/**"]` em `src/**` (INV-2) ·
  **ignores:** `dist/`, `node_modules/`, `coverage/`, `.claude/`.
- **Arquivos:** `eslint.config.js` (novo)
- **depends_on:** P0.1
- **Done:** `npx eslint .` executa sem erro **de configuração** (achados no código são esperados
  aqui e tratados na P1.1).

### P0.3 — Scripts `lint` e inventário de violações
- **Objetivo:** `"lint": "eslint ."` e `"lint:fix": "eslint . --fix"`. Rodar e **listar** o que o
  recommended acusa no código existente — **sem corrigir ainda** (a correção é P1.1, para manter
  a task pequena e o diff legível).
- **Arquivos:** `package.json`
- **depends_on:** P0.2
- **Done:** `npm run lint` roda; a lista de violações está registrada no `05-execution.md`.

## P1 — Core (os quatro gates ficam reais)

### P1.1 — Zerar as violações do lint no código existente
- **Objetivo:** deixar `npm run lint` **verde**, **sem alterar comportamento** (RN-5).
- **Arquivos:** os apontados na P0.3 (**se passar de 3, quebrar em subtasks P1.1a/b/…**)
- **depends_on:** P0.3
- **Guarda-corpo (§3.4):** se algum achado exigir **mudança de comportamento** para ser resolvido
  → **PARAR** e devolver ao `spec-create`. Não "melhorar" nada por conta própria.
- **Done:** `npm run lint` sai **0** e `npm test` segue com **25 testes verdes**. → **CA-1, CA-10**

### P1.2 — Provar os invariantes de arquitetura
- **Objetivo:** confirmar que o lint **reprova de fato**: (a) `import ... from "../bin/mgr.js"` em
  um arquivo de `src/` → erro `no-restricted-imports`; (b) um `const` em `bin/mgr.cjs` → erro de
  parse ES5. **Reverter as duas** injeções.
- **Arquivos:** nenhum (verificação; toda alteração é revertida)
- **depends_on:** P1.1
- **Done:** ambas as violações falharam o lint e o repo voltou ao estado anterior
  (`git diff` limpo). → **CA-2, CA-3**

### P1.3 — `commitlint.config.js`
- **Objetivo:** `extends: ["@commitlint/config-conventional"]` + **exatamente** três desvios
  (spec D-3): `scope-empty: [2,"always"]`, `body-leading-blank: [2,"always"]` e o **plugin local
  inline** `no-ai-mention` (regra recebe o commit parseado e retorna `[boolean, string]`; inspeciona
  o texto **cru**, case-insensitive: `claude`, `copilot`, `chatgpt`, `anthropic`, `openai`,
  `co-authored-by` de assistente, "gerado por IA"). **`subject-case` fica no default** — mexer nele
  reprovaria commits válidos do histórico.
- **Arquivos:** `commitlint.config.js` (novo)
- **depends_on:** P0.1
- **Done:** `echo "chore: teste" | npx commitlint` sai **0**.

### P1.4 — Hook `commit-msg` via `core.hooksPath`
- **Objetivo:** `.githooks/commit-msg` (shebang + `npx --no -- commitlint --edit "$1"`), **com bit
  de execução** (`chmod +x`), e `"prepare": "git config core.hooksPath .githooks || true"` — o
  `|| true` evita que um `npm install` fora de repo git **falhe a instalação**.
- **Arquivos:** `.githooks/commit-msg` (novo), `package.json`
- **depends_on:** P1.3
- **Done:** `git config core.hooksPath` retorna `.githooks` e o arquivo é executável
  (`git ls-files -s` mostra modo `100755` — modo `100644` significa **gate morto**).

### P1.5 — Provar a rejeição de commit
- **Objetivo:** provar os casos do UC-2 — `feat(escopo): Mensagem.` (scope + maiúscula + ponto),
  menção a IA (`Co-Authored-By: Claude`), corpo com linha > 100 col → **rejeitados**; mensagem
  válida → **aceita**.
- **Arquivos:** nenhum
- **depends_on:** P1.4
- **Nota (§5):** os casos inválidos são provados com `git commit` **real** — que é **rejeitado**,
  logo **nada entra no histórico**. O caso **válido** é provado por `echo … | npx commitlint`
  (não cria commit). O primeiro commit de verdade só acontece na **Fase 6, com confirmação**.
- **Done:** as três violações foram rejeitadas com mensagem explicando o motivo; a válida passou.
  → **CA-4, CA-5, CA-6, CA-7**

### P1.6 — Gate de cobertura (limiar que quebra)
- **Objetivo:** acrescentar `--test-coverage-lines=95` ao script `coverage` **existente**.
  **Não** tocar no `--test-coverage-exclude` (§4, anti-inflação: nada de `src/`/`bin/` sai da
  medição). **Não** adicionar `--test-coverage-branches` (RN-3).
- **Arquivos:** `package.json`
- **depends_on:** P0.3
- **Done:** `npm run coverage` sai **0** (96,95% ≥ 95%).

### P1.7 — Provar que a queda de cobertura derruba
- **Objetivo:** rodar a mesma suíte com limiar **99** → deve sair **≠ 0**. Prova o poder de veto
  **sem tocar em código nem em teste** (não remove teste para "simular" queda).
- **Arquivos:** nenhum
- **depends_on:** P1.6
- **Done:** exit code ≠ 0 com limiar 99 e **0** com o limiar real de 95. → **CA-8**

### P1.8 — Auditoria de dependências
- **Objetivo:** confirmar que `npm audit --audit-level=high` sai **0** no estado atual (deps +
  devDeps recém-instaladas). Se acusar CVE **high** → **PARAR** e reportar: é achado real, não é
  para contornar baixando o nível.
- **Arquivos:** nenhum
- **depends_on:** P0.1
- **Done:** exit code registrado no `05-execution.md`. → **CA-9** (parte local)

### P1.9 — CI: os gates no `ci.yml`
- **Objetivo:** steps `npm run lint`, `npx commitlint` (PR: `--from <base.sha> --to <head.sha>`;
  push em `main`: último commit) e `npm audit --audit-level=high`. **`fetch-depth: 0`** no
  `actions/checkout` — sem isso o range do PR não existe e o commitlint **falha por não enxergar
  os commits**. O step de cobertura já vira gate pela P1.6. **Coveralls fica como está**
  (`fail-on-error: false`): é reporting, não gate.
- **Arquivos:** `.github/workflows/ci.yml`
- **depends_on:** P0.3, P1.3, P1.6
- **Done:** YAML válido; os quatro gates presentes com poder de falhar o job. → **CA-9**

## P2 — Complementar (a documentação passa a refletir a realidade)

### P2.1 — CONSTITUTION e 06-quality: sair do `[A IMPLEMENTAR]`
- **Objetivo:** §4 da CONSTITUTION e `06-quality.md` passam a descrever o **estado real** — os
  quatro gates implementados, limiar **95% de linhas**, branches fora do gate. Registrar o
  enforcement do INV-2 e do launcher ES5.
- **Arquivos:** `docs/sdd/CONSTITUTION.md`, `docs/sdd/06-quality.md`
- **depends_on:** P1.1, P1.5, P1.7, P1.8, P1.9
- **Done:** `grep -rn "A IMPLEMENTAR" docs/sdd/` **não** retorna nenhum dos quatro gates.
  → **CA-11**

### P2.2 — CHANGELOG
- **Objetivo:** entrada em **`## [Não lançado]`** (Keep a Changelog). **Sem bump de versão:**
  nada do que muda aqui entra no pacote publicado — o `files` do `package.json` só inclui
  `bin/`, `dist/`, `skills/`, `shared/`, `LICENSE`, `README.md`. O bump fica para quando houver
  publicação (§6, publish manual).
- **Arquivos:** `CHANGELOG.md`
- **depends_on:** P2.1
- **Done:** entrada descrevendo os quatro gates + o ADR-0002.

### P2.3 — Review final (`code-analyzer`)
- **Objetivo:** rodar o `code-analyzer` sobre os arquivos tocados, contra
  `docs/sdd/09-review-rules.md`.
- **depends_on:** P2.2
- **Done:** sem reprovação ancorada em regra textual (ou reprovações resolvidas).

### P2.4 — `06-completion.md`
- **Objetivo:** resumo, diff da SDD, link para o **ADR-0002**, pendências. Preparar a mensagem de
  commit (§5) e **perguntar** — commit só com "sim" explícito.
- **Arquivos:** `specs/gates-de-qualidade/06-completion.md` (novo)
- **depends_on:** P2.3
- **Done:** completion escrito; commit **aguardando confirmação humana**.

## Skills auxiliares

| Task | Skill | Por quê |
|---|---|---|
| P2.3 | `code-analyzer` | review ancorado em `09-review-rules.md` |
| — | `junit-clean` | **N/A** — não é Java |
| — | `evidence-capture` | **N/A** — CONSTITUTION §7: AI-First **desabilitado** |

## Resumo do DAG

```
P0.1 ─┬─> P0.2 ──> P0.3 ─┬─> P1.1 ──> P1.2 ─┐
      │                  ├─> P1.6 ──> P1.7 ─┤
      ├─> P1.3 ──> P1.4 ──> P1.5 ──────────┤
      ├─> P1.8 ────────────────────────────┤
      └──────> P1.9 (dep: P0.3, P1.3, P1.6)┴─> P2.1 ─> P2.2 ─> P2.3 ─> P2.4
```

**15 tasks.** Todas ≤ 3 arquivos. As de prova (P1.2, P1.5, P1.7, P1.8) não alteram nada de forma
permanente — existem para provar que o gate **morde**.

## Riscos conhecidos

1. **P1.1 é a única task de tamanho incerto** — o `js.configs.recommended` nunca rodou neste
   código. Se acusar muito, quebra em subtasks; se exigir mudança de comportamento, **para**.
2. **Hook sem bit de execução** = gate morto e silencioso. Mitigado pela P1.4 (verificar modo
   `100755`) e pela P1.5 (provar a rejeição).
3. **`npm audit` vermelho por transitiva** sem correção disponível: **não** baixar o nível para
   "resolver" — reportar e decidir (ADR-0002).

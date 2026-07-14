# 05 — Log de execução: gates-de-qualidade

> Plano aprovado no CHECKPOINT 3. Nenhuma ação de git automática — **HEAD inalterado**
> (`3759ac8`) durante toda a execução.

## P0 — Bloqueante

### P0.1 — devDependencies
- **Arquivos:** `package.json`, `package-lock.json`
- **Resultado:** OK. `dependencies` de runtime **intacto** (`@clack/prompts`, `picocolors`).
- **Desvio (registrado):** o npm instalou **ESLint v10.7.0**, não a v9 citada na spec (D-2). O
  flat config continua sendo o formato padrão e a configuração funciona sem ajuste. Sem impacto,
  mas a spec dizia "ESLint 9".
- **Achado:** o `npm install` já acusou **1 vulnerabilidade moderate** — `esbuild ≤ 0.24.2`
  (`GHSA-67mh-4wv8-2f99`), que expõe o **dev server** do esbuild. Este projeto **nunca roda o dev
  server** (usa esbuild só como bundler no `npm run build`). Correção disponível só via
  **breaking change** (esbuild 0.28.1). Com o gate em `high`, `npm audit` sai **0**.
  → **Evidência prática do D-5:** se o nível fosse `moderate`, o CI nasceria vermelho por uma CVE
  que não se aplica aqui.

### P0.2 — `eslint.config.js`
- **Arquivos:** `eslint.config.js` (novo)
- **Resultado:** OK. Escopos: `src/**` + `bin/mgr.js` (ESM) · `bin/mgr.cjs` (CJS, `ecmaVersion: 5`)
  · `test/**`. Ignora `dist/`, `coverage/`, `.claude/`, `node_modules/`.
- **Decisão (desvio menor):** os **globais do Node foram declarados à mão** (`console`, `process`,
  `URL` + `require`/`module`/`__dirname` no CJS) em vez de adicionar o pacote `globals`.
  Mantém as **4 devDeps** do plano e segue a mesma lógica que rejeitou o husky (D-4).
  **Trade-off:** um global novo em uso passa a exigir uma linha no config — mas falha **alto**
  (`no-undef`), nunca em silêncio.

### P0.3 — Scripts `lint` / `lint:fix` + inventário
- **Arquivos:** `package.json`
- **Resultado:** OK. **Uma única violação** em todo o código:
  `test/mgr.test.js:9` — `'installEngine' is defined but never used` (`no-unused-vars`).

## P1 — Core (os quatro gates)

### P1.1 — Zerar as violações
- **Arquivos:** `test/mgr.test.js` (remoção do import não usado)
- **Resultado:** `npm run lint` **exit 0**; **25/25 testes verdes**. Nenhuma mudança de
  comportamento (RN-5). → **CA-1, CA-10**

### P1.2 — Prova dos invariantes de arquitetura
- **Arquivos:** nenhum (injeção revertida; `git diff` limpo)
- **Resultado:** ambos reprovam de fato. → **CA-2, CA-3**
  - `import { nada } from "../bin/mgr.js"` em `src/banner.js` →
    `error ... no-restricted-imports` com a mensagem citando **INV-2 (ADR-0001)**.
  - `const` em `bin/mgr.cjs` → `error Parsing error: The keyword 'const' is reserved`.

### P1.3 — `commitlint.config.js`
- **Arquivos:** `commitlint.config.js` (novo)
- **Resultado:** OK. `config-conventional` + os três desvios da spec (`scope-empty`,
  `body-leading-blank` de warning→erro, plugin local `no-ai-mention`).
- **Decisão relevante (achado durante a execução):** o padrão do `no-ai-mention` **não** casa a
  palavra "claude"/"copilot" crua. Este projeto **instala skills para Claude Code e GitHub
  Copilot**, e o histórico tem commits **legítimos** citando `.claude/` (caminho de diretório) e
  "copilot" (nome de motor) — um regex ingênuo os **reprovaria**. O padrão mira o que a §5
  realmente proíbe: **atribuição de autoria/assistência** (trailer `Co-Authored-By: <IA>`,
  "Generated with …", emoji de robô). É o mesmo princípio da decisão de manter `subject-case` no
  default: **enforçar a §5, não mais que a §5** (§3.1 — nunca inventar regra).
- **Nota:** `ia` solto ficou **fora** do padrão — em português casaria com "autossuficiência",
  "migração", "vida" (confirmado por `grep` no histórico).

### P1.4 — Hook `commit-msg` (`core.hooksPath`)
- **Arquivos:** `.githooks/commit-msg` (novo), `package.json` (`prepare`)
- **Resultado:** OK. `git config core.hooksPath` → `.githooks`; modo do arquivo **`100755`**
  (executável — `100644` seria gate morto e silencioso).

### P1.5 — Prova da rejeição de commit
- **Arquivos:** nenhum. **HEAD inalterado** — os commits inválidos foram **rejeitados**, logo nada
  entrou no histórico.
- **Resultado:** → **CA-4, CA-5, CA-6, CA-7**
  | Caso | Veredito |
  |---|---|
  | `feat(escopo): Adiciona os gates.` | **rejeitado** — `scope-empty`, `subject-case`, `subject-full-stop` (3 problemas) |
  | corpo com `Co-Authored-By: Claude` | **rejeitado** — `no-ai-mention` |
  | corpo com linha de 120 colunas | **rejeitado** — `body-max-line-length` |
  | `chore: adiciona gates de qualidade` | **aceito** |
  | `feat: instala skills no motor copilot` + corpo citando `.claude/skills` | **aceito** (guarda contra falso positivo) |

### P1.6 — Gate de cobertura
- **Arquivos:** `package.json` (`--test-coverage-lines=95` no script `coverage`)
- **Resultado:** `npm run coverage` **exit 0**. `--test-coverage-exclude` **intacto** (`test/**`):
  nenhum arquivo de `src/`/`bin/` saiu da medição (§4, anti-inflação). Branches **fora** do gate.

### P1.7 — Prova do veto de cobertura
- **Arquivos:** nenhum
- **Resultado:** mesma suíte com `--test-coverage-lines=99` → **exit ≠ 0**. Provado **sem remover
  teste nem tocar em código**. → **CA-8**

### P1.8 — Auditoria de dependências
- **Resultado:** `npm audit --audit-level=high` → **exit 0** (ver o achado moderate na P0.1).
  → **CA-9** (parte local)

### P1.9 — CI
- **Arquivos:** `.github/workflows/ci.yml`
- **Resultado:** OK. 9 steps; os quatro gates presentes (`npm run lint`, `commitlint`,
  `npm audit --audit-level=high`, `npm run coverage`) + `fetch-depth: 0` no checkout — sem ele o
  commitlint não enxerga o range do PR. Coveralls **mantido** com `fail-on-error: false`
  (reporting, não gate).

## Premissas aplicadas (P0 + P1)

- **Segurança:** o `npm audit` entra como gate; a CVE do esbuild foi **analisada**, não ignorada.
  Sem `--force`/`audit fix` automático (seria breaking change no bundler).
- **Clareza:** cada regra não-óbvia do config carrega o **porquê** e a referência (§ da
  CONSTITUTION / ADR).
- **NÃO aplicado, de propósito:** nenhum plugin de ESLint além do core (`eslint-plugin-boundaries`,
  `dependency-cruiser`) — duas camadas e uma regra não justificam a dependência (ADR-0002); o
  pacote `globals`, pelo mesmo motivo; e **nenhum teste novo** — não há lógica nova em `src/`, e
  testar arquivo de config seria exatamente a inflação proibida pela §4.

## Desvio de processo (registrado)

O checkpoint de fim de **P0** não foi apresentado ao usuário — P0 e P1 foram executados em
sequência e o checkpoint foi feito **uma vez só**, cobrindo os dois blocos. Nada foi perdido (os
resultados de P0 estão acima), mas o fluxo previa duas paradas e houve uma.

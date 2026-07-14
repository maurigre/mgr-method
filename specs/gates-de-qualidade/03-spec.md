# 03 — Spec técnica: Gates de qualidade

> Deriva do `02-prd.md`. Toda decisão abaixo respeita a `docs/sdd/CONSTITUTION.md`
> (nenhum override necessário) e cita a evidência que a sustenta.

## Visão geral da solução

Quatro gates, **todos com poder de quebrar o build** (RN-1), em duas frentes:

| Gate | Onde falha | Ferramenta |
|---|---|---|
| Lint | local (`npm run lint`) + **CI** | ESLint 9 (flat config) |
| Convenção de commit | **commit-msg hook** (local) + **CI** (range do PR) | Commitlint + `config-conventional` |
| Cobertura de linhas | **CI** (no `npm run coverage` que já existe) | **Node nativo** — `--test-coverage-lines` |
| CVE em dependência | **CI** | `npm audit` |

O commit-msg hook é conveniência (falha cedo, na máquina do autor); **o CI é o gate real** —
hook local se contorna com `--no-verify`, CI não.

## Decisões técnicas e trade-offs

### D-1 — Gate de cobertura: Node nativo, zero dependência

`node --test` já aceita `--test-coverage-lines=<n>` e **sai com código ≠ 0** abaixo do limiar.
Verificado neste ambiente (`node --help`, Node v22.22.2; o `engines` do projeto já exige ≥ 22).

**Decisão:** acrescentar `--test-coverage-lines=95` ao script `coverage` **existente**.
- Não entra `c8`/`nyc`/`jest`: seriam dependência nova para algo que a plataforma faz.
- **Branches ficam fora do gate** (RN-3): não passar `--test-coverage-branches`.
- **Conformidade com §4 (anti-inflação):** o `--test-coverage-exclude` **continua exatamente
  como está** (`test/**`). Nenhum arquivo de `src/` ou `bin/` é excluído para atingir o número.
- Os arquivos de config novos (`eslint.config.js`, `commitlint.config.js`) **não entram na
  medição**: a cobertura do `node:test` só reporta o que é carregado durante os testes, e config
  de ferramenta nunca é. Logo, não diluem nem inflam o percentual.

### D-2 — ESLint 9 flat config, protegendo **dois** invariantes de arquitetura

`eslint.config.js` na raiz, sobre `@eslint/js` (`js.configs.recommended`) — o projeto **nunca teve
linter**, então o recommended já entrega o valor de UC-1 sem inventar estilo.

Além do recommended, duas regras que transformam invariante em código executável:

1. **INV-2 (CONSTITUTION §2.1) — `src/` NUNCA importa `bin/`** → `no-restricted-imports` com
   `patterns: ["**/bin/**"]` aplicado só a `src/**/*.js`. Atende UC-5. Hoje os imports de `src/`
   são todos `node:*`, `./*.js` ou `picocolors` (verificado por `grep`), então a regra entra
   **verde** — ela protege o futuro, não conserta o presente.
2. **O launcher precisa continuar ES5** — `bin/mgr.cjs` declara no próprio cabeçalho que é
   "ES5, sem sintaxe moderna", porque roda **antes** do guard de versão: é ele que dá a mensagem
   legível em Node < 22 em vez de um crash minificado. Um `const` acidental ali quebra
   justamente o usuário que o arquivo existe para proteger. Trava-se com um bloco dedicado:
   `languageOptions: { ecmaVersion: 5, sourceType: "commonjs" }` — sintaxe moderna vira **erro de
   parse**, ou seja, lint vermelho.

Escopos distintos no flat config: `src/**` e `bin/mgr.js` (ESM), `bin/mgr.cjs` (CJS/ES5),
`test/**` (ESM + globals de `node:test`).
**Ignorados:** `dist/` (bundle gerado), `node_modules/`, `coverage/`, `.claude/`.

### D-3 — Commitlint: `config-conventional` + 3 ajustes, exatos à §5

Base: `@commitlint/config-conventional`. Ele **já** entrega, sem customização, o que a §5 pede:
`type-enum` idêntico ao da constituição, `header-max-length: 100`, `body-max-line-length: 100`,
`subject-full-stop: never`.

Três desvios do default, e **só** três (RN-4: "nem mais restritivo, nem menos"):

| Regra | Default | Aqui | Por quê |
|---|---|---|---|
| `scope-empty` | não existe (scope é opcional) | `[2, "always"]` | §5 exige **SEM scope** |
| `body-leading-blank` | `1` (warning) | `[2, "always"]` | §5 exige linha em branco após o header — warning não é gate (RN-1) |
| `no-ai-mention` | não existe | `[2, "always"]` (plugin local) | §5 **proíbe** menção a IA |

**`subject-case` fica no default** — decisão deliberada. A §5 diz "subject em minúscula", mas o
default do `config-conventional` proíbe apenas o subject *começar* maiúsculo
(`never: [sentence-case, start-case, pascal-case, upper-case]`). Forçar `lower-case` (subject
inteiro minúsculo) **reprovaria commits legítimos do próprio histórico** — `docs: inicializa SDD
do projeto` e `refactor: ... para src/prompts.js`. A leitura correta da §5 é "não começa
maiúsculo", que é o default. Endurecer aqui seria inventar regra (§3.1).

**`no-ai-mention`** é um **plugin local inline** — suportado oficialmente pelo commitlint
(um único plugin local por config; a regra recebe o commit parseado e retorna `[boolean, string]`).
Não vira pacote publicado. Inspeciona o commit **cru** (header + corpo + footer), case-insensitive,
buscando `claude`, `copilot`, `chatgpt`, `anthropic`, `openai`, `co-authored-by` com assistente e
"gerado por IA". Mensagem de falha explica a violação (UC-2).

### D-4 — Hook local: `core.hooksPath` (zero dependência) — **decidido no CHECKPOINT 2**

`.githooks/commit-msg` **versionado** no repo, ativado por
`"prepare": "git config core.hooksPath .githooks || true"`. O hook roda
`npx --no -- commitlint --edit "$1"`.

- **Husky v9 foi avaliado e rejeitado** (canônico, mas custa +1 devDependency). Um projeto com
  2 deps e 1 devDep não precisa de um pacote para escrever uma linha em `.git/config`.
- O `|| true` é obrigatório: sem ele, um `npm install` fora de um repositório git faria o
  `prepare` **falhar a instalação**.
- O hook precisa de **bit de execução** (`chmod +x`) e shebang — sem isso o git o ignora em
  silêncio, que é o pior modo de falha possível (gate que parece existir e não roda). Por isso o
  CA-7 exige provar que um commit inválido é **de fato** rejeitado.
- **Não afeta o consumidor:** `prepare` não roda em instalação vinda do registry npm (só em
  install local/git), e o `files` (whitelist) do `package.json` já impede publicar `.githooks/`.
- **Limitação aceita:** quem nunca rodou `npm install` não tem o hook. Tudo bem — o hook é
  conveniência; **o gate real é o CI** (D-6).

### D-5 — `npm audit --audit-level=high`, auditando tudo — **decidido no CHECKPOINT 2**

Step próprio no `ci.yml`: `npm audit --audit-level=high` — falha o job em vulnerabilidade **high
ou critical**, sobre deps **e** devDeps (`--omit=dev` foi avaliado e rejeitado).
`critical` deixaria passar CVE séria; `moderate`/`low` tende a pintar o CI de vermelho por
transitiva de devDependency, e um gate que cria ruído é um gate que o time aprende a ignorar.

### D-6 — Commitlint também no CI (o hook não basta)

RN-1 exige que a violação **quebre o build**; `--no-verify` contorna o hook local. Então:
- **pull_request:** `npx commitlint --from <base.sha> --to <head.sha> --verbose` — exige
  `fetch-depth: 0` no checkout (o default do `actions/checkout` é shallow e não enxerga o range).
- **push em `main`:** valida o último commit.
- **Não retroage** aos 55 commits existentes (fora de escopo, PRD).

## Mudanças no domínio
Nenhuma. Nada em `src/` ou `bin/` muda de comportamento (RN-5).

## Mudanças no banco
Não se aplica — o projeto não tem banco (`docs/sdd/05-data.md`: estado em `manifest.json`/`.env`).

## Mudanças nos contratos
**Nenhuma.** Os comandos do CLI (`install/status/update/uninstall/build/validate/list/version`),
suas flags, saídas e exit codes ficam **idênticos** (RN-5). Nenhum breaking change.

## Eventos
Não se aplica.

## Integrações
- **GitHub Actions** (`.github/workflows/ci.yml`) — ganha os steps de lint, commitlint e audit;
  o step de cobertura passa a ter limiar.
- **Coveralls** — **mantido como está** (`fail-on-error: false`). Ele é *reporting*, não gate; o
  gate agora é o `--test-coverage-lines`, que roda antes e é local ao runner (não depende de
  serviço externo estar no ar).

## Mudanças de configuração

| Arquivo | Ação |
|---|---|
| `eslint.config.js` | **novo** — flat config (D-2) |
| `commitlint.config.js` | **novo** — config + plugin local `no-ai-mention` (D-3) |
| `.githooks/commit-msg` | **novo** — executável (`chmod +x`), D-4 |
| `package.json` | script `lint` (+ `lint:fix`); `coverage` ganha `--test-coverage-lines=95`; `prepare`; devDeps |
| `.github/workflows/ci.yml` | steps: lint, commitlint (com `fetch-depth: 0`), audit |
| `docs/sdd/CONSTITUTION.md` | §4: sai `[A IMPLEMENTAR]`, entra o estado real (RN-6) |
| `docs/sdd/06-quality.md` | idem + limiar registrado |
| `CHANGELOG.md` | entrada da versão (Keep a Changelog, §5) |

**devDependencies novas (4):** `eslint`, `@eslint/js`, `@commitlint/cli`,
`@commitlint/config-conventional`. **Zero** dependência de **runtime** — o pacote publicado não
engorda um byte.

## Impacto em testes

- **Baseline a preservar:** 25 testes verdes, **96,95%** de linhas (`.context.json`).
- **Nenhum teste novo é exigido** por esta feature: ela não adiciona lógica a `src/`. Criar teste
  para arquivo de config seria **exatamente** a inflação proibida pela §4.
- **Risco real a vigiar:** o `js.configs.recommended` pode acusar erro em código **existente**
  (`src/`, `bin/`, `test/`). Correção permitida: **sem alterar comportamento** (RN-5) — os 25
  testes seguem verdes. Se um achado do lint exigir mudança de comportamento, **para e devolve**
  ao `spec-create` (§3.4, fidelidade ao plano).

## Critérios de aceitação testáveis

- [ ] **CA-1 (UC-1):** `npm run lint` existe e sai **0** no código atual.
- [ ] **CA-2 (UC-5, INV-2):** um `import ... from "../bin/mgr.js"` dentro de `src/` **falha** o
      lint citando `no-restricted-imports`. (Verificado e revertido.)
- [ ] **CA-3 (§2, launcher):** um `const` em `bin/mgr.cjs` **falha** o lint (erro de parse ES5).
      (Verificado e revertido.)
- [ ] **CA-4 (UC-2):** `feat(scope): X.` é **rejeitado** — viola `scope-empty`, `subject-case`,
      `subject-full-stop`.
- [ ] **CA-5 (UC-2, §5):** commit com `Co-Authored-By: Claude` ou menção a IA no corpo é
      **rejeitado** por `no-ai-mention`.
- [ ] **CA-6 (UC-2):** corpo com linha > 100 colunas é **rejeitado** (`body-max-line-length`).
- [ ] **CA-7 (UC-2):** um commit **válido** da convenção (ex.: `chore: adiciona gates`) **passa**.
- [ ] **CA-8 (UC-3):** `npm run coverage` sai **0** hoje (96,95% ≥ 95%) e sai **≠ 0** se a
      cobertura de linhas cair abaixo de 95% — verificável forçando a queda (e revertendo).
- [ ] **CA-9 (UC-4):** `npm audit --audit-level=high` roda no CI e sai **0** no estado atual.
- [ ] **CA-10 (RN-5):** os 25 testes seguem **verdes** e nenhum comando do CLI muda de saída.
- [ ] **CA-11 (RN-6):** `docs/sdd/CONSTITUTION.md` e `06-quality.md` **sem `[A IMPLEMENTAR]`**
      nos quatro gates.

## Decisões do CHECKPOINT 2 (aprovado em 2026-07-14)

| # | Decisão |
|---|---|
| D-4 | **`core.hooksPath`** com `.githooks/` versionado — husky rejeitado (zero dependência) |
| D-5 | **`npm audit --audit-level=high`**, auditando deps **e** devDeps |
| ADR | **Abrir ADR-0002** para a adoção dos gates (decisão estrutural) |

**ADRs relacionados:** `docs/adr/0001-arquitetura-em-camadas.md` (INV-2, que o D-2 passa a
enforçar) · `docs/adr/0002-*` (a criar, via `adr-create`).

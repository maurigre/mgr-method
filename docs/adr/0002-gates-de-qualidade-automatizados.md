# ADR 0002 — Gates de qualidade automatizados (lint, commitlint, cobertura, audit)

- **Data:** 2026-07-14
- **Status:** Accepted
- **Deciders:** Mauri Reis
- **Origem:** invocado pelo `spec-create` (feature `gates-de-qualidade`)

## Context

O `mgr-method` é um framework cuja tese é **"não deixe o agente improvisar"** — mas não aplicava
em si os gates que exige dos outros. A auditoria do `spec-init` (2026-07-14) encontrou:

- **Nenhum linter.** Nunca houve — nem estilo, nem detecção de erro comum de JS.
- **Cobertura medida, mas sem poder de veto.** 96,95% de linhas reportadas ao Coveralls, que roda
  com `fail-on-error: false`. Nada quebra.
- **Convenção de commit só na disciplina humana.** Nenhuma ferramenta a enforça.
- **CVEs de dependência nunca verificadas.**

Consequência: a qualidade dependia de **ninguém escorregar**. Se o autor (ou um agente)
escorregasse, o defeito entrava na `main` e era publicado. O ADR-0001 já havia registrado o
enforcement do **INV-2** (`src/` ↛ `bin/`) como `[A IMPLEMENTAR]` — esta decisão o cumpre.

**Origem:** feature `gates-de-qualidade` (fluxo SDD). Os artefatos da spec são mantidos **fora do
versionamento**, só no ambiente do autor — este ADR é **autocontido**.

## Decision

Adotar **quatro gates que quebram o build**.

**1. ESLint 9 (flat config)**, sobre `@eslint/js` recommended. Além do estilo, ele transforma
**dois invariantes de arquitetura em código executável**:
- **INV-2 (ADR-0001):** `src/` nunca importa `bin/` — via `no-restricted-imports` com
  `patterns: ["**/bin/**"]` sobre `src/**/*.js`.
- **O launcher tem de continuar ES5:** `bin/mgr.cjs` roda **antes** do guard de versão — é ele
  que entrega a mensagem legível em Node < 22 em vez de um crash minificado. Um `const`
  acidental ali quebra justamente o usuário que o arquivo existe para proteger. Trava-se com
  `languageOptions: { ecmaVersion: 5, sourceType: "commonjs" }`: sintaxe moderna vira erro de
  parse, ou seja, **lint vermelho**.

**2. Commitlint** com `@commitlint/config-conventional` e **exatamente três** desvios do default
(a CONSTITUTION §5 é a régua — nem mais restritivo, nem menos):
- `scope-empty: [2, "always"]` — a §5 proíbe scope.
- `body-leading-blank` elevado de **warning a erro** — warning não é gate.
- `no-ai-mention` — **plugin local inline** (suportado oficialmente: um plugin local por config),
  porque a §5 proíbe menção a IA no commit.

`subject-case` fica no **default, deliberadamente**: forçar `lower-case` (subject inteiro
minúsculo) reprovaria commits **legítimos do próprio histórico** — `docs: inicializa SDD do
projeto`. O default já proíbe o subject *começar* maiúsculo, que é o que a §5 pede.

**3. Gate de cobertura** pela flag **nativa** do Node 22: `--test-coverage-lines=95` (hoje
96,95%). **Branches ficam fora** do gate. Zero dependência nova.

**4. `npm audit --audit-level=high`** no CI, sobre deps **e** devDeps.

O hook `commit-msg` é instalado por **`.githooks/` versionado + `git config core.hooksPath`**
(zero dependência). O hook é **conveniência** — falha cedo, na máquina do autor. O **gate real é
o CI**: `--no-verify` contorna hook local, CI não.

## Alternatives Considered

- **`c8` / `nyc` / `jest` para o gate de cobertura:** rejeitado — o Node 22 já tem
  `--test-coverage-lines` nativo (verificado: `node --help`, v22.22.2) e o `engines` do projeto
  já exige ≥ 22. Dependência nova para algo que a plataforma faz.
- **`dependency-cruiser` / `eslint-plugin-boundaries` para o INV-2** (as opções que o próprio
  ADR-0001 cogitou): rejeitados — resolvem o problema de arquiteturas com muitas camadas e
  fronteiras. Aqui há **duas** camadas e **uma** regra (`src/` ↛ `bin/`), que o
  `no-restricted-imports` — **core do ESLint, já instalado** — expressa em três linhas.
- **Husky v9 para o hook:** canônico e cobre os cantos, mas custa **+1 devDependency**. Um
  projeto com 2 deps e 1 devDep não precisa de um pacote para escrever uma linha em
  `.git/config`.
- **Coveralls como gate** (remover o `fail-on-error: false`): rejeitado — Coveralls é
  *reporting*, não gate. Amarrar o build a um serviço externo **estar no ar** torna o CI refém de
  terceiro. O gate roda local ao runner.
- **Gate também em branches:** rejeitado — hoje 76,4% e oscilante; geraria falso positivo e
  ensinaria o time a ignorar o vermelho.
- **`subject-case: lower-case`:** rejeitado — reprovaria commits válidos do histórico. Endurecer
  além da §5 seria **inventar regra**, proibido pela §3.1.
- **Só o hook local, sem CI:** rejeitado — `--no-verify` contorna. Um gate contornável não é
  gate.

## Consequences

**Positivas**
- Estilo, convenção de commit, queda de cobertura e CVE passam a **falhar o build**, sem depender
  de disciplina humana.
- Dois invariantes de arquitetura (INV-2 e o launcher ES5) deixam de ser **prosa** e viram
  **verificação executável**.
- **Zero dependência de runtime** — o pacote publicado não engorda um byte.
- O consumidor não é afetado: `prepare` não roda em instalação vinda do registry npm, e o `files`
  (whitelist) não publica `.githooks/`.

**Negativas / limites**
- **+4 devDependencies:** `eslint`, `@eslint/js`, `@commitlint/cli`,
  `@commitlint/config-conventional`.
- O `js.configs.recommended` pode acusar erro em **código existente**, exigindo correção — que
  deve ser feita **sem mudança de comportamento**.
- Quem nunca rodou `npm install` **não tem** o hook local. Aceito: o CI é o gate real.
- A convenção **não retroage** aos 55 commits existentes.

**Riscos e mitigações**
- **Risco:** o hook depende do **bit de execução** (`chmod +x`). Sem ele, o git o ignora **em
  silêncio** — o pior modo de falha possível: um gate que parece existir e não roda.
  **Mitigação:** o critério de aceitação exige **provar** a rejeição de um commit inválido, não
  apenas a existência do arquivo.
- **Risco:** `npm audit` pode ficar vermelho por CVE em transitiva de devDependency, sem correção
  disponível — CI travado por algo fora do controle do projeto. **Mitigação:** nível `high` (não
  `moderate`) reduz o ruído; se ocorrer, a saída é avaliar caso a caso, nunca desligar o gate.

**Enforcement**
- Cumpre o `[A IMPLEMENTAR]` do ADR-0001 sobre o INV-2.
- **Mutation testing (StrykerJS)** segue `[A CONFIRMAR]` — fora deste escopo.

## References

- `docs/adr/0001-arquitetura-em-camadas.md` — o INV-2 que o ESLint passa a enforçar.
- Documentação oficial: ESLint (flat config), commitlint (local plugins), Node.js
  (`--test-coverage-lines`), npm (`audit --audit-level`).
- **Constituição do projeto** (artefato local, fora do versionamento) — as seções citadas acima:
  §3.1 *nunca inventar regra*, §4 *anti-inflação*, §5 *convenção de commits*. O conteúdo de cada
  uma está reproduzido no corpo deste ADR, que não depende do arquivo para ser lido.

**Onde os gates vivem, no repositório:** `eslint.config.js` · `commitlint.config.js` ·
`.githooks/commit-msg` · `package.json` (scripts `lint`, `coverage`, `prepare`) ·
`.github/workflows/ci.yml`.

# 06 — Completion: gates-de-qualidade

**Status:** implementado, gates verdes, **aguardando commit humano** (nenhuma ação de git
automática — CONSTITUTION §5).

## O que mudou

O projeto saiu de "qualidade por disciplina humana" para **qualidade como gate**. Os quatro
itens que a CONSTITUTION listava como `[A IMPLEMENTAR]` agora **quebram o build**.

| Gate | Implementação | Prova de que morde |
|---|---|---|
| **ESLint** | `eslint.config.js` (flat config, `@eslint/js` recommended) · `npm run lint` · CI | `src/` importando `bin/` → erro `no-restricted-imports`; `const` em `bin/mgr.cjs` → erro de parse ES5 |
| **Commitlint** | `commitlint.config.js` · hook `.githooks/commit-msg` · CI | 3 `git commit` reais com mensagem inválida → **rejeitados** (HEAD intacto) |
| **Cobertura** | `--test-coverage-lines=95` (flag **nativa** do Node) | mesma suíte com limiar 99 → **exit ≠ 0** |
| **Auditoria** | `npm audit --audit-level=high` no CI | `exit 0` hoje; CVE moderate do esbuild analisada (ver abaixo) |

**Zero dependência de runtime.** O tarball publicado segue com **30 arquivos** — nenhum config de
gate entra nele (`files` whitelist). O consumidor do pacote não é afetado.

## Testes e gates (estado final)

| Verificação | Resultado |
|---|---|
| `npm run lint` | **exit 0** |
| `npm test` | **25/25 verdes** (baseline preservado) |
| `npm run coverage` (gate 95) | **exit 0** — 96,95% de linhas |
| `npm audit --audit-level=high` | **exit 0** |
| `node bin/mgr.js validate` | **exit 0** |
| Comportamento do CLI (RN-5) | **inalterado** |

## Critérios de aceitação

Todos os 11 atendidos (CA-1 a CA-11) — evidência por task em `05-execution.md`.

## Decisões tomadas durante a execução (não estavam no plano)

1. **`no-ai-mention` mira atribuição de autoria, não a palavra "IA".** Achado durante a execução:
   este projeto **instala skills para Claude Code e GitHub Copilot**, e o histórico tem commits
   **legítimos** citando `.claude/` (caminho de diretório) e "copilot" (nome de motor). Um regex
   cru os reprovaria. O padrão pega `Co-Authored-By: <IA>`, "Generated with …" e o emoji de robô.
   Testado contra falso positivo: `feat: instala skills no motor copilot` **passa**.
   Mesmo princípio que manteve `subject-case` no default — **enforçar a §5, não mais que a §5**
   (§3.1: nunca inventar regra).
2. **Globais do Node declarados à mão** em `eslint.config.js`, em vez do pacote `globals` —
   mantém as 4 devDeps, pela mesma lógica que rejeitou o husky.
3. **ESLint v10** (o npm instalou a mais recente; a spec dizia v9). Flat config idêntico.

## Desvios do plano (registrados)

- **Task acrescentada — `09-review-rules.md`.** O plano (P2.1) só previa `CONSTITUTION.md` e
  `06-quality.md`. Mas o **guia de review** — a fonte do `code-analyzer` — ainda dizia
  "ESLint `[A IMPLEMENTAR]` (ainda não configurado)" e tratava o enforce do INV-2 como opt-in.
  Deixá-lo assim faria o guia **mentir sobre o próprio projeto**. Atualizados TS-7, TS-9 e o
  perfil de estilo; acrescentada **TS-10** (launcher preso ao ES5).
- **Checkpoint de P0 não foi apresentado** — P0 e P1 correram em sequência, com um único
  checkpoint cobrindo os dois blocos.

## Diff da SDD

| Arquivo | Mudança |
|---|---|
| `docs/sdd/CONSTITUTION.md` | §4: os quatro `[A IMPLEMENTAR]` → tabela dos gates **implementados**, com onde cada um falha; registro dos dois invariantes enforçados por lint |
| `docs/sdd/06-quality.md` | gates implementados, limiar 95%, hook sem husky, e a seção **"Duas regras que foram deliberadamente NÃO endurecidas"** |
| `docs/sdd/09-review-rules.md` | TS-7 e TS-9 passam a "ativo"; **nova TS-10** (ES5 no launcher); perfil de estilo atualizado |
| `docs/adr/0002-*.md` | **novo** — ADR da adoção dos gates |

**ADR relacionado:** `docs/adr/0002-gates-de-qualidade-automatizados.md` (Accepted) — cumpre o
`[A IMPLEMENTAR]` que o **ADR-0001** havia deixado sobre o enforcement do INV-2.

## Review final (`code-analyzer`)

**Sem reprovações** ancoradas em regra textual do guia. Uma correção aplicada durante o review:
`texto` → `mensagemCrua` (NAM-1/NAM-2) em `commitlint.config.js`.

**Ressalva de honestidade:** esta feature **editou o guia** contra o qual o review rodou (TS-7,
TS-9, TS-10). A **TS-10 foi tratada como não-aplicável** para fins de reprovação — revisar o
próprio código contra uma regra escrita na mesma mudança seria circular.

## Pendências (não bloqueiam)

1. **CVE moderate do esbuild** (`GHSA-67mh-4wv8-2f99`, dev server — que este projeto **nunca
   roda**). Correção só via **breaking change** (esbuild 0.28.1), o que exige revalidar o
   `npm run build`. Não afeta o gate `high`. **Decisão adiada, de propósito.**
2. **Hook exige `npm install`** — quem clonar e commitar sem instalar recebe erro pouco claro do
   `npx`. Falha **fechado** (bloqueia), que é a direção segura.
3. **Mutation testing (StrykerJS)** segue `[A CONFIRMAR]` — fora do escopo desta spec.
4. **Bug de caminho da CONSTITUTION** (`spec-init` diz raiz, `sdd-check` exige `docs/sdd/`) —
   `fix:` separado, já fora de escopo no PRD.
5. **CHANGELOG em `[Não lançado]`, sem bump** — nada aqui entra no pacote publicado.

## Commit

**Não executado.** Mensagem preparada para confirmação humana (§5: Conventional Commits sem
scope, sem menção a IA, corpo ≤ 100 colunas/linha):

```
feat: adiciona gates de qualidade que quebram o build

Implementa os quatro gates que a CONSTITUTION listava como [A IMPLEMENTAR]: ESLint (flat
config), commitlint (hook commit-msg via core.hooksPath, sem husky), gate de cobertura
(--test-coverage-lines=95, flag nativa do Node) e npm audit --audit-level=high no CI.

O lint passa a enforcar dois invariantes de arquitetura: src/ nunca importa bin/ (INV-2) e
bin/mgr.cjs preso ao ES5, que e o que garante a mensagem legivel em Node < 22.

Nenhuma dependencia de runtime; o pacote publicado nao muda. Decisoes em ADR-0002.
```

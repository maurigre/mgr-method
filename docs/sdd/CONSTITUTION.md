# CONSTITUTION — mgr-method

> Base não-negociável do projeto. Gerada pelo `spec-init` em **2026-07-14** (modo brownfield),
> a partir do código, dos manifestos e das decisões do autor. **Exige revisão humana explícita.**
> Tudo que o `spec-create`/`spec-execute` fizerem depois deriva daqui.

## 1. Identidade

**mgr-method** é um framework de **Specification-Driven Development para agentes de código**,
distribuído como pacote npm. Ele existe para **impedir que o agente improvise**: plano antes do
código, execução **fiel ao plano**, review **ancorado em regra textual**.

## 2. Princípios arquiteturais (invioláveis)

1. **Arquitetura em camadas (layered)**: **Borda (`bin/`) → Núcleo (`src/`)**.
   `src/` **NUNCA** importa `bin/`.
2. **A lógica vive no núcleo.** A borda é cola: parse de flags, prompts, formatação, exit codes.
3. **I/O de terminal no núcleo só por adaptador injetado** (padrão *Humble Object*, ver
   `src/prompts.js`). Nada de `console`/prompt direto em módulo de lógica.
4. **Um único ponto de acesso aos recursos do pacote**: `src/bundle.js`.
5. **Cada motor é autossuficiente.** Nenhum diretório é referenciado por outro motor; apagar a
   pasta de um motor **não pode** quebrar o outro.
6. **`.mgr-core/` é config, não conteúdo.** Nunca voltar a colocar skills lá dentro.
7. **Compatibilidade é obrigação**: mudança de layout instalado exige **migração automática e
   anunciada** (discriminada pelo campo `model` do manifesto). Quem não roda comando algum
   **não pode** ser afetado.

## 3. Regras não-negociáveis do método (o produto)

1. **Nunca inventar regra.** O `code-analyzer` só reprova citando **texto** de
   `docs/sdd/09-review-rules.md`. Sem regra textual → o código está conforme.
2. **Nunca inventar conteúdo.** Detalhe não confirmado por código/config/entrevista →
   `[A CONFIRMAR]`. Na dúvida: buscar fonte sólida (canon/doc oficial); não achando, **perguntar**.
3. **Atribuição correta.** Regra de arquitetura vem do **criador daquela arquitetura**
   (Cockburn/hexagonal, Martin/clean, Palermo/onion, Fowler/layered). Práticas de outros autores
   (ex.: *Screaming Architecture*, de Martin) entram como **Boas Práticas transversais opt-in**,
   sempre creditadas — nunca como invariante de outra arquitetura.
4. **Fidelidade ao plano.** O `spec-execute` produz **o artefato exato do plano** — não divide,
   não renomeia, não "melhora" a forma por conta própria. Plano errado → **parar** e devolver ao
   `spec-create`.
5. **Fonte única.** Regras transversais (arquitetura e qualidade) vivem em **um** lugar
   (`shared/arch`, `shared/quality`) e são consumidas por todas as skills. Nunca duplicar.
6. **Refatorar preserva o decidido.** Refatoração **adiciona/refina**; nunca perde
   funcionalidade nem decisão anterior. Divergência → resolver explicitamente, não sobrescrever.
7. **Anti-compactação.** Nunca resumir conversa nem trocar contexto estruturado por prosa —
   arquivar fatos em disco e manter referência.

## 4. Padrões de qualidade

### Vigentes (já no repo)
- **Testes:** `node:test` nativo. Toda mudança em `src/` exige teste.
- **`mgr validate` verde** é obrigatório (frontmatter, kebab-case, `SKILL.md` ≤ 500 linhas).
- **Cobertura** medida (`node --experimental-test-coverage` → Coveralls). Estado: **96,95%**.
- **Anti-inflação (regra dura):** proibido criar teste para código sem lógica só para bater
  métrica. Cobertura é **métrica, não meta**. E **proibido excluir código da medição para
  maquiar o número** — o caminho é extrair a lógica e testá-la.

### Gates automatizados (implementados em 2026-07-14 — ADR-0002)

Cada um **quebra o build**. Aviso que não falha não é gate.

| Gate | Como | Onde falha |
|---|---|---|
| **ESLint** | flat config (`eslint.config.js`) sobre `@eslint/js` recommended | `npm run lint` + CI |
| **Gate de cobertura** | `--test-coverage-lines=95` (flag **nativa** do Node) — **linhas ≥ 95%**; branches **fora** do gate | `npm run coverage` + CI |
| **Commitlint** | `config-conventional` + `scope-empty`, `body-leading-blank` e `no-ai-mention` | hook `commit-msg` (`.githooks/`) + CI |
| **Auditoria de dependências** | `npm audit --audit-level=high` (deps **e** devDeps) | CI |

**O hook local é conveniência; o gate real é o CI** — `--no-verify` contorna hook, CI não.

**Dois invariantes desta constituição são enforçados pelo lint**, não pela disciplina:
- **§2.1 (INV-2)** — `src/` importando `bin/` → `no-restricted-imports`.
- **`bin/mgr.cjs` tem de continuar ES5** (roda **antes** do guard de versão: é ele que dá a
  mensagem legível em Node < 22) → `ecmaVersion: 5` faz sintaxe moderna virar erro de parse.

## 5. Política de versionamento (git)

Detectada no repositório e **mantida**:
- **Conventional Commits, SEM scope**: `type: subject` — minúscula, imperativo, sem ponto final,
  header ≤ 100 col; corpo com linha em branco após o header e **cada linha ≤ 100 colunas**.
  `type` ∈ {build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test}.
- **Proibido** qualquer menção a IA/assistente nas mensagens de commit ou corpos de PR.
- **Branch por mudança relevante**; `main` recebe merge fast-forward.
- **Nenhuma ação de git automática**: commit/push só com confirmação explícita.
- **SemVer + Keep a Changelog**: toda versão publicada tem entrada no `CHANGELOG.md` e tag
  `vX.Y.Z`. Versão publicada **nunca** é sobrescrita — erro → **bump**.

## 6. Publicação

**MANUAL**, por decisão forçada: os dois caminhos automatizados do npm estão quebrados do lado
do registry (OIDC `npm/cli#8730`; granular token bypass-2FA `npm/cli#8869`). O `publish.yml`
roda **apenas gates**. Reavaliar quando o npm corrigir. Detalhes em `docs/sdd/07-operations.md`.

## 7. Evidências AI-First

**Desabilitado** (default). Não há `ai/index.md` nem `specs/*/ai/` no repositório.
Alterar esta linha habilita o `evidence-capture` para **todas** as features (política de
projeto, não escolha por feature).

## 8. Memória estendida (mgr-code)

Opcional. Toda skill **sonda** o `mgr-mcp`: **ON** → recupera contexto e grava decisões;
**OFF** → **avisa visivelmente** e prossegue. Nunca silenciar a ausência; nunca travar por ela.

---

> **Revisão humana pendente.** Confirme, ajuste ou rejeite cada seção antes de usar o
> `spec-create`.

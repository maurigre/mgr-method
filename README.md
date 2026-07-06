# MGR — Método Governado por Rastreabilidade

[![CI](https://img.shields.io/github/actions/workflow/status/maurigre/mgr-method/ci.yml?branch=main&label=CI&logo=github)](https://github.com/maurigre/mgr-method/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/coveralls/github/maurigre/mgr-method?branch=main&logo=coveralls)](https://coveralls.io/github/maurigre/mgr-method?branch=main)
[![npm](https://img.shields.io/npm/v/mgr-method?logo=npm)](https://www.npmjs.com/package/mgr-method)
[![node](https://img.shields.io/node/v/mgr-method?logo=node.js&logoColor=white)](https://www.npmjs.com/package/mgr-method)
[![downloads](https://img.shields.io/npm/dm/mgr-method?logo=npm)](https://www.npmjs.com/package/mgr-method)
[![license](https://img.shields.io/badge/license-Source--Available-blue)](LICENSE)

Framework de **Specification-Driven Development (SDD)** para agentes de código:
um CLI instala um conjunto de Agent Skills que conduzem o
projeto do brief à entrega com checkpoints humanos, decisões rastreáveis (ADRs) e
review governado por regras do próprio projeto. Portável entre **Claude Code** e
**GitHub Copilot** (padrão aberto de Agent Skills), com integração opcional à memória
de longo prazo **mgr-code**.

## Instalação

```bash
npx mgr-method install          # TUI interativa: multiselect de motores + escopo
```

O instalador permite selecionar **vários motores de uma vez** (espaço marca, enter
confirma): dá para instalar em `.claude/skills` **e** `.github/skills` simultaneamente,
com um único runtime.

Não-interativo / ciclo de vida:

```bash
npx mgr-method install --engine claude-code --scope project .
npx mgr-method install --engine copilot --scope project .   # lançadores em .github/skills
npx mgr-method install --dry-run
npx mgr-method status | update | uninstall
```

O instalador escreve o **runtime** em `.mgr-core/` (conteúdo uma vez + `manifest.json`)
e **lançadores finos** na pasta do motor (`.claude/skills/` ou `.github/skills/`), que
apontam para o runtime — instalar para vários motores não duplica conteúdo. As
convenções de diretório seguem as versões vigentes das ferramentas; se a sua versão
esperar outro caminho, use `--skills-dir` para forçar. O
`uninstall` remove só o que o MGR criou; `docs/`, `specs/` e código ficam intactos.

## O fluxo

```
spec-init  ─── uma vez ───►  docs/sdd/ + CONSTITUTION.md + 09-review-rules.md
                                  │   (constituição: revisão humana obrigatória)
spec-create ── por feature ──►  specs/<feature>/ 01-brief → 02-prd → 03-spec
                                  → 04-plan (P0/P1/P2 + DAG) → 05-execution → 06-completion
                                  │   checkpoints bloqueantes; sem commit automático
adr-create  ── quando há decisão arquitetural (invocada automaticamente)
junit-clean ── tasks de teste Java (13 regras)
code-analyzer ─ review final, ancorado no guia DO projeto (zero regra inventada)
```

### As skills

| Skill | Papel |
|---|---|
| `spec-init` | Inicializa a SDD: analisa projeto existente (chunking em fases) **ou** entrevista guiada em projeto vazio (greenfield). Gera `docs/sdd/`, a `CONSTITUTION.md` do projeto e o guia de review. |
| `spec-create` | Evolui o projeto por feature: brief → PRD → spec → plano (P0/P1/P2 + DAG), com checkpoints bloqueantes; após a aprovação do plano, delega a implementação ao `spec-execute` e fecha com o completion. |
| `spec-execute` | Executa o plano aprovado task a task (DAG), aplicando as premissas de desenvolvimento (segurança, performance, recursos, clareza — "vocabulário, não checklist") e o controle ativo de contexto (tiers S–F, arquivamento a 75%, hand-off, anti-compactação). Retomada direta de execução interrompida. |
| `adr-create` | ADRs formato Nygard: auto-detecta diretório, numeração sequencial, imutabilidade de aceitos, modo avulso ou invocado. |
| `code-analyzer` | Revisor rigoroso com **Restrição Crítica**: toda reprovação cita textualmente uma regra de `docs/sdd/09-review-rules.md`; problema real sem regra vira sugestão não-bloqueante. Agnóstico à arquitetura — as regras vêm do projeto. |
| `evidence-capture` | Registra evidências AI-First por funcionalidade (prompts, revisões, habilidades) em `specs/<feature>/ai/` + índice global; organiza e pergunta, nunca inventa. |
| `junit-clean` | Testes Java padronizados por 13 regras (naming should+camelCase, sem herança, ParameterizedTest, AAA, boundary + MC/DC, Sonar-safe). |
| `arch-hexagonal` | Provedora do guia de regras para Ports & Adapters (guia Java completo e validado). |
| `arch-clean` · `arch-onion` · `arch-layered` | Provedoras stub: regra de dependência definida; regras detalhadas `[A DEFINIR]` com o time (nunca inventadas). |

### Princípios que governam tudo

- **Constituição é lei** — gerada por projeto pelo `spec-init`, revisada por humano;
  toda spec/task a respeita ou declara override documentado.
- **Evidência, nunca invenção** — o que não deriva de código, spec ou entrevista vira
  `[A CONFIRMAR]`/`[A DEFINIR]` + pergunta; reprovação sem regra textual não existe.
- **Checkpoints bloqueantes** — o humano aprova PRD, spec e plano; commit é humano.
- **Contexto sob controle** — tiers S/A/B/C/D/E/F, arquivamento a 75%, hand-off de
  sessão, proibição de compactação. Projetado para caber no menor orçamento de contexto
  entre os motores suportados (limites variam por ferramenta/versão — não presuma janela grande).
- **mgr-code se disponível** — cada skill sonda o `mgr-mcp` no início; usa a memória
  quando presente e **alerta visivelmente** quando ausente. Nunca é dependência crítica.

## Projeto do zero (greenfield)

`spec-init` detecta o projeto vazio e entra em modo entrevista: stack, arquitetura
(hexagonal default / clean / onion / layered), domínio, persistência, contratos, testes,
logs e não-negociáveis — com defaults agressivos e ramificação. Cada decisão estrutural
gera um ADR automaticamente. Sai a mesma SDD do brownfield; depois é `spec-create` por
feature, idêntico.

## Estrutura do repositório

```
bin/mgr.js          # CLI (install · status · update · uninstall · build · validate · list)
src/                # bundle · builder (runtime+lançadores) · installer (2 fases) · manifest · validator
skills/             # as 11 skills (fonte)
shared/scripts/     # sdd-check.sh (verifica pré-requisitos do spec-create)
test/               # node:test
```

Dependências mínimas (@clack/prompts e picocolors na TUI; esbuild só em dev — o pacote
publicado é um bundle minificado). Node ≥ 18. Release: `git tag vX.Y.Z && git push --tags`
dispara o workflow de publish (valida, testa e publica no npm com provenance). Desenvolvimento: `npm test`,
`node bin/mgr.js validate`.

## Licença

Source-available — código aberto para leitura e uso pessoal/interno; redistribuição,
revenda ou derivados distribuídos exigem autorização do autor. Veja [LICENSE](LICENSE).

# MGR — Método Governado por Rastreabilidade

> **English version:** [README.md](README.md) — the package's canonical documentation.

[![CI](https://img.shields.io/github/actions/workflow/status/maurigre/mgr-method/ci.yml?branch=main&label=CI&logo=github)](https://github.com/maurigre/mgr-method/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/coveralls/github/maurigre/mgr-method?branch=main&logo=coveralls)](https://coveralls.io/github/maurigre/mgr-method?branch=main)
[![npm](https://img.shields.io/npm/v/mgr-method?logo=npm)](https://www.npmjs.com/package/mgr-method)
[![node](https://img.shields.io/node/v/mgr-method?logo=node.js&logoColor=white)](https://www.npmjs.com/package/mgr-method)
[![license](https://img.shields.io/badge/license-Source--Available-blue)](LICENSE)

Framework de **Specification-Driven Development (SDD)** para agentes de código:
um CLI instala um conjunto de Agent Skills que conduzem o
projeto do brief à entrega com checkpoints humanos, decisões rastreáveis (ADRs) e
review governado por regras do próprio projeto. Portável entre **Claude Code** e
**GitHub Copilot** (padrão aberto de Agent Skills), com integração opcional à memória
de longo prazo **mgr-code**.

O conteúdo das skills é mantido em **inglês** (fonte canônica única — ADR-0003), mas o
**idioma de saída** é seu: a instalação pergunta em que idioma as skills devem conversar
com você e gerar os artefatos (PRDs, specs, ADRs) — para times brasileiros, `pt-BR`.

## Instalação

```bash
npx mgr-method@latest install   # TUI: motores + escopo + linguagem + arquitetura + idioma de saída
```

> Use `@latest` para o `npx` sempre pegar a versão publicada mais recente (sem tag, ele
> pode reusar uma versão em cache). Para fixar uma versão: `npx mgr-method@0.3.0 install`.

A instalação é **seletiva**: o TUI pergunta os motores, o escopo, a **linguagem** e a
**arquitetura** do projeto, o **idioma de saída** (sugerido a partir do seu locale) e um
`MGR_PROJECT_ID`. Só as skills que o projeto usa são copiadas — o núcleo (`spec-init`,
`spec-create`, `spec-execute`, `adr-create`, `code-analyzer`, `diagnosing-bugs`), a skill
da arquitetura escolhida (ex.: `arch-hexagonal`) e os helpers da linguagem (ex.:
`junit-clean` em Java). A própria CLI fala `en` e `pt-BR`, seguindo a mesma preferência
(flag > manifesto > locale).

Não-interativo / ciclo de vida:

```bash
npx mgr-method install --engine claude-code --language java --arch hexagonal .
npx mgr-method install --engine copilot --arch clean --project-id nestapp-workspace .
npx mgr-method install --user-language pt-BR .   # skills conversam e geram artefatos em pt-BR
npx mgr-method install --all-skills .            # instala todas as skills (sem seleção)
npx mgr-method install --dry-run
npx mgr-method status | update | uninstall
```

### Layout instalado

Cada motor é **autossuficiente**: o conteúdo completo das skills vai direto para a pasta do
motor (`.claude/skills/` ou `.github/skills/`), sem duplicação e sem apontadores. O
`.mgr-core/` guarda apenas **config do projeto** (versione-o):

```
.mgr-core/
├── manifest.json     # o que foi instalado (motores, skills, linguagem, arquitetura, userLanguage)
└── .env              # MGR_PROJECT_ID=<id>, usado pela memória estendida (mgr-code)
.claude/skills/       # as skills (única árvore de skills)
```

Instalar para dois motores gera duas árvores independentes — apagar uma **não** afeta a
outra. Instalações no modelo antigo (runtime + `.mgr-core/skills` + lançadores) são
**migradas automaticamente** no `install`/`update` — inclusive o idioma: instalação
existente sem `userLanguage` herda `pt-BR` silenciosamente no `update`. Use `--skills-dir`
para forçar um diretório específico. O `uninstall` remove só o que o MGR criou; `docs/`,
`specs/` e código ficam intactos.

## O fluxo

```
spec-init  ─── uma vez ───►  docs/sdd/ + CONSTITUTION.md + 09-review-rules.md
                                  │   (constituição: revisão humana obrigatória)
spec-create ── por feature ──►  specs/<feature>/ 01-brief → 02-prd → 03-spec
                                  → 04-plan (P0/P1/P2 + DAG) → 05-execution → 06-completion
                                  │   checkpoints bloqueantes; sem commit automático
adr-create  ── quando há decisão arquitetural (invocada automaticamente)
diagnosing-bugs ─ bug difícil: loop de reprodução vermelho antes de qualquer hipótese
junit-clean ── tasks de teste Java (13 regras)
code-analyzer ─ review final de 2 eixos: Standards (guia DO projeto) + Spec (cumpriu o pedido?)
```

### As skills

| Skill | Papel |
|---|---|
| `spec-init` | Inicializa a SDD: analisa projeto existente (chunking em fases) **ou** entrevista guiada em projeto vazio (greenfield). Gera `docs/sdd/`, a `CONSTITUTION.md` do projeto e o guia de review. |
| `spec-create` | Evolui o projeto por feature: brief → PRD → spec → plano (P0/P1/P2 + DAG), com checkpoints bloqueantes; após a aprovação do plano, delega a implementação ao `spec-execute` e fecha com o completion. |
| `spec-execute` | Executa o plano aprovado task a task (DAG), aplicando as premissas de desenvolvimento (segurança, performance, recursos, clareza — "vocabulário, não checklist") e o controle ativo de contexto (tiers S–F, arquivamento a 75%, hand-off, anti-compactação). Retomada direta de execução interrompida. |
| `adr-create` | ADRs formato Nygard: auto-detecta diretório, numeração sequencial, imutabilidade de aceitos, modo avulso ou invocado. |
| `code-analyzer` | Revisor rigoroso de **dois eixos**, reportados lado a lado: **Standards** (o código segue `docs/sdd/09-review-rules.md`?) e **Spec** (o código cumpriu a spec de origem?). **Restrição Crítica** nos dois: toda reprovação cita textualmente — a regra do guia ou a linha da spec; sem citação, não reprova (§3.1). Modelo de dois eixos adaptado de `code-review` de Matt Pocock ([MIT](https://github.com/mattpocock/skills)). |
| `diagnosing-bugs` | Disciplina de diagnóstico de bug difícil: exige um loop de reprodução **vermelho** antes de qualquer hipótese (*sinal antes de teoria*), 3–5 hipóteses falsificáveis, teste de regressão antes do fix. Acha a causa e para (entrega o conserto ao `spec-create`). Adaptada de `diagnosing-bugs` de Matt Pocock ([MIT](https://github.com/mattpocock/skills)). |
| `evidence-capture` | Registra evidências AI-First por funcionalidade (prompts, revisões, habilidades) em `specs/<feature>/ai/` + índice global; organiza e pergunta, nunca inventa. |
| `junit-clean` | Testes Java padronizados por 13 regras (naming should+camelCase, sem herança, ParameterizedTest, AAA, boundary + MC/DC, Sonar-safe). |
| `arch-hexagonal` | Guia de regras para Ports & Adapters (Cockburn), agnóstico à linguagem (perfis Java/Go/Python/C#/TS + genérico). |
| `arch-clean` · `arch-onion` · `arch-layered` | Guias canônicos de Clean (Martin), Onion (Palermo) e Layered (Fowler), no mesmo template agnóstico, com regras transversais compartilhadas. |

### Princípios que governam tudo

- **Constituição é lei** — gerada por projeto pelo `spec-init`, revisada por humano;
  toda spec/task a respeita ou declara override documentado.
- **Evidência, nunca invenção** — o que não deriva de código, spec ou entrevista vira
  `[TO CONFIRM]`/`[TO DEFINE]` + pergunta; reprovação sem regra textual não existe.
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
skills/             # as 12 skills (fonte)
shared/scripts/     # sdd-check.sh (verifica pré-requisitos do spec-create)
test/               # node:test
```

Dependências mínimas (@clack/prompts e picocolors na TUI; esbuild só em dev — o pacote
publicado é um bundle minificado). Node ≥ 22. Release: `git tag vX.Y.Z && git push --tags`
dispara o workflow de publish (valida, testa e publica no npm com provenance). Desenvolvimento: `npm test`,
`node bin/mgr.js validate`.

## Licença

Source-available — código aberto para leitura e uso pessoal/interno; redistribuição,
revenda ou derivados distribuídos exigem autorização do autor. Veja [LICENSE](LICENSE).

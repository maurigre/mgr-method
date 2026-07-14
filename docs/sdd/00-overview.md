# 00 — Overview

> Gerado pelo `spec-init` em 2026-07-14 (modo BROWNFIELD, análise do repositório).
> Fonte: código, manifestos e configs deste repo. Nada aqui foi inferido sem evidência.

## O que é

**mgr-method** — *MGR: Método Governado por Rastreabilidade*. É um **framework de
Specification-Driven Development (SDD) para agentes de código**, distribuído como pacote npm.
Um CLI instala um conjunto de **Agent Skills** que conduzem um projeto do brief à entrega, com
checkpoints humanos, decisões rastreáveis (ADRs) e review governado pelas regras do próprio
projeto.

Fonte: `package.json` (`description`), `README.md`.

## Propósito

Evitar que o agente de código improvise: o método impõe **plano → execução fiel → review
ancorado em regra textual**, com o guia de regras derivado da **arquitetura escolhida** e da
**linguagem** do projeto — nunca de regras inventadas pela IA.

## Escopo do produto

| Entregável | Onde |
|---|---|
| CLI `mgr` / `mgr-method` | `bin/mgr.cjs` (launcher) → `dist/mgr.min.js` (bundle) |
| 11 Agent Skills | `skills/*/SKILL.md` |
| Fontes transversais compartilhadas | `shared/arch/`, `shared/quality/` |
| Script de apoio | `shared/scripts/sdd-check.sh` |

Skills atuais: `spec-init`, `spec-create`, `spec-execute`, `adr-create`, `code-analyzer`,
`evidence-capture`, `junit-clean`, `arch-hexagonal`, `arch-clean`, `arch-onion`, `arch-layered`.

## Fluxo do método (o que o produto entrega ao usuário)

```
spec-init    ── uma vez ──►  docs/sdd/ + CONSTITUTION.md + 09-review-rules.md
spec-create  ── por feature ──►  brief → PRD → spec → plano (P0/P1/P2 + DAG)
spec-execute ── executa o plano task a task (fidelidade + qualidade + auto-review)
code-analyzer ── review final, ancorado no guia DO projeto (zero regra inventada)
adr-create   ── registra decisões arquiteturais (Nygard)
```

## Motores suportados

Claude Code (`.claude/skills`) e GitHub Copilot (`.github/skills`). A instalação é **seletiva**
(só as skills que o projeto usa) e **autossuficiente por motor** (sem duplicação).
Fonte: `src/installer.js` (`ENGINE_DIR`), `src/catalog.js`.

## Estado atual

- Versão publicada: **0.3.8** (`package.json`).
- Licença: **Source-Available v1.0** (custom) — `LICENSE`.
- Repositório: `github.com/maurigre/mgr-method` (público).

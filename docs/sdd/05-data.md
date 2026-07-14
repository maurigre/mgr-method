# 05 — Dados e persistência

> **Não há banco de dados.** A persistência é o **filesystem do projeto do usuário**.

## O que o MGR escreve no projeto

```
<repo>/
├── .mgr-core/                 ← CONFIG do projeto (versionável; NÃO contém skills)
│   ├── manifest.json          estado da instalação (fonte de verdade)
│   └── .env                   MGR_PROJECT_ID=<id>   (consumido pelo mgr-code)
│
└── .claude/skills/            ← MOTOR (autossuficiente; conteúdo completo)
    ├── spec-init/  spec-create/  spec-execute/  adr-create/  code-analyzer/
    ├── arch-<escolhida>/                    (só a do projeto)
    ├── <helpers da linguagem>/              (ex.: junit-clean em Java)
    └── _shared/
        ├── arch/regras-transversais.md      (se há skill arch-*)
        └── quality/regras-qualidade.md      (se há spec-init)
```

Com dois motores, gera-se **duas árvores independentes** (`.claude/skills` e
`.github/skills`) — apagar uma não afeta a outra.

## Esquema do manifesto

Ver `03-contracts.md` §4. Campos-chave para o ciclo de vida:

| Campo | Uso |
|---|---|
| `model` | `self-contained` (atual) ou `runtime-launcher` (antigo) → **discrimina a migração** |
| `skillsDirs` | onde remover no `uninstall` |
| `skills` | conjunto exato instalado → `update` re-sincroniza o mesmo conjunto |
| `language` / `architecture` | reconstroem o plano no `update` |
| `projectId` | identidade do projeto para a memória estendida |

## Migração (modelo antigo → atual)

Fonte: `src/installer.js` (`migrateOld`), coberta por teste.

```
detecta manifest.model == "runtime-launcher"
   → remove os lançadores antigos (por skillsDirs × skills do manifesto)
   → remove .mgr-core/skills e .mgr-core/shared  (o conteúdo duplicado)
   → MANTÉM .mgr-core/ (vira só config) e reescreve manifest.json + .env
   → instala o conteúdo real na pasta do motor
```
É **automática e anunciada** no `install`/`update`. Quem não roda comando algum **não é
afetado** — nada muda em disco.

## Dados gerados pelo método (no projeto do usuário)

Não são gerenciados pelo CLI, mas fazem parte do contrato do método:
- `docs/sdd/` (00-08, `09-review-rules.md`, `_self-assessment.md`) e `CONSTITUTION.md`
- `specs/<feature>/` (01-brief → 06-completion, `.handoff.md`)
- ADRs (diretório auto-detectado pelo `adr-create`)
- `.spec-init/cache/` (cache de análise — **deve ser gitignored**)

O `uninstall` **não** toca nesses artefatos.

## Retenção / migração de dados

Sem banco, sem retenção. `[A CONFIRMAR]` — não há política definida para versões futuras do
formato do `manifest.json` além do campo `model`.

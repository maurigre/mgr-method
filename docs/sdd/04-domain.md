# 04 — Domínio

> Domínio extraído de `src/catalog.js`, `src/installer.js`, `src/builder.js`,
> `src/manifest.js`, `src/validator.js`.

## Bounded context

**Instalação e governança de Agent Skills.** O domínio não é "código do usuário" — é o
*método* (skills, catálogo, motores, guia de regras) e sua instalação/ciclo de vida num projeto.

## Entidades e conceitos

| Conceito | Descrição | Fonte |
|---|---|---|
| **Skill** | Unidade do método: pasta com `SKILL.md` (frontmatter + instruções). É o artefato central. | `bundle.skillNames`, `validator` |
| **Catálogo** | Classificação das skills em **core** · **arquitetura** · **linguagem** · **opcional**. É o que permite a instalação seletiva. | `src/catalog.js` |
| **Motor (engine)** | Ferramenta que consome as skills: `claude-code` (`.claude/skills`) ou `copilot` (`.github/skills` \| `~/.copilot/skills`). | `installer.ENGINE_DIR` |
| **Escopo (scope)** | `project` (no repo) ou `global` (na home). | `installer` |
| **Plano de instalação** | Resultado de `planInstall`: motores, alvos, **subconjunto de skills**, linguagem, arquitetura, `projectId`. Não escreve nada. | `installer.planInstall` |
| **Manifesto** | Estado do que foi instalado (`.mgr-core/manifest.json`) + `.env`. Fonte de verdade para `status`/`update`/`uninstall`/migração. | `src/manifest.js` |
| **Perfil de linguagem** | Regras específicas da linguagem (teste, lint, mutation, idiomas do canon). | `shared/arch`, `shared/quality` |
| **Arquitetura** | Uma de: hexagonal · clean · onion · layered. Define o guia de regras do projeto. | `catalog.ARCHITECTURES` |

## Invariantes de domínio (regras que o código garante)

1. **O núcleo (`core`) é sempre instalado**: `spec-init`, `spec-create`, `spec-execute`,
   `adr-create`, `code-analyzer`. (`catalog.CORE`)
2. **Uma única skill de arquitetura por projeto** — a escolhida. As outras **não** são copiadas.
   (`catalog.selectSkills`)
3. **Skills de linguagem só entram se a linguagem casar** (ex.: `junit-clean` só em Java).
   (`catalog.LANGUAGE`)
4. **Arquitetura desconhecida → erro explícito**, nunca silencioso.
   (`selectSkills` lança `arquitetura desconhecida: …`)
5. **Motor inválido → erro explícito.** (`installer.engineSkillsDir` lança `motor inválido: …`)
6. **Toda skill `arch-*` instalada implica a fonte transversal** co-localizada
   (`needsArchShared` → `_shared/arch`).
7. **`spec-init` instalado implica a fonte de qualidade** (`_shared/quality`).
8. **`projectId` nunca é vazio**: default = nome da pasta do projeto.
   (`planInstall`)
9. **Uninstall preserva o trabalho do usuário**: remove só o que o MGR criou; `docs/` e
   `specs/` ficam intactos. (`installer.uninstall`, coberto por teste)
10. **Cada motor é autossuficiente**: apagar a pasta de um motor não afeta o outro.

## Linguagem ubíqua (termos do domínio)

`skill` · `motor/engine` · `escopo/scope` · `catálogo` · `core` · `perfil` · `plano` ·
`manifesto` · `runtime` (modelo antigo) · `lançador/launcher` (modelo antigo) ·
`self-contained` (modelo atual) · `migração` · `guia de regras` (`09-review-rules.md`).

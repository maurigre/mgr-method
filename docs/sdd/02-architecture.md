# 02 — Arquitetura

> Padrão **LAYERED** (em camadas), confirmado com o autor em 2026-07-14.
> Não é hexagonal/clean/onion: **não há ports/adapters formais**. A garantia aqui é a
> **direção top-down** (borda → núcleo) e a **separação de responsabilidades**.

## Camadas

```
┌─ BORDA (I/O, cola — "humble object") ──────────────────────────────┐
│  bin/mgr.cjs    launcher CJS (ES5): guard de versão do Node,       │
│                 depois spawna o bundle ESM                         │
│  bin/mgr.js     CLI: parseArgs, dispatch de comandos, adaptador    │
│                 de prompts (@clack), formatação/saída, banner      │
└────────────────────────────┬───────────────────────────────────────┘
                             │  (só desce)
┌─ NÚCLEO (lógica — sem I/O de terminal) ────────────────────────────┐
│  src/prompts.js    coleta de respostas do install (adaptador de    │
│                    prompts INJETADO — testável sem TTY)            │
│  src/catalog.js    catálogo das skills (core / arquitetura /       │
│                    linguagem / opcional) + selectSkills            │
│  src/installer.js  planInstall · execute · migrateOld · installs · │
│                    update · uninstall  (orquestração)              │
│  src/builder.js    buildSkill/buildAll/buildRuntime · installEngine│
│                    (copia conteúdo + _shared + resolve token)      │
│  src/manifest.js   persiste `.mgr-core/manifest.json` e `.env`     │
│  src/validator.js  valida SKILL.md (frontmatter + regras)          │
│  src/bundle.js     localiza os recursos do pacote (skills/, shared/)│
│  src/banner.js     apresentação (ASCII + créditos)                 │
└────────────────────────────────────────────────────────────────────┘
```

## Regra de dependência (INV desta arquitetura)

- **Top-down:** `bin/` usa `src/`; **`src/` nunca importa `bin/`**.
- Dentro do núcleo, as dependências são explícitas e acíclicas:
  `installer → {builder, manifest, catalog, bundle}` · `builder → {bundle, catalog}` ·
  `prompts → catalog` · `validator → bundle` · `banner → bundle`.
- **A lógica de negócio vive no núcleo** (`src/`), nunca na borda (`bin/`).

## Inversão pontual (Humble Object)

`src/prompts.js` **recebe o adaptador de prompts injetado** (`{ multiselect, select, confirm,
text, isCancel }`): o CLI passa o do `@clack`; os testes passam um stub. Isso tira a lógica das
perguntas do `bin/` e a torna testável **sem TTY**.
Fonte: `src/prompts.js` (`collectInstallAnswers`), `bin/mgr.js` (`CLACK`).

## Isolamento do filesystem do pacote

`src/bundle.js` é o **único** ponto que resolve caminhos dos recursos empacotados
(`skills/`, `shared/`) a partir de `import.meta.url` — funciona rodando do repo **ou**
instalado via npm/npx.

## Fluxo do comando `install`

```
bin/mgr.js
  ├─ parseArgs (flags)
  ├─ [TTY] prompts.collectInstallAnswers(CLACK, ...)   ← perguntas
  ├─ installer.planInstall(...)  → { engines, skills, language, architecture, projectId }
  ├─ installer.execute(plan)
  │    ├─ migrateOld()      remove layout antigo (.mgr-core/skills + lançadores)
  │    ├─ builder.installEngine()  copia skills + _shared/{arch,quality} + resolve token
  │    └─ manifest.writeManifest() + writeEnv()   → .mgr-core/
  └─ saída (note/spinner/outro)
```

## Modelo de instalação (decisão estrutural)

**Autossuficiente por motor**: o conteúdo completo das skills selecionadas vai **direto** para a
pasta do motor (`.claude/skills` ou `.github/skills`). **Não há runtime compartilhado nem
lançadores.** Cada motor é independente e pode ser apagado sem afetar o outro.

O `.mgr-core/` guarda **apenas config do projeto**: `manifest.json` + `.env` com
`MGR_PROJECT_ID` (consumido pela memória estendida `mgr-code`). Instalações no modelo antigo
(runtime + lançadores) são **migradas automaticamente**.
Fonte: `src/installer.js`, `src/builder.js`, `src/manifest.js`.

## Anti-patterns desta arquitetura (o que reprova)

- Lógica de negócio na borda (`bin/`) em vez do núcleo (`src/`).
- `src/` importando `bin/` (dependência para cima).
- Módulo do núcleo fazendo I/O de terminal (prompt/print) diretamente — deve receber
  adaptador injetado ou devolver dados para a borda formatar.
- Acesso a caminho do pacote fora do `bundle.js`.

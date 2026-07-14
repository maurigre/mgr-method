# 03 — Contratos

> Não há API HTTP/gRPC/GraphQL. Os contratos deste produto são: **a CLI**, **o pacote npm**,
> **o formato SKILL.md** e **o manifesto de instalação**.

## 1. Contrato da CLI

Fonte: `bin/mgr.js` (`parseArgs`, `HELP`, `main`).

| Comando | Efeito |
|---|---|
| `install [repo]` | Instala as skills (seletivo) direto na pasta do motor; migra layout antigo |
| `status [repo]` | Mostra o que está instalado (modelo, motor, stack, skills) |
| `update [repo]` | Re-sincroniza preservando o conjunto instalado |
| `uninstall [repo]` | Remove o que o MGR criou (preserva `docs/` e `specs/`) |
| `build` | Gera um diretório com todo o conteúdo (`--out`) |
| `validate` | Valida todas as `SKILL.md` |
| `list` | Lista as skills |
| `version` | Mostra a versão |
| `help` \| *(vazio)* | Banner + ajuda |

**Flags do `install`:** `--engine claude-code|copilot|both` · `--scope project|global` ·
`--language` · `--arch` · `--project-id` · `--all-skills` · `--skills-dir` · `--dry-run` ·
`-y|--yes`.

**Saída/erros:** exit `0` sucesso; `1` erro (flag desconhecida, comando desconhecido, exceção).

## 2. Contrato do pacote npm

Fonte: `package.json`.

- `bin`: `mgr` e `mgr-method` → `bin/mgr.cjs`.
- `engines.node`: `>=22` (**enforçado em runtime** pelo launcher, não só declarado).
- `files` (o que é publicado): `bin/mgr.cjs`, `dist/`, `skills/`, `shared/`, `LICENSE`,
  `README.md`.
- `type`: `module`.

## 3. Contrato de uma Skill (`SKILL.md`)

Fonte: `src/validator.js` (`checkSkill`) — regras **enforçadas** por `mgr validate`:

1. Frontmatter YAML obrigatório (`--- ... ---`).
2. `name` obrigatório, **kebab-case** (`^[a-z0-9]+(-[a-z0-9]+)*$`) e **igual ao nome da pasta**.
3. `description` com **≥ 40 caracteres** (o que faz **e** quando usar).
4. `SKILL.md` com **≤ 500 linhas** (material profundo vai em subpastas).

Descoberta: `src/bundle.js` (`skillNames`) — qualquer diretório em `skills/` com um `SKILL.md`
é uma skill. Nada de registro manual.

## 4. Contrato do manifesto de instalação

Fonte: `src/manifest.js`, `src/installer.js`.

`.mgr-core/manifest.json`:
```json
{
  "model": "self-contained",
  "installedAt": "<ISO>",
  "version": "<versão do mgr-method>",
  "scope": "project|global",
  "engines": ["claude-code", "copilot"],
  "language": "java|null",
  "architecture": "hexagonal|clean|onion|layered|null",
  "projectId": "<MGR_PROJECT_ID>",
  "skillsDirs": [".claude/skills"],
  "skills": ["spec-init", "..."]
}
```
`.mgr-core/.env`: `MGR_PROJECT_ID=<id>` — consumido pela memória estendida (**mgr-code**).

**Compatibilidade:** o campo `model` distingue o layout novo (`self-contained`) do antigo
(`runtime-launcher`), habilitando a **migração automática**.

## 5. Contrato interno das fontes compartilhadas

Instaladas ao lado das skills, no motor:
- `_shared/arch/regras-transversais.md` — quando há skill `arch-*` no conjunto.
- `_shared/quality/regras-qualidade.md` — quando há `spec-init` no conjunto.

As skills `arch-*` trazem o token `{{MGR_ARCH_RULES}}`, **resolvido no install** para o caminho
real da fonte co-localizada. Fonte: `src/builder.js` (`installEngine`), `src/catalog.js`.

# Plugin skills

A **plugin skill** is a regular [Agent Skills](https://agentskills.io/specification) folder
(`SKILL.md` plus any resources) with one extra file at its root: `mgr-manifest.json`.

- The `SKILL.md` frontmatter is the contract with the **platforms** (Claude Code, Copilot).
- The `mgr-manifest.json` is the contract with **MGR**: provenance, category, permissions and
  the per-platform hints MGR translates when installing.

Nothing in the format is MGR-only: a plugin folder still works as a plain skill if you copy
it by hand.

## Commands

| Command | What it does |
|---|---|
| `mgr registry add <name> <index-url> [--trusted]` | registers a registry; `<name>` becomes the `@name` scope |
| `mgr registry list` / `mgr registry remove <name>` | lists / removes registries |
| `mgr add @<registry>/<skill>` | resolves, downloads, verifies, **asks for confirmation**, installs and locks |
| `mgr remove @<registry>/<skill>` | removes the skill from the engines and from the lockfile |
| `mgr list` | after the method catalog, lists installed plugins and what the registries offer |
| `mgr status` | adds a plugin block (name, version, registry) |
| `mgr install` / `mgr update` | when `mgr-skills.lock` exists, restores the exact locked set |

Registries live in `.mgr-core/config.json`; the locked set lives in `mgr-skills.lock` at the
root of the project. Commit the lockfile: it is a team contract, like `package-lock.json`.

There is **no `--yes` for `mgr add`**. Every install is confirmed by a human, and in a
non-interactive terminal the command fails with an explicit message instead of installing.

## `mgr-manifest.json`

```json
{
  "name": "@mgr/junit-clean",
  "version": "1.0.0",
  "author": "Mauri Reis",
  "description": "What the skill does and when to use it — 40 to 1024 characters, with explicit triggers.",
  "category": "language",
  "compatibility": { "mgr": ">=0.6.0" },
  "extends": null,
  "permissions": ["read-files", "write-files"],
  "capabilities": { "requires": [], "optional": ["model-selection"] },
  "model": { "claude-code": "sonnet", "copilot": "Claude Sonnet 4.5" },
  "effort": "medium",
  "testedModels": ["Claude Sonnet 4.5"]
}
```

| Field | Required | Rule |
|---|---|---|
| `name` | yes | `@registry/skill`, both halves in kebab-case. The installed folder is the skill half |
| `version` | yes | semver `MAJOR.MINOR.PATCH`, optional pre-release suffix |
| `author` | yes | non-empty string |
| `description` | yes | 40–1024 characters, stating what it does **and when to use it** |
| `category` | yes | `architecture`, `language`, `database`, `infra`, `monitoring`, `testing`, `docs`, `workflow`, `other` |
| `compatibility` | no | `{ "mgr": "<range>" }` |
| `extends` | no | `@registry/skill` of the base skill, or `null` |
| `permissions` | no (**required in the official registry**) | any of `read-files`, `write-files`, `run-shell`, `network` |
| `capabilities` | no | `{ "requires": [], "optional": [] }` |
| `model` | no | platform → model **display name** (never a dated model id) |
| `effort` | no | `low`, `medium`, `high`, `max` |
| `testedModels` | no | model display names the skill was actually tested with |

There is no `checksum` field: a file cannot hash itself. The checksum lives in the registry
index and in the lockfile.

## Platform capability matrix

MGR translates what the platform supports today and **degrades the rest with a warning** —
an install never fails because a platform lacks a capability. Verified 2026-07-20:

| Capability | Claude Code | Copilot |
|---|---|---|
| Skills folder | `.claude/skills/` | `.github/skills/` |
| `model` per skill | yes — injected into the `SKILL.md` frontmatter | no field in skills (only custom agents) → **warning** |
| `effort` per skill | yes — injected into the frontmatter | not supported; effort is global only → **warning** |

Whatever each adapter applied or degraded is recorded per engine in the `applied` block of
the lockfile, so the result is auditable without extra tooling.

## `mgr-skills.lock`

```json
{
  "lockfileVersion": 1,
  "registries": { "mgr": { "url": "https://raw.../index.json", "trusted": true } },
  "skills": {
    "@mgr/junit-clean": {
      "version": "1.0.0",
      "registry": "mgr",
      "checksum": "sha256-...",
      "category": "language",
      "dir": "junit-clean",
      "engines": ["claude-code", "copilot"],
      "applied": {
        "claude-code": { "model": "sonnet", "effort": "medium" },
        "copilot": { "warnings": ["effort \"medium\" not supported by copilot skills; effort is global only"] }
      }
    }
  }
}
```

`dir` is the folder the skill was installed into. Two registries may publish the same skill
name: the first one installed keeps the plain folder, the next gets a `--<registry>` suffix,
and `dir` records which one this entry owns.

## Integrity and trust

1. Every file is downloaded with its own `sha256`, and the whole set with an aggregate
   checksum: `sha256` over each path plus its bytes, in lexicographic order of path.
2. A mismatch aborts **before anything is written**.
3. `mgr install` / `mgr update` restore from the locked registry — not from whatever the
   local machine has configured — and refuse to proceed if the registry now serves a
   different version or checksum. A plugin is never updated silently.
4. `--trusted` records that you trust a registry; in this version it does **not** enable
   silent installs.

## Publishing to a registry

A registry is a Git repository with a `skills/<name>/` folder per plugin and an `index.json`
**generated from the manifests** — never edited by hand:

```json
{
  "indexVersion": 1,
  "registry": "mgr",
  "generatedAt": "<ISO timestamp>",
  "categories": {
    "language": [
      {
        "name": "@mgr/junit-clean",
        "version": "1.0.0",
        "description": "...",
        "checksum": "sha256-...",
        "files": [{ "path": "SKILL.md", "url": "https://raw.../SKILL.md", "sha256": "..." }]
      }
    ]
  }
}
```

Point `mgr registry add` at the raw URL of that `index.json`.

To turn a folder you already have into a plugin, `scripts/export-plugin.mjs` (in this
repository) copies the skill, generates the manifest and validates it with the same code the
installer uses.

## Known limits of this version

- Upgrading an installed plugin is not supported yet: `mgr remove` then `mgr add`.
- `extends` installs both skills and injects a precedence header into the extending one;
  merging instructions is out of scope.
- Plugins are installed as published: the `{{MGR_USER_LANGUAGE}}` token of the method skills
  is resolved at export time, not per project.

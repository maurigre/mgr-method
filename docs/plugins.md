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
| `mgr detect` | reads the project and lists what the registries offer for it; writes nothing |

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
| `ecosystems` | no | kebab-case tokens for the project ecosystems this skill serves, e.g. `["java", "postgres"]`. Without it the skill is never suggested — only installed by name |
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

## When a plugin has the same name as a method skill

MGR ships its own skills into the same folder a plugin would use. When the short names
collide — `@acme/code-analyzer` against the method's `code-analyzer` — `mgr add` stops and
asks, before writing anything:

| Choice | What happens |
|---|---|
| **Install alongside** (default) | the plugin goes to `code-analyzer--acme`; the method skill stays where it is |
| **Replace the method skill** | the plugin takes the `code-analyzer` folder, and the lockfile records it |

Replacing is recorded, not improvised. The lockfile entry gains a `replaces` field:

```json
"@acme/code-analyzer": {
  "version": "1.0.0",
  "registry": "acme",
  "dir": "code-analyzer",
  "replaces": "code-analyzer"
}
```

That single line is what makes the rest of the CLI behave:

- `mgr install` and `mgr update` **skip** the replaced skill when installing the method, so
  the folder is written once, with what you chose — instead of being written and then
  overwritten. If the registry is unreachable, the command fails loudly and the folder stays
  empty, rather than silently holding a version you did not pick.
- `.mgr-core/manifest.json` keeps the method's full intended skill set and adds a `replaced`
  map, so it never claims to have installed something a plugin took over.
- `mgr status` names the replacement, and reports any skill the lockfile locks but the disk
  does not match. It reports; it never fixes silently.
- `mgr remove` of a replacing plugin tells you the method skill returns on the next
  `mgr install` or `mgr update`.

The choice is made once, travels in the lockfile, and is applied without asking again — so a
teammate cloning the repository gets the same layout from `mgr install`.

A folder occupied by something that is neither the plugin nor a method skill is refused:
MGR never writes over content it cannot account for.
## Being suggested instead of hunted down

A skill nobody knows about is a skill nobody installs. `mgr` reads the project, matches what
it finds against the `ecosystems` published in the index, and proposes what fits — showing
**why** each suggestion appeared.

```
$ mgr detect
Detected in this project
  java  (from pom.xml)

Plugin skills available for what was detected
  @mgr/junit-clean@1.1.0  — java, from pom.xml
```

`mgr detect` writes nothing. `mgr install` ends with the same proposal and, in an interactive
terminal, offers to install — which goes through the ordinary confirmation, the one that
shows origin, permissions and checksum. Accepting a suggestion is never a shortcut around it.

### What is looked at, and what is not

A fixed list of paths, never a tree walk: `pom.xml`, `build.gradle`, `build.gradle.kts`,
`package.json`, `docker-compose.*`, `compose.*`, and `src/main/resources/application.*`.
Services come from anchored markers inside those files — `image: postgres`,
`jdbc:postgresql:`, `amqp://` — never from a loose word in a comment. There is no YAML
parser: the file is **evidence**, not a structure to interpret.

Nothing read from your files becomes a skill name, a URL, or a command. That is deliberate:
a repository you did not write is exactly where a crafted `docker-compose.yml` would try to
talk the tool into installing something. Matching only ever happens between tokens the CLI
knows and the `ecosystems` field published in the index.

Modules in subdirectories of a monorepo are not detected in this version.

### Modes

Set `detectionMode` in `.mgr-core/config.json`:

| Mode | Behaviour |
|---|---|
| `suggest` (default) | detects and asks |
| `manual` | never suggests; detection only when you run `mgr detect` |
| `auto` | **not available yet** — refused with an explicit error |

`auto` would install without asking. It stays out until `mgr audit` exists, because today
`trusted` is only a flag someone typed, and that is not a basis for skipping human review.
Configuring it and silently getting `suggest` would be worse than the error.

Without a TTY — CI, for instance — `suggest` prints what it found and installs nothing.

### Session hooks

`mgr install` also wires a session-start hook for each engine you chose, so the next session
already knows what is available without you running anything. The hook runs the same
deterministic detector and hands the agent a short list of facts; **no agent reads your
project files to detect**, and no file content ever crosses into the agent's context.

Verified on 2026-08-25 against each CLI, not from documentation alone:

| Engine | File (project-local, never committed) | Fires | Reaches the agent |
|---|---|---|---|
| Claude Code | `.claude/settings.local.json` | yes | yes, via stdout |
| Copilot CLI | `.github/copilot/settings.local.json` | yes | yes, via `additionalContext` |
| Copilot in VS Code | — | no hook support | — |

**Copilot needs folder trust first.** Until you trust the folder, a repository hook does not
load and nothing tells you so — no error, not even in debug logs. The first session asks;
accept it and the hook starts working, including in `-p` mode.

The hook lives in a machine-local, gitignored file, so it never changes the agent's behaviour
for anyone else who clones the repository. `mgr` only ever touches its own entry, identified
by a marker in the command; `--no-hooks` skips writing them, and `mgr uninstall` removes them.
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
  merging instructions is out of scope — the same holds for a plugin that replaces a method
  skill: one folder wins, nothing is merged.
- Plugins are installed as published: the `{{MGR_USER_LANGUAGE}}` token of the method skills
  is resolved at export time, not per project.
- Detection covers the repository root (plus the conventional Spring config path), not modules
  in subdirectories, and identifies the ecosystem rather than the framework inside it.

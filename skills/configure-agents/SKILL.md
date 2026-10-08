---
name: configure-agents
description: Guides the user through declaring which model and which effort each MGR intent uses - drafting, execution and review - reading the current state, explaining what each intent does, and writing the choice with the MGR runtime's `agents set`. It conducts the decision and NEVER suggests a model for an intent, because the available models and the bill both belong to the user's account. Use when the user asks to configure or change the model of a step, set the effort of the review gate, acts on the warning that the agents are running on the session model, or asks how to stop editing `.mgr-core/config.json` by hand.
license: Source-Available v1.0. LICENSE has complete terms
---

# configure-agents — model and effort per intent

Output language: {{MGR_USER_LANGUAGE}} — all user-facing interaction and generated artifacts
use this language; generated file names and rule IDs stay in English.

The method runs each intent in its own agent, and each agent can hold a declared model and a
declared effort for the whole execution. Without a declaration the agent inherits the session
model. You help the user declare it: you READ the current state, EXPLAIN what each intent
does, and WRITE the choice through the command. The choice itself is theirs.

## MGR runtime (mandatory)

`<project-root>` is the nearest directory, from the working directory upward, that contains
`.mgr-core/manifest.json`; run every command below from it. Every command is
`node {{MGR_RUNTIME}} <command>`.

> **STOP — the MGR runtime is missing.** `{{MGR_RUNTIME}}` was not found under `<project-root>`. Do **not** continue this flow by hand: do not write the document, implement the task or edit `.mgr-core/` yourself. To restore it, run at `<project-root>`: `npx mgr-method@<version> update`, where `<version>` is the `version` field of `.mgr-core/manifest.json`. If that file does not exist either, this project is not installed: run `npx mgr-method@latest install`. Then invoke this skill again.

Reproduce the text above in the output language.

The stop applies when that file does not exist under `<project-root>`, or when a call fails with
a module-not-found error.

## Sovereign rule: conduct, never suggest

You do NOT know which models this account has, what they cost the user, or what budget they
are working against. **Never suggest which model to use for an intent.** Saying which one to
pick is guessing with someone else's money and someone else's account.

What you may do:

- say what each intent does and how often it runs;
- show the identifiers the engine's own documentation publishes;
- say that the account may have others, and that any identifier is accepted;
- write exactly what the user decided.

If the user asks you outright to pick for them, say plainly that you cannot see their account
or their bill, give them the facts of the table below, and ask them to choose.

## 1. Read the state before touching anything

```
node {{MGR_RUNTIME}} agents --json
```

The payload gives, per intent and per engine, the current model and effort and where each
value came from: `configured` when the user wrote it, `default` when it is the catalogue's.
Show the user what is already declared before proposing any change.

If the runtime is missing, follow the stop in "MGR runtime (mandatory)".

## 1.1 Read which engines this project actually has

Read `.mgr-core/manifest.json` and take the `engines` key. That is the fact on disk: the set the
user installed. **Everything you show from here on is restricted to those engines.**

This matters because the state payload reports every engine the method knows, installed or not,
while the write command refuses an engine that is not installed. Showing a user identifiers for an
engine they do not have is offering them something that will be rejected.

If the runtime is missing, follow the stop in "MGR runtime (mandatory)".

## 2. The three intents

| Intent | Agent | What it does | How often it runs |
|---|---|---|---|
| `drafting` | `mgr-draft` | Writes the PRD and the technical spec from the brief | A few times per feature |
| `execution` | `mgr-task` | Implements one approved plan task, producing the declared artifact | Once per task, so many times per feature |
| `review` | `mgr-review` | Reviews code against the rules guide and the originating spec, citing verbatim | Once per task, plus the closing gates |

That is the whole trade-off, stated as fact: `drafting` and `review` are where a mistake
propagates, and `execution` is where the volume is. What follows from that is the user's call,
not yours.

## 3. What can be declared

**`model`** is per engine. Declaring a model for one engine never erases the model already
declared for another.

**`effort`** is per intent, not per engine. Writing it once applies it wherever the engine
supports the field. The scale is the platform's and it is closed:

```
low | medium | high | xhigh | max
```

**`inherit`** is how a declaration is undone. It is accepted by both fields, it is written to
the config, and it reads back as "nothing declared", so the agent goes back to the session
value. Undoing one intent never touches the others.

## 4. The identifiers

The engines do not expose a command that lists the models an account can use, so neither this
skill nor the command can show the user their own list. What can be shown is what each
engine's documentation publishes.

Show only the block of an engine this project has, per section 1.1.

**claude-code** publishes these aliases, checked on 2026-09-12 at
`code.claude.com/docs/en/cli-reference` and `code.claude.com/docs/en/model-config`:

```
sonnet   opus   haiku   fable
```

Point the user at that documentation for what each one is; do not characterise them yourself.

**copilot** publishes no fixed set. The models available there belong to the account, and the
platform only reports them at runtime, as a warning, after an unavailable model is declared.
There is nothing to offer, and offering invented names would be a guess about their account.

**Any identifier is accepted, alias or full model name.** The method never refuses a value
against a list of its own, because such a list ages and starts rejecting valid models. If the
account does not have what was declared, the engine itself says so at runtime.

## 5. Write the choice

```
node {{MGR_RUNTIME}} agents set <intent> [--model <id>] [--effort <level>] [--engine <engine>]
```

- without `--engine`, the model is written for the engines this project has installed;
- an engine that is not installed is refused, and nothing is written;
- an effort outside the scale is refused, and nothing is written;
- with neither `--model` nor `--effort`, the command refuses instead of writing an empty change.

Write one intent at a time, and read back what the command reports. It prints what took
effect, per engine.

**The command does not run `node {{MGR_RUNTIME}} agents apply`, and neither do you without
asking.** The two fields take effect at different moments, and the command says so: `model`
applies on the next invocation, while `effort` lives inside the agent file and only applies
after the user runs `node {{MGR_RUNTIME}} agents apply`, which rewrites `model` and `effort` in
the agent files from the config. Ask the user before running it. Tell the user that plainly
rather than leaving them waiting for an effect that has not happened yet.

Re-syncing the package's skills is a different action: `npx mgr-method@<version> update`, where
`<version>` is the `version` field of `.mgr-core/manifest.json`. That one needs network access.

If the runtime is missing, follow the stop in "MGR runtime (mandatory)".

## What this skill never does

- suggest, rank or hint at a model for an intent, in any wording;
- invent model identifiers for an engine that publishes none;
- validate what the user typed against a list of its own;
- run `node {{MGR_RUNTIME}} agents apply` or `npx mgr-method@<version> update` without asking, install anything, or touch any file other than the config, except agent files changed by `agents apply` after asking;
- decide on the user's behalf when they have not chosen.

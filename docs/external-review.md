# External review

**External review** lets a reviewer from **another provider** review a feature, besides the
`mgr-review` gate that runs on the same engine that implemented it. The reviewer is called with no
conversation and in read-only mode, answers in a fixed format, and MGR checks every citation
against the project rules guide and the feature spec before it counts as a finding.

It is **off by default**. A project that never turns it on sees no change in its flow: no new step,
nothing sent anywhere, and `spec archive` keeps its three conditions. The only visible trace is one
line at the end of `mgr install` that says it is off.

The first and only reviewer in this version is the [`codex`](https://developers.openai.com/codex)
CLI from OpenAI.

## What leaves your machine

Read this before turning it on.

- On every `review external`, the reviewer reads, in your project folder, the files the feature
  changed, the rules guide (`docs/sdd/09-review-rules.md`) and the feature PRD and spec, and sends
  what it reads to **its provider** (OpenAI, for `codex`).
- Each review consumes the **quota of the account** logged in to the reviewer on the machine that
  runs it.
- MGR stores no credential of the reviewer. Authentication is the reviewer's own login.

## Commands

| Command | What it does |
|---|---|
| `mgr review enable [--reviewer <id>]` | turns it on for the project, after showing what changes and asking for confirmation in a terminal |
| `mgr review disable` | turns it off; `spec archive` is back to three conditions and the recorded proofs stay |
| `mgr review consent [--reviewer <id>]` | records **your** consent to send your code, once per person and project, after a confirmation in a terminal |
| `mgr review revoke [--reviewer <id>]` | removes your consent |
| `mgr review set [--reviewer <id>] --model <model> --effort <level>` | the model and effort the reviewer uses; with none set, the reviewer's own default applies |
| `mgr review status [--json]` | on or off, where the value came from, the reviewers, their options and your consent |
| `mgr review external <slug> --base <ref> [--reviewer <id>]` | reviews the feature: the files changed since `<ref>`, outside `specs/` |
| `mgr review waive <slug> --reason "<why>"` | waives the review of one feature after a reviewer failure, in a terminal |

`review external` and `review status` also run in the project runtime. The others change the
project policy or need a person at a terminal, so they run only through the lifecycle CLI.

`mgr install` and `mgr update` **never** turn it on. The install prints one line with its state.

## Turning it on: team and person

The two decisions live in different places on purpose:

- **The team turns on the requirement** (`review enable`), in `.mgr-core/config.json`, the team
  layer of the config. From then on, `spec archive` requires a valid external review.
- **Each person consents to sending their own code** (`review consent`), in
  `.mgr-core/config.local.json`, the personal layer, outside git. Without it, `review external`
  sends nothing and says why.

`review enable`, `review consent` and `review waive` always ask in a terminal, with "no" as the
default. In a non-interactive terminal they refuse and write nothing. There is no flag to skip
the confirmation.

## The proof

A successful review writes `specs/<slug>/external-review.json`. The file accumulates entries and
moves with the feature when it is archived:

- `review`: reviewer, version it reports, session id, base and HEAD commits, model and effort
  when set, and **every reviewed file with the sha256 of its content in that HEAD**, plus the
  findings and suggestions;
- `failure`: the reviewer failed (not installed, not logged in, failed, answered outside the
  format, no session id). It is not a review; it exists so a waiver can cite it;
- `waiver`: who waived, when, why, and the failure it follows.

The file hashes are read **before** the reviewer is called, pinned to that HEAD commit. If HEAD or
the working tree changes while the reviewer runs, nothing is recorded and the command asks you to
run it again.

A finding blocks only with a verbatim citation of a rule of `docs/sdd/09-review-rules.md` or a line
of the feature spec. A finding whose citation MGR cannot find in the source becomes a suggestion,
recorded with the rule or source and the quote the reviewer sent.

A review exits 0 with or without findings: the exit code says the review happened, not that the
code conforms. Each finding is then fixed, decided by `mgr-review`, or taken to a person; after two
rounds, what is still in disagreement goes to the person running the feature.

## `spec archive` with external review on

With it on, `spec archive` adds a **fourth condition**: the last `review` of the proof must cover
the current files, that is, every reviewed file must be identical in HEAD now. This also holds
after the merge. Each failure has its own reason, and nothing is moved:

- no review yet (with a hint to consent first when your consent is missing);
- the proof cannot be read;
- some reviewed file changed since the review: run it again;
- no git repository to check against.

It applies to **every** feature archived while it is on, including one that was ready before it
was turned on.

## Waiving

When the reviewer is down or the quota is exhausted, a person can waive the review of one feature:

```
mgr review waive <slug> --reason "quota exhausted until tomorrow"
```

- It is accepted only when the last entry of the proof is a reviewer `failure`: a waiver exists
  for a reviewer that is down, not to skip the review.
- It needs a reason and your initials (`mgr spec initials set <xx>`).
- `spec archive` then archives and prints, highlighted, that the feature was archived **without**
  external review, by whom, when and why. `spec status --archived` marks it.

## Known limits of this version

- **The proof is local and not cryptographic.** It shows the review happened over those files; it
  does not prevent someone from editing the file on purpose, or from turning the feature off to
  skip the fourth condition. A strong guarantee in CI is planned for after 1.0.
- **Another feature that changes the same files before the archive invalidates the proof.** Archive
  right after the merge.
- **Two writes to the same proof at the same time are not supported** (two reviews, or a review and a
  `review waive` whose confirmation is open): one may overwrite the entry of the other. Run them one
  after the other.
- **A citation is checked anywhere in the guide**, not only inside the item of the cited rule.
  Narrowing it is planned for 0.8.0.
- **Plugging another reviewer** means adding a reviewer sheet to the package; a sheet of your own in
  the project is not supported yet.
- **`spec-execute` does not call the review by itself yet.** In this version you run
  `review external`; the conditional step in `spec-execute` comes in 0.8.0.

// A classe vem do catalogo: sem a chave COMPUTADA, trocar o valor de uma constante faria as tres
// razoes cairem no fallback neutro em silencio, que e o que a CA-13 proibe (achado S-1 do gate).
import * as catalog from "./catalog.js";

// Mensagens da CLI em fonte única, por idioma de saída (userLanguage).
// `en` é o default (idioma canônico do pacote — ADR-0003); `pt-BR` preserva a
// experiência original. O núcleo não decide idioma: a borda resolve a precedência
// (flag > manifesto > locale) e passa a tabela pronta via getMessages().

const en = ({ invocation, lifecycle }) => ({
  unknownFlag: (flag) => `unknown flag: ${flag}`,
  unknownCommand: (command) => `unknown command: ${command}\n`,
  errorPrefix: (message) => `error: ${message}`,
  aborted: "aborted.",

  existingSkillsTitle: "Existing skills detected",
  invalidScope: (scope) => `invalid scope: ${scope}`,
  oldInstallWarn: (version) => `Old installation (v${version}, runtime-launcher model) detected — it will be MIGRATED to the new layout.`,
  resyncWarn: "Existing MGR installation detected — it will be re-synchronized.",
  planTitle: "Installation plan (self-contained per engine)",
  planProject: (projectId, scope) => `project:     ${projectId}    scope: ${scope}`,
  planEngines: (engines) => `engine(s):   ${engines}`,
  planStack: (language, architecture) => `language:    ${language}    architecture: ${architecture}`,
  planOutput: (lang) => `output:      ${lang}`,
  planOutputHint: "(skills output: conversation and artifacts)",
  planConfig: (dir) => `config   →   ${dir}`,
  planConfigHint: "(team: manifest.json + config.json · personal: config.local.json + .env)",
  planSkillsDir: (dir) => `skills   →   ${dir}`,
  planSkills: (count, list) => `skills (${count}): ${list}`,
  dryRun: "(dry-run: nothing was written.)",
  planAbandoned: (lines) => `leaving the declared set (${lines.length}) — removed only if you confirm:\n${lines.map((line) => `  ${line}`).join("\n")}`,
  removalReason: (name, klass) => `${name} — ${{
    [catalog.CLASS_ARCHITECTURE]: "architecture skill no longer selected",
    [catalog.CLASS_LANGUAGE]: "language helper no longer selected",
    [catalog.CLASS_OPTIONAL]: "optional skill no longer selected",
    [catalog.CLASS_UNCLASSIFIED]: "no longer in the declared set",
  }[klass] || "no longer in the declared set"}`,
  confirmRemoval: (count) => `Remove the ${count} skill(s) above from disk?`,
  removedSkills: (paths) => `Removed ${paths.length} skill(s): ${paths.join(" · ")}`,
  keptByChoice: (names) => `Nothing was removed: ${names.join(", ")} stayed on disk and stay declared, so nothing was orphaned.`,
  keptNoConsent: (names) => `Nothing was removed: there was no terminal to ask. ${names.join(", ")} stayed on disk and stay declared; \`-y\` authorizes the removal.`,
  keptNoSource: (names) => `This version no longer ships ${names.join(", ")}: they stay on disk, out of the manifest, and \`${invocation} doctor\` will report them as orphans.`,
  confirmInstall: "Confirm installation?",
  installing: "Installing skills into the engines",
  installedAt: (dirs) => `Skills installed at ${dirs}.`,
  migrationInfo: (count) => `Migration: old model removed (${count} item(s), including .mgr-core).`,
  done: "Done! Start with /spec-init, then /spec-create per feature.",

  statusOldModel: `runtime-launcher (OLD — run \`${lifecycle} update\` to migrate)`,
  statusProject: (id) => `  project: ${id}`,
  statusConfig: (dir) => `  config:  ${dir}`,
  statusStack: (language, architecture) => `  stack:   language=${language} architecture=${architecture}`,
  statusOutput: (lang) => `  output:  ${lang}`,
  statusSkillsDir: (dir) => `  skills:  ${dir}`,
  statusSkills: (list) => `  skills:  ${list}`,
  statusInstalledAt: (timestamp) => `  at:      ${timestamp}`,
  statusNone: "No MGR installation found (project or global).",

  updateMigrated: "(old installation migrated to the new layout)",
  updateDone: (scope, count, dirs) => `Re-synchronized (${scope}): ${count} skills at ${dirs}.`,

  uninstallConfirm: (scope) => `Remove the MGR installation (${scope})? docs/ and specs/ will be preserved.`,
  removedItem: (item) => `  removed: ${item}`,
  uninstalled: "Uninstalled.",

  buildDone: (dest, names) => `runtime built at ${dest}: ${names}`,

  bannerTagline: "AI Development Framework (SDD for coding agents)",
  bannerInstaller: (version) => `Installer v${version}`,
  bannerCreatedBy: (author, email) => `Created by ${author} · ${email}`,

  qEngines: "Which engines should receive the skills? (space marks, enter confirms)",
  qScope: "Installation scope?",
  scopeProjectHint: "in this repository",
  scopeGlobalHint: "for all projects (home)",
  qArchitecture: "Project architecture? (defines which arch-* skill to install)",
  qLanguage: "Main programming language? (defines specific helpers)",
  langOtherLabel: "other / unspecified",
  langOtherHint: "no language helpers",
  qOutputLanguage: "Output language? (conversation and artifacts generated by the skills)",
  outEnHint: "English",
  outPtHint: "Brazilian Portuguese",
  outOtherLabel: "other",
  outOtherHint: "specify which",
  qWhichLanguage: "Which language? (e.g. es-ES, fr-FR)",
  qOptionalEvidence: "Include the optional evidence-capture skill?",
  qProjectId: "MGR_PROJECT_ID (project identifier for the mgr-code memory)?",

  pluginProposalTitle: "Plugin skill to install",
  pluginProposalName: (name, version) => `skill:       ${name}@${version}`,
  pluginProposalOrigin: (registry, url) => `origin:      ${registry} (${url})`,
  pluginProposalTrust: (trusted) => `trusted:     ${trusted ? "yes" : "no"}`,
  pluginProposalCategory: (category) => `category:    ${category}`,
  pluginProposalPermissions: (permissions) => `permissions: ${permissions}`,
  pluginProposalChecksum: (checksum) => `checksum:    ${checksum}`,
  pluginProposalEngines: (engines) => `engine(s):   ${engines}`,
  pluginProposalExtends: (base) => `extends:     ${base} (installed together; the extending skill takes precedence)`,
  pluginNoPermissions: "none declared",
  pluginConfirm: "Install this skill?",
  pluginNeedsTty: `\`${lifecycle} add\` requires an interactive terminal: every install is confirmed by a human and there is no bypass flag.`,
  pluginInstalling: "Downloading and verifying",
  pluginInstalled: (name, dir) => `${name} installed at ${dir}.`,
  pluginWarning: (engine, warning) => `  warning (${engine}): ${warning}`,
  pluginLocked: (file) => `locked in ${file}.`,
  pluginCancelled: "installation cancelled by the user.",
  pluginRemoving: (name) => `Removing ${name} from the engines and the lockfile`,
  pluginCollisionQuestion: (methodSkill) => `The method already provides the skill "${methodSkill}" here. What should mgr do?`,
  pluginCollisionAlongside: "Install alongside",
  pluginCollisionAlongsideHint: (dir) => `plugin goes to ${dir}; the method skill stays`,
  pluginCollisionReplace: "Replace the method skill",
  pluginCollisionReplaceHint: (skill) => `plugin takes the ${skill} folder; recorded in the lockfile`,
  pluginRemoveReturns: (skill) => `  the method skill ${skill} comes back on the next \`${lifecycle} install\` or \`${lifecycle} update\``,
  statusPluginItemReplacing: (name, version, registry, skill) => `    ${name}@${version} (${registry}) — replaces the method skill ${skill}`,
  statusDivergenceTitle: "  divergences (lockfile vs disk):",
  statusDivergenceItem: (name) => `    ${name}: locked, but missing or different on disk`,
  statusDivergenceHint: `    run \`${lifecycle} install\` to restore the locked set`,
  pluginRemoveSkipped: (dir, name) => `  kept ${dir}: it does not carry ${name}'s manifest, so another skill owns that folder`,
  pluginRemoved: (name) => `${name} removed.`,
  pluginUsageAdd: `usage: ${lifecycle} add <@registry/skill>`,
  pluginUsageRemove: `usage: ${lifecycle} remove <@registry/skill>`,

  registryAdding: (name) => `Adding registry "${name}" to .mgr-core/config.json`,
  registryAdded: (name, url) => `registry "${name}" added: ${url}`,
  registryRemoving: (name) => `Removing registry "${name}" from .mgr-core/config.json`,
  registryRemoved: (name) => `registry "${name}" removed.`,
  registryListTitle: "Configured registries",
  registryListItem: (name, url, trusted) => `  ${name}${trusted ? " (trusted)" : ""}  ${url}`,
  registryListEmpty: `No registry configured — run \`${lifecycle} registry add <name> <index-url>\`.`,
  registryUsage: `usage: ${lifecycle} registry add <name> <index-url> [--trusted] | ${lifecycle} registry remove <name> | ${lifecycle} registry list`,

  pluginsInstalledTitle: "Installed plugin skills",
  pluginsInstalledItem: (name, version, registry, dir) => `  ${name}@${version}  (registry: ${registry}, folder: ${dir})`,
  pluginsAvailableTitle: "Available in the configured registries",
  pluginsAvailableItem: (name, version, category) => `  ${name}@${version}  [${category}]`,
  pluginsAvailableError: (registry, reason) => `  (registry "${registry}" unavailable: ${reason})`,
  statusPluginsTitle: (file) => `  plugins: ${file}`,
  statusPluginItem: (name, version, registry) => `    ${name}@${version} (${registry})`,

  restoring: (file) => `Restoring plugin skills from ${file}`,
  restoreDone: (count) => `${count} plugin skill(s) restored.`,
  restoreSkippedEngine: (name, engines) => `${name} is locked for ${engines}, not an active engine here; that copy was not restored`,

  detectTitle: "Detected in this project",
  detectItem: (ecosystem, evidence) => `  ${ecosystem}  (from ${evidence})`,
  detectNothing: "Nothing detected: no known project file found at the paths mgr looks at.",
  suggestTitle: "Plugin skills available for what was detected",
  suggestItem: (name, version, ecosystem, evidence) => `  ${name}@${version}  — ${ecosystem}, from ${evidence}`,
  suggestNone: "No skill in the configured registries matches what was detected.",
  suggestConfirm: (name) => `Install ${name}?`,
  suggestNonInteractive: `Not asking without an interactive terminal; install with \`${lifecycle} add <name>\`.`,
  suggestSkipped: "No skill installed from the suggestion.",
  planHooks: (files) => `hooks    →   ${files}`,
  planHooksHint: "(session detection and hand-off before compaction, per engine)",
  hookWritten: (file, events) => `  hooks written to ${file}: ${events}`,
  planRuntime: (dirs, n) => `MGR runtime → ${dirs}  (${n} files, readable, Node only)`,
  runtimeWritten: (dir, n) => `MGR runtime written to ${dir} (${n} files)`,
  runtimeMigrated: (version, dirs) => `Installation in the previous layout (v${version}, no runtime in the project) — the MGR runtime will be copied to ${dirs} and the skills will call it by explicit path.`,
  // Nomeia os eventos, e não "o hook": desde o ADR-0018 o arquivo carrega dois, e anunciar um só
  // esconderia do usuário metade do que o método tirou do arquivo dele.
  hookRemoved: (file, events) => `  hooks removed from ${file}: ${events}`,
  hookCopilotTrust: "Copilot only loads the repository hook after you trust the folder: the first session will ask, and nothing happens until you accept.",

  planGate: (dir) => `agents   →   ${dir}`,
  planGateHint: "(one agent per intent; the review runs in its own)",
  planAgentIntent: (intent, agent) => `  ${intent}: ${agent}`,
  planGateEngine: (engine, model, effort) => `  ${engine}: model=${model} effort=${effort}`,
  gateModelInherited: "inherits the session model",
  gateEffortInherited: "session effort",
  gateSkipped: (engine, capability) => `  ${engine}: ${capability} not supported by this engine — declared, not applied`,
  gateBlocked: (file) => `  not overwritten: ${file} exists and was not written by MGR`,
  agentWritten: (agent, file) => `  agent ${agent} written to ${file}`,
  planLaws: (file) => `laws     →   ${file}`,
  planLawsHint: "(execution laws: single source, pointed to by every CORE skill)",
  planPreambleOn: "  session preamble: on (the central laws enter before the first message)",
  planPreambleOff: "  session preamble: off (lawsPreamble.enabled = false)",
  statusLaws: (state) => `  laws:    ${state}`,
  specValidateOk: (tasks, criteria, files) => `${files} artifact(s): ${tasks} task(s) and ${criteria} acceptance criteria checked, no structural defect found.`,
  specValidateHeader: (file) => `${file}`,
  specValidateItem: (code, severity, task, line, message) =>
    `  ${severity === "error" ? "x" : "!"} ${code}${task ? ` ${task}` : ""}${line ? `:${line}` : ""} — ${message}`,
  specValidateFix: (text) => `      fix: ${text}`,
  specValidateExample: (text) => `      like: ${text}`,
  specValidateSummary: (errors, warnings) => `${errors} error(s), ${warnings} warning(s).`,
  specValidateNextSteps: `Next steps: fix the errors above and run \`${invocation} spec validate\` again.`,
  specValidateScopeNote:
    "This check is STRUCTURAL. It does not judge whether the plan is right, whether the tasks are the right ones, whether a done criterion is good, nor whether an acceptance criterion is testable or covers the spec.",
  specValidateNoSpecs: (dir) => `no spec found in ${dir}`,
  specNextTask: (id) => id,
  specNextFile: (file) => `${file}`,
  specNextArtifact: (text) => `  artifact:  ${text}`,
  specNextDoneWhen: (text) => `  done when: ${text}`,
  specNextSkill: (skill) => `  skill:     ${skill}`,
  specNextDependsOn: (ids) => `  after:     ${ids}`,
  specNextAllDone: (count) => `Nothing to do: all ${count} task(s) are marked done.`,
  specNextNothingReady: "Nothing is ready to start. Every pending task waits on something.",
  specNextBlocked: (id, waiting) => `  ${id} waits on ${waiting}`,
  specNextRunValidate: `In a valid plan this cannot happen: some task has no dependency and is ready. Run \`${invocation} spec validate\`.`,
  specNextNoTasks: "The plan declares the format but has no task.",
  specNextFormatNotDeclared:
    "This plan does not declare the format, so there is nothing to answer from. Add the marker on the first line and the fields the tasks already have become readable.",
  specNextBasis: (declared, total) => `State declared in ${declared} of ${total} task(s).`,
  specNextNoState: (total) => `State declared in 0 of ${total} task(s): this tool does NOT know what you have already done.`,
  specNextFirstStartable: "So this is the first task that CAN start, not necessarily the next one.",
  specNextNoPlan: (dir) => `no plan found in ${dir}`,
  tokensMissing: (files) => `transcript not found: ${files}`,
  tokensNoInput: "no transcript given — pass the conversation transcript, and each agent transcript after it",
  tokensTotal: (total) => `total          ${total}`,
  tokensConversation: (context, total) => `conversation   context ${context}  ·  ${total} counted`,
  tokensAgents: (total, count) => `agents         ${total}  ·  ${count} transcript(s)`,
  tokensCacheRead: (cache) => `cache read     ${cache}  (reported apart, never in the total)`,
  tokensNoBudget: "No ceiling declared in `agents.budget.totalTokens`: measured, not judged.",
  tokensWithin: (total, budget) => `Within the declared ceiling: ${total} of ${budget}.`,
  tokensOver: (total, budget) => `OVER the declared ceiling: ${total} against ${budget}.`,
  agentsIntent: (intent, agent) => `${intent.padEnd(10)} ${agent}`,
  agentsEngine: (engine, model, effort) => `  ${engine.padEnd(12)} model=${model}  effort=${effort}`,
  agentChanged: (agent, engine, field, from, to) =>
    `  ${agent} (${engine}): ${field} from ${from} to ${to}`,
  agentCreated: (agent, engine) => `  ${agent} (${engine}): written for the first time`,
  agentsValueFrom: (value, source) => `${value} (${source})`,
  agentsUnsupported: "not supported by this engine",
  agentsSourceConfigured: "configured",
  agentsSourceDefault: "default",
  agentsInherited: "inherited from the session",
  agentsInheritWarning: (intents) =>
    `Running on the session model: ${intents}. No model is published by default — the list of `
    + `models belongs to your account, not to this tool. Declare one per intent in `
    + `\`.mgr-core/config.json\` to get the benefit.`,
  agentsEffortNote:
    `Changing \`effort\` only takes effect after \`${invocation} agents apply\`: it lives in the agent file, and the `
    + "invocation cannot override it. Changing `model` takes effect on the next invocation.",
  agentsAliasNote:
    "`reviewGate` and `agents.review` are both set: `agents.review` wins. Remove `reviewGate` to "
    + "keep one source.",
  agentsUnknown: (intent, known) => `unknown intent \`${intent}\` (expected ${known})`,
  agentsSetNeedsIntent: (known) => `name the intent to configure (expected ${known})`,
  agentsSetWriting: (intent) => `Writing \`agents.${intent}\` to .mgr-core/config.json`,
  precompactWrote: (file, slug) =>
    `Context compaction is about to happen. Hand-off for \`${slug}\` written to ${file}.`,
  precompactWroteBlocked: (file, slug) =>
    `Compaction stopped this time. Hand-off for \`${slug}\` written to ${file}.`,
  precompactNothingToSave:
    "Context compaction is about to happen. No feature in progress, so nothing was written.",
  precompactSuggestNewSession:
    "Start a NEW session and resume from the hand-off: what follows in this window comes from a "
    + "summary, not from the original context.",
  precompactBlocked: (file) =>
    `Compaction blocked by MGR: you asked for it, and the state is safe on disk (${file}). `
    + "Start a new session and resume from it. If you still want to compact, ask again and it will "
    + "go through.",
  precompactProceeding:
    "Compacting: you asked again, and the hand-off on disk is current. What follows in this window "
    + "comes from a summary.",
  // Logs do comando de hook (LOG-1/LOG-2). Vão para o stderr, que a doc do claude-code manda para o
  // debug log quando o hook sai 0 — destino de diagnóstico, e não canal de usuário.
  precompactLogContextBefore: (file) => `referencing the conversation context in ${file}`,
  precompactLogContextAfter: (file, entries) => `context referenced in ${file} (${entries} entries)`,
  precompactContextReferenced: ({ file, records, bytes, artifacts }) =>
    `Context of this session referenced in ${file}: ${records} records, ${bytes} bytes`
    + `${artifacts ? `, plus ${artifacts} session file(s)` : ""}. The extended memory was NOT `
    + "consulted: consolidation into mgr-code happens later. The method POINTS at the context, it "
    + "does not keep it — clearing the engine history loses what the reference pointed to.",
  precompactContextMissed: (reason) =>
    `The conversation context could NOT be referenced (${reason}): the hand-off was still written.`,
  precompactContextRecovered:
    "The previous context manifest was corrupt and had to be replaced: references not yet "
    + "consolidated were lost.",
  precompactLogGitBefore: "reading the git working tree",
  precompactLogGitAfter: (count) => `git reported ${count} uncommitted file(s)`,
  precompactLogWriteBefore: (file) => `writing the hand-off to ${file}`,
  precompactLogWriteAfter: (file, appended) =>
    `hand-off ${appended ? "appended to" : "created at"} ${file}`,
  precompactLogStampBefore: "writing the refusal stamp",
  precompactLogStampAfter: "refusal stamp written",
  agentsSetNothing: "nothing to write: pass `--model`, `--effort`, or both",
  originWriting: (dir) => `Writing the project origin to ${dir}/config.json`,
  originSetNeedsValue: (validos) => `${invocation} origin set needs a value (${validos})`,
  originUnknown: (valor, validos) => `unknown project origin: ${valor} (expected ${validos})`,
  originWritten: (antes, depois) => `project origin: ${antes} -> ${depois}`,
  originNoInstall: (dir) => `no MGR installation found at ${dir}; writing the origin anyway (this is the global-scope case).`,
  agentsSetEngineNotInstalled: (engine, installed) =>
    `engine \`${engine}\` is not installed in this project`
    + (installed ? ` (installed: ${installed})` : ""),
  // Sem motor instalado, `--engine` não é saída: o laço acima recusa qualquer motor que não esteja
  // no manifesto. Aconselhar um caminho que não leva a lugar nenhum é pior que não aconselhar.
  agentsSetNoEngines: `no engine installed in this project: run \`${lifecycle} install\` first`,
  agentsSetWritten: (intent, agent) => `written to \`agents.${intent}\` — ${agent}`,
  agentsSetModelEffect: "`model` takes effect on the next invocation.",
  agentsSetEffortEffect:
    `\`effort\` only takes effect after \`${invocation} agents apply\`: it lives in the agent file, and the `
    + "invocation cannot override it.",
  specNextAllRefused: `\`${invocation} spec next\` does not accept \`--all\`: the next action is about ONE feature — name one, or run it from inside \`specs/<slug>/\``,
  runtimeLifecycleRefused: (cmd) => `${cmd} is a lifecycle command and does not run in the project runtime: run ${lifecycle} ${cmd}`,
  runtimeUnknownCommand: (cmd) => `unknown command: ${cmd}`,
  runtimeUnknownSpecSub: (sub) => `unknown command: spec ${sub}`.trim(),
  runtimeDetectNeedsHook: () => "detect requires --hook <engine>",
  runtimeHelp: [
    "mgr-method project runtime",
    "",
    "  spec status|validate|next",
    "  agents [<intent>|set|apply]",
    "  origin set <value>",
    "  origin [--json]",
    "  doctor",
    "  sdd-check",
    "  detect --hook <engine>",
    "  precompact --hook <engine>",
    "  version",
    "",
    `Lifecycle commands (install, update, add...) run through ${lifecycle}.`,
    "",
  ].join("\n"),
  specNextNeedsSlug: (count) => `${count} feature(s) in specs/ and none was named — name one, or run this from inside \`specs/<slug>/\``,
  specStatusRoot: (root) => `${root}`,
  specStatusArtifacts: (linha) => `  artifacts: ${linha}`,
  specStatusNextReady: (ids) => `  to write:  ${ids}`,
  specStatusNothingReady: "  to write:  nothing — every artifact is on disk",
  specStatusHandoffNone: "  handoff:   none",
  specStatusHandoffOn: (file) => `  handoff:   ${file} (on disk; it is never removed automatically)`,
  specStatusLine: (slug, resumo) => `  ${slug.padEnd(26)} ${resumo}`,
  doctorSemInstalacao: "no MGR installation here: nothing to compare against",
  doctorResumo: (checks, achados) => `  ${checks} checks, ${achados} finding(s).`,
  doctorNaoAtesta: "  No finding means the checks I run found nothing, never that the install is sound.",
  specStatusWarning:
    "This is FILE EXISTENCE, not progress. It does not know which checkpoint you approved, and an artifact on disk is not an approved artifact.",
  specStatusNotFound: (slug) => `no feature \`${slug}\` in specs/`,
  specStatusEmpty: (dir) => `no feature found in ${dir}`,
  gateKept: (file) => `  kept: ${file} lost the MGR marker and was left untouched`,
  statusGate: (state) => `  gate:    ${state}`,
  statusGateOff: "off (every intent disabled in `agents`)",
  statusGateEngine: (engine, model, effort) => `    ${engine}: model=${model} effort=${effort}`,
  statusGateSource: (source) => `    from: ${source}`,
  sddCheckNoDir: () => "SDD INCOMPLETE: docs/sdd/ does not exist — run the spec-init skill first",
  sddCheckNoConstitution: () => "SDD INCOMPLETE: docs/sdd/CONSTITUTION.md missing — run spec-init and review the constitution",
  sddCheckEmpty: () => "SDD INCOMPLETE: docs/sdd/ is empty",
  sddCheckNoReviewRules: () => "warning: docs/sdd/09-review-rules.md missing — code-analyzer will operate without the project guide",
  sddCheckOk: (dir) => `SDD OK: project initialized (${dir})`,
  agentsApplyMissing: (file, version) => `${file} does not exist: run npx mgr-method@${version} update`,
  agentsApplyNotOwned: (file) => `${file} was not written by MGR (no mgr-managed-agent marker): left untouched`,
  agentsApplyWriting: (file) => `Rewriting the agent frontmatter in ${file}`,
  agentsApplyWritten: (file) => `Agent frontmatter rewritten: ${file}`,

  // §4.2 da spec F2: config em duas camadas, update que converge e marca de posse.
  installModelSkipped: (intents) => `No model recorded for: ${intents}. These agents inherit the session model. To declare one: \`${invocation} agents set <intent> --model <id>\` (or the configure-agents skill).`,
  installOriginAbsent: `Project origin not recorded: the reviewer treats it as unknown. To record it: \`${invocation} origin set greenfield|brownfield\` (spec-init also asks).`,
  updateSkillEntering: (name) => `skill entering: ${name}`,
  updateSkillLeaving: (line) => `skill leaving: ${line}`,
  updateOrphanOffered: (rel, ev) => `orphan offered for removal: ${rel} (${ev})`,
  orphanEvidenceMarked: "carries the MGR ownership mark",
  orphanEvidenceDistributed: "a name mgr-method ships, absent from the manifest and from mgr-skills.lock",
  updateOutOfReach: (list) => `out of reach, origin unknown (not offered): ${list}`,
  confirmRemoveOne: (rel) => `Remove ${rel}?`,
  hookEventAdded: (file, event) => `hook event added to ${file}: ${event}`,
  updateDivergent: (version, names) => `Still diverging from what v${version} decides: ${names}. Run \`${lifecycle} update\` in a terminal to decide item by item.`,
  configMigrated: (version, file) => `Installation in the previous layout (v${version}, single-layer config) — projectId leaves the versioned manifest and moves to ${file}, which is personal; the skills now carry the ownership mark.`,
  personalKeysIgnored: (file, keys) => `${file}: ${keys} belong to the team config (.mgr-core/config.json) and were ignored.`,
  gitignoreWritten: (file) => `personal MGR files ignored in ${file} (managed block)`,
  gitignoreDeclined: (lines) => `.gitignore left unchanged. Keep these out of version control: ${lines}`,
  gitignoreTeamIgnored: (line) => `.gitignore line "${line}" ignores the team config (.mgr-core/config.json): the model policy and the origin will not travel with the repository.`,
  gitignoreRemoved: (file) => `managed block removed from ${file}`,

  // Textos fixados no CHECKPOINT 3 da P0.7 (lacunas L-1 a L-6).
  projectIdPersonal: ".mgr-core/config.json: projectId is personal and belongs in .mgr-core/config.local.json; it was ignored.",
  qModel: (intent, engine) => `Model for ${intent} (${engine})`,
  modelOtherLabel: "other (type the identifier)",
  modelSkipLabel: "skip — agents inherit the session model",
  qModelIdentifier: (intent, engine) => `Model identifier for ${intent} (${engine}), empty to skip`,
  qOrigin: "Project origin (sets the weight of review findings)",
  originGreenfieldOption: "greenfield — new project",
  originBrownfieldOption: "brownfield — existing code",
  originSkipOption: "skip — not recorded",
  planOrigin: (value) => `origin → ${value}`,
  planOriginNotRecorded: "origin → not recorded",
  planGitignore: ".gitignore → managed block with .mgr-core/config.local.json and .mgr-core/.env",
  qGitignoreBlock: "Add the managed block to .gitignore (personal config stays out of version control)?",
  originRecorded: (value) => `project origin: ${value} (.mgr-core/config.json)`,
  originNotRecorded: `project origin: not recorded — run ${invocation} origin set greenfield|brownfield`,
  originInvalid: (value) => `project origin: invalid value ${value} in .mgr-core/config.json`,
  hookEventToAdd: (file, event) => `hook event to add in ${file}: ${event}`,
  hookCommandToRewrite: (file, event) => `hook command to rewrite in ${file}: ${event}`,
  enteringBlockedByPlugin: (rel, name) => `kept ${rel}: a plugin owns that folder, so ${name} was not installed`,
  modelFlagNeedsEngineValues: (intent) => `--model-${intent} needs one value per engine when more than one engine takes a model: --model-${intent} claude-code=<id>,copilot=<id>`,
  modelFlagMalformed: (intent, value) => `--model-${intent}: "${value}" is neither one model id nor a list of engine=id pairs`,
  modelFlagNoModelEngine: (intent, list) => `--model-${intent}: none of the chosen engines (${list}) takes a model`,
  personalKeysUnknown: (file, keys) => `${file}: ${keys} is not a recognized key and was ignored.`,
  confirmReplaceOne: (rel, name) => `Replace ${rel} (not installed by mgr-method) with the shipped ${name}?`,
  modelFlagEngineNotChosen: (intent, engine, chosen) => `--model-${intent}: engine ${engine} was not chosen for this install (chosen: ${chosen})`,

  help: `MGR — Método Governado por Rastreabilidade (Traceability-Governed Method)

Usage: mgr <command> [options]

  install [repo]   installs the skills (selective) straight into the engine folder
                   (--engine claude-code|copilot|both, --scope, --language, --arch,
                    --user-language, --project-id, --all-skills, --skills-dir, --dry-run, -y)
  status [repo]    shows what is installed
  update [repo]    re-synchronizes (--scope)
  uninstall [repo] removes the installed skills (--scope, -y)
  build            generates a directory with the full content (--out)
  validate         validates the SKILL.md files (skill authoring)
  audit            infers each skill's dangerous capabilities and compares with what it declares
  doctor           checks whether the installation is intact, and never writes anything
  sdd-check        confirms the project was initialized for SDD (docs/sdd/)
  spec validate    validates this project's plan and spec artifacts
                   ([<slug>], --all, --strict, --json)
  spec next        the next action from the plan ([<slug>], --json)
  spec status      which artifacts exist ([<slug>], --all, --json)
  agents           which model and effort each intent uses, and where each
                   value came from ([<intent>], --json)
  agents set       writes one intent's policy (<intent>, --model, --effort,
                   --engine); it does not run ${lifecycle} update
  agents apply     rewrites each agent's model and effort from the config, offline
  origin set       records whether the project was born from the method or is
                   legacy (<greenfield|brownfield>); it does not run ${lifecycle} update
  origin [--json]  reads the recorded origin: recorded, absent or invalid (exit 1)
  precompact       writes the hand-off before the engine compacts the context
                   (--hook <engine>); called by the hook, not by hand
  tokens           how much the flow consumed: pass the conversation
                   transcript, then each agent transcript (--json)
  list             lists the skills
  version          shows the version

Plugin skills (https://github.com/maurigre/mgr-method/blob/main/docs/plugins.md):

  add <@registry/skill>       installs a plugin skill (always asks for confirmation)
  remove <@registry/skill>    removes a plugin skill
  registry add <name> <url> [--trusted] | remove <name> | list
                              manages the registries in .mgr-core/config.json
  detect [repo]               shows what the project needs and what the registries offer
                              (--hook <engine> emits the session-hook report)
`,
});

const ptBR = ({ invocation, lifecycle }) => ({
  unknownFlag: (flag) => `flag desconhecida: ${flag}`,
  unknownCommand: (command) => `comando desconhecido: ${command}\n`,
  errorPrefix: (message) => `erro: ${message}`,
  aborted: "abortado.",

  existingSkillsTitle: "Skills existentes detectadas",
  invalidScope: (scope) => `escopo inválido: ${scope}`,
  oldInstallWarn: (version) => `Instalação antiga (v${version}, modelo runtime-launcher) detectada — será MIGRADA para o novo layout.`,
  resyncWarn: "Instalação MGR existente detectada — será re-sincronizada.",
  planTitle: "Plano de instalação (autossuficiente por motor)",
  planProject: (projectId, scope) => `projeto:     ${projectId}    escopo: ${scope}`,
  planEngines: (engines) => `motor(es):   ${engines}`,
  planStack: (language, architecture) => `linguagem:   ${language}    arquitetura: ${architecture}`,
  planOutput: (lang) => `idioma:      ${lang}`,
  planOutputHint: "(saída das skills: conversa e artefatos)",
  planConfig: (dir) => `config   →   ${dir}`,
  planConfigHint: "(time: manifest.json + config.json · pessoal: config.local.json + .env)",
  planSkillsDir: (dir) => `skills   →   ${dir}`,
  planSkills: (count, list) => `skills (${count}): ${list}`,
  dryRun: "(dry-run: nada foi escrito.)",
  planAbandoned: (lines) => `sai do conjunto declarado (${lines.length}) — só com a sua confirmação:\n${lines.map((line) => `  ${line}`).join("\n")}`,
  removalReason: (name, klass) => `${name} — ${{
    [catalog.CLASS_ARCHITECTURE]: "skill de arquitetura que saiu da seleção",
    [catalog.CLASS_LANGUAGE]: "helper de linguagem que saiu da seleção",
    [catalog.CLASS_OPTIONAL]: "skill opcional que saiu da seleção",
    [catalog.CLASS_UNCLASSIFIED]: "fora do conjunto declarado",
  }[klass] || "fora do conjunto declarado"}`,
  confirmRemoval: (count) => `Remover do disco a(s) ${count} skill(s) acima?`,
  removedSkills: (paths) => `Removida(s) ${paths.length} skill(s): ${paths.join(" · ")}`,
  keptByChoice: (names) => `Nada foi removido: ${names.join(", ")} ficou(aram) em disco e segue(m) declarada(s), então nada virou órfã.`,
  keptNoConsent: (names) => `Nada foi removido: não havia terminal para perguntar. ${names.join(", ")} ficou(aram) em disco e segue(m) declarada(s); o \`-y\` autoriza a remoção.`,
  keptNoSource: (names) => `Esta versão já não distribui ${names.join(", ")}: ficou(aram) em disco, fora do manifesto, e o \`${invocation} doctor\` vai reportá-la(s) como órfã(s).`,
  confirmInstall: "Confirmar instalação?",
  installing: "Instalando skills nos motores",
  installedAt: (dirs) => `Skills instaladas em ${dirs}.`,
  migrationInfo: (count) => `Migração: modelo antigo removido (${count} item(ns), incluindo .mgr-core).`,
  done: "Pronto! Comece com /spec-init e depois /spec-create por feature.",

  statusOldModel: `runtime-launcher (ANTIGO — rode \`${lifecycle} update\` para migrar)`,
  statusProject: (id) => `  projeto: ${id}`,
  statusConfig: (dir) => `  config:  ${dir}`,
  statusStack: (language, architecture) => `  stack:   linguagem=${language} arquitetura=${architecture}`,
  statusOutput: (lang) => `  idioma:  ${lang}`,
  statusSkillsDir: (dir) => `  skills:  ${dir}`,
  statusSkills: (list) => `  skills:  ${list}`,
  statusInstalledAt: (timestamp) => `  em:      ${timestamp}`,
  statusNone: "Nenhuma instalação MGR encontrada (projeto ou global).",

  updateMigrated: "(instalação antiga migrada para o novo layout)",
  updateDone: (scope, count, dirs) => `Re-sincronizado (${scope}): ${count} skills em ${dirs}.`,

  uninstallConfirm: (scope) => `Remover instalação MGR (${scope})? docs/ e specs/ serão preservados.`,
  removedItem: (item) => `  removido: ${item}`,
  uninstalled: "Desinstalado.",

  buildDone: (dest, names) => `runtime construído em ${dest}: ${names}`,

  bannerTagline: "AI Development Framework (SDD para agentes de código)",
  bannerInstaller: (version) => `Instalador v${version}`,
  bannerCreatedBy: (author, email) => `Criado por ${author} · ${email}`,

  qEngines: "Quais motores devem receber as skills? (espaço marca, enter confirma)",
  qScope: "Escopo da instalação?",
  scopeProjectHint: "neste repositório",
  scopeGlobalHint: "para todos os projetos (home)",
  qArchitecture: "Arquitetura do projeto? (define qual skill arch-* instalar)",
  qLanguage: "Linguagem principal? (define helpers específicos)",
  langOtherLabel: "outra / não especificar",
  langOtherHint: "sem helpers de linguagem",
  qOutputLanguage: "Idioma de saída? (conversa e artefatos gerados pelas skills)",
  outEnHint: "inglês",
  outPtHint: "português do Brasil",
  outOtherLabel: "outro",
  outOtherHint: "informar qual",
  qWhichLanguage: "Qual idioma? (ex.: es-ES, fr-FR)",
  qOptionalEvidence: "Incluir a skill opcional evidence-capture?",
  qProjectId: "MGR_PROJECT_ID (identificador do projeto para a memória do mgr-code)?",

  pluginProposalTitle: "Skill plugável a instalar",
  pluginProposalName: (name, version) => `skill:       ${name}@${version}`,
  pluginProposalOrigin: (registry, url) => `origem:      ${registry} (${url})`,
  pluginProposalTrust: (trusted) => `confiável:   ${trusted ? "sim" : "não"}`,
  pluginProposalCategory: (category) => `categoria:   ${category}`,
  pluginProposalPermissions: (permissions) => `permissões:  ${permissions}`,
  pluginProposalChecksum: (checksum) => `checksum:    ${checksum}`,
  pluginProposalEngines: (engines) => `motor(es):   ${engines}`,
  pluginProposalExtends: (base) => `estende:     ${base} (instalada junto; a skill que estende tem precedência)`,
  pluginNoPermissions: "nenhuma declarada",
  pluginConfirm: "Instalar esta skill?",
  pluginNeedsTty: `\`${lifecycle} add\` exige terminal interativo: toda instalação é confirmada por uma pessoa e não há flag de bypass.`,
  pluginInstalling: "Baixando e verificando",
  pluginInstalled: (name, dir) => `${name} instalada em ${dir}.`,
  pluginWarning: (engine, warning) => `  aviso (${engine}): ${warning}`,
  pluginLocked: (file) => `travada em ${file}.`,
  pluginCancelled: "instalação cancelada pelo usuário.",
  pluginRemoving: (name) => `Removendo ${name} dos motores e do lockfile`,
  pluginCollisionQuestion: (methodSkill) => `O método já fornece a skill "${methodSkill}" aqui. O que o mgr deve fazer?`,
  pluginCollisionAlongside: "Instalar ao lado",
  pluginCollisionAlongsideHint: (dir) => `o plugin vai para ${dir}; a skill do método fica`,
  pluginCollisionReplace: "Substituir a skill do método",
  pluginCollisionReplaceHint: (skill) => `o plugin ocupa a pasta ${skill}; fica registrado no lockfile`,
  pluginRemoveReturns: (skill) => `  a skill ${skill} do método volta no próximo \`${lifecycle} install\` ou \`${lifecycle} update\``,
  statusPluginItemReplacing: (name, version, registry, skill) => `    ${name}@${version} (${registry}) — substitui a skill ${skill} do método`,
  statusDivergenceTitle: "  divergências (lockfile x disco):",
  statusDivergenceItem: (name) => `    ${name}: travada no lockfile, ausente ou diferente no disco`,
  statusDivergenceHint: `    rode \`${lifecycle} install\` para restaurar o conjunto travado`,
  pluginRemoveSkipped: (dir, name) => `  preservado ${dir}: não tem o manifest de ${name}, então a pasta é de outra skill`,
  pluginRemoved: (name) => `${name} removida.`,
  pluginUsageAdd: `uso: ${lifecycle} add <@registry/skill>`,
  pluginUsageRemove: `uso: ${lifecycle} remove <@registry/skill>`,

  registryAdding: (name) => `Adicionando o registry "${name}" ao .mgr-core/config.json`,
  registryAdded: (name, url) => `registry "${name}" adicionado: ${url}`,
  registryRemoving: (name) => `Removendo o registry "${name}" de .mgr-core/config.json`,
  registryRemoved: (name) => `registry "${name}" removido.`,
  registryListTitle: "Registries configurados",
  registryListItem: (name, url, trusted) => `  ${name}${trusted ? " (confiável)" : ""}  ${url}`,
  registryListEmpty: `Nenhum registry configurado — rode \`${lifecycle} registry add <nome> <url-do-index>\`.`,
  registryUsage: `uso: ${lifecycle} registry add <nome> <url-do-index> [--trusted] | ${lifecycle} registry remove <nome> | ${lifecycle} registry list`,

  pluginsInstalledTitle: "Skills plugáveis instaladas",
  pluginsInstalledItem: (name, version, registry, dir) => `  ${name}@${version}  (registry: ${registry}, pasta: ${dir})`,
  pluginsAvailableTitle: "Disponíveis nos registries configurados",
  pluginsAvailableItem: (name, version, category) => `  ${name}@${version}  [${category}]`,
  pluginsAvailableError: (registry, reason) => `  (registry "${registry}" indisponível: ${reason})`,
  statusPluginsTitle: (file) => `  plugins: ${file}`,
  statusPluginItem: (name, version, registry) => `    ${name}@${version} (${registry})`,

  restoring: (file) => `Restaurando skills plugáveis de ${file}`,
  restoreDone: (count) => `${count} skill(s) plugável(is) restaurada(s).`,
  restoreSkippedEngine: (name, engines) => `${name} está travada para ${engines}, motor não ativo aqui; essa cópia não foi restaurada`,

  detectTitle: "Detectado neste projeto",
  detectItem: (ecosystem, evidence) => `  ${ecosystem}  (por ${evidence})`,
  detectNothing: "Nada detectado: nenhum arquivo de projeto conhecido nos caminhos que o mgr consulta.",
  suggestTitle: "Skills plugáveis disponíveis para o que foi detectado",
  suggestItem: (name, version, ecosystem, evidence) => `  ${name}@${version}  — ${ecosystem}, por ${evidence}`,
  suggestNone: "Nenhuma skill dos registries configurados corresponde ao que foi detectado.",
  suggestConfirm: (name) => `Instalar ${name}?`,
  suggestNonInteractive: `Sem terminal interativo não há pergunta; instale com \`${lifecycle} add <nome>\`.`,
  suggestSkipped: "Nenhuma skill instalada a partir da sugestão.",
  planHooks: (files) => `hooks    →   ${files}`,
  planHooksHint: "(detecção por sessão e hand-off antes da compactação, por motor)",
  hookWritten: (file, events) => `  hooks gravados em ${file}: ${events}`,
  planRuntime: (dirs, n) => `Runtime do MGR → ${dirs}  (${n} arquivos, legível, só Node)`,
  runtimeWritten: (dir, n) => `runtime do MGR gravado em ${dir} (${n} arquivos)`,
  runtimeMigrated: (version, dirs) => `Instalação no layout anterior (v${version}, sem runtime no projeto) — o runtime do MGR será copiado para ${dirs} e as skills passarão a chamá-lo por caminho explícito.`,
  // Nomeia os eventos, e não "o hook": desde o ADR-0018 o arquivo carrega dois, e anunciar um só
  // esconderia do usuário metade do que o método tirou do arquivo dele.
  hookRemoved: (file, events) => `  hooks removidos de ${file}: ${events}`,
  hookCopilotTrust: "O Copilot só carrega o hook do repositório depois que você confia na pasta: a primeira sessão vai perguntar, e nada acontece até você aceitar.",

  planGate: (dir) => `agentes  →   ${dir}`,
  planGateHint: "(um agente por intenção; a revisão roda no próprio)",
  planAgentIntent: (intent, agent) => `  ${intent}: ${agent}`,
  planGateEngine: (engine, model, effort) => `  ${engine}: modelo=${model} esforço=${effort}`,
  gateModelInherited: "herda o modelo da sessão",
  gateEffortInherited: "esforço da sessão",
  gateSkipped: (engine, capability) => `  ${engine}: ${capability} não suportado por este motor — declarado, não aplicado`,
  gateBlocked: (file) => `  não sobrescrito: ${file} já existe e não foi escrito pelo MGR`,
  agentWritten: (agent, file) => `  agente ${agent} gravado em ${file}`,
  planLaws: (file) => `leis     →   ${file}`,
  planLawsHint: "(leis de execução: fonte única, apontada por toda skill do CORE)",
  planPreambleOn: "  preâmbulo de sessão: ligado (as leis centrais entram antes da primeira mensagem)",
  planPreambleOff: "  preâmbulo de sessão: desligado (lawsPreamble.enabled = false)",
  statusLaws: (state) => `  leis:    ${state}`,
  specValidateOk: (tasks, criteria, files) => `${files} artefato(s): ${tasks} task(s) e ${criteria} critérios de aceitação conferidos, nenhum defeito estrutural encontrado.`,
  specValidateHeader: (file) => `${file}`,
  specValidateItem: (code, severity, task, line, message) =>
    `  ${severity === "error" ? "x" : "!"} ${code}${task ? ` ${task}` : ""}${line ? `:${line}` : ""} — ${message}`,
  specValidateFix: (text) => `      corrija: ${text}`,
  specValidateExample: (text) => `      assim: ${text}`,
  specValidateSummary: (errors, warnings) => `${errors} erro(s), ${warnings} aviso(s).`,
  specValidateNextSteps: `Próximos passos: corrija os erros acima e rode \`${invocation} spec validate\` de novo.`,
  specValidateScopeNote:
    "Esta verificação é ESTRUTURAL. Ela não julga se o plano está certo, se as tasks são as certas, se um critério de done é bom, nem se um critério de aceitação é testável ou cobre a spec.",
  specValidateNoSpecs: (dir) => `nenhuma spec encontrada em ${dir}`,
  specNextTask: (id) => id,
  specNextFile: (file) => `${file}`,
  specNextArtifact: (text) => `  artefato:  ${text}`,
  specNextDoneWhen: (text) => `  pronta em: ${text}`,
  specNextSkill: (skill) => `  skill:     ${skill}`,
  specNextDependsOn: (ids) => `  depois de: ${ids}`,
  specNextAllDone: (count) => `Nada a fazer: as ${count} task(s) estão marcadas como concluídas.`,
  specNextNothingReady: "Nada pronto para começar. Toda task pendente espera por algo.",
  specNextBlocked: (id, waiting) => `  ${id} espera por ${waiting}`,
  specNextRunValidate: `Num plano válido isto não acontece: alguma task não depende de nada e está pronta. Rode \`${invocation} spec validate\`.`,
  specNextNoTasks: "O plano declara o formato mas não tem nenhuma task.",
  specNextFormatNotDeclared:
    "Este plano não declara o formato, então não há de onde responder. Acrescente o marcador na primeira linha e os campos que as tasks já têm passam a ser lidos.",
  specNextBasis: (declared, total) => `Estado declarado em ${declared} de ${total} task(s).`,
  specNextNoState: (total) => `Estado declarado em 0 de ${total} task(s): esta ferramenta NÃO sabe o que você já fez.`,
  specNextFirstStartable: "Então esta é a primeira task que PODE começar, não necessariamente a próxima.",
  specNextNoPlan: (dir) => `nenhum plano encontrado em ${dir}`,
  tokensMissing: (files) => `transcript não encontrado: ${files}`,
  tokensNoInput: "nenhum transcript informado — passe o transcript da conversa e, depois dele, o de cada agente",
  tokensTotal: (total) => `total          ${total}`,
  tokensConversation: (context, total) => `conversa       contexto ${context}  ·  ${total} contados`,
  tokensAgents: (total, count) => `agentes        ${total}  ·  ${count} transcript(s)`,
  tokensCacheRead: (cache) => `cache lido     ${cache}  (reportado à parte, nunca no total)`,
  tokensNoBudget: "Nenhum teto declarado em `agents.budget.totalTokens`: medido, não julgado.",
  tokensWithin: (total, budget) => `Dentro do teto declarado: ${total} de ${budget}.`,
  tokensOver: (total, budget) => `ACIMA do teto declarado: ${total} contra ${budget}.`,
  agentsIntent: (intent, agent) => `${intent.padEnd(10)} ${agent}`,
  agentsEngine: (engine, model, effort) => `  ${engine.padEnd(12)} modelo=${model}  esforço=${effort}`,
  agentChanged: (agent, engine, field, from, to) =>
    `  ${agent} (${engine}): ${field} de ${from} para ${to}`,
  agentCreated: (agent, engine) => `  ${agent} (${engine}): gravado pela primeira vez`,
  agentsValueFrom: (value, source) => `${value} (${source})`,
  agentsUnsupported: "não suportado por este motor",
  agentsSourceConfigured: "configurado",
  agentsSourceDefault: "default",
  agentsInherited: "herdado da sessão",
  agentsInheritWarning: (intents) =>
    `Rodando no modelo da sessão: ${intents}. Nenhum modelo é publicado por default — a lista de `
    + `modelos é da sua conta, não desta ferramenta. Declare um por intenção em `
    + `\`.mgr-core/config.json\` para ter o benefício.`,
  agentsEffortNote:
    `Mudar o \`effort\` só passa a valer depois de \`${invocation} agents apply\`: ele vive no arquivo do agente, e a `
    + "invocação não tem como sobrepô-lo. Mudar o `model` vale já na próxima invocação.",
  agentsAliasNote:
    "`reviewGate` e `agents.review` estão os dois escritos: `agents.review` vence. Apague o "
    + "`reviewGate` para ficar com uma fonte só.",
  agentsUnknown: (intent, known) => `intenção \`${intent}\` desconhecida (esperado ${known})`,
  agentsSetNeedsIntent: (known) => `diga a intenção a configurar (esperado ${known})`,
  agentsSetWriting: (intent) => `Escrevendo \`agents.${intent}\` em .mgr-core/config.json`,
  precompactWrote: (file, slug) =>
    `A compactação de contexto vai acontecer. Hand-off de \`${slug}\` gravado em ${file}.`,
  precompactWroteBlocked: (file, slug) =>
    `A compactação foi impedida desta vez. Hand-off de \`${slug}\` gravado em ${file}.`,
  precompactNothingToSave:
    "A compactação de contexto vai acontecer. Nenhuma feature em andamento, então nada foi gravado.",
  precompactSuggestNewSession:
    "Abra uma sessão NOVA e retome pelo hand-off: o que vier depois nesta janela vem de um resumo, "
    + "e não do contexto original.",
  precompactBlocked: (file) =>
    `Compactação bloqueada pelo MGR: você pediu, e o estado está a salvo em disco (${file}). `
    + "Abra uma sessão nova e retome por ele. Se ainda quiser compactar, peça de novo que passa.",
  precompactProceeding:
    "Compactando: você pediu de novo, e o hand-off em disco está atual. O que vier depois nesta "
    + "janela vem de um resumo.",
  // Logs do comando de hook (LOG-1/LOG-2). Vão para o stderr, que a doc do claude-code manda para o
  // debug log quando o hook sai 0 — destino de diagnóstico, e não canal de usuário.
  precompactLogContextBefore: (file) => `referenciando o contexto da conversa em ${file}`,
  precompactLogContextAfter: (file, entries) => `contexto referenciado em ${file} (${entries} entradas)`,
  precompactContextReferenced: ({ file, records, bytes, artifacts }) =>
    `Contexto desta sessão referenciado em ${file}: ${records} registros, ${bytes} bytes`
    + `${artifacts ? `, mais ${artifacts} arquivo(s) da sessão` : ""}. A memória estendida NÃO foi `
    + "consultada: a consolidação no mgr-code é posterior. O método APONTA para o contexto, não o "
    + "guarda — limpar o histórico do motor faz a referência apontar para o vazio.",
  precompactContextMissed: (reason) =>
    `O contexto da conversa NÃO pôde ser referenciado (${reason}): o hand-off foi gravado de todo jeito.`,
  precompactContextRecovered:
    "O manifesto de contexto anterior estava corrompido e foi substituído: as referências ainda não "
    + "consolidadas foram perdidas.",
  precompactLogGitBefore: "lendo a árvore de trabalho do git",
  precompactLogGitAfter: (count) => `git devolveu ${count} arquivo(s) não commitado(s)`,
  precompactLogWriteBefore: (file) => `gravando o hand-off em ${file}`,
  precompactLogWriteAfter: (file, appended) =>
    `hand-off ${appended ? "acrescentado a" : "criado em"} ${file}`,
  precompactLogStampBefore: "gravando o carimbo da recusa",
  precompactLogStampAfter: "carimbo da recusa gravado",
  agentsSetNothing: "nada a escrever: passe `--model`, `--effort`, ou os dois",
  originWriting: (dir) => `Gravando a origem do projeto em ${dir}/config.json`,
  originSetNeedsValue: (validos) => `${invocation} origin set precisa de um valor (${validos})`,
  originUnknown: (valor, validos) => `origem de projeto desconhecida: ${valor} (esperado ${validos})`,
  originWritten: (antes, depois) => `origem do projeto: ${antes} -> ${depois}`,
  originNoInstall: (dir) => `nenhuma instalação MGR encontrada em ${dir}; gravando a origem mesmo assim (é o caso do escopo global).`,
  agentsSetEngineNotInstalled: (engine, instalados) =>
    `motor \`${engine}\` não está instalado neste projeto`
    + (instalados ? ` (instalados: ${instalados})` : ""),
  agentsSetNoEngines: `nenhum motor instalado neste projeto: rode \`${lifecycle} install\` primeiro`,
  agentsSetWritten: (intent, agent) => `escrito em \`agents.${intent}\` — ${agent}`,
  agentsSetModelEffect: "`model` passa a valer na próxima invocação.",
  agentsSetEffortEffect:
    `\`effort\` só passa a valer depois de \`${invocation} agents apply\`: ele mora no arquivo do agente, e a `
    + "invocação não o sobrescreve.",
  specNextAllRefused: `\`${invocation} spec next\` não aceita \`--all\`: a próxima ação é sobre UMA feature — nomeie uma, ou rode de dentro de \`specs/<slug>/\``,
  runtimeLifecycleRefused: (cmd) => `${cmd} é ciclo de vida e não roda no runtime do projeto: rode ${lifecycle} ${cmd}`,
  runtimeUnknownCommand: (cmd) => `comando desconhecido: ${cmd}`,
  runtimeUnknownSpecSub: (sub) => `comando desconhecido: spec ${sub}`.trim(),
  runtimeDetectNeedsHook: () => "detect exige --hook <motor>",
  runtimeHelp: [
    "runtime do projeto mgr-method",
    "",
    "  spec status|validate|next",
    "  agents [<intencao>|set|apply]",
    "  origin set <valor>",
    "  origin [--json]",
    "  doctor",
    "  sdd-check",
    "  detect --hook <motor>",
    "  precompact --hook <motor>",
    "  version",
    "",
    `Comandos de ciclo de vida (install, update, add...) rodam por ${lifecycle}.`,
    "",
  ].join("\n"),
  specNextNeedsSlug: (count) => `${count} feature(s) em specs/ e nenhuma foi nomeada — nomeie uma, ou rode isto de dentro de \`specs/<slug>/\``,
  specStatusRoot: (root) => `${root}`,
  specStatusArtifacts: (linha) => `  artefatos: ${linha}`,
  specStatusNextReady: (ids) => `  escrever:  ${ids}`,
  specStatusNothingReady: "  escrever:  nada — todos os artefatos estão em disco",
  specStatusHandoffNone: "  handoff:   nenhum",
  specStatusHandoffOn: (file) => `  handoff:   ${file} (em disco; ele nunca é removido automaticamente)`,
  specStatusLine: (slug, resumo) => `  ${slug.padEnd(26)} ${resumo}`,
  doctorSemInstalacao: "sem instalação do MGR aqui: não há com o que comparar",
  doctorResumo: (checks, achados) => `  ${checks} verificações, ${achados} achado(s).`,
  doctorNaoAtesta: "  Nenhum achado significa que as verificações que eu faço não acharam nada, nunca que está íntegro.",
  specStatusWarning:
    "Isto é EXISTÊNCIA DE ARQUIVO, não progresso. Ele não sabe qual checkpoint você aprovou, e artefato em disco não é artefato aprovado.",
  specStatusNotFound: (slug) => `não há a feature \`${slug}\` em specs/`,
  specStatusEmpty: (dir) => `nenhuma feature encontrada em ${dir}`,
  gateKept: (file) => `  preservado: ${file} perdeu o marcador do MGR e não foi tocado`,
  statusGate: (state) => `  gate:    ${state}`,
  statusGateOff: "desligado (todas as intenções desligadas em `agents`)",
  statusGateEngine: (engine, model, effort) => `    ${engine}: modelo=${model} esforço=${effort}`,
  statusGateSource: (source) => `    origem: ${source}`,
  sddCheckNoDir: () => "SDD INCOMPLETO: docs/sdd/ não existe — rode a skill spec-init primeiro",
  sddCheckNoConstitution: () => "SDD INCOMPLETO: docs/sdd/CONSTITUTION.md ausente — rode o spec-init e revise a constituição",
  sddCheckEmpty: () => "SDD INCOMPLETO: docs/sdd/ está vazio",
  sddCheckNoReviewRules: () => "aviso: docs/sdd/09-review-rules.md ausente — o code-analyzer vai operar sem o guia do projeto",
  sddCheckOk: (dir) => `SDD OK: projeto inicializado (${dir})`,
  agentsApplyMissing: (file, version) => `${file} não existe: rode npx mgr-method@${version} update`,
  agentsApplyNotOwned: (file) => `${file} não foi escrito pelo MGR (sem o marcador mgr-managed-agent): mantido como está`,
  agentsApplyWriting: (file) => `Reescrevendo o frontmatter do agente em ${file}`,
  agentsApplyWritten: (file) => `Frontmatter do agente reescrito: ${file}`,

  // §4.2 da spec F2: config em duas camadas, update que converge e marca de posse.
  installModelSkipped: (intents) => `Nenhum modelo gravado para: ${intents}. Esses agentes herdam o modelo da sessão. Para declarar: \`${invocation} agents set <intenção> --model <id>\` (ou a skill configure-agents).`,
  installOriginAbsent: `Origem do projeto não gravada: o revisor a trata como desconhecida. Para gravar: \`${invocation} origin set greenfield|brownfield\` (o spec-init também pergunta).`,
  updateSkillEntering: (name) => `skill entra: ${name}`,
  updateSkillLeaving: (line) => `skill sai: ${line}`,
  updateOrphanOffered: (rel, ev) => `órfã oferecida para remoção: ${rel} (${ev})`,
  orphanEvidenceMarked: "leva a marca de posse do MGR",
  orphanEvidenceDistributed: "nome que o mgr-method distribui, ausente do manifesto e do mgr-skills.lock",
  updateOutOfReach: (list) => `fora do alcance, origem desconhecida (não oferecida): ${list}`,
  confirmRemoveOne: (rel) => `Remover ${rel}?`,
  hookEventAdded: (file, event) => `evento de hook gravado em ${file}: ${event}`,
  updateDivergent: (version, names) => `Ainda diverge do que a v${version} decide: ${names}. Rode \`${lifecycle} update\` num terminal para decidir item a item.`,
  configMigrated: (version, file) => `Instalação no layout anterior (v${version}, config em uma camada só) — o projectId sai do manifesto versionado e passa a morar em ${file}, que é pessoal; as skills passam a levar a marca de posse.`,
  personalKeysIgnored: (file, keys) => `${file}: ${keys} pertence(m) à config do time (.mgr-core/config.json) e foi(ram) ignorada(s).`,
  gitignoreWritten: (file) => `arquivos pessoais do MGR ignorados em ${file} (bloco gerenciado)`,
  gitignoreDeclined: (lines) => `.gitignore não alterado. Mantenha fora do versionamento: ${lines}`,
  gitignoreTeamIgnored: (line) => `A linha "${line}" do .gitignore ignora a config do time (.mgr-core/config.json): a política de modelo e a origem não vão viajar com o repositório.`,
  gitignoreRemoved: (file) => `bloco gerenciado removido de ${file}`,

  // Textos fixados no CHECKPOINT 3 da P0.7 (lacunas L-1 a L-6).
  projectIdPersonal: ".mgr-core/config.json: projectId é pessoal e mora em .mgr-core/config.local.json; foi ignorado.",
  qModel: (intent, engine) => `Modelo para ${intent} (${engine})`,
  modelOtherLabel: "outro (digitar o identificador)",
  modelSkipLabel: "pular — os agentes herdam o modelo da sessão",
  qModelIdentifier: (intent, engine) => `Identificador do modelo para ${intent} (${engine}), vazio para pular`,
  qOrigin: "Origem do projeto (define o peso dos achados da review)",
  originGreenfieldOption: "greenfield — projeto novo",
  originBrownfieldOption: "brownfield — código existente",
  originSkipOption: "pular — fica sem registro",
  planOrigin: (value) => `origem → ${value}`,
  planOriginNotRecorded: "origem → sem registro",
  planGitignore: ".gitignore → bloco gerenciado com .mgr-core/config.local.json e .mgr-core/.env",
  qGitignoreBlock: "Gravar o bloco gerenciado no .gitignore (a config pessoal fica fora do versionamento)?",
  originRecorded: (value) => `origem do projeto: ${value} (.mgr-core/config.json)`,
  originNotRecorded: `origem do projeto: sem registro — rode ${invocation} origin set greenfield|brownfield`,
  originInvalid: (value) => `origem do projeto: valor inválido ${value} em .mgr-core/config.json`,
  hookEventToAdd: (file, event) => `evento de hook a gravar em ${file}: ${event}`,
  hookCommandToRewrite: (file, event) => `comando de hook a reescrever em ${file}: ${event}`,
  enteringBlockedByPlugin: (rel, name) => `mantida ${rel}: um plugin é dono dessa pasta, então ${name} não foi instalada`,
  modelFlagNeedsEngineValues: (intent) => `--model-${intent} exige um valor por motor quando mais de um motor aceita modelo: --model-${intent} claude-code=<id>,copilot=<id>`,
  modelFlagMalformed: (intent, value) => `--model-${intent}: "${value}" não é um id de modelo nem uma lista de pares motor=id`,
  modelFlagNoModelEngine: (intent, list) => `--model-${intent}: nenhum dos motores escolhidos (${list}) aceita modelo`,
  personalKeysUnknown: (file, keys) => `${file}: ${keys} não é chave reconhecida e foi ignorada.`,
  confirmReplaceOne: (rel, name) => `Substituir ${rel} (não instalada pelo mgr-method) pela ${name} do pacote?`,
  modelFlagEngineNotChosen: (intent, engine, chosen) => `--model-${intent}: o motor ${engine} não foi escolhido nesta instalação (escolhidos: ${chosen})`,

  help: `MGR — Método Governado por Rastreabilidade

Uso: mgr <comando> [opções]

  install [repo]   instala as skills (seletivo) direto na pasta do motor
                   (--engine claude-code|copilot|both, --scope, --language, --arch,
                    --user-language, --project-id, --all-skills, --skills-dir, --dry-run, -y)
  status [repo]    mostra o que está instalado
  update [repo]    re-sincroniza (--scope)
  uninstall [repo] remove as skills instaladas (--scope, -y)
  build            gera um diretório com todo o conteúdo (--out)
  validate         valida as SKILL.md (autoria de skill)
  audit            infere as capacidades perigosas de cada skill e compara com o declarado
  doctor           confere se a instalacao esta integra, e nunca escreve nada
  sdd-check        confere se o projeto foi inicializado para SDD (docs/sdd/)
  spec validate    valida o plano e a spec deste projeto
                   ([<slug>], --all, --strict, --json)
  spec next        a próxima ação a partir do plano ([<slug>], --json)
  spec status      quais artefatos existem ([<slug>], --all, --json)
  agents           qual modelo e esforço cada intenção usa, e de onde veio
                   cada valor ([<intenção>], --json)
  agents set       escreve a política de uma intenção (<intenção>, --model,
                   --effort, --engine); não roda o ${lifecycle} update
  agents apply     reescreve model e esforço de cada agente a partir do config, sem rede
  origin set       registra se o projeto nasceu do método ou é legado
                   (<greenfield|brownfield>); não roda o ${lifecycle} update
  origin [--json]  lê a origem gravada: recorded, absent ou invalid (sai 1)
  precompact       grava o hand-off antes de o motor compactar o contexto
                   (--hook <motor>); chamado pelo hook, não à mão
  tokens           quanto o fluxo consumiu: passe o transcript da conversa e,
                   depois dele, o de cada agente (--json)
  list             lista as skills
  version          mostra a versão

Skills plugáveis (ver https://github.com/maurigre/mgr-method/blob/main/docs/plugins.md):

  add <@registry/skill>       instala uma skill plugável (sempre pede confirmação)
  remove <@registry/skill>    remove uma skill plugável
  registry add <nome> <url> [--trusted] | remove <nome> | list
                              gerencia os registries em .mgr-core/config.json
  detect [repo]               mostra o que o projeto pede e o que os registries oferecem
                              (--hook <motor> emite o relatório do hook de sessão)
`,
});

// Seleciona a tabela pelo userLanguage: qualquer variante pt-* cai na pt-BR; o resto, en.
// `invocation` nomeia os comandos que o runtime atende; `lifecycle`, os de ciclo de vida. Com os
// defaults, a saída é a de sempre (`mgr ...`); o runtime passa os seus próprios prefixos (DT-15).
export function getMessages(lang, { invocation = "mgr", lifecycle = "mgr" } = {}) {
  const opts = { invocation, lifecycle };
  return lang && String(lang).toLowerCase().startsWith("pt") ? ptBR(opts) : en(opts);
}

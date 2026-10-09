// Instalação no modelo AUTOSSUFICIENTE por motor: o conteúdo completo das skills selecionadas
// vai direto para a pasta do motor (.claude/skills ou .github/skills). O `.mgr-core/` guarda
// APENAS config do projeto (manifest.json + .env com MGR_PROJECT_ID) — sem skills.
// Instalações do modelo antigo (runtime-launcher, com skills dentro de .mgr-core) são migradas
// automaticamente no install: remove-se o conteúdo antigo e mantém-se o .mgr-core só como config.
//
// Convenção por motor:
//   claude-code : <repo>/.claude/skills  |  ~/.claude/skills
//   copilot     : <repo>/.github/skills  |  ~/.copilot/skills
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bundle from "./bundle.js";
import { installAgents, installEngine, installRuntime, isOurAgent, isOurSkill, lockedDirsOf, orphanClass } from "./builder.js";
import * as engineDescriptors from "./engines/index.js";
import { previewAgents, readAgents, readPersonal, writeAgentPolicy, writeOrigin, writePersonal } from "./registry.js";
import { readManifest, writeManifest, writeEnv, readEnvProjectId, MODEL_RUNTIME, MODEL_LAYERED } from "./manifest.js";
import * as catalog from "./catalog.js";

const KNOWN_PROJECT = [".claude/skills", ".github/skills", ".agents/skills", ".cursor/skills"];
const KNOWN_GLOBAL = [".claude/skills", ".copilot/skills", ".agents/skills"];

export const ENGINES = engineDescriptors.ids();

function countSkills(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(path.join(dir, d.name, "SKILL.md")))
    .length;
}

export function detect(repo) {
  const out = [];
  for (const rel of KNOWN_PROJECT) {
    const p = path.join(repo, rel);
    if (existsSync(p)) out.push({ scope: "projeto", path: p, count: countSkills(p) });
  }
  for (const rel of KNOWN_GLOBAL) {
    const p = path.join(os.homedir(), rel);
    if (existsSync(p)) out.push({ scope: "global", path: p, count: countSkills(p) });
  }
  return out;
}

export function engineSkillsDir(engine, scope, repo) {
  // O `get` do descritor lança com a mensagem dele; aqui a mensagem é OUTRA e observável — um teste
  // a afirma desde antes desta mudança, e trocá-la seria degradar o que a pessoa lê.
  if (!engineDescriptors.ids().includes(engine)) throw new Error(`motor inválido: ${engine}`);
  const rel = engineDescriptors.get(engine).skillsDir[scope];
  if (!rel) throw new Error(`escopo desconhecido: ${scope} (use project | global)`);
  return scope === "project" ? path.join(repo, rel) : path.join(os.homedir(), rel);
}

// `.mgr-core/` — config do projeto (project) ou global (home).
export function coreDir(scope, repo) {
  const base = scope === "global" ? os.homedir() : repo;
  return path.join(base, bundle.RUNTIME_DIR_NAME);
}

const absDir = (d, scope, repo) => (path.isAbsolute(d) ? d : (scope === "project" ? path.join(repo, d) : d));

// Referência (string) que substitui o token {{MGR_ARCH_RULES}} nas skills arch-*.
function archRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, ...catalog.ARCH_INSTALLED);
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// Referência que substitui o token {{MGR_LAWS}} nas SKILL.md do CORE (ADR-0011).
function lawsRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, ...catalog.LAWS_INSTALLED);
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// Referência que substitui o token {{MGR_RUNTIME}}: relativa à raiz com "/" no projeto, absoluta no global.
export function runtimeRef(engineDir, scope, repo) {
  const entry = path.join(engineDir, ...catalog.RUNTIME_DIR, ...catalog.RUNTIME_ENTRY);
  return scope === "project" ? path.relative(repo, entry).split(path.sep).join("/") : entry;
}

// Referência que substitui o token {{MGR_CHARTER}} DENTRO das leis instaladas (ADR-0022).
function charterRulesRef(engineDir, scope, repo) {
  const shared = path.join(engineDir, ...catalog.CHARTER_INSTALLED);
  return scope === "project" ? path.relative(repo, shared) : shared;
}

// Fonte de leis JÁ INSTALADA de um motor, ou `null` se aquele motor não está instalado.
// Mora no núcleo porque é DECISÃO sobre estado persistido (INV-5/INV-6): a borda só formata.
// Resolvida pelo diretório do próprio motor, nunca por posição em `skillsDirs` — indexar por
// posição fazia o hook do copilot anunciar a árvore do claude-code.
export function installedLawsRef(engine, scope, repo) {
  const man = readManifest(coreDir(scope, repo));
  if (!man || !(man.engines || []).includes(engine)) return null;
  return lawsRulesRef(engineSkillsDir(engine, scope, repo), scope, repo);
}

// Diretório de agentes do motor, resolvido pelo descritor (ADR-0010) — mesma forma que
// engineSkillsDir faz para skills, mas sem um segundo mapa por motor aqui dentro.
export function engineAgentsDir(engine, scope, repo) {
  const rel = engineDescriptors.get(engine).agentsDir[scope];
  if (!rel) throw new Error(`escopo desconhecido: ${scope} (use project | global)`);
  return scope === "project" ? path.join(repo, rel) : path.join(os.homedir(), rel);
}

// As 5 fontes do projectId, na ordem da DT-16: flag > camada pessoal > manifesto anterior > `.env`
// derivado > nome da pasta. Vazio em qualquer fonte conta como ausente e passa para a seguinte.
export function resolveProjectId({ flag, coreDir: core, prior, repo }) {
  if (flag) return flag;
  const personal = readPersonal(core).projectId;
  if (personal) return personal;
  if (prior?.projectId) return prior.projectId;
  const env = readEnvProjectId(core);
  if (env.state === "present") return env.projectId;
  return path.basename(path.resolve(repo));
}

export function planInstall(engines, scope, repo, opts = {}) {
  const { skillsDir = null, language = null, architecture = null, userLanguage = null, optional = [], all = false, names = null, projectId = null, replaced = {}, models = {}, origin = null } = opts;
  const skills = names || (all ? bundle.skillNames() : catalog.selectSkills({ language, architecture, optional }));
  // Skill substituída por plugin sai do conjunto DAQUELE motor (ADR-0008): sem isso o
  // instalador escreveria a skill do método para o restore sobrescrever logo em seguida,
  // deixando no disco, no intervalo, a versão que o usuário não escolheu.
  const forEngine = (engine) => skills.filter((name) => !(replaced[engine] || {})[name]);
  // O alvo `custom` não tem motor próprio no lockfile: o que foi cedido a plugin em QUALQUER motor sai
  // dele, a mesma união do `cededAt`. Sem isso o `custom` construía o nome que o `occupiedFolders` pula
  // por ser cedido, e o `buildSkill` apagava a pasta do plugin (review estreito da P2.7, caminho 1).
  const cedidasEmQualquerMotor = Object.assign({}, ...Object.values(replaced));
  const targets = skillsDir
    ? [{ engine: "custom", dir: skillsDir, skills: skills.filter((name) => !cedidasEmQualquerMotor[name]) }]
    : engines.map((e) => ({ engine: e, dir: engineSkillsDir(e, scope, repo), skills: forEngine(e) }));
  const pid = resolveProjectId({ flag: projectId, coreDir: coreDir(scope, repo), prior: readManifest(coreDir(scope, repo)), repo });
  // A política de TODAS as intenções, de UMA fonte (ADR-0017, RN-1). O `reviewGate` do plano passa
  // a SAIR daqui, e não mais de `readReviewGate`: lendo o apelido enquanto a instalação gravava a
  // partir de `agents`, o plano que o usuário confirmava contradizia o arquivo que era escrito —
  // defeito achado pelo gate isolado e reproduzido.
  //
  // `reviewGate` NÃO volta no plano: ele seria `agents.policies.review` com outro nome, e campo
  // duplicado diverge na primeira mudança. Mesma razão que tirou o `readReviewGate` do módulo.
  //
  // `previewAgents` sobrepõe as respostas de modelo em memória: o plano mostra o que `execute` gravará.
  const agents = previewAgents(coreDir(scope, repo), models);
  return {
    engines: skillsDir ? ["custom"] : engines, scope, repo, targets, skills, replaced, language, architecture, userLanguage,
    projectId: pid, agents, answers: { models, origin }, optional, all,
  };
}

// Migra do modelo antigo (runtime-launcher): remove lançadores e o conteúdo de skills/shared
// de dentro de `.mgr-core/`, mantendo o diretório (será reescrito como config).
export function migrateOld(scope, repo) {
  const core = coreDir(scope, repo);
  const man = readManifest(core);
  if (!man || man.model !== "runtime-launcher") return null;
  const removed = [];
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  for (const d of dirs) {
    const base = absDir(d, scope, repo);
    for (const name of man.skills || []) {
      const p = path.join(base, name);
      // Pasta de plugin (`mgr-manifest.json`) não é lançador do layout antigo: nunca é apagada aqui
      // (review estreito da P2.7, caminho 2).
      if (existsSync(path.join(p, "mgr-manifest.json"))) continue;
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
  }
  for (const sub of ["skills", "shared"]) {
    const p = path.join(core, sub);
    if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
  }
  return { removed, version: man.version };
}

// Remover ANTES de declarar, e na mesma operacao. Se o processo morrer entre os dois passos,
// removendo antes o estado que sobra e `missing-skill` — declarada e ausente —, que TEM remediacao;
// gravando o manifesto antes, o estado seria `orphan-skill`, que NAO tem. E o defeito que esta
// fatia existe para nao produzir, e por isso a ordem e parte do contrato, nao detalhe.
//
// `remove` e injetavel para o caso negativo que prova a ordem: com um `remove` que lanca, o
// manifesto anterior nao pode ter sido reescrito.
export function execute(plan, { abandoned = [], remove = rmSync } = {}) {
  const removed = [];
  for (const saindo of abandoned) {
    remove(saindo.path, { recursive: true, force: true });
    removed.push(saindo.path);
  }
  const migrated = migrateOld(plan.scope, plan.repo);
  // Só o que foi respondido é gravado; sem resposta o `config.json` não é criado nem tocado (DT-3).
  const core = coreDir(plan.scope, plan.repo);
  const { models = {}, origin = null } = plan.answers ?? {};
  for (const [intent, model] of Object.entries(models)) {
    if (Object.keys(model ?? {}).length) writeAgentPolicy(core, intent, { model });
  }
  if (origin) writeOrigin(core, origin);
  // Ordem da spec §3: config do time -> camada pessoal -> skills/runtime/agentes -> manifesto -> .env.
  // projectId é pessoal (DT-1): vai para config.local.json; o manifesto não o grava mais.
  writePersonal(core, { projectId: plan.projectId });
  const { policies } = plan.agents || readAgents(core);
  // Mesma fonte que o `installAgents` usa. Sem isto, o roteamento da skill de review olharia para
  // uma política e o arquivo do agente seria escrito a partir de outra.
  const gate = policies.review;
  const agents = [];
  const agentsDirs = [];
  const agentChanges = [];
  const gateWarnings = [];
  const runtime = [];
  for (const t of plan.targets) {
    const ref = t.engine === "custom" ? undefined : archRulesRef(t.dir, plan.scope, plan.repo);
    const engineId = t.engine === "custom" ? undefined : t.engine;
    installEngine(t.dir, t.skills || plan.skills, {
      archRulesRef: ref,
      lawsRulesRef: t.engine === "custom" ? undefined : lawsRulesRef(t.dir, plan.scope, plan.repo),
      charterRulesRef: t.engine === "custom" ? undefined : charterRulesRef(t.dir, plan.scope, plan.repo),
      runtimeRef: runtimeRef(t.dir, plan.scope, plan.repo),
      userLanguage: plan.userLanguage, engineId, reviewGate: engineId ? gate : undefined,
    });
    runtime.push(installRuntime(t.dir, { version: bundle.readVersion() }));
    // Motor "custom" (--skills-dir) não é plataforma: não há diretório de agentes para ele.
    //
    // O gate desligado NÃO pula mais o bloco inteiro: cada intenção decide sozinha se é escrita,
    // e desligar a revisão não pode levar junto a redação e a execução.
    if (!engineId) continue;
    const dir = engineAgentsDir(engineId, plan.scope, plan.repo);
    const skillRef = path.join(t.dir, catalog.REVIEW_GATE.skill, "SKILL.md");
    const { written, skipped, blocked, changes } = installAgents(engineId, dir, policies, {
      reviewSkillRef: plan.scope === "project" ? path.relative(plan.repo, skillRef) : skillRef,
      userLanguage: plan.userLanguage,
    });
    if (written.length) { agents.push(...written); agentsDirs.push(dir); }
    agentChanges.push(...changes);
    for (const capability of skipped) gateWarnings.push({ engine: engineId, capability });
    for (const file of blocked) gateWarnings.push({ engine: engineId, blocked: file });
  }
  const rel = (p) => (plan.scope === "project" ? path.relative(plan.repo, p) : p);
  writeManifest(core, {
    version: bundle.readVersion(),
    scope: plan.scope,
    engines: plan.engines,
    language: plan.language,
    architecture: plan.architecture,
    userLanguage: plan.userLanguage,
    optional: plan.optional ?? [],
    allSkills: plan.all === true,
    skillsDirs: plan.targets.map((t) => rel(t.dir)),
    // `skills` continua sendo o conjunto PRETENDIDO do método — é o que faz a skill voltar
    // quando o plugin que a substituiu for removido (DT-6). `replaced` diz o que, hoje,
    // está cedido a um plugin naquele motor.
    skills: plan.skills,
    ...(Object.keys(plan.replaced || {}).length ? { replaced: plan.replaced } : {}),
    // Agentes instalados: é o que faz o uninstall saber o que remover e o update, o que
    // reescrever — mesmo contrato que as skills já têm.
    ...(agents.length ? { agentsDirs: agentsDirs.map(rel), agents: agents.map(rel) } : {}),
  });
  writeEnv(core, plan.projectId);
  return {
    targets: plan.targets.map((t) => ({ engine: t.engine, dir: t.dir })),
    skills: plan.skills, migrated, core, projectId: plan.projectId,
    agents, gate, gateWarnings, agentChanges, removed, runtime,
  };
}

export function installs(scope, repo) {
  const man = readManifest(coreDir(scope, repo));
  return man ? [{ ...man, core: coreDir(scope, repo) }] : [];
}

export function detectPrior(scope, repo) {
  return readManifest(coreDir(scope, repo));
}

export function needsRuntimeMigration(prior) {
  return Boolean(prior) && ![MODEL_RUNTIME, MODEL_LAYERED].includes(prior.model);
}

export function needsConfigMigration(prior) {
  return Boolean(prior) && prior.model !== MODEL_LAYERED;
}

// Skills cedidas a plugin num alvo. O alvo do `--skills-dir` tem engine "custom", e `replaced` so e
// chaveado por motor REAL: sem a uniao, `plan.replaced["custom"]` seria sempre undefined e a skill
// cedida a plugin entraria na lista — medido em 2026-09-25, e com `-y` o rmSync cairia no diretorio
// do plugin. Compartilhada por `abandonedSkills` e `orphanCandidates` para a regra nao divergir.
const cededAt = (target, plan) => (target.engine === "custom"
  ? Object.assign({}, ...Object.values(plan.replaced || {}))
  : (plan.replaced || {})[target.engine] || {});

// O conjunto ABANDONADO: o que o manifesto anterior declarava e este plano deixa de declarar.
//
// Os candidatos saem de DOIS CONJUNTOS QUE O METODO ESCREVEU — `prior.skills` e `prior.skillsDirs`,
// campos que so o `execute` grava. Nao ha `readdirSync`, glob nem varredura aqui, e o `exists`
// injetado so SUBTRAI. Arquivo que o metodo nunca declarou nao tem por onde entrar: e o inverso do
// `orphanSkills` do doctor, que parte do disco e por isso nao pode ter remediacao.
//
// A intersecao de diretorios importa: um diretorio que o manifesto anterior nunca declarou pode ter
// arquivo de outra origem, e agir nele seria apagar o que o metodo nao instalou.
export function abandonedSkills({ prior, plan, exists = existsSync }) {
  if (!prior || !Array.isArray(prior.skills)) return [];
  // Modelo antigo NAO reconcilia: o que ele declara sao LANCADORES, e o `migrateOld` ja os descarta
  // dentro do proprio `execute`. Mante-los declarados os RESSUSCITARIA como skill de verdade —
  // medido em 2026-09-25: `arch-onion` voltava a disco com conteudo novo, deixando duas skills de
  // arquitetura instaladas, que e o estado que o PRD chama de defeito.
  if (prior.model === "runtime-launcher") return [];
  const declaradas = new Set(plan.skills || []);
  const saindo = prior.skills.filter((name) => !declaradas.has(name));
  if (!saindo.length) return [];
  // O manifesto grava `skillsDirs` RELATIVO no escopo project; o plano carrega o dir ABSOLUTO.
  // Sem absolutizar, a intersecao seria sempre vazia e a lista sairia vazia em silencio.
  const anteriores = new Set((prior.skillsDirs || []).map((dir) => absDir(dir, plan.scope, plan.repo)));
  const fora = [];
  for (const target of plan.targets || []) {
    if (!anteriores.has(target.dir)) continue;
    // O alvo do `--skills-dir` tem engine "custom", e `replaced` so e chaveado por motor REAL: sem
    // a uniao, `plan.replaced["custom"]` seria sempre undefined e a skill cedida a plugin entraria
    // na lista — medido em 2026-09-25, e com `-y` o rmSync cairia no diretorio do plugin.
    const cedidas = cededAt(target, plan);
    for (const name of saindo) {
      if (cedidas[name]) continue;
      const alvo = path.join(target.dir, name);
      if (!exists(alvo)) continue;
      fora.push({ name, dir: target.dir, path: alvo, class: catalog.skillClass(name) });
    }
  }
  return fora;
}

// X-19: skill que ENTRA no update e ja encontra pasta de mesmo nome em disco. Pura em relacao ao
// disco (IO por `read`/`exists`). Do metodo (marca no proprio nome) -> fora das listas, substitui sem
// pergunta; plugin (lockfile ou mgr-manifest.json) -> `blocked`, nunca substituida; o resto ->
// `replaceable`, so com consentimento. Sem isto o `buildSkill` apagaria a pasta do usuario.
// X-27: skill do plano que ja estava declarada (`declared`) tambem e examinada, mas SO para pasta com
// `mgr-manifest.json` (plugin que saiu do lockfile e deixou a pasta): vira `blocked`, nunca sobrescrita.
export function occupiedFolders({
  plan, entering, lockfile, declared = [],
  read = (file) => readFileSync(file, "utf8"),
  exists = existsSync,
}) {
  const out = { replaceable: [], blocked: [] };
  const lockedDirs = lockedDirsOf(lockfile);
  for (const target of plan.targets || []) {
    const cedidas = cededAt(target, plan);
    const doAlvo = target.skills || plan.skills;
    for (const name of [...entering, ...declared.filter((nome) => !entering.includes(nome))]) {
      if (cedidas[name] || !doAlvo.includes(name)) continue;
      const alvo = path.join(target.dir, name);
      if (!exists(alvo)) continue;
      const skillFile = path.join(alvo, "SKILL.md");
      const comManifesto = exists(path.join(alvo, "mgr-manifest.json"));
      if (!entering.includes(name)) {
        if (comManifesto) out.blocked.push({ name, dir: target.dir, path: alvo });
        continue;
      }
      const bloqueada = lockedDirs.has(name) || comManifesto;
      if (!bloqueada && exists(skillFile) && isOurSkill(read(skillFile), name)) continue;
      (bloqueada ? out.blocked : out.replaceable).push({ name, dir: target.dir, path: alvo });
    }
  }
  return out;
}

// Pastas de skill em disco que o manifesto NAO declara (DT-10). Pura em relacao ao disco: o IO entra
// por `read`, `list` e `exists`; `lockfile` e o objeto ja lido (ou null).
//
// EXCECAO REGISTRADA no ADR-0024 a invariante do PR #31 (o bloco de `abandonedSkills` acima): aqui o
// disco ENUMERA. Mas so enumera, e so vira candidata a classe `marked` (marca de posse no
// frontmatter) ou `distributed` (nome que o pacote distribui). `unknown` — nome estranho, dir do
// lockfile ou pasta com `mgr-manifest.json` — vai para `outOfReach`: e anunciada, nunca oferecida.
//
// A intersecao de diretorios e a mesma de `abandonedSkills`: so se enumera onde o manifesto anterior
// declarou E o plano mantem, porque diretorio nunca declarado pode ter arquivo de outra origem.
// O `install` NAO usa esta funcao: a remocao de orfa e do `update` (D-5).
export function orphanCandidates({
  prior, plan, lockfile,
  read = (file) => readFileSync(file, "utf8"),
  list = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
  exists = existsSync,
}) {
  if (!prior) return { candidates: [], outOfReach: [] };
  const anteriores = new Set((prior.skillsDirs || []).map((dir) => absDir(dir, plan.scope, plan.repo)));
  const declaradas = new Set([...(prior.skills || []), ...(plan.skills || [])]);
  const lockedDirs = lockedDirsOf(lockfile);
  const out = { candidates: [], outOfReach: [] };
  for (const target of plan.targets || []) {
    if (!anteriores.has(target.dir) || !exists(target.dir)) continue;
    const cedidas = cededAt(target, plan);
    for (const name of list(target.dir)) {
      if (name.startsWith("_") || declaradas.has(name) || cedidas[name]) continue;
      const alvo = path.join(target.dir, name);
      const skillFile = path.join(alvo, "SKILL.md");
      if (!exists(skillFile)) continue;
      const classe = orphanClass({
        name,
        skillText: read(skillFile),
        hasPluginManifest: exists(path.join(alvo, "mgr-manifest.json")),
        lockedDirs,
      });
      if (classe === "unknown") out.outOfReach.push({ name, dir: target.dir });
      else out.candidates.push({ name, dir: target.dir, path: alvo, class: classe });
    }
  }
  return out;
}

// O que fica em disco continua DECLARADO. Sem isto, recusar a remocao (ou nao ter terminal para
// perguntar) deixaria a skill em disco e fora do manifesto — uma orfa NOVA, que nao tem remediacao,
// e a mensagem que manda usar `-y` seria falsa, porque na execucao seguinte o nome ja nao estaria em
// `prior.skills` para virar candidato. Medido de ponta a ponta em 2026-09-25 antes desta correcao.
//
// Devolve um plano NOVO: o de entrada nao e mutado, e o `execute` nao muda de assinatura.
// Nome que ESTA versao do pacote ja nao distribui nao pode ser mantido declarado: o `installEngine`
// o reconstruiria e o `buildSkill` lanca, transformando a RECUSA em erro de instalacao. Medido em
// 2026-09-25: exit 1 num caminho em que a spec promete 0, e com escrita parcial antes do throw.
//
// Ele tambem nao pode ser declarado sem ser reconstruido: o `update` passa `names: man.skills` pelo
// mesmo caminho e quebraria igual. Entao sai do conjunto — e a borda ANUNCIA, nunca em silencio.
export function splitKept(kept = [], available = bundle.skillNames()) {
  return {
    mantidas: kept.filter((saindo) => available.includes(saindo.name)),
    semFonte: kept.filter((saindo) => !available.includes(saindo.name)),
  };
}

export function keepDeclared(plan, kept = []) {
  if (!kept.length) return { ...plan, targets: plan.targets.map((target) => ({ ...target })) };
  const une = (nomes, novos) => [...nomes, ...novos.filter((nome) => !nomes.includes(nome))];
  return {
    ...plan,
    skills: une(plan.skills, kept.map((mantida) => mantida.name)),
    targets: plan.targets.map((target) => ({
      ...target,
      skills: une(target.skills || plan.skills, kept.filter((mantida) => mantida.dir === target.dir).map((mantida) => mantida.name)),
    })),
  };
}

// DT-9: o conjunto que a versão instalada deveria ter, reconstruído das escolhas gravadas.
// Manifesto antigo (sem `optional`/`allSkills`) infere: optional = OPTIONAL ∩ skills;
// allSkills só se as 4 arquiteturas estão em skills (D-14; três mantidas por recusa não chegam a 4).
// As escolhas de instalação de um manifesto, gravadas ou inferidas (D-14). Fonte única: quem monta o
// conjunto (`versionSet`) e quem grava o manifesto seguinte (`planUpdate`) leem daqui. Com duas cópias,
// o update de um manifesto antigo montava o conjunto certo e gravava `allSkills: false`, e o update
// SEGUINTE ofereceria remover três arquiteturas.
export function inferredChoices(manifest) {
  const skills = manifest.skills || [];
  return {
    optional: manifest.optional ?? catalog.OPTIONAL.filter((nome) => skills.includes(nome)),
    allSkills: manifest.allSkills ?? Object.values(catalog.ARCHITECTURES).every((nome) => skills.includes(nome)),
  };
}

export function versionSet(manifest) {
  const { optional, allSkills } = inferredChoices(manifest);
  if (allSkills) return bundle.skillNames();
  return catalog.selectSkills({ architecture: manifest.architecture, language: manifest.language, optional });
}

export function uninstall(scope, repo) {
  const core = coreDir(scope, repo);
  const man = readManifest(core);
  if (!man) throw new Error("nenhuma instalação MGR encontrada — nada a desinstalar");
  const removed = [];
  const dirs = man.skillsDirs || (man.skillsDir ? [man.skillsDir] : []);
  for (const d of dirs) {
    const base = absDir(d, scope, repo);
    for (const name of man.skills || []) {
      const p = path.join(base, name);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
    const sh = path.join(base, catalog.SHARED_DIR);
    if (existsSync(sh)) { rmSync(sh, { recursive: true, force: true }); removed.push(sh); }
    if (existsSync(base) && readdirSync(base).length === 0) { rmSync(base, { recursive: true, force: true }); removed.push(base); }
  }
  const kept = [];
  for (const file of man.agents || []) {
    const p = absDir(file, scope, repo);
    if (!existsSync(p)) continue;
    // Prova de posse: se o arquivo perdeu o marcador, alguém o reescreveu — não é nosso.
    if (!isOurAgent(readFileSync(p, "utf8"))) { kept.push(p); continue; }
    rmSync(p, { force: true });
    removed.push(p);
  }
  for (const d of man.agentsDirs || []) {
    const base = absDir(d, scope, repo);
    if (existsSync(base) && readdirSync(base).length === 0) {
      rmSync(base, { recursive: true, force: true });
      removed.push(base);
    }
  }
  if (existsSync(core)) { rmSync(core, { recursive: true, force: true }); removed.push(core); }
  return { removed, kept };
}

// O PLANO do update: nada é escrito aqui (o consentimento da borda vem entre o plano e a execução).
// `lockfile` chega já lido. `models` vazio e `origin` nulo: o update não pergunta nenhum dos dois, e
// com isso o `execute` não reescreve o `config.json` do time.
export function planUpdate(scope, repo, { replaced = {}, lockfile = null, projectId = null } = {}) {
  const prior = readManifest(coreDir(scope, repo));
  if (!prior) throw new Error("nenhuma instalação MGR encontrada — rode `mgr install` antes");
  const engines = (prior.engines || [prior.engine]).filter((x) => x && x !== "custom");
  // DT-17: alvo custom é preservado pelo dir que o manifesto gravou, e não vira claude-code.
  const custom = (prior.engines || [prior.engine]).includes("custom") && (prior.skillsDirs || []).length > 0;
  const escolhas = inferredChoices(prior);
  const plan = planInstall(engines.length ? engines : ["claude-code"], scope, repo, {
    names: versionSet(prior), language: prior.language, architecture: prior.architecture,
    // Manifesto anterior a esta versão não tem userLanguage: toda instalação dessa era é
    // pt-BR — herdar preserva a experiência sem pergunta nova (decisão do CHECKPOINT 1).
    userLanguage: prior.userLanguage || "pt-BR",
    optional: escolhas.optional, all: escolhas.allSkills,
    skillsDir: custom ? absDir(prior.skillsDirs[0], scope, repo) : null,
    projectId, replaced,
  });
  const antes = new Set(prior.skills || []);
  const entering = plan.skills.filter((nome) => !antes.has(nome));
  const occupied = occupiedFolders({ plan, entering, lockfile, declared: prior.skills || [] });
  // X-27 também na SAÍDA (review final, SP-1): a abandonada cuja pasta tem `mgr-manifest.json` é de
  // plugin. Oferecê-la apagaria o plugin com `-y`, e recusá-la a devolveria ao plano pelo `keepDeclared`
  // e o `buildSkill` a reconstruiria por cima. Ela é tratada como pasta de origem desconhecida: deixa de
  // ser declarada (a versão não a seleciona), nunca é oferecida nem reconstruída, e é anunciada como
  // fora do alcance. Não há divergência: sem ela declarada, o projeto bate com o conjunto da versão.
  const abandoned = [];
  const orphans = orphanCandidates({ prior, plan, lockfile });
  for (const saindo of abandonedSkills({ prior, plan })) {
    if (existsSync(path.join(saindo.path, "mgr-manifest.json"))) {
      orphans.outOfReach.push({ name: saindo.name, dir: path.dirname(saindo.path) });
    } else {
      abandoned.push(saindo);
    }
  }
  return {
    prior, plan,
    entering,
    occupied,
    abandoned,
    orphans,
    migration: { runtime: needsRuntimeMigration(prior), config: needsConfigMigration(prior) },
  };
}

// Executa o plano JÁ DECIDIDO pelo chamador: `aRemover` e `mantidas` vêm do consentimento item a item.
// A ordem (remover antes de gravar o manifesto) é a do `execute`. `mantidas` sem fonte neste pacote
// saem do conjunto e voltam em `semFonte`, para a borda anunciar.
export function applyUpdate(planned, { aRemover = [], mantidas = [], remove = rmSync, skipEntering = [] } = {}) {
  const { mantidas: mantem, semFonte } = splitKept(mantidas);
  const kept = keepDeclared(planned.plan, mantem);
  // Substituicao recusada ou bloqueada: o nome sai do plano ANTES do `execute`, para a pasta do
  // usuario ficar intacta e a skill nao ser declarada.
  const skip = new Set(skipEntering);
  const plan = skip.size ? {
    ...kept,
    skills: kept.skills.filter((nome) => !skip.has(nome)),
    targets: kept.targets.map((t) => (t.skills ? { ...t, skills: t.skills.filter((nome) => !skip.has(nome)) } : t)),
  } : kept;
  const result = execute(plan, { abandoned: aRemover, remove });
  return { ...result, semFonte };
}

// Tudo o que o update pergunta, na ordem abandonadas -> orfas candidatas -> substituicoes.
export function consentItems(planned) {
  return [
    ...planned.abandoned.map((item) => ({ kind: "abandoned", item })),
    ...planned.orphans.candidates.map((item) => ({ kind: "orphan", item })),
    ...(planned.occupied?.replaceable ?? []).map((item) => ({ kind: "replace", item })),
  ];
}

// A particao do consentimento vive no nucleo. `approvedPaths` sao os `item.path` absolutos aprovados.
// Orfa recusada vai para `keptOrphans`, NUNCA para `mantidas`: declara-la faria o `execute`
// reconstrui-la do pacote e sobrescrever o conteudo dela.
export function partitionConsent(planned, approvedPaths) {
  const out = { aRemover: [], mantidas: [], keptOrphans: [], declinedReplacements: [], blockedEntering: planned.occupied?.blocked ?? [] };
  for (const { kind, item } of consentItems(planned)) {
    const aprovado = approvedPaths.has(item.path);
    if (kind === "abandoned") (aprovado ? out.aRemover : out.mantidas).push(item);
    else if (kind === "orphan") (aprovado ? out.aRemover : out.keptOrphans).push(item);
    else if (!aprovado) out.declinedReplacements.push(item);
  }
  return out;
}

// Os nomes que ficam FORA do plano por causa do consentimento: substituicao recusada e pasta bloqueada.
// Fonte unica para `update()` e para a borda (`skipEntering` do `applyUpdate` e `keptEntering` do exit).
export function skippedByConsent(planned, part) {
  return [...part.declinedReplacements, ...(planned.occupied?.blocked ?? [])].map((x) => x.name);
}

// API pública de sempre (X-16): planeja e aplica SEM remover nada, que é o mesmo resultado de "sem
// terminal e sem -y". Quem decide remover item a item é a borda, com `planUpdate` + `applyUpdate`.
export function update(scope, repo, { replaced = {}, lockfile = null, projectId = null } = {}) {
  const planned = planUpdate(scope, repo, { replaced, lockfile, projectId });
  // Sem consentimento possivel, nada e substituido: toda pasta ocupada fica de fora.
  const part = partitionConsent(planned, new Set());
  return applyUpdate(planned, { mantidas: part.mantidas, skipEntering: skippedByConsent(planned, part) });
}

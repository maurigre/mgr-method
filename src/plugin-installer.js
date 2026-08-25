// Orquestra os fluxos de skill plugável: add (resolve -> baixa -> verifica -> confirma ->
// aplica por motor -> trava no lockfile), remove e restore. Ponto de junção do núcleo:
// registry (procedência), plugin (schema/checksum), adapters (tradução por motor) e
// lockfile (contrato do time). Não importa `installer.js`: os diretórios de destino chegam
// prontos em `targets` (DAG da spec seção 1 — nada de ciclo com a borda).
//
// Invariantes vindos da spec/ADR-0006/ADR-0007:
//   - nenhum byte vai ao disco antes de checksum validado E confirmação humana concedida;
//   - `mgr add` sem callback de confirmação não existe (sem bypass nesta fase);
//   - o lockfile é atualizado na mesma operação que instala.
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregateChecksum, assertValidManifest, MANIFEST_NAME, parseSkillName, sha256 } from "./plugin.js";
import { listRegistries, resolve } from "./registry.js";
import { LOCKFILE_NAME, readLockfile, removeSkill, upsertSkill, writeLockfile } from "./lockfile.js";
import { readManifest } from "./manifest.js";
import { applyToEngine, resolveInstallDirName } from "./adapters.js";

// Exit code próprio do cancelamento pelo usuário (contrato de CLI da spec seção 5).
export const CANCELLED_EXIT_CODE = 2;

export class InstallCancelled extends Error {
  constructor(name) {
    super(`installation cancelled by the user: ${name}`);
    this.name = "InstallCancelled";
    this.exitCode = CANCELLED_EXIT_CODE;
  }
}

// O `path` de cada arquivo vem do registry (dado externo): só caminho relativo, para dentro
// da pasta da skill. Barra a travessia de diretório antes de qualquer escrita.
export function assertSafePath(filePath) {
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized.split(/[\\/]/).includes("..")) {
    throw new Error(`unsafe file path in registry entry: ${JSON.stringify(filePath)}`);
  }
  return normalized;
}

// Baixa os arquivos da entrada do index validando o sha256 individual e, no fim, o agregado
// (ADR-0005/ADR-0006). Tudo em memória: mismatch aborta sem ter escrito nada.
export async function download(entry, { fetchImpl }) {
  const files = [];
  for (const file of entry.files) {
    const filePath = assertSafePath(file.path);
    const response = await fetchImpl(file.url);
    if (!response.ok) {
      throw new Error(`skill file unavailable: ${file.url} (HTTP ${response.status})`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    const digest = sha256(content);
    if (digest !== file.sha256) {
      throw new Error(`checksum mismatch for ${filePath}: expected ${file.sha256}, got ${digest}`);
    }
    files.push({ path: filePath, content });
  }
  const checksum = aggregateChecksum(files);
  if (checksum !== entry.checksum) {
    throw new Error(`aggregate checksum mismatch for ${entry.name}: expected ${entry.checksum}, got ${checksum}`);
  }
  return { files, checksum };
}

// O manifest chega junto com os arquivos baixados. Divergência entre manifest e index é
// erro: o index é gerado a partir do manifest (ADR-0005), então divergir é sinal de
// adulteração ou de index desatualizado.
export function manifestFromFiles(files, entry) {
  const file = files.find((candidate) => candidate.path === MANIFEST_NAME);
  if (!file) {
    throw new Error(`skill package has no ${MANIFEST_NAME}: ${entry.name}`);
  }
  const manifest = assertValidManifest(JSON.parse(file.content.toString("utf8")));
  if (manifest.name !== entry.name || manifest.version !== entry.version) {
    throw new Error(`${MANIFEST_NAME} does not match the registry index: index has ${entry.name}@${entry.version}, manifest has ${manifest.name}@${manifest.version}`);
  }
  return manifest;
}

function writeSkillFiles(installedDir, files) {
  rmSync(installedDir, { recursive: true, force: true });
  for (const file of files) {
    const dest = path.join(installedDir, file.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }
  return installedDir;
}

// Colisão de pasta (Q1): outra skill de MESMO nome curto já travada, vinda de outro
// registry. A primeira instalada mantém a pasta limpa; a nova recebe o sufixo da origem.
function hasCollision(lockfile, name) {
  const { skill } = parseSkillName(name);
  return Object.keys(lockfile?.skills || {})
    .some((locked) => locked !== name && parseSkillName(locked).skill === skill);
}

const displayPath = (repo, absolute) => {
  const relative = path.relative(repo, absolute);
  return relative && !relative.startsWith("..") ? relative : absolute;
};

// A pasta instalada só pode ser apagada se ela FOR o plugin: o `mgr-manifest.json` com o
// nome correspondente é a prova. Sem isso, remover um plugin cujo nome curto coincide com o
// de uma skill do método apagaria a skill do método — a pasta é a mesma (ex.: o método
// instala `diagnosing-bugs` e o registry publica `@mgr/diagnosing-bugs`). Nunca apagar
// pasta que não se instalou.
function isPluginDir(installedDir, name) {
  const manifestFile = path.join(installedDir, MANIFEST_NAME);
  if (!existsSync(manifestFile)) return false;
  try {
    return JSON.parse(readFileSync(manifestFile, "utf8")).name === name;
  } catch {
    return false;
  }
}

// Classifica a pasta de destino (DT-3/ADR-0008). Cruzar disco com a lista de skills do
// metodo e o que separa "colisao com o metodo" (o usuario pode escolher) de "ocupante
// desconhecido" (recusa): sem esse cruzamento, ou se oferece substituir o que nao e do
// metodo, ou se recusa sem saida o que e.
export const TARGET_FREE = "free";
export const TARGET_SAME_PLUGIN = "same-plugin";
export const TARGET_METHOD_SKILL = "method-skill";
export const TARGET_FOREIGN = "foreign";

export function classifyTarget(installedDir, { name, methodSkills = [] }) {
  if (!existsSync(installedDir)) return TARGET_FREE;
  if (isPluginDir(installedDir, name)) return TARGET_SAME_PLUGIN;
  return methodSkills.includes(path.basename(installedDir)) ? TARGET_METHOD_SKILL : TARGET_FOREIGN;
}

const classifyAll = (context, dir, name) => context.targets.map((target) => {
  const installedDir = path.join(target.dir, dir);
  return {
    target, installedDir, methodSkill: path.basename(installedDir),
    kind: classifyTarget(installedDir, { name, methodSkills: context.methodSkills }),
  };
});

function refuseForeign(classified, name) {
  const foreign = classified.find((item) => item.kind === TARGET_FOREIGN);
  if (foreign) {
    throw new Error(
      `cannot install ${name}: ${foreign.installedDir} already holds another skill (no ${MANIFEST_NAME} for ${name})`,
    );
  }
}

async function installOne(name, context, state) {
  if (state.pending.has(name)) {
    throw new Error(`circular "extends" chain involving ${name}`);
  }
  const installedBefore = state.installed.find((result) => result.name === name);
  if (installedBefore) return installedBefore;

  const { entry, category, origin } = await resolve(name, context.registries, { fetchImpl: context.fetchImpl });
  const locked = state.lockfile?.skills?.[name];
  if (locked && locked.version !== entry.version) {
    throw new Error(`${name} is locked at ${locked.version}; updating a plugin is not supported yet (remove it first)`);
  }

  const { files, checksum } = await download(entry, { fetchImpl: context.fetchImpl });
  const manifest = manifestFromFiles(files, entry);

  const confirmed = await context.confirm({
    name, version: entry.version, category, origin, checksum,
    permissions: manifest.permissions || [],
    engines: context.targets.map((target) => target.engine),
    extends: manifest.extends || null,
  });
  if (!confirmed) throw new InstallCancelled(name);

  let base = null;
  if (manifest.extends) {
    state.pending.add(name);
    base = await installOne(manifest.extends, context, state);
    state.pending.delete(name);
  }

  let dir = resolveInstallDirName(parseSkillName(name).skill, origin.name, hasCollision(state.lockfile, name));
  let replaces = null;
  // Colisao com skill do METODO: o usuario decide, e a decisao vai para o lockfile
  // (ADR-0008). Ocupante desconhecido segue recusado. Tudo antes de qualquer escrita.
  const alvosClassificados = classifyAll(context, dir, name);
  refuseForeign(alvosClassificados, name);

  const collision = alvosClassificados.find((item) => item.kind === TARGET_METHOD_SKILL);
  if (collision) {
    if (typeof context.resolveCollision !== "function") {
      throw new Error(
        `${name} collides with the method skill "${collision.methodSkill}" in ${collision.installedDir}. `
        + "Resolving it requires an interactive choice; run `mgr add` instead",
      );
    }
    const alongsideDir = resolveInstallDirName(parseSkillName(name).skill, origin.name, true);
    const choice = await context.resolveCollision({
      name, methodSkill: collision.methodSkill, engine: collision.target.engine,
      replaceDir: dir, alongsideDir,
    });
    if (choice === "replace") {
      replaces = collision.methodSkill;
    } else if (choice === "alongside") {
      dir = alongsideDir;
      refuseForeign(classifyAll(context, dir, name), name);
    } else {
      throw new InstallCancelled(name);
    }
  }

  const dirs = {};
  const applied = {};
  for (const target of context.targets) {
    const installedDir = writeSkillFiles(path.join(target.dir, dir), files);
    const extendsBase = base ? displayPath(context.repo, base.dirs[target.engine]) : null;
    applied[target.engine] = applyToEngine(target.engine, installedDir, manifest, { extendsBase });
    dirs[target.engine] = installedDir;
  }

  const lockEntry = {
    version: entry.version,
    registry: origin.name,
    checksum,
    category,
    // `dir` fixa a pasta escolhida no momento da instalação: sem ele, remove/restore
    // recalculariam a colisão num estado diferente e deixariam pasta órfã.
    dir,
    engines: context.targets.map((target) => target.engine),
    applied,
  };
  if (replaces) lockEntry.replaces = replaces;
  if (manifest.extends) lockEntry.extends = manifest.extends;

  state.lockfile = upsertSkill(state.lockfile, name, lockEntry, origin);
  const result = { name, dir, dirs, entry: lockEntry, warnings: warningsOf(applied) };
  state.installed.push(result);
  return result;
}

const warningsOf = (applied) => Object.entries(applied)
  .flatMap(([engine, block]) => (block.warnings || []).map((warning) => ({ engine, warning })));

// Instala a skill plugável (e a base, quando o manifest declara `extends` — DT-5).
// `targets` = [{engine, dir}] (pastas dos motores, vindas da borda); `confirm` = callback
// obrigatório de confirmação humana; `fetchImpl` = fetch injetado (Humble Object).
export async function add(name, { repo, coreDir, targets, fetchImpl, confirm, resolveCollision }) {
  if (typeof confirm !== "function") {
    throw new Error("mgr add requires a human confirmation callback (there is no bypass in this phase)");
  }
  if (!targets?.length) {
    throw new Error("mgr add requires at least one engine target");
  }
  const context = {
    repo, targets, fetchImpl, confirm, resolveCollision,
    registries: listRegistries(coreDir),
    // Projeto sem o método instalado é estado legítimo: sem manifesto, nenhuma pasta
    // conta como skill do método, então ocupante inesperado cai em `foreign` (recusa).
    methodSkills: readManifest(coreDir)?.skills || [],
  };
  const state = { lockfile: readLockfile(repo), installed: [], pending: new Set() };
  await installOne(name, context, state);
  const lockfile = writeLockfile(repo, state.lockfile);
  return { installed: state.installed, lockfile };
}

// Remove a skill plugável dos motores e do lockfile na mesma operação (ADR-0006 §6).
// Só a pasta da própria skill sai: `_shared/` e as skills do método nunca são tocadas.
// Pasta ocupada por outra coisa é PULADA e devolvida em `skipped` para a borda avisar —
// pular em silêncio esconderia do usuário que sobrou arquivo do plugin no disco.
export function remove(name, { repo, targets }) {
  const lockfile = readLockfile(repo);
  const entry = lockfile?.skills?.[name];
  if (!entry) {
    throw new Error(`skill not installed as a plugin: ${name}`);
  }
  const dependents = Object.entries(lockfile.skills)
    .filter(([, locked]) => locked.extends === name)
    .map(([dependent]) => dependent);
  if (dependents.length) {
    throw new Error(`${name} is extended by ${dependents.join(", ")}; remove the extending skill first`);
  }

  const removed = [];
  const skipped = [];
  // Só os motores TRAVADOS na entrada (ADR-0006 §6 — o lockfile é a fonte de verdade):
  // pasta de mesmo nome num motor onde o plugin não foi instalado não é tocada.
  for (const target of targets) {
    if (!entry.engines.includes(target.engine)) continue;
    const installedDir = path.join(target.dir, entry.dir);
    if (!existsSync(installedDir)) continue;
    if (!isPluginDir(installedDir, name)) {
      skipped.push({ engine: target.engine, dir: installedDir });
      continue;
    }
    rmSync(installedDir, { recursive: true, force: true });
    removed.push(installedDir);
  }
  return { removed, skipped, entry, lockfile: writeLockfile(repo, removeSkill(lockfile, name)) };
}

// Reinstala o conjunto EXATO travado no lockfile (semântica de restore do ADR-0006 §4):
// resolve cada skill no registry TRAVADO (não no config da máquina), confere versão e
// checksum e reescreve as pastas. Sem confirmação humana: o conjunto já foi confirmado por
// quem rodou o `mgr add` e revisado no commit do lockfile — o gate de ADR-0007 é o `add`.
// O lockfile não é reescrito: aqui ele é a fonte de verdade, não o resultado.
export async function restore({ repo, targets, fetchImpl }) {
  const lockfile = readLockfile(repo);
  if (!lockfile) return null;
  const registries = Object.entries(lockfile.registries || {})
    .map(([name, registry]) => ({ name, ...registry }));

  const restored = [];
  for (const [name, locked] of Object.entries(lockfile.skills)) {
    const { entry } = await resolve(name, registries, { fetchImpl });
    if (entry.version !== locked.version || entry.checksum !== locked.checksum) {
      throw new Error(`${name} does not match ${LOCKFILE_NAME}: locked ${locked.version} (${locked.checksum}), registry serves ${entry.version} (${entry.checksum})`);
    }
    const { files } = await download(entry, { fetchImpl });
    const manifest = manifestFromFiles(files, entry);

    const dirs = {};
    for (const target of targets) {
      if (!locked.engines.includes(target.engine)) continue;
      const installedDir = writeSkillFiles(path.join(target.dir, locked.dir), files);
      const extendsBase = locked.extends
        ? displayPath(repo, path.join(target.dir, lockedDirOf(lockfile, locked.extends, name)))
        : null;
      applyToEngine(target.engine, installedDir, manifest, { extendsBase });
      dirs[target.engine] = installedDir;
    }
    // Motor travado sem target ativo nesta instalação: degradação EXPLÍCITA (D05) — a
    // borda avisa em vez de restaurar parcialmente em silêncio.
    const skippedEngines = locked.engines.filter(
      (engine) => !targets.some((target) => target.engine === engine),
    );
    restored.push({ name, dir: locked.dir, dirs, skippedEngines });
  }
  return { restored, skills: restored.map((skill) => skill.name) };
}

function lockedDirOf(lockfile, baseName, extendingName) {
  const base = lockfile.skills[baseName];
  if (!base) {
    throw new Error(`${LOCKFILE_NAME} is inconsistent: ${extendingName} extends ${baseName}, which is not locked`);
  }
  return base.dir;
}

// Nomes dos plugins travados que estão REALMENTE no disco, com a prova de posse de sempre
// (`mgr-manifest.json` correspondente). Alimenta o `diff` do lockfile: o que está travado e
// não aparece aqui é divergência entre o contrato do time e a máquina (DT-8/RN-8).
// Fica no núcleo, não na borda, porque é regra de domínio — a borda só imprime (INV-5/INV-6).
export function installedPluginNames(lockfile, targets) {
  const presentes = [];
  for (const [name, entry] of Object.entries(lockfile?.skills || {})) {
    const alvos = targets.filter((target) => entry.engines.includes(target.engine));
    const emTodos = alvos.length > 0
      && alvos.every((target) => isPluginDir(path.join(target.dir, entry.dir), name));
    if (emTodos) presentes.push(name);
  }
  return presentes;
}

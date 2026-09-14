import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import * as bundle from "../src/bundle.js";
import {
  AGENT_MARKER, agentDeclares, agentFrontmatter, buildRuntime, inheritingModel, buildSkill, gateSummary, installAgents,
  installEngine, isOurAgent, resolveLaws, resolveUserLanguage, routeReviewSkill,
} from "../src/builder.js";
import * as installer from "../src/installer.js";
import * as catalog from "../src/catalog.js";
import { get as engineDescriptor, ids as engineIds } from "../src/engines/index.js";
import { collectInstallAnswers, detectUserLanguage, CANCELLED } from "../src/prompts.js";
import { getMessages } from "../src/messages.js";
import { validateAll, validateSkill, checkSkill } from "../src/validator.js";
import { aggregateChecksum, sha256 } from "../src/plugin.js";
import { add as addPlugin } from "../src/plugin-installer.js";
import { addRegistry, readAgents, writeAgentPolicy, writeConfig } from "../src/registry.js";
import { eventsFor, hookCommand, removeHook, writeHook, writtenEvents } from "../src/hooks.js";
import { readLockfile } from "../src/lockfile.js";
import { captureCli } from "../scripts/capture-cli-baseline.mjs";

const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-"));
const CORE = ["spec-init", "spec-create", "spec-execute", "adr-create", "code-analyzer", "diagnosing-bugs"];

test("skills do fluxo SDD presentes e válidas", () => {
  const names = bundle.skillNames();
  for (const n of CORE) assert.ok(names.includes(n), `faltando ${n}`);
  for (const [n, problems] of Object.entries(validateAll())) {
    assert.equal(problems.length, 0, `${n}: ${problems.join("; ")}`);
  }
});

test("selectSkills monta o subconjunto por linguagem/arquitetura", () => {
  const s = catalog.selectSkills({ architecture: "hexagonal", language: "java" });
  for (const c of CORE) assert.ok(s.includes(c), c);
  assert.ok(s.includes("arch-hexagonal") && s.includes("junit-clean"));
  assert.ok(!s.includes("arch-clean") && !s.includes("arch-onion") && !s.includes("arch-layered"));
  assert.ok(!s.includes("evidence-capture"));

  const s2 = catalog.selectSkills({ architecture: "clean", optional: ["evidence-capture"] });
  assert.ok(s2.includes("arch-clean") && s2.includes("evidence-capture"));
  assert.ok(!s2.includes("junit-clean"));

  assert.throws(() => catalog.selectSkills({ architecture: "xyz" }), /arquitetura desconhecida/);
});

test("install autossuficiente: só o subconjunto na pasta do motor, sem .mgr-core", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { language: "java", architecture: "hexagonal" }));
  const sk = path.join(repo, ".claude", "skills");

  for (const n of [...CORE, "arch-hexagonal", "junit-clean"]) {
    assert.ok(existsSync(path.join(sk, n, "SKILL.md")), `deveria instalar ${n}`);
  }
  for (const n of ["arch-clean", "arch-onion", "arch-layered", "evidence-capture"]) {
    assert.ok(!existsSync(path.join(sk, n)), `${n} não deveria existir`);
  }
  // .mgr-core existe como CONFIG (manifest + .env), sem skills dentro
  const core = path.join(repo, ".mgr-core");
  assert.ok(existsSync(path.join(core, "manifest.json")), "deve criar .mgr-core/manifest.json");
  assert.ok(!existsSync(path.join(core, "skills")), ".mgr-core não deve conter skills");
  assert.match(readFileSync(path.join(core, ".env"), "utf8"), /MGR_PROJECT_ID=/);

  assert.ok(existsSync(path.join(sk, "_shared", "arch", "cross-cutting-rules.md")));
  assert.ok(existsSync(path.join(sk, "_shared", "quality", "quality-rules.md")), "fonte de qualidade co-locada (spec-init)");
  const archMd = readFileSync(path.join(sk, "arch-hexagonal", "SKILL.md"), "utf8");
  assert.ok(!archMd.includes("{{MGR_ARCH_RULES}}"), "token deve ser resolvido");
  assert.ok(archMd.includes("_shared/arch/cross-cutting-rules.md"), "deve apontar para a fonte co-locada");

  const man = JSON.parse(readFileSync(path.join(core, "manifest.json"), "utf8"));
  assert.equal(man.model, "self-contained");
  assert.equal(man.architecture, "hexagonal");
  assert.equal(man.language, "java");
  assert.ok(man.projectId, "deve gravar projectId");
});

test("dois motores: cada um autossuficiente e independente", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code", "copilot"], "project", repo, { architecture: "onion" }));
  for (const dir of [".claude/skills", ".github/skills"]) {
    assert.ok(existsSync(path.join(repo, dir, "spec-init", "SKILL.md")), dir);
    assert.ok(existsSync(path.join(repo, dir, "arch-onion", "SKILL.md")), dir);
  }
  const man = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.deepEqual(man.engines, ["claude-code", "copilot"]);
});

test("migra instalação antiga (runtime-launcher) para o novo layout", () => {
  const repo = diretorioTemporario();
  const core = path.join(repo, ".mgr-core");
  mkdirSync(path.join(core, "skills"), { recursive: true });
  mkdirSync(path.join(repo, ".claude", "skills", "spec-init"), { recursive: true });
  writeFileSync(path.join(repo, ".claude", "skills", "spec-init", "SKILL.md"), "launcher antigo", "utf8");
  writeFileSync(path.join(core, "manifest.json"), JSON.stringify({
    model: "runtime-launcher", version: "0.0.1", engines: ["claude-code"], scope: "project",
    skillsDirs: [".claude/skills"], skills: ["spec-init"],
  }), "utf8");

  const res = installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  assert.ok(res.migrated, "deve reportar migração");
  assert.ok(!existsSync(path.join(core, "skills")), "conteúdo antigo (.mgr-core/skills) deve sumir");
  assert.ok(existsSync(path.join(core, "manifest.json")), ".mgr-core permanece como config");
  assert.equal(JSON.parse(readFileSync(path.join(core, "manifest.json"), "utf8")).model, "self-contained");
  const md = readFileSync(path.join(repo, ".claude/skills/spec-init/SKILL.md"), "utf8");
  assert.ok(md.includes("name: spec-init") && !md.includes("launcher antigo"));
});

test("uninstall remove skills e preserva docs/specs", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  mkdirSync(path.join(repo, "specs", "keep"), { recursive: true });

  installer.uninstall("project", repo);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/spec-init")));
  assert.ok(!existsSync(path.join(repo, ".claude/skills/_shared")));
  assert.ok(!existsSync(path.join(repo, ".mgr-core")), ".mgr-core (config) deve ser removido");
  assert.ok(existsSync(path.join(repo, "docs", "sdd")));
  assert.ok(existsSync(path.join(repo, "specs", "keep")));
});

test("projectId explícito vai para o manifest e o .env", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal", projectId: "nestapp-workspace" }));
  const man = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.equal(man.projectId, "nestapp-workspace");
  assert.match(readFileSync(path.join(repo, ".mgr-core", ".env"), "utf8"), /MGR_PROJECT_ID=nestapp-workspace/);
});

test("update re-sincroniza preservando o conjunto instalado", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean", language: "java" }));
  const res = installer.update("project", repo);
  assert.ok(res.skills.includes("arch-clean") && res.skills.includes("junit-clean"));
  assert.ok(!res.skills.includes("arch-hexagonal"));
});

test("userLanguage atravessa o plano até o manifesto; update preserva o valor existente", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean", userLanguage: "en" }));
  const manPath = path.join(repo, ".mgr-core", "manifest.json");
  assert.equal(JSON.parse(readFileSync(manPath, "utf8")).userLanguage, "en");
  installer.update("project", repo);
  assert.equal(JSON.parse(readFileSync(manPath, "utf8")).userLanguage, "en");
});

test("update backfilla userLanguage pt-BR em manifesto da era anterior", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean" }));
  const manPath = path.join(repo, ".mgr-core", "manifest.json");
  const man = JSON.parse(readFileSync(manPath, "utf8"));
  assert.equal(man.userLanguage, null, "instalação sem idioma explícito grava null");
  delete man.userLanguage;
  writeFileSync(manPath, JSON.stringify(man, null, 2), "utf8");

  installer.update("project", repo);
  assert.equal(JSON.parse(readFileSync(manPath, "utf8")).userLanguage, "pt-BR");
});

test("copilot vai para .github/skills sem tocar .claude", () => {
  const repo = diretorioTemporario();
  installer.execute(installer.planInstall(["copilot"], "project", repo, { architecture: "hexagonal" }));
  assert.ok(existsSync(path.join(repo, ".github/skills/code-analyzer/SKILL.md")));
  assert.ok(!existsSync(path.join(repo, ".claude")));
});

test("instalação com --skills-dir (custom) resolve o token do shared", () => {
  const repo = diretorioTemporario();
  const custom = path.join(repo, "meus-skills");
  const plan = installer.planInstall([], "project", repo, { skillsDir: custom, names: ["spec-init", "arch-clean"] });
  assert.deepEqual(plan.engines, ["custom"]);
  installer.execute(plan);
  assert.ok(existsSync(path.join(custom, "spec-init", "SKILL.md")));
  assert.ok(existsSync(path.join(custom, "_shared", "arch", "cross-cutting-rules.md")));
  assert.ok(!readFileSync(path.join(custom, "arch-clean", "SKILL.md"), "utf8").includes("{{MGR_ARCH_RULES}}"));
});

test("detect, installs e detectPrior enxergam a instalação", () => {
  const repo = diretorioTemporario();
  assert.equal(installer.detectPrior("project", repo), null);
  assert.deepEqual(installer.installs("project", repo), []);
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));

  assert.ok(installer.detect(repo).some((f) => f.path.endsWith(path.join(".claude", "skills")) && f.count >= 1));
  const prior = installer.detectPrior("project", repo);
  assert.ok(prior && prior.model === "self-contained");
  assert.equal(installer.installs("project", repo).length, 1);
});

test("update e uninstall exigem instalação existente", () => {
  const repo = diretorioTemporario();
  assert.throws(() => installer.update("project", repo), /rode `mgr install`/);
  assert.throws(() => installer.uninstall("project", repo), /nada a desinstalar/);
});

test("getMessages: en é o default e qualquer pt-* seleciona a tabela pt-BR", () => {
  assert.equal(getMessages(null).aborted, "aborted.");
  assert.equal(getMessages("en-US").aborted, "aborted.");
  assert.equal(getMessages("es-ES").aborted, "aborted.");
  assert.equal(getMessages("pt-BR").aborted, "abortado.");
  assert.equal(getMessages("pt").confirmInstall, "Confirmar instalação?");
  assert.equal(getMessages("PT-PT").uninstalled, "Desinstalado.");
});

test("as tabelas en e pt-BR têm exatamente as mesmas chaves", () => {
  const en = Object.keys(getMessages("en")).sort();
  const ptBR = Object.keys(getMessages("pt-BR")).sort();
  assert.deepEqual(ptBR, en);
  for (const key of en) {
    assert.equal(typeof getMessages("pt-BR")[key], typeof getMessages("en")[key], key);
  }
});

test("collectInstallAnswers usa a tabela de mensagens injetada (pt-BR)", async () => {
  const repo = diretorioTemporario();
  const vistas = [];
  const ask = {
    multiselect: async ({ message }) => { vistas.push(message); return ["claude-code"]; },
    select: async ({ message }) => {
      vistas.push(message);
      return /Arquitetura/.test(message) ? "layered" : /Linguagem/.test(message) ? "outra" : /Idioma de saída/.test(message) ? "pt-BR" : "project";
    },
    confirm: async () => false,
    text: async () => "meu-projeto",
    isCancel: () => false,
  };
  const out = await collectInstallAnswers(ask, {}, { repo, msg: getMessages("pt-BR") });
  assert.ok(vistas.some((m) => /motores devem receber/.test(m)));
  assert.ok(vistas.some((m) => /Idioma de saída/.test(m)));
  assert.equal(out.userLanguage, "pt-BR");
  assert.equal(out.architecture, "layered");
});

test("resolveUserLanguage troca o token pelo idioma ou pelo fallback", () => {
  const linha = `Output language: ${catalog.USER_LANGUAGE_TOKEN} — always.`;
  assert.equal(resolveUserLanguage(linha, "pt-BR"), "Output language: pt-BR — always.");
  assert.equal(resolveUserLanguage(linha, null), `Output language: ${catalog.USER_LANGUAGE_FALLBACK} — always.`);
  assert.equal(resolveUserLanguage("sem token", "en"), "sem token");
});

test("install limpa a fonte co-locada legada (nomes pt) e não deixa token de idioma", () => {
  const repo = diretorioTemporario();
  const sk = path.join(repo, ".claude", "skills");
  mkdirSync(path.join(sk, "_shared", "arch"), { recursive: true });
  mkdirSync(path.join(sk, "_shared", "quality"), { recursive: true });
  writeFileSync(path.join(sk, "_shared", "arch", "regras-transversais.md"), "legado", "utf8");
  writeFileSync(path.join(sk, "_shared", "quality", "regras-qualidade.md"), "legado", "utf8");

  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal", userLanguage: "pt-BR" }));
  assert.ok(!existsSync(path.join(sk, "_shared", "arch", "regras-transversais.md")), "legado arch removido");
  assert.ok(!existsSync(path.join(sk, "_shared", "quality", "regras-qualidade.md")), "legado quality removido");
  assert.ok(existsSync(path.join(sk, "_shared", "arch", "cross-cutting-rules.md")), "fonte nova presente");
  for (const n of ["spec-init", "arch-hexagonal"]) {
    assert.ok(!readFileSync(path.join(sk, n, "SKILL.md"), "utf8").includes(catalog.USER_LANGUAGE_TOKEN), n);
  }
});

test("catálogo expõe arquiteturas e linguagens", () => {
  assert.ok(catalog.architectures().includes("hexagonal"));
  assert.ok(catalog.languages().includes("java"));
});

test("detectUserLanguage: parse do locale com precedência LC_ALL > LC_MESSAGES > LANG", () => {
  assert.equal(detectUserLanguage({ LANG: "pt_BR.UTF-8" }), "pt-BR");
  assert.equal(detectUserLanguage({ LANG: "en_US.UTF-8" }), "en-US");
  assert.equal(detectUserLanguage({}), "en");
  assert.equal(detectUserLanguage({ LANG: "C" }), "en");
  assert.equal(detectUserLanguage({ LANG: "POSIX" }), "en");
  assert.equal(detectUserLanguage({ LC_MESSAGES: "es_ES.UTF-8", LANG: "pt_BR.UTF-8" }), "es-ES");
  assert.equal(detectUserLanguage({ LC_ALL: "fr_FR@euro", LC_MESSAGES: "es_ES", LANG: "pt_BR" }), "fr-FR");
});

test("collectInstallAnswers: coleta completa via prompter injetado", async () => {
  const repo = diretorioTemporario();
  const ask = {
    multiselect: async () => ["claude-code"],
    select: async ({ message }) =>
      /architecture/i.test(message) ? "clean" : /programming/.test(message) ? "java" : /Output language/.test(message) ? "pt-BR" : "project",
    confirm: async () => true,
    text: async () => "meu-projeto",
    isCancel: () => false,
  };
  const out = await collectInstallAnswers(ask, {}, { repo });
  assert.deepEqual(out.engines, ["claude-code"]);
  assert.equal(out.scope, "project");
  assert.equal(out.architecture, "clean");
  assert.equal(out.language, "java");
  assert.equal(out.userLanguage, "pt-BR");
  assert.deepEqual(out.optional, ["evidence-capture"]);
  assert.equal(out.projectId, "meu-projeto");
});

test("collectInstallAnswers: linguagem 'outra' vira null; projectId vazio cai no nome da pasta", async () => {
  const repo = diretorioTemporario();
  const ask = {
    multiselect: async () => ["copilot"],
    select: async ({ message }) =>
      /architecture/i.test(message) ? "onion" : /programming/.test(message) ? "outra" : /Output language/.test(message) ? "outro" : "project",
    confirm: async () => false,
    text: async () => "",
    isCancel: () => false,
  };
  const out = await collectInstallAnswers(ask, {}, { repo, env: { LANG: "es_ES.UTF-8" } });
  assert.equal(out.language, null);
  assert.equal(out.userLanguage, "es-ES");
  assert.deepEqual(out.optional, []);
  assert.equal(out.projectId, path.basename(repo));
});

test("collectInstallAnswers: cancelamento em qualquer prompt retorna CANCELLED", async () => {
  const repo = diretorioTemporario();
  const CANCEL = Symbol("cancel");
  const cancelando = (onde) => ({
    multiselect: async () => (onde === "engines" ? CANCEL : ["claude-code"]),
    select: async ({ message }) => {
      if (onde === "scope" && /scope/.test(message)) return CANCEL;
      if (onde === "arch" && /architecture/i.test(message)) return CANCEL;
      if (onde === "lang" && /programming/.test(message)) return CANCEL;
      if (onde === "userlang" && /Output language/.test(message)) return CANCEL;
      if (/Output language/.test(message)) return "en";
      return /architecture/i.test(message) ? "hexagonal" : /programming/.test(message) ? "java" : "project";
    },
    confirm: async () => (onde === "optional" ? CANCEL : false),
    text: async () => (onde === "pid" ? CANCEL : "x"),
    isCancel: (v) => v === CANCEL,
  });
  for (const onde of ["engines", "scope", "arch", "lang", "userlang", "optional", "pid"]) {
    assert.equal(await collectInstallAnswers(cancelando(onde), {}, { repo }), CANCELLED, onde);
  }
});

test("collectInstallAnswers: não pergunta o que já veio por flag (--all-skills pula arch/lang/opcional)", async () => {
  const repo = diretorioTemporario();
  const naoPergunta = { isCancel: () => false };
  const out = await collectInstallAnswers(
    naoPergunta,
    { engines: ["copilot"], scope: "global", projectId: "x", userLanguage: "en" },
    { repo, allSkills: true }
  );
  assert.deepEqual(out.engines, ["copilot"]);
  assert.equal(out.scope, "global");
  assert.equal(out.projectId, "x");
  assert.equal(out.architecture, null);
  assert.equal(out.userLanguage, "en");
  assert.deepEqual(out.optional, []);
});

test("CLI: comandos básicos e ciclo de vida (smoke)", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  // Locale fixado: as mensagens da CLI seguem o idioma (flag > manifesto > locale) e o
  // ambiente do runner varia (dev pt_BR, CI C) — sem fixar, os asserts oscilariam.
  // `cwd` em diretório vazio: o manifesto VENCE o locale, e este repositório se auto-instala
  // para dogfooding — rodando na raiz, o .mgr-core local decidiria o idioma da CLI sob teste.
  const neutro = diretorioTemporario();
  const run = (args, env = {}) =>
    execFileSync("node", [bin, ...args], {
      encoding: "utf8", cwd: neutro, env: { ...process.env, LC_ALL: "pt_BR.UTF-8", ...env },
    });

  assert.match(run(["version"]), /mgr-method \d+\.\d+\.\d+/);
  assert.ok(run(["list"]).includes("spec-init"));
  assert.ok(run(["validate"]).includes("spec-init"));
  assert.match(run(["help"]), /Uso: mgr/);
  const helpEn = run(["help"], { LC_ALL: "en_US.UTF-8" });
  assert.match(helpEn, /Usage: mgr/);
  assert.match(helpEn, /SDD for coding agents/);
  assert.match(helpEn, /Método Governado por Rastreabilidade/, "a marca não se traduz");
  // O `help` NÃO entra na baseline de CLI (ela captura list/install/status/update), então a
  // presença do subcomando novo só é protegida aqui.
  assert.match(run(["help"]), /spec validate\s+valida o plano e a spec deste projeto/);
  assert.match(helpEn, /spec validate\s+validates this project's plan and spec artifacts/);

  const repo = diretorioTemporario();
  const flags = ["--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y"];

  run(["install", ...flags, "--dry-run", repo]);
  assert.ok(!existsSync(path.join(repo, ".claude")), "dry-run não escreve");

  run(["install", ...flags, repo]);
  assert.equal(
    JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8")).userLanguage,
    "pt-BR",
    "-y sem flag herda o locale, nunca null"
  );
  assert.match(run(["status", repo]), /self-contained/);
  assert.match(run(["update", repo]), /Re-sincronizado/);
  assert.match(run(["uninstall", "-y", repo]), /Desinstalado/);

  const out = path.join(diretorioTemporario(), "rt");
  run(["build", "--out", out]);
  assert.ok(existsSync(path.join(out, "skills")));

  assert.throws(() => run(["comando-inexistente"]), /Command failed/);
  assert.throws(() => run(["install", "--flag-invalida"]), /Command failed/);
});

test("CLI: install migra instalação antiga sem crash (smoke)", () => {
  const repo = diretorioTemporario();
  mkdirSync(path.join(repo, ".mgr-core", "skills"), { recursive: true });
  mkdirSync(path.join(repo, ".claude", "skills", "spec-init"), { recursive: true });
  writeFileSync(path.join(repo, ".claude", "skills", "spec-init", "SKILL.md"), "antigo", "utf8");
  writeFileSync(path.join(repo, ".mgr-core", "manifest.json"), JSON.stringify({
    model: "runtime-launcher", version: "0.2.0", engines: ["claude-code"], scope: "project",
    skillsDirs: [".claude/skills"], skills: ["spec-init"],
  }), "utf8");

  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const out = execFileSync("node", [bin, "install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", repo], { encoding: "utf8" });
  assert.doesNotMatch(out, /is not a function/);
  assert.ok(!existsSync(path.join(repo, ".mgr-core", "skills")), "deve migrar (remover .mgr-core/skills)");
  assert.ok(readFileSync(path.join(repo, ".claude/skills/spec-init/SKILL.md"), "utf8").includes("name: spec-init"));
});

test("planInstall rejeita motor desconhecido", () => {
  assert.throws(() => installer.planInstall(["motor-x"], "project", diretorioTemporario(), { architecture: "hexagonal" }), /motor inválido/);
});

test("buildRuntime gera skills + shared num diretório", () => {
  const dir = path.join(diretorioTemporario(), "rt");
  buildRuntime(dir, ["spec-init"]);
  assert.ok(existsSync(path.join(dir, "skills", "spec-init", "SKILL.md")));
  assert.ok(existsSync(path.join(dir, "shared", "arch", "cross-cutting-rules.md")));
});

test("bundle.pkgDir lança para recurso ausente e readVersion retorna semver", () => {
  assert.throws(() => bundle.pkgDir("nao-existe"), /recurso do MGR ausente/);
  assert.match(bundle.readVersion(), /^\d+\.\d+\.\d+/);
  assert.ok(existsSync(bundle.skillsDir()) && existsSync(bundle.sharedDir()));
});

test("buildSkill lança para skill inexistente", () => {
  assert.throws(() => buildSkill("nao-existe", path.join(diretorioTemporario(), "skills")), /skill inexistente/);
});

test("validateSkill reporta SKILL.md ausente", () => {
  assert.deepEqual(validateSkill("nao-existe"), ["nao-existe: falta SKILL.md"]);
});

test("checkSkill cobre frontmatter, name, description e tamanho", () => {
  const desc = "d".repeat(50);
  assert.deepEqual(checkSkill("x", "sem frontmatter"), ["x: sem frontmatter YAML (--- ... ---)"]);

  const semName = checkSkill("foo", `---\ndescription: ${desc}\n---\n`);
  assert.ok(semName.some((p) => p.includes("sem `name`")));

  const nomeRuim = checkSkill("foo", `---\nname: Foo Bar\ndescription: ${desc}\n---\n`);
  assert.ok(nomeRuim.some((p) => p.includes("kebab-case")));
  assert.ok(nomeRuim.some((p) => p.includes("difere do nome da pasta")));

  const descCurta = checkSkill("foo", "---\nname: foo\ndescription: curta\n---\n");
  assert.ok(descCurta.some((p) => p.includes("curta demais")));

  const longo = checkSkill("foo", `---\nname: foo\ndescription: ${desc}\n---\n${"\n".repeat(501)}`);
  assert.ok(longo.some((p) => p.includes("linhas")));

  assert.deepEqual(checkSkill("foo", `---\nname: foo\ndescription: ${desc}\n---\n`), []);
});

test("CLI: mgr add exige nome e terminal interativo, sem flag de bypass", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const neutro = diretorioTemporario();
  const run = (args, env = {}) => {
    try {
      const stdout = execFileSync("node", [bin, ...args], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: neutro,
        env: { ...process.env, LC_ALL: "pt_BR.UTF-8", ...env },
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      return { status: error.status, stdout: error.stdout, stderr: error.stderr };
    }
  };

  const semNome = run(["add"]);
  assert.equal(semNome.status, 1);
  assert.match(semNome.stderr, /uso: mgr add <@registry\/skill>/);

  const semTty = run(["add", "@mgr/junit-clean"]);
  assert.equal(semTty.status, 1);
  assert.match(semTty.stderr, /exige terminal interativo/);
  assert.match(run(["add", "@mgr/junit-clean"], { LC_ALL: "en_US.UTF-8" }).stderr, /requires an interactive terminal/);
  assert.doesNotMatch(run(["add", "@mgr/junit-clean", "-y"]).stderr, /instalada/);
});

test("CLI: mgr registry add/list/remove persiste em .mgr-core/config.json", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const run = (args) => execFileSync("node", [bin, ...args], {
    encoding: "utf8", cwd: repo, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });
  const config = path.join(repo, ".mgr-core", "config.json");
  const url = "https://raw.githubusercontent.com/maurigre/mgr-registry/main/index.json";

  assert.match(run(["registry", "list"]), /Nenhum registry configurado/);
  assert.match(run(["registry", "add", "mgr", url, "--trusted"]), /registry "mgr" adicionado/);
  assert.deepEqual(JSON.parse(readFileSync(config, "utf8")).registries, [{ name: "mgr", url, trusted: true }]);

  run(["registry", "add", "empresa", "https://registry.empresa.dev/index.json"]);
  const listed = run(["registry", "list"]);
  assert.match(listed, /mgr \(confiável\)/);
  assert.match(listed, /empresa {2}https:\/\/registry.empresa.dev/);

  assert.match(run(["registry", "remove", "empresa"]), /registry "empresa" removido/);
  assert.deepEqual(JSON.parse(readFileSync(config, "utf8")).registries.map((r) => r.name), ["mgr"]);

  assert.throws(() => run(["registry", "add", "mgr", url]), /Command failed/);
  assert.throws(() => run(["registry", "listar"]), /Command failed/);
  assert.throws(() => run(["remove"]), /Command failed/);
});

test("CLI: list e status ganham as seções de plugin só quando há lockfile ou registry", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const run = (args) => execFileSync("node", [bin, ...args], {
    encoding: "utf8", cwd: repo, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });

  const semPlugins = run(["list"]);
  assert.doesNotMatch(semPlugins, /Skills plugáveis instaladas|Disponíveis nos registries/);

  writeFileSync(path.join(repo, "mgr-skills.lock"), JSON.stringify({
    lockfileVersion: 1,
    registries: { mgr: { url: "https://raw.example/index.json", trusted: true } },
    skills: {
      "@mgr/junit-clean": {
        version: "1.0.0", registry: "mgr", checksum: `sha256-${"a".repeat(64)}`,
        category: "language", dir: "junit-clean", engines: ["claude-code"], applied: {},
      },
    },
  }, null, 2) + "\n", "utf8");

  const comLockfile = run(["list"]);
  assert.match(comLockfile, /Skills plugáveis instaladas/);
  assert.match(comLockfile, /@mgr\/junit-clean@1\.0\.0 {2}\(registry: mgr, pasta: junit-clean\)/);
  assert.ok(comLockfile.startsWith(semPlugins), "o catálogo do método sai antes e intocado");

  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  const status = run(["status"]);
  assert.match(status, /plugins: mgr-skills\.lock/);
  assert.match(status, /@mgr\/junit-clean@1\.0\.0 \(mgr\)/);
});

test("CLI: install e update restauram o conjunto travado no lockfile (registry HTTP local)", async () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const skillMd = "---\nname: junit-clean\ndescription: Standardizes Java unit tests with JUnit 5 following strict rules.\n---\n\n# junit-clean\n";
  const manifest = {
    name: "@mgr/junit-clean", version: "1.0.0", author: "Mauri Reis",
    description: "Standardizes Java unit tests with JUnit 5 following strict quality rules.",
    category: "language", permissions: ["read-files"],
    model: { "claude-code": "sonnet" }, effort: "medium",
  };
  const contents = [
    { path: "SKILL.md", content: Buffer.from(skillMd, "utf8") },
    { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];

  const server = createServer((request, response) => {
    const file = contents.find((candidate) => request.url === `/junit-clean/${candidate.path}`);
    if (request.url === "/index.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(index));
      return;
    }
    if (!file) { response.statusCode = 404; response.end("not found"); return; }
    response.end(file.content);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = {
    indexVersion: 1, registry: "mgr", generatedAt: "2026-07-21T00:00:00.000Z",
    categories: {
      language: [{
        name: "@mgr/junit-clean", version: "1.0.0", description: manifest.description,
        checksum: aggregateChecksum(contents),
        files: contents.map((file) => ({ path: file.path, url: `${base}/junit-clean/${file.path}`, sha256: sha256(file.content) })),
      }],
    },
  };

  const lockfile = {
    lockfileVersion: 1,
    registries: { mgr: { url: `${base}/index.json`, trusted: true } },
    skills: {
      "@mgr/junit-clean": {
        version: "1.0.0", registry: "mgr", checksum: index.categories.language[0].checksum,
        category: "language", dir: "junit-clean", engines: ["claude-code"],
        applied: { "claude-code": { model: "sonnet", effort: "medium" } },
      },
    },
  };
  writeFileSync(path.join(repo, "mgr-skills.lock"), JSON.stringify(lockfile, null, 2) + "\n", "utf8");

  const run = async (args, options = {}) => (await promisify(execFile)("node", [bin, ...args], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "pt_BR.UTF-8" }, ...options,
  })).stdout;

  try {
    const installed = await run(["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", repo]);
    assert.match(installed, /Restaurando skills plugáveis de mgr-skills\.lock/);
    assert.match(installed, /1 skill\(s\) plugável\(is\) restaurada\(s\)/);
    const installedMd = readFileSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md"), "utf8");
    assert.match(installedMd, /^model: sonnet$/m);
    assert.match(installedMd, /^effort: medium$/m);
    assert.match(await run(["update", repo]), /1 skill\(s\) plugável\(is\) restaurada\(s\)/);

    assert.match(await run(["remove", "@mgr/junit-clean"], { cwd: repo }), /@mgr\/junit-clean removida/);
    assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")));
    assert.ok(existsSync(path.join(repo, ".claude/skills/spec-init/SKILL.md")), "skills do método intactas");

    const adulterado = diretorioTemporario();
    writeFileSync(path.join(adulterado, "mgr-skills.lock"), JSON.stringify({
      ...lockfile,
      skills: { "@mgr/junit-clean": { ...lockfile.skills["@mgr/junit-clean"], checksum: `sha256-${"0".repeat(64)}` } },
    }, null, 2) + "\n", "utf8");
    await assert.rejects(
      run(["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y", adulterado]),
      /does not match mgr-skills.lock/,
    );
    assert.ok(!existsSync(path.join(adulterado, ".claude/skills/junit-clean")), "checksum divergente não escreve o plugin");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("regressão §2.7: a saída da CLI só muda por decisão deliberada", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const home = diretorioTemporario();

  const atual = captureCli(bin, { repo, home });
  const arquivo = readFileSync(fileURLToPath(new URL("./fixtures/cli-baseline.txt", import.meta.url)), "utf8");
  // A fixture abre com linhas de comentário explicando como regenerá-la; só o corpo conta.
  const baseline = arquivo.split("\n").filter((linha) => !linha.startsWith("#")).join("\n");

  assert.equal(atual, baseline,
    "install/list/status/update mudaram: se foi deliberado, regenere com `node scripts/capture-cli-baseline.mjs working-tree`");
  assert.ok(!existsSync(path.join(repo, "mgr-skills.lock")), "nenhum lockfile criado");
  assert.ok(!existsSync(path.join(repo, ".mgr-core", "config.json")), "nenhum config de registry criado");
  for (const lang of ["en", "pt-BR"]) {
    const msg = getMessages(lang);
    for (const titulo of [msg.pluginsInstalledTitle, msg.pluginsAvailableTitle, msg.registryListTitle]) {
      assert.ok(!atual.includes(titulo), `seção de plugin vazou na saída: ${titulo}`);
    }
  }
});

test("CLI: status de projeto só com plugin não se contradiz nem falha", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const run = (args) => {
    try {
      return { status: 0, stdout: execFileSync("node", [bin, ...args], {
        encoding: "utf8", cwd: repo, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
      }) };
    } catch (error) {
      return { status: error.status, stdout: error.stdout };
    }
  };

  const vazio = run(["status"]);
  assert.equal(vazio.status, 1, "projeto sem nada segue saindo 1");
  assert.match(vazio.stdout, /Nenhuma instalação MGR encontrada/);

  writeFileSync(path.join(repo, "mgr-skills.lock"), JSON.stringify({
    lockfileVersion: 1,
    registries: { mgr: { url: "https://raw.example/index.json", trusted: true } },
    skills: {
      "@mgr/junit-clean": {
        version: "1.0.0", registry: "mgr", checksum: `sha256-${"a".repeat(64)}`,
        category: "language", dir: "junit-clean", engines: ["claude-code"], applied: {},
      },
    },
  }, null, 2) + "\n", "utf8");

  const comPlugin = run(["status"]);
  assert.equal(comPlugin.status, 0, "projeto com plugin travado tem instalação: exit 0");
  assert.match(comPlugin.stdout, /@mgr\/junit-clean@1\.0\.0 \(mgr\)/);
  assert.doesNotMatch(comPlugin.stdout, /Nenhuma instalação MGR encontrada/);
});

test("planInstall exclui a skill substituída só do motor indicado e registra replaced", () => {
  const repo = diretorioTemporario();
  const replaced = { "claude-code": { "junit-clean": "@acme/junit-clean" } };
  const plan = installer.planInstall(["claude-code", "copilot"], "project", repo, {
    language: "java", architecture: "hexagonal", replaced,
  });

  const porMotor = Object.fromEntries(plan.targets.map((alvo) => [alvo.engine, alvo.skills]));
  assert.ok(!porMotor["claude-code"].includes("junit-clean"), "sai do motor com substituição");
  assert.ok(porMotor.copilot.includes("junit-clean"), "permanece no motor sem substituição");
  assert.ok(plan.skills.includes("junit-clean"), "o conjunto pretendido segue completo");

  installer.execute(plan);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")), "não escreve a substituída");
  assert.ok(existsSync(path.join(repo, ".github/skills/junit-clean/SKILL.md")));
  const manifesto = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.deepEqual(manifesto.replaced, replaced);
  assert.ok(manifesto.skills.includes("junit-clean"), "skills[] preserva o conjunto pretendido");
});

test("planInstall sem replaced mantém o conjunto e o manifesto de hoje", () => {
  const repo = diretorioTemporario();
  const plan = installer.planInstall(["claude-code"], "project", repo, { language: "java", architecture: "hexagonal" });
  assert.deepEqual(plan.targets[0].skills, plan.skills);
  installer.execute(plan);
  const manifesto = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.equal(manifesto.replaced, undefined, "manifesto sem substituição não ganha o campo");
  assert.ok(existsSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md")));
});

// Registry stub local servindo um plugin de nome IGUAL ao de uma skill do método.
function stubDeColisao(nome = "junit-clean", registry = "acme") {
  const skillMd = `---\nname: ${nome}\ndescription: Variante interna da empresa para testes Java, com regras proprias.\n---\n\n# ${nome} do plugin\n`;
  const manifest = {
    name: `@${registry}/${nome}`, version: "1.0.0", author: "Acme",
    description: "Variante interna da empresa para testes Java. Use when the user asks for the Acme flavour.",
    category: "language", permissions: ["read-files"],
  };
  const contents = [
    { path: "SKILL.md", content: Buffer.from(skillMd, "utf8") },
    { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];
  let index;
  const server = createServer((request, response) => {
    if (request.url === "/index.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(index));
      return;
    }
    const file = contents.find((candidate) => request.url === `/${nome}/${candidate.path}`);
    if (!file) { response.statusCode = 404; response.end("nf"); return; }
    response.end(file.content);
  });
  const pronto = new Promise((done) => server.listen(0, "127.0.0.1", done)).then(() => {
    const base = `http://127.0.0.1:${server.address().port}`;
    index = {
      indexVersion: 1, registry, generatedAt: "2026-08-25T00:00:00.000Z",
      categories: {
        language: [{
          name: manifest.name, version: "1.0.0", description: manifest.description,
          checksum: aggregateChecksum(contents),
          files: contents.map((file) => ({ path: file.path, url: `${base}/${nome}/${file.path}`, sha256: sha256(file.content) })),
        }],
      },
    };
    return { base, indexUrl: `${base}/index.json` };
  });
  return { server, pronto, marcaDoPlugin: "do plugin" };
}

test("ciclo completo da substituição: add substitui, install respeita, remove avisa, update devolve", async () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const stub = stubDeColisao();
  const { indexUrl } = await stub.pronto;
  const run = async (args, options = {}) => (await promisify(execFile)("node", [bin, ...args], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "pt_BR.UTF-8" }, ...options,
  })).stdout;
  const skillMd = path.join(repo, ".claude/skills/junit-clean/SKILL.md");

  try {
    await run(["install", "--engine", "claude-code", "--language", "java", "--arch", "hexagonal", "--project-id", "ciclo", "-y", repo]);
    assert.doesNotMatch(readFileSync(skillMd, "utf8"), /do plugin/, "começa com a skill do método");

    addRegistry(path.join(repo, ".mgr-core"), { name: "acme", url: indexUrl });
    await addPlugin("@acme/junit-clean", {
      repo, coreDir: path.join(repo, ".mgr-core"),
      targets: [{ engine: "claude-code", dir: path.join(repo, ".claude/skills") }],
      fetchImpl: globalThis.fetch, confirm: async () => true, resolveCollision: async () => "replace",
    });
    assert.match(readFileSync(skillMd, "utf8"), /do plugin/, "o plugin tomou a pasta");
    assert.equal(readLockfile(repo).skills["@acme/junit-clean"].replaces, "junit-clean");

    await run(["install", "--engine", "claude-code", "--language", "java", "--arch", "hexagonal", "--project-id", "ciclo", "-y", repo]);
    assert.match(readFileSync(skillMd, "utf8"), /do plugin/, "install não devolve a skill do método");
    const manifesto = JSON.parse(readFileSync(path.join(repo, ".mgr-core/manifest.json"), "utf8"));
    assert.deepEqual(manifesto.replaced, { "claude-code": { "junit-clean": "@acme/junit-clean" } });
    assert.ok(manifesto.skills.includes("junit-clean"), "o conjunto pretendido segue completo");

    const status = await run(["status", repo]);
    assert.match(status, /substitui a skill junit-clean do método/);

    let avisoDoRemove = "";
    try {
      await promisify(execFile)("node", [bin, "remove", "@acme/junit-clean"], {
        encoding: "utf8", cwd: repo, env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
      }).then((r) => { avisoDoRemove = r.stderr; });
    } catch (error) { avisoDoRemove = error.stderr; }
    assert.match(avisoDoRemove, /a skill junit-clean do método volta no próximo/);
    assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")));

    await run(["update", repo]);
    assert.doesNotMatch(readFileSync(skillMd, "utf8"), /do plugin/, "a skill do método voltou");
  } finally {
    stub.server.closeAllConnections();
    stub.server.close();
  }
});

test("registry fora do ar não devolve a skill do método fingindo ser o plugin", async () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const stub = stubDeColisao();
  const { indexUrl } = await stub.pronto;
  const flags = ["install", "--engine", "claude-code", "--language", "java", "--arch", "hexagonal", "--project-id", "fora", "-y", repo];
  const run = (args, options = {}) => promisify(execFile)("node", [bin, ...args], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "pt_BR.UTF-8" }, ...options,
  });

  try {
    await run(flags);
    addRegistry(path.join(repo, ".mgr-core"), { name: "acme", url: indexUrl });
    await addPlugin("@acme/junit-clean", {
      repo, coreDir: path.join(repo, ".mgr-core"),
      targets: [{ engine: "claude-code", dir: path.join(repo, ".claude/skills") }],
      fetchImpl: globalThis.fetch, confirm: async () => true, resolveCollision: async () => "replace",
    });
  } finally {
    stub.server.closeAllConnections();
    stub.server.close();
  }

  await assert.rejects(run(flags), /Command failed/, "com o registry fora do ar o install falha");
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md"))
    || !readFileSync(path.join(repo, ".claude/skills/junit-clean/SKILL.md"), "utf8").includes("Standardizes Java"),
  "a pasta não pode conter a skill do método no lugar do plugin");
});

test("status reporta divergência entre o lockfile e o disco, sem corrigir", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const run = () => execFileSync("node", [bin, "status", repo], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));
  writeFileSync(path.join(repo, "mgr-skills.lock"), JSON.stringify({
    lockfileVersion: 1,
    registries: { acme: { url: "https://raw.example/index.json", trusted: false } },
    skills: {
      "@acme/junit-clean": {
        version: "1.0.0", registry: "acme", checksum: `sha256-${"a".repeat(64)}`,
        category: "language", dir: "junit-clean", engines: ["claude-code"], applied: {},
      },
    },
  }, null, 2) + "\n", "utf8");

  const divergente = run();
  assert.match(divergente, /divergências \(lockfile x disco\)/);
  assert.match(divergente, /@acme\/junit-clean: travada no lockfile, ausente ou diferente no disco/);
  assert.match(divergente, /rode `mgr install` para restaurar o conjunto travado/);
  assert.ok(!existsSync(path.join(repo, ".claude/skills/junit-clean")), "reporta, nunca corrige");

  mkdirSync(path.join(repo, ".claude/skills/junit-clean"), { recursive: true });
  writeFileSync(path.join(repo, ".claude/skills/junit-clean/mgr-manifest.json"),
    JSON.stringify({ name: "@acme/junit-clean" }), "utf8");
  assert.doesNotMatch(run(), /divergências/, "conjunto coerente não reporta nada");
});

test("clone limpo reproduz a substituição sem perguntar (critério 4 da spec)", async () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const origem = diretorioTemporario();
  const stub = stubDeColisao();
  const { indexUrl } = await stub.pronto;
  const flags = (repo, id) => ["install", "--engine", "claude-code", "--language", "java", "--arch", "hexagonal", "--project-id", id, "-y", repo];
  const run = async (args) => (await promisify(execFile)("node", [bin, ...args], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  })).stdout;

  try {
    await run(flags(origem, "origem"));
    addRegistry(path.join(origem, ".mgr-core"), { name: "acme", url: indexUrl });
    await addPlugin("@acme/junit-clean", {
      repo: origem, coreDir: path.join(origem, ".mgr-core"),
      targets: [{ engine: "claude-code", dir: path.join(origem, ".claude/skills") }],
      fetchImpl: globalThis.fetch, confirm: async () => true, resolveCollision: async () => "replace",
    });

    // O colega clona: só o lockfile viaja (o .mgr-core fica na máquina de quem instalou).
    const clone = diretorioTemporario();
    writeFileSync(path.join(clone, "mgr-skills.lock"), readFileSync(path.join(origem, "mgr-skills.lock"), "utf8"), "utf8");

    const saida = await run(flags(clone, "clone"));
    assert.doesNotMatch(saida, /O método já fornece a skill/, "install não pergunta nada");

    const skillMd = path.join(clone, ".claude/skills/junit-clean/SKILL.md");
    assert.match(readFileSync(skillMd, "utf8"), /do plugin/, "a pasta tem o plugin, não a skill do método");
    assert.equal(
      readFileSync(skillMd, "utf8"),
      readFileSync(path.join(origem, ".claude/skills/junit-clean/SKILL.md"), "utf8"),
      "conjunto idêntico ao da máquina de origem",
    );
    const manifesto = JSON.parse(readFileSync(path.join(clone, ".mgr-core/manifest.json"), "utf8"));
    assert.deepEqual(manifesto.replaced, { "claude-code": { "junit-clean": "@acme/junit-clean" } });
    assert.ok(manifesto.skills.includes("junit-clean"), "o conjunto pretendido segue completo no clone");
  } finally {
    stub.server.closeAllConnections();
    stub.server.close();
  }
});

// Registry stub com uma skill que DECLARA o ecossistema — é o que a torna sugerível.
function stubComEcossistema(nome = "junit-clean", ecosystems = ["java"]) {
  const skillMd = `---\nname: ${nome}\ndescription: Skill de teste para o ecossistema declarado no manifest.\n---\n\n# ${nome}\n`;
  const manifest = {
    name: `@mgr/${nome}`, version: "1.1.0", author: "Mauri Reis",
    description: "Skill de teste para o ecossistema declarado. Use when the project matches it.",
    category: "language", permissions: ["read-files"], ecosystems,
  };
  const contents = [
    { path: "SKILL.md", content: Buffer.from(skillMd, "utf8") },
    { path: "mgr-manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];
  let index;
  const server = createServer((request, response) => {
    if (request.url === "/index.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(index));
      return;
    }
    const file = contents.find((candidate) => request.url === `/${nome}/${candidate.path}`);
    if (!file) { response.statusCode = 404; response.end("nf"); return; }
    response.end(file.content);
  });
  const pronto = new Promise((done) => server.listen(0, "127.0.0.1", done)).then(() => {
    const base = `http://127.0.0.1:${server.address().port}`;
    index = {
      indexVersion: 1, registry: "mgr", generatedAt: "2026-08-26T00:00:00.000Z",
      categories: {
        language: [{
          name: manifest.name, version: manifest.version, description: manifest.description,
          checksum: aggregateChecksum(contents), ecosystems,
          files: contents.map((file) => ({ path: file.path, url: `${base}/${nome}/${file.path}`, sha256: sha256(file.content) })),
        }],
      },
    };
    return { indexUrl: `${base}/index.json` };
  });
  return { server, pronto };
}

test("CLI: install grava o hook dos motores escolhidos, sem duplicar, e uninstall remove", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const run = (args) => execFileSync("node", [bin, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });
  const flags = ["--engine", "both", "--arch", "hexagonal", "--project-id", "hk", "-y", repo];
  const claude = path.join(repo, ".claude", "settings.local.json");
  const copilot = path.join(repo, ".github", "copilot", "settings.local.json");

  const saida = run(["install", ...flags]);
  // A mensagem passou a NOMEAR os eventos: o arquivo carrega dois desde o ADR-0018, e anunciar
  // "hook de sessão" esconderia do usuário metade do que foi escrito no arquivo dele.
  assert.match(saida, /hooks gravados em .claude\/settings.local.json: SessionStart · PreCompact/);
  assert.match(saida, /hooks gravados em .github\/copilot\/settings.local.json: sessionStart · preCompact/);
  assert.match(saida, /Copilot só carrega o hook do repositório depois que você confia na pasta/);
  assert.equal(JSON.parse(readFileSync(claude, "utf8")).hooks.SessionStart.length, 1);
  assert.equal(JSON.parse(readFileSync(copilot, "utf8")).hooks.sessionStart.length, 1);

  run(["install", ...flags]);
  assert.equal(JSON.parse(readFileSync(claude, "utf8")).hooks.SessionStart.length, 1, "reinstalar não duplica");

  const removido = run(["uninstall", "-y", repo]);
  assert.match(removido, /hooks removidos de .claude\/settings.local.json: SessionStart · PreCompact/);
  assert.ok(!existsSync(claude) && !existsSync(copilot), "os arquivos criados pelo MGR somem");
});

test("CLI: --no-hooks não grava hook nenhum e o plano não promete o que não vai fazer", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const saida = execFileSync("node", [bin, "install", "--engine", "claude-code", "--arch", "hexagonal",
    "--project-id", "nh", "--no-hooks", "-y", repo], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });
  assert.doesNotMatch(saida, /hooks gravados em/);
  assert.doesNotMatch(saida, /hooks {4}→/);
  assert.ok(!existsSync(path.join(repo, ".claude", "settings.local.json")));
});

test("CLI: modo manual não sugere e detectionMode inválido falha antes de escrever", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  writeFileSync(path.join(repo, "pom.xml"), "<project/>", "utf8");
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  const config = path.join(repo, ".mgr-core", "config.json");
  const flags = ["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "md", "-y", repo];
  const run = (args) => execFileSync("node", [bin, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "pt_BR.UTF-8" },
  });

  writeFileSync(config, JSON.stringify({ registries: [], detectionMode: "manual" }), "utf8");
  assert.doesNotMatch(run(flags), /Skills plugáveis disponíveis/, "manual não sugere");

  writeFileSync(config, JSON.stringify({ registries: [], detectionMode: "auto" }), "utf8");
  const semAuto = diretorioTemporario();
  writeFileSync(path.join(semAuto, "marcador"), "x", "utf8");
  mkdirSync(path.join(semAuto, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(semAuto, ".mgr-core", "config.json"),
    JSON.stringify({ registries: [], detectionMode: "auto" }), "utf8");
  assert.throws(
    () => run(["install", "--engine", "claude-code", "--arch", "hexagonal", "--project-id", "au", "-y", semAuto]),
    /Command failed/,
  );
  assert.ok(!existsSync(path.join(semAuto, ".claude")), "auto falha ANTES de escrever qualquer skill");
});

test("CLI: ciclo da sugestão — detect propõe, add instala, detect para de propor", async () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const repo = diretorioTemporario();
  const stub = stubComEcossistema();
  const { indexUrl } = await stub.pronto;
  const run = async (args, options = {}) => (await promisify(execFile)("node", [bin, ...args], {
    encoding: "utf8", env: { ...process.env, LC_ALL: "pt_BR.UTF-8" }, ...options,
  })).stdout;

  try {
    writeFileSync(path.join(repo, "pom.xml"), "<project/>", "utf8");
    addRegistry(path.join(repo, ".mgr-core"), { name: "mgr", url: indexUrl });

    const detectado = await run(["detect", repo]);
    assert.match(detectado, /java {2}\(por pom\.xml\)/);
    assert.match(detectado, /@mgr\/junit-clean@1\.1\.0 {2}— java, por pom\.xml/);

    const noHook = await run(["detect", "--hook", "claude-code", repo]);
    assert.match(noHook, /@mgr\/junit-clean@1\.1\.0 \(ecosystem: java, evidence: pom\.xml\)/);

    const instalando = await run(["install", "--engine", "claude-code", "--arch", "hexagonal",
      "--project-id", "ciclo", "-y", repo]);
    assert.match(instalando, /Skills plugáveis disponíveis/, "o install informa a sugestão");
    assert.match(instalando, /Sem terminal interativo não há pergunta/, "e não instala sozinho");
    assert.ok(!existsSync(path.join(repo, "mgr-skills.lock")), "sem TTY nada é instalado");

    await addPlugin("@mgr/junit-clean", {
      repo, coreDir: path.join(repo, ".mgr-core"),
      targets: [{ engine: "claude-code", dir: path.join(repo, ".claude/skills") }],
      fetchImpl: globalThis.fetch, confirm: async () => true, resolveCollision: async () => "alongside",
    });

    assert.match(await run(["detect", repo]), /Nenhuma skill dos registries configurados/,
      "skill já travada não é sugerida de novo");
  } finally {
    stub.server.closeAllConnections();
    stub.server.close();
  }
});

test("nenhum motor recebe default de modelo, e o copilot também não tem esforço", () => {
  const { agent, skill, defaults } = catalog.REVIEW_GATE;
  assert.equal(agent, "mgr-review");
  assert.equal(skill, "code-analyzer");
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.effort, "max");
  // O ADR-0010 deixava o copilot sem default porque a lista de modelos é DA CONTA. Com mais
  // motores na fila, a exceção virou regra: NENHUM motor recebe identificador publicado.
  assert.deepEqual(defaults.model, {}, "nenhum motor recebe default de modelo");
});

test("a fonte do agente do gate existe e não duplica o procedimento de review", () => {
  const corpo = readFileSync(path.join(bundle.agentsDir(), "mgr-review.md"), "utf8");
  assert.ok(corpo.includes(catalog.REVIEW_SKILL_TOKEN), "aponta para a skill instalada");
  assert.ok(corpo.includes(catalog.USER_LANGUAGE_TOKEN), "respeita o idioma do usuário");
  assert.ok(/verbatim citation/i.test(corpo), "carrega a restrição de ancoragem");
  assert.ok(!corpo.startsWith("---"), "o frontmatter é montado por motor, não vem da fonte");
});

// Clone raso com o mapa `model` próprio: os testes ajustam o gate sem contaminar o default.
// Mapa de políticas com SÓ a intenção pedida ligada — os testes abaixo falam do gate, e ligar as
// três faria cada um deles escrever três arquivos e afirmar sobre o primeiro por acaso.
const soA = (intent, policy) => Object.fromEntries(
  catalog.INTENTS.map((nome) => [nome, nome === intent ? policy : { ...catalog.AGENTS[nome].defaults, enabled: false }]),
);

const gateDefaults = () => ({
  ...catalog.REVIEW_GATE.defaults,
  model: { ...catalog.REVIEW_GATE.defaults.model },
});

test("o agente do claude-code declara modelo, esforço e só ferramentas de leitura", () => {
  const { frontmatter, skipped } = agentFrontmatter("claude-code", "review", gateDefaults());
  assert.match(frontmatter, /^---\nname: mgr-review\n/);
  assert.match(frontmatter, /tools: Read, Grep, Glob/);
  assert.ok(!frontmatter.includes("model:"), "sem default publicado: o agente herda o da sessão");
  assert.match(frontmatter, /effort: max/, "o esforço segue com default — a escala é da plataforma");
  assert.deepEqual(skipped, []);
  for (const escrita of ["Write", "Edit", "NotebookEdit"]) {
    assert.ok(!frontmatter.includes(escrita), `ferramenta de escrita vazou: ${escrita}`);
  }
});

test("as ferramentas seguem a NECESSIDADE da intenção, e o gate nunca ganha escrita", () => {
  const ESCRITA = /\b(Write|Edit|NotebookEdit|edit)\b/;
  for (const engineId of ["claude-code", "copilot"]) {
    for (const intent of catalog.INTENTS) {
      const { frontmatter } = agentFrontmatter(engineId, intent, catalog.AGENTS[intent].defaults);
      // Só a linha `tools:` — o CORPO do gate contém "You cannot write", que é a frase que
      // garante a invariante, e casá-la acusaria justamente a proteção.
      const linha = frontmatter.split("\n").find((l) => l.startsWith("tools:"));
      const temEscrita = ESCRITA.test(linha);
      assert.equal(temEscrita, catalog.AGENTS[intent].needs === "write",
        `${engineId}/${intent}: ferramenta de escrita só onde a intenção declara precisar`);
    }
  }
  // A invariante do ADR-0010, dita sem depender do laço acima.
  assert.equal(catalog.AGENTS.review.needs, "read",
    "um revisor que pode editar não tem como reprovar em vez de corrigir");
});

test("as ferramentas de cada motor batem com a documentação da plataforma", () => {
  assert.equal(engineDescriptor("claude-code").agentTools.read, "Read, Grep, Glob");
  // Corrigido em 2026-09-11 contra a doc oficial: `view` não é alias nem nome de ferramenta do
  // copilot, e nome não reconhecido é ignorado em SILÊNCIO — o gate rodava sem leitura de arquivo.
  assert.equal(engineDescriptor("copilot").agentTools.read, '["read", "search"]');
  assert.equal(engineDescriptor("copilot").agentTools.write, '["read", "search", "edit"]');
});

// A P1.2 é a task de risco desta fatia: ela reescreve quem produz um arquivo que já está instalado
// na máquina de quem usa. O gate é textual e estrutural; a prova byte a byte contra a linha de base
// mora no fechamento, porque depende do snapshot gravado antes da primeira linha de código.
test("`src/hooks.js` não conhece o nome de motor nenhum", () => {
  const fonte = readFileSync(fileURLToPath(new URL("../src/hooks.js", import.meta.url)), "utf8");
  for (const id of engineIds()) {
    assert.ok(!fonte.includes(id),
      `hooks.js ainda cita \`${id}\`; o conhecimento por motor é dado no descritor, não texto aqui`);
  }
  assert.ok(!fonte.includes("HOOK_FILES") && !fonte.includes("HOOK_EVENTS"),
    "os dois mapas foram substituídos pelo descritor");
});

test("o hook gravado sai exatamente da forma que o descritor declara", () => {
  const repo = diretorioTemporario();
  for (const id of engineIds()) {
    const motor = engineDescriptor(id);
    writeHook(id, repo, { command: "CMD" });
    const gravado = JSON.parse(readFileSync(path.join(repo, ...motor.hookFile), "utf8"));
    const entradas = gravado.hooks[motor.hookEvents.sessionStart];
    assert.equal(entradas.length, 1);
    assert.deepEqual(entradas[0],
      motor.hookEntry(hookCommand("CMD", id), motor.hookMatchers.sessionStart, motor.hookTimeouts.sessionStart),
      `${id}: a entrada tem de ser a do descritor, sem o módulo remontar nada`);
    for (const [chave, valor] of Object.entries(motor.hookEnvelope ?? {})) {
      assert.equal(gravado[chave], valor, `${id}: envelope da plataforma`);
    }
  }
});

// O descritor passa a carregar o conhecimento de HOOK (ADR-0018), que hoje vive em mapas dentro de
// `src/hooks.js`. Esta task só publica o dado; quem consome é a P1.2.
test("o descritor publica arquivo, evento e forma da entrada de cada motor", () => {
  const claude = engineDescriptor("claude-code");
  assert.deepEqual(claude.hookFile, [".claude", "settings.local.json"]);
  assert.equal(claude.hookEvents.sessionStart, "SessionStart");
  assert.equal(claude.hookEnvelope, null);
  assert.deepEqual(claude.hookEntry("CMD", "startup", claude.hookTimeouts.sessionStart),
    { matcher: "startup", hooks: [{ type: "command", command: "CMD" }] },
    "o sessionStart deste motor nunca declarou teto, e declarar um reescreveria arquivo já instalado");
  assert.deepEqual(claude.hookEntry("CMD", "manual|auto", claude.hookTimeouts.preCompact),
    { matcher: "manual|auto", hooks: [{ type: "command", command: "CMD", timeout: 15 }] },
    "o default da doc para `command` é 600s, e o comando espera EOF do stdin");
  assert.equal(claude.hookMatchers.preCompact, "manual|auto",
    "o matcher é POR EVENTO: `startup` no PreCompact faria o hook não disparar, em silêncio");

  const copilot = engineDescriptor("copilot");
  assert.deepEqual(copilot.hookFile, [".github", "copilot", "settings.local.json"]);
  assert.equal(copilot.hookEvents.sessionStart, "sessionStart");
  assert.deepEqual(copilot.hookEnvelope, { version: 1 },
    "o envelope é exigência da plataforma, e é dado do motor, não regra do módulo");
  assert.deepEqual(copilot.hookEntry("CMD", null, copilot.hookTimeouts.sessionStart),
    { type: "command", bash: "CMD", timeout: 15 },
    "o sessionStart deste motor nunca teve matcher, e mudar isso reescreveria arquivo já instalado");
  assert.deepEqual(copilot.hookEntry("CMD", "manual|auto", copilot.hookTimeouts.preCompact),
    { type: "command", bash: "CMD", timeout: 15, matcher: "manual|auto" });
});

test("o descritor é dado PURO: nenhum campo de hook depende de IO ou de caminho da máquina", () => {
  for (const id of engineIds()) {
    const motor = engineDescriptor(id);
    assert.ok(Array.isArray(motor.hookFile), `${id}: caminho em segmentos, para o módulo montar`);
    for (const segmento of motor.hookFile) {
      assert.ok(!segmento.includes("/") && !segmento.includes("\\"), `${id}: segmento com separador`);
    }
  }
});

test("`compaction` distingue os TRÊS estados, e não é booleano", () => {
  const claude = engineDescriptor("claude-code").compaction;
  assert.equal(claude.event, "PreCompact", "tem evento");
  assert.equal(claude.block, "exit-code", "e bloqueia");

  const copilot = engineDescriptor("copilot").compaction;
  assert.equal(copilot.event, "preCompact", "TEM o evento");
  assert.equal(copilot.block, null,
    "e não bloqueia: a doc classifica como notification only, e isso é diferente de não ter evento");

  for (const id of engineIds()) {
    const { event, block } = engineDescriptor(id).compaction;
    assert.ok(event !== null || block === null,
      `${id}: bloquear sem ter evento é estado impossível, e o método gravaria hook no vazio`);
  }
});

test("os aliases documentados do claude-code são os quatro que a doc citada publica", () => {
  assert.deepEqual(engineDescriptor("claude-code").documentedModels, ["sonnet", "opus", "haiku", "fable"]);
});

test("a lista do copilot é vazia porque os modelos são da conta, e não do produto", () => {
  assert.deepEqual(engineDescriptor("copilot").documentedModels, [],
    "não é omissão: o produto não publica conjunto fixo, e inventar nomes seria palpite sobre a conta alheia");
});

test("todo motor declara a lista, ainda que vazia", () => {
  for (const id of engineIds()) {
    assert.ok(Array.isArray(engineDescriptor(id).documentedModels), `${id} sem documentedModels`);
  }
});

test("a lista documentada é sugestão, e não grade do que pode ser escrito", () => {
  const foraDaLista = "modelo-que-so-existe-na-minha-conta";
  assert.ok(!engineDescriptor("claude-code").documentedModels.includes(foraDaLista));
  const core = diretorioTemporario();
  writeConfig(core, { registries: [] });
  writeAgentPolicy(core, "drafting", { model: { "claude-code": foraDaLista } });
  const { policies } = readAgents(core);
  assert.equal(policies.drafting.model["claude-code"], foraDaLista,
    "validar contra lista nossa faria o método recusar modelo válido assim que a doc mudasse (RN-2)");
});

test("o agente de revisão do copilot TEM ferramenta de leitura", () => {
  const { frontmatter } = agentFrontmatter("copilot", "review", catalog.AGENTS.review.defaults);
  const linha = frontmatter.split("\n").find((l) => l.startsWith("tools:"));
  assert.match(linha, /"read"/, "sem isto ele não abre o arquivo que a L1.1 manda citar verbatim");
  assert.ok(!linha.includes("view"), "`view` não existe na plataforma e era ignorado sem aviso");
});

test("o agente do copilot sai sem effort e sem model, e diz o que pulou", () => {
  const { frontmatter, skipped } = agentFrontmatter("copilot", "review", gateDefaults());
  assert.match(frontmatter, /tools: \["read", "search"\]/);
  assert.ok(!frontmatter.includes("effort:"), "copilot não tem campo effort (V-3)");
  assert.ok(!frontmatter.includes("model:"), "sem default de modelo para o copilot");
  assert.deepEqual(
    skipped, ["effort"],
    "modelo sem entrada é o default de desenho, não degradação — só o effort é capacidade ausente",
  );
});

test("modelo declarado pelo usuário chega ao agente do copilot", () => {
  const gate = { ...gateDefaults(), model: { copilot: "claude-sonnet-5" } };
  const { frontmatter, skipped } = agentFrontmatter("copilot", "review", gate);
  assert.match(frontmatter, /model: claude-sonnet-5/);
  assert.deepEqual(skipped, ["effort"]);
});

test("instalar o agente resolve os tokens e marca a posse", () => {
  const dir = path.join(diretorioTemporario(), "agents");
  const { written, blocked } = installAgents("claude-code", dir, soA("review", gateDefaults()), {
    reviewSkillRef: ".claude/skills/code-analyzer/SKILL.md",
    userLanguage: "português",
  });
  assert.equal(written.length, 1);
  const texto = readFileSync(written[0], "utf8");
  assert.ok(texto.includes(".claude/skills/code-analyzer/SKILL.md"), "token da skill resolvido");
  assert.ok(texto.includes("português"), "token de idioma resolvido");
  assert.ok(!texto.includes(catalog.REVIEW_SKILL_TOKEN) && !texto.includes(catalog.USER_LANGUAGE_TOKEN));
  assert.ok(isOurAgent(texto) && texto.includes(AGENT_MARKER));
  assert.deepEqual(blocked, []);
});

test("nome do arquivo do agente segue o descritor do motor", () => {
  const claudeDir = path.join(diretorioTemporario(), "agents");
  const copilotDir = path.join(diretorioTemporario(), "agents");
  const opts = { reviewSkillRef: "x", userLanguage: "en" };
  assert.equal(path.basename(installAgents("claude-code", claudeDir, soA("review", gateDefaults()), opts).written[0]), "mgr-review.md");
  assert.equal(path.basename(installAgents("copilot", copilotDir, soA("review", gateDefaults()), opts).written[0]), "mgr-review.agent.md");
});

test("gate desligado não escreve arquivo de agente nenhum", () => {
  const dir = path.join(diretorioTemporario(), "agents");
  const resultado = installAgents("claude-code", dir, soA("review", { ...gateDefaults(), enabled: false }), {});
  assert.deepEqual(resultado.written, []);
  assert.equal(existsSync(dir), false);
});

test("agente alheio de mesmo nome não é sobrescrito", () => {
  const dir = path.join(diretorioTemporario(), "agents");
  mkdirSync(dir, { recursive: true });
  const alheio = path.join(dir, "mgr-review.md");
  writeFileSync(alheio, "agente do usuário, escrito à mão", "utf8");
  const resultado = installAgents("claude-code", dir, soA("review", gateDefaults()), { reviewSkillRef: "x" });
  assert.deepEqual(resultado.written, []);
  assert.deepEqual(resultado.blocked, [alheio]);
  assert.equal(readFileSync(alheio, "utf8"), "agente do usuário, escrito à mão");
});

test("no claude-code o desvio até o agente é estrutural, no frontmatter", () => {
  const skill = "---\nname: code-analyzer\ndescription: x\n---\n\ncorpo da skill\n";
  const roteada = routeReviewSkill("claude-code", skill);
  assert.match(roteada, /context: fork/);
  assert.match(roteada, /agent: mgr-review/);
  assert.match(roteada, /background: false/);
  assert.ok(roteada.includes("corpo da skill"), "o corpo da skill é preservado");
});

test("no copilot o desvio é instrução no corpo, sem tocar no frontmatter", () => {
  const skill = "---\nname: code-analyzer\ndescription: x\n---\n\ncorpo da skill\n";
  const roteada = routeReviewSkill("copilot", skill);
  assert.ok(!roteada.includes("context: fork"), "copilot não tem context: fork (V-3/ADR-0010)");
  assert.match(roteada, /## Delegation \(copilot\)/);
  assert.match(roteada, /mgr-review/);
  assert.match(roteada, /`task`/);
});

test("com o gate desligado a code-analyzer instalada só sofre as resoluções de token", () => {
  const comGate = path.join(diretorioTemporario(), "skills");
  const semGate = path.join(diretorioTemporario(), "skills");
  const gate = gateDefaults();
  installEngine(semGate, ["code-analyzer"], { engineId: "claude-code", reviewGate: { ...gate, enabled: false } });
  installEngine(comGate, ["code-analyzer"], { engineId: "claude-code", reviewGate: gate });

  const fonte = readFileSync(path.join(bundle.skillsDir(), "code-analyzer", "SKILL.md"), "utf8");
  const instaladaSemGate = readFileSync(path.join(semGate, "code-analyzer", "SKILL.md"), "utf8");
  const instaladaComGate = readFileSync(path.join(comGate, "code-analyzer", "SKILL.md"), "utf8");

  // A instalação resolve DOIS tokens: idioma e leis de execução. O que o gate desligado tem de
  // garantir é que nenhuma injeção de ROTEAMENTO acontece — não que o arquivo saia intocado.
  assert.equal(
    instaladaSemGate,
    resolveLaws(resolveUserLanguage(fonte, undefined), path.join("_shared", "laws", "execution-laws.md")),
    "gate desligado: só as resoluções de token, nenhuma injeção de roteamento (CONSTITUTION §2.7)",
  );
  assert.ok(!instaladaSemGate.includes("context: fork"), "gate desligado não injeta fork");
  assert.ok(!instaladaSemGate.includes("Delegation (copilot)"), "gate desligado não injeta delegação");
  assert.notEqual(instaladaComGate, instaladaSemGate, "gate ligado: a skill é roteada");
  assert.match(instaladaComGate, /agent: mgr-review/);
});

test("o roteamento só toca a code-analyzer, não as outras skills", () => {
  const dir = path.join(diretorioTemporario(), "skills");
  const gate = gateDefaults();
  installEngine(dir, ["code-analyzer", "adr-create"], { engineId: "claude-code", reviewGate: gate });
  const outra = readFileSync(path.join(dir, "adr-create", "SKILL.md"), "utf8");
  assert.ok(!outra.includes("agent: mgr-review"));
});

const instalarComGate = (repo, gate) => {
  if (gate) writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], reviewGate: gate }), "utf8");
  return installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));
};

test("instalar com o default grava o agente e o registra no manifest", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const resultado = instalarComGate(repo);

  const agente = path.join(repo, ".claude", "agents", "mgr-review.md");
  assert.ok(existsSync(agente), "o agente foi escrito");
  // As TRÊS intenções são instaladas: o gate mais os dois agentes do ADR-0017.
  assert.equal(resultado.agents.length, catalog.INTENTS.length);

  const man = JSON.parse(readFileSync(path.join(installer.coreDir("project", repo), "manifest.json"), "utf8"));
  assert.deepEqual(
    man.agents.sort(),
    catalog.INTENTS.map((intent) => path.join(".claude", "agents", `${catalog.AGENTS[intent].agent}.md`)).sort(),
  );
  assert.deepEqual(man.agentsDirs, [path.join(".claude", "agents")]);

  const texto = readFileSync(agente, "utf8");
  assert.ok(!texto.includes("model:"), "nenhuma intenção nasce com modelo publicado");
  assert.match(texto, /effort: max/);
  assert.ok(texto.includes(path.join(".claude", "skills", "code-analyzer", "SKILL.md")), "aponta para a skill instalada");
});

test("gate desligado não grava O AGENTE DO GATE, e não leva os outros junto", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarComGate(repo, { enabled: false });

  // Antes do ADR-0017 o gate desligado pulava o bloco inteiro. Agora cada intenção decide sozinha:
  // desligar a revisão não pode levar junto a redação e a execução.
  assert.equal(existsSync(path.join(repo, ".claude", "agents", "mgr-review.md")), false);
  assert.ok(existsSync(path.join(repo, ".claude", "agents", "mgr-draft.md")), "a redação continua");
  assert.ok(existsSync(path.join(repo, ".claude", "agents", "mgr-task.md")), "a execução continua");
});

test("todas as intenções desligadas não gravam agente nem registram no manifest", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const desligadas = Object.fromEntries(catalog.INTENTS.map((intent) => [intent, { enabled: false }]));
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: desligadas }), "utf8");
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));

  assert.equal(existsSync(path.join(repo, ".claude", "agents")), false);
  const man = JSON.parse(readFileSync(path.join(installer.coreDir("project", repo), "manifest.json"), "utf8"));
  assert.equal(Object.hasOwn(man, "agents"), false);
});

test("uninstall remove o agente do MGR e limpa o diretório vazio", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarComGate(repo);
  const { removed, kept } = installer.uninstall("project", repo);

  assert.ok(removed.some((p) => p.endsWith(path.join("agents", "mgr-review.md"))));
  assert.equal(existsSync(path.join(repo, ".claude", "agents")), false, "diretório vazio não fica órfão");
  assert.deepEqual(kept, []);
});

test("uninstall não toca em agente que perdeu o marcador do MGR", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarComGate(repo);

  const agente = path.join(repo, ".claude", "agents", "mgr-review.md");
  writeFileSync(agente, "reescrito pelo usuário, sem marcador", "utf8");
  const { removed, kept } = installer.uninstall("project", repo);

  assert.deepEqual(kept, [agente]);
  assert.ok(!removed.includes(agente));
  assert.equal(readFileSync(agente, "utf8"), "reescrito pelo usuário, sem marcador");
});

test("install não sobrescreve agente alheio e devolve o aviso", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const dir = path.join(repo, ".claude", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mgr-review.md"), "agente do usuário", "utf8");

  const resultado = instalarComGate(repo);
  // O bloqueio é DO ARQUIVO ocupado, não da instalação inteira: os outros dois agentes seguem.
  assert.ok(!resultado.agents.some((p) => p.endsWith("mgr-review.md")), "o ocupado não foi escrito");
  assert.equal(resultado.agents.length, catalog.INTENTS.length - 1, "os outros dois foram");
  assert.ok(resultado.gateWarnings.some((w) => w.blocked));
  assert.equal(readFileSync(path.join(dir, "mgr-review.md"), "utf8"), "agente do usuário");
});

test("no copilot o gate instala o agente e declara o esforço não suportado", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const resultado = installer.execute(
    installer.planInstall(["copilot"], "project", repo, { names: ["code-analyzer"] }),
  );

  const agente = path.join(repo, ".github", "agents", "mgr-review.agent.md");
  assert.ok(existsSync(agente), "o gate existe no copilot (DT-5, V-5)");
  assert.ok(!readFileSync(agente, "utf8").includes("effort:"), "sem effort no copilot (V-3)");
  assert.ok(resultado.gateWarnings.some((w) => w.engine === "copilot" && w.capability === "effort"));

  const skill = readFileSync(path.join(repo, ".github", "skills", "code-analyzer", "SKILL.md"), "utf8");
  assert.match(skill, /## Delegation \(copilot\)/);
  assert.ok(!skill.includes("context: fork"));
});

test("o ajuste do gate sobrevive ao update", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarComGate(repo, { effort: "high", model: { "claude-code": "sonnet" } });
  installer.update("project", repo);

  const texto = readFileSync(path.join(repo, ".claude", "agents", "mgr-review.md"), "utf8");
  assert.match(texto, /effort: high/);
  assert.match(texto, /model: sonnet/);
});

test("o resumo do gate diz o que cada motor de fato sustenta", () => {
  assert.deepEqual(gateSummary("claude-code", gateDefaults()), {
    engine: "claude-code", model: null, effort: "max", skipped: [],
  });
  assert.deepEqual(gateSummary("copilot", gateDefaults()), {
    engine: "copilot", model: null, effort: null, skipped: ["effort"],
  });
});

test("modelo declarado para um motor que não o sustenta vira degradação declarada", () => {
  const semModelo = { ...gateDefaults(), model: { "claude-code": "opus" } };
  // O copilot sustenta `model`; o que ele não sustenta é `effort` (V-3).
  assert.deepEqual(gateSummary("copilot", { ...semModelo, model: { copilot: "gpt-5" } }).skipped, ["effort"]);
  assert.equal(gateSummary("copilot", { ...semModelo, model: { copilot: "gpt-5" } }).model, "gpt-5");
});

test("as leis de execução são copiadas SEMPRE, sem depender de arquitetura", () => {
  const semArch = path.join(diretorioTemporario(), "skills");
  installEngine(semArch, ["adr-create"], {});
  const lei = path.join(semArch, "_shared", "laws", "execution-laws.md");
  assert.ok(existsSync(lei), "a fonte é núcleo: não depende de skill de arquitetura");
  assert.ok(!existsSync(path.join(semArch, "_shared", "arch")), "controle: a de arquitetura NÃO veio");
});

test("o token {{MGR_LAWS}} é resolvido para o caminho da fonte no motor", () => {
  const linha = `Execution laws (binding): ${catalog.LAWS_TOKEN}`;
  const resolvida = resolveLaws(linha, ".claude/skills/_shared/laws/execution-laws.md");
  assert.equal(resolvida, "Execution laws (binding): .claude/skills/_shared/laws/execution-laws.md");
  assert.ok(!resolvida.includes(catalog.LAWS_TOKEN));
});

test("sem referência resolvida, o ponteiro das leis cai no caminho da fonte, nunca no token cru", () => {
  assert.equal(resolveLaws(catalog.LAWS_TOKEN, null), catalog.LAWS_SHARED);
  assert.equal(resolveLaws("sem token aqui", "x"), "sem token aqui");
});

test("as 45 leis têm ID único e papel declarado", () => {
  const lei = readFileSync(path.join(bundle.sharedDir(), "laws", "execution-laws.md"), "utf8");
  const cabecalhos = [...lei.matchAll(/^### (L\d+\.\d+) — .+?`\[([A-Za-z, ]+)\]`$/gm)];
  assert.equal(cabecalhos.length, 45, "45 leis, L0.1 a L6.5");
  const ids = cabecalhos.map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "nenhum ID repetido");
  const papeisValidos = new Set(["All", "Planner", "Executor", "Verifier", "Diagnostician"]);
  for (const [, id, papeis] of cabecalhos) {
    for (const papel of papeis.split(",").map((p) => p.trim())) {
      assert.ok(papeisValidos.has(papel), `papel inválido em ${id}: ${papel}`);
    }
  }
});

test("as invariantes I1, I2 e I3 sobrevivem verbatim na fonte única", () => {
  const normalizar = (texto) => texto.replace(/\s+/g, " ");
  const lei = normalizar(readFileSync(path.join(bundle.sharedDir(), "laws", "execution-laws.md"), "utf8"));
  const clausulas = [
    "even if the problem is real",
    "in the absence of an explicit textual excerpt, the code is conformant",
    "ALWAYS archive raw facts to files and keep a cross-reference",
    "**never** re-rank one against the other nor merge the findings",
  ];
  for (const clausula of clausulas) {
    assert.ok(lei.includes(normalizar(clausula)), `invariante perdida: ${clausula}`);
  }
});

test("o preâmbulo aponta para a fonte DO MOTOR, não para a do outro", async () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  installer.execute(installer.planInstall(["claude-code", "copilot"], "project", repo, { names: ["adr-create"] }));

  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const run = (motor) => execFileSync("node", [bin, "detect", "--hook", motor, repo], { encoding: "utf8" });

  assert.match(run("claude-code"), /\.claude[/\\]skills[/\\]_shared[/\\]laws/);
  const copilot = JSON.parse(run("copilot")).additionalContext;
  assert.match(copilot, /\.github[/\\]skills[/\\]_shared[/\\]laws/);
  assert.ok(!copilot.includes(".claude"), "cada motor é autossuficiente (CONSTITUTION §2.5)");
});

// Locale fixado, como os demais testes de CLI deste arquivo: as mensagens seguem a precedência
// flag > manifesto > locale, e sem fixar o locale a asserção passaria na máquina do autor (pt_BR)
// e falharia no CI (C). Foi assim que a primeira versão destes testes quebrou o build.
const ptBR = (repo) => ({ encoding: "utf8", cwd: repo, env: { ...process.env, LC_ALL: "pt_BR.UTF-8" } });

const planoEm = (repo, slug, corpo) => {
  mkdirSync(path.join(repo, "specs", slug), { recursive: true });
  writeFileSync(path.join(repo, "specs", slug, "04-plan.md"), corpo, "utf8");
};

test("mgr spec validate: plano defeituoso reprova com exit 1 e ensina a corrigir", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "quebrado", [
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — a",
    "- **depends_on:** [P9.9]",
    "- **files:** [a, b, c, d]",
    "- **artifact:** 1 coisa",
    "",
  ].join("\n"));

  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const resultado = (() => {
    try {
      return { stdout: execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo)), status: 0 };
    } catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
  })();

  assert.equal(resultado.status, 1, "erro estrutural tem de sair com exit 1");
  assert.match(resultado.stdout, /PLAN-1/);
  assert.match(resultado.stdout, /PLAN-3/);
  assert.match(resultado.stdout, /PLAN-4/);
  assert.match(resultado.stdout, /ESTRUTURAL/, "a saída declara o escopo da verificação");
  assert.match(resultado.stdout, /Próximos passos/);
});

test("mgr spec validate: um plano em cada forma real passa com exit 0", () => {
  const repo = diretorioTemporario();
  const fixtures = fileURLToPath(new URL("./fixtures/plans", import.meta.url));
  for (const nome of readdirSync(fixtures, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
    mkdirSync(path.join(repo, "specs", nome.replace(".md", "")), { recursive: true });
    writeFileSync(path.join(repo, "specs", nome.replace(".md", ""), "04-plan.md"),
      readFileSync(path.join(fixtures, nome), "utf8"), "utf8");
  }
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo));
  assert.match(stdout, /0 erro\(s\)|0 error\(s\)/);
  assert.match(stdout, /ESTRUTURAL|STRUCTURAL/);
});

test("mgr spec validate --json tem schemaVersion e o contrato estável", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "ok", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **artifact:** 1 x\n- **done_when:** y\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "spec", "validate", "--all", "--json"], ptBR(repo)));
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(Object.keys(payload).sort(), ["files", "findings", "schemaVersion", "scope", "summary"]);
  assert.equal(payload.scope, "structural", "o agente também precisa saber que o verde é estrutural (L2.4)");
  assert.deepEqual(payload.summary, { errors: 0, warnings: 0 });
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina no payload");
});

test("mgr spec validate: --strict NÃO transforma PLAN-0 em erro", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "legado", "### P0.1 — a\n- **depends_on:** []\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "spec", "validate", "--all", "--strict"], ptBR(repo));
  assert.match(stdout, /PLAN-0/);
  assert.match(stdout, /0 erro\(s\)/, "formato legado nunca reprova, nem com --strict (RN-2)");
});

test("mgr validate (autoria de skill) continua intacto ao lado do mgr spec validate", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const stdout = execFileSync("node", [bin, "validate"], { encoding: "utf8", cwd: raiz });
  assert.match(stdout, /spec-init/);
  assert.ok(!stdout.includes("PLAN-"), "são contratos diferentes e não se misturam");
});

test("mgr spec validate sem --all e fora de specs/ diz o que fazer", () => {
  const repo = diretorioTemporario();
  mkdirSync(path.join(repo, "specs"), { recursive: true });
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const resultado = (() => {
    try { return { stdout: execFileSync("node", [bin, "spec", "validate"], ptBR(repo)), status: 0 }; }
    catch (erro) { return { stdout: erro.stdout, stderr: erro.stderr, status: erro.status }; }
  })();
  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /nenhuma spec|no spec/);
});

test("mgr spec validate <slug> valida só aquele slug", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "bom", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **artifact:** 1 x\n- **done_when:** y\n");
  planoEm(repo, "ruim", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **depends_on:** [P9.9]\n- **artifact:** 1 x\n- **done_when:** y\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "spec", "validate", "bom"], ptBR(repo));
  assert.match(stdout, /0 erro\(s\)|0 error\(s\)/);
  assert.ok(!stdout.includes("PLAN-1"), "o slug limita o escopo: o plano ruim não foi tocado");
});

test("mgr spec <subcomando desconhecido> reprova nomeando o comando", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const resultado = (() => {
    try { return { status: 0, stderr: "" , stdout: execFileSync("node", [bin, "spec", "archive"], ptBR(raiz)) }; }
    catch (erro) { return { status: erro.status, stderr: erro.stderr }; }
  })();
  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /spec archive/);
});

test("mgr spec respeita o userLanguage do manifesto, como os demais comandos", () => {
  // Regressão real, achada pelo gate e fora do alcance do regression-baseline: o primeiro
  // posicional de `mgr spec` é SUBCOMANDO, não repositório. Sem tratar isso, o repo virava
  // `<cwd>/validate`, o manifesto não era encontrado e a precedência
  // flag > manifesto > locale valia para todo comando MENOS o novo.
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  installer.execute(installer.planInstall(["claude-code"], "project", repo, {
    names: ["adr-create"], userLanguage: "pt-BR",
  }));
  planoEm(repo, "x", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **artifact:** 1 x\n- **done_when:** y\n");

  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const emIngles = { ...process.env, LC_ALL: "en_US.UTF-8" };
  const specValidate = execFileSync("node", [bin, "spec", "validate", "--all"], { encoding: "utf8", cwd: repo, env: emIngles });
  const status = execFileSync("node", [bin, "status"], { encoding: "utf8", cwd: repo, env: emIngles });

  assert.match(status, /projeto:/, "controle: o comando antigo já respeitava o manifesto");
  assert.match(specValidate, /erro\(s\)/, "o comando novo tem de respeitar igual");
  assert.ok(!specValidate.includes("error(s)"), "locale en não pode vencer o manifesto pt-BR");
});

const specEm = (repo, slug, corpo) => {
  mkdirSync(path.join(repo, "specs", slug), { recursive: true });
  writeFileSync(path.join(repo, "specs", slug, "03-spec.md"), corpo, "utf8");
};

test("mgr spec validate cobre plano E spec no mesmo comando", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "x", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **depends_on:** [P9.9]\n- **artifact:** 1 x\n- **done_when:** y\n");
  specEm(repo, "x", "<!-- mgr-spec-format: 1 -->\n# spec sem critério\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const resultado = (() => {
    try { return { stdout: execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo)), status: 0 }; }
    catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
  })();
  assert.equal(resultado.status, 1);
  assert.match(resultado.stdout, /PLAN-1/, "o achado do plano continua saindo");
  assert.match(resultado.stdout, /SPEC-1/, "o achado da spec aparece ao lado");
});

test("mgr spec validate: achados PLAN-* não mudaram de forma", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "x", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **files:** [a, b, c, d]\n- **artifact:** 1 x\n- **done_when:** y\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const resultado = (() => {
    try { return { stdout: execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo)), status: 0 }; }
    catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
  })();
  assert.match(resultado.stdout, /x PLAN-3 P0\.1:\d+ — task com 4 arquivos; o teto é 3/);
});

// O outro lado da decisão: sem isto, a suíte não distingue "--strict funciona" de "--strict é
// no-op". Os dois avisos abaixo NÃO são isentos, e em modo estrito o comando tem de sair com 1.
test("mgr spec validate: --strict reprova o aviso não isento, nos dois artefatos", () => {
  const repo = diretorioTemporario();
  const plano = [
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — a", "- **depends_on:** [P1.1]", "- **artifact:** 1 x", "- **done_when:** y",
    "### P1.1 — b", "- **depends_on:** []", "- **artifact:** 1 y", "- **done_when:** z",
  ].join("\n");
  planoEm(repo, "x", `${plano}\n`);
  specEm(repo, "x", "<!-- mgr-spec-format: 1 -->\n- [ ] **CA-1:** a\n- [ ] **CA-3:** b\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const rodar = (args) => {
    try { return { stdout: execFileSync("node", [bin, ...args], ptBR(repo)), status: 0 }; }
    catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
  };
  const frouxo = rodar(["spec", "validate", "--all"]);
  assert.equal(frouxo.status, 0, "aviso não reprova no modo padrão");
  assert.match(frouxo.stdout, /0 erro\(s\), 2 aviso\(s\)/);

  const estrito = rodar(["spec", "validate", "--all", "--strict"]);
  assert.equal(estrito.status, 1, "em modo estrito o aviso não isento reprova");
  assert.match(estrito.stdout, /PLAN-5/);
  assert.match(estrito.stdout, /SPEC-4/);
});

test("mgr spec validate: spec sem marcador não reprova, nem com --strict", () => {
  const repo = diretorioTemporario();
  specEm(repo, "legado", "# spec antiga\n\n1. primeiro critério sem identidade\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "spec", "validate", "--all", "--strict"], ptBR(repo));
  assert.match(stdout, /SPEC-0/);
  assert.match(stdout, /0 erro\(s\)/);
});

test("mgr spec validate --json soma os dois artefatos no mesmo envelope", () => {
  const repo = diretorioTemporario();
  planoEm(repo, "x", "<!-- mgr-plan-format: 1 -->\n### P0.1 — a\n- **artifact:** 1 x\n- **done_when:** y\n");
  specEm(repo, "x", "<!-- mgr-spec-format: 1 -->\n- [ ] **CA-1:** algo observável\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "spec", "validate", "--all", "--json"], ptBR(repo)));
  assert.deepEqual(Object.keys(payload).sort(), ["files", "findings", "schemaVersion", "scope", "summary"]);
  assert.equal(payload.files.length, 2, "plano e spec no mesmo envelope");
  assert.deepEqual(payload.summary, { errors: 0, warnings: 0 });
});

// `mgr spec next` (ADR-0014). Locale fixado: foi o locale que quebrou o CI da fatia 1.
const planoDeFixture = (repo, slug, nome) => {
  const fixtures = fileURLToPath(new URL("./fixtures/plans", import.meta.url));
  mkdirSync(path.join(repo, "specs", slug), { recursive: true });
  writeFileSync(path.join(repo, "specs", slug, "04-plan.md"), readFileSync(path.join(fixtures, nome), "utf8"));
};
const rodarNext = (repo, args) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  try { return { stdout: execFileSync("node", [bin, "spec", "next", ...args], ptBR(repo)), status: 0 }; }
  catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
};

test("mgr spec next: devolve a task pronta, com artefato e skill", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "com-estado.md");
  const { stdout, status } = rodarNext(repo, ["demo"]);
  assert.equal(status, 0);
  assert.match(stdout, /^P0\.2$/m);
  assert.match(stdout, /1 função escolher\(plano\)/);
  assert.match(stdout, /code-analyzer/);
  assert.match(stdout, /Estado declarado em 1 de 3/);
});

test("mgr spec next: com tudo concluído não devolve task, e sai com 0", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "tudo-concluido.md");
  const { stdout, status } = rodarNext(repo, ["demo"]);
  assert.equal(status, 0, "ausência de trabalho pronto é resposta verdadeira, não falha");
  assert.match(stdout, /Nada a fazer/);
  assert.ok(!/^P\d/m.test(stdout), "nenhuma task oferecida");
});

test("mgr spec next: nada pronto lista o que bloqueia e manda validar", () => {
  const repo = diretorioTemporario();
  const fixtures = fileURLToPath(new URL("./fixtures/plans/invalidos", import.meta.url));
  mkdirSync(path.join(repo, "specs", "demo"), { recursive: true });
  writeFileSync(path.join(repo, "specs", "demo", "04-plan.md"),
    readFileSync(path.join(fixtures, "nada-pronto.md"), "utf8"));
  const { stdout, status } = rodarNext(repo, ["demo"]);
  assert.equal(status, 0);
  assert.match(stdout, /P0\.1 espera por P9\.9/);
  assert.match(stdout, /mgr spec validate/);
  assert.ok(!/PODE começar/.test(stdout), "não promete task quando não devolveu nenhuma");
});

test("mgr spec next: plano sem marcador explica o que falta e não reprova", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "legado-puro.md");
  const { stdout, status } = rodarNext(repo, ["demo"]);
  assert.equal(status, 0, "plano escrito antes da feature nunca é reprovado por ela");
  assert.match(stdout, /não declara o formato/);
  assert.match(stdout, /Estado declarado em/, "a CA-6 diz TODA resposta, sem exceção");
  assert.match(stdout, /04-plan\.md/, "a resposta diz de qual plano fala");
});

test("mgr spec next: sem estado declarado, admite que não sabe o que já foi feito", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "formato-1.md");
  const { stdout } = rodarNext(repo, ["demo"]);
  assert.match(stdout, /NÃO sabe o que você já fez/);
  assert.match(stdout, /PODE começar, não necessariamente a próxima/);
});

test("mgr spec next: sem plano nenhum sai com 1", () => {
  const repo = diretorioTemporario();
  mkdirSync(path.join(repo, "specs"), { recursive: true });
  assert.equal(rodarNext(repo, ["inexistente"]).status, 1);
});

test("mgr spec next --json tem o envelope estável e nenhum caminho absoluto", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "com-estado.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "spec", "next", "demo", "--json"], ptBR(repo)));
  assert.deepEqual(Object.keys(payload).sort(),
    ["blocked", "file", "outcome", "schemaVersion", "stateDeclared", "task", "taskCount"]);
  assert.equal(payload.outcome, "task");
  assert.equal(payload.task.id, "P0.2");
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina no payload");
});

test("mgr spec next: `--all` é RECUSADO, em vez de aceito e ignorado", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "com-estado.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  let erro = null;
  try { execFileSync("node", [bin, "spec", "next", "--all"], ptBR(repo)); } catch (e) { erro = e; }
  assert.ok(erro, "a flag é recusada, não aceita e ignorada");
  assert.equal(erro.status, 1, "a pergunta `o que faço agora` é sobre UMA feature");
  assert.match(erro.stderr + "", /não aceita `--all`/);
  assert.equal(erro.stdout + "", "", "a recusa vai para stderr, e nenhuma task é oferecida");
});

test("mgr spec next: da raiz e sem slug, NÃO escolhe em silêncio", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "alfa", "com-estado.md");
  planoDeFixture(repo, "beta", "formato-1.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  let erro = null;
  try { execFileSync("node", [bin, "spec", "next"], ptBR(repo)); } catch (e) { erro = e; }
  assert.ok(erro, "sem slug e da raiz, o comando recusa");
  assert.equal(erro.status, 1);
  assert.match(erro.stderr + "", /2 feature\(s\) em specs\//, "diz quantas existem");
  assert.match(erro.stderr + "", /specs\/<slug>\//, "diz a outra saída: rodar de dentro da feature");
  assert.ok(!/^P\d/m.test(erro.stdout + ""), "nenhuma task foi oferecida");
});

test("mgr spec next: de dentro de specs/<slug>/ continua respondendo sem slug", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "alfa", "com-estado.md");
  planoDeFixture(repo, "beta", "formato-1.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const dentro = { ...ptBR(repo), cwd: path.join(repo, "specs", "beta") };
  const stdout = execFileSync("node", [bin, "spec", "next"], dentro);
  assert.match(stdout, /beta/, "responde sobre a feature de onde foi rodado");
});

// `mgr spec validate` com proveniência (ADR-0016). Locale fixado, como as fatias anteriores exigem.
const artefatoComTexto = (repo, slug, nome, texto) => {
  mkdirSync(path.join(repo, "specs", slug), { recursive: true });
  writeFileSync(path.join(repo, "specs", slug, nome), texto);
};
const rodarValidate = (repo, args) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  try { return { stdout: execFileSync("node", [bin, "spec", "validate", ...args], ptBR(repo)), status: 0 }; }
  catch (erro) { return { stdout: erro.stdout + "", status: erro.status }; }
};

test("mgr spec validate: o ponteiro quebrado entra no MESMO comando, como erro", () => {
  const repo = diretorioTemporario();
  artefatoComTexto(repo, "demo", "01-brief.md", "a origem disto [code:src/sumiu.js:1]\n");
  const { stdout, status } = rodarValidate(repo, ["demo"]);
  assert.equal(status, 1, "PROV-2 é erro e bloqueia");
  assert.match(stdout, /PROV-2/);
  assert.match(stdout, /01-brief\.md/, "a proveniência vale para QUALQUER artefato, não só plano e spec");
});

test("mgr spec validate: ponteiro que resolve e etiqueta em prosa não produzem achado", () => {
  const repo = diretorioTemporario();
  writeFileSync(path.join(repo, "existe.js"), "uma linha\n");
  artefatoComTexto(repo, "demo", "01-brief.md",
    "resolve [code:existe.js:1]\no ponteiro `[code:src/sumiu.js:1]` citado no meio da frase.\n");
  const { stdout, status } = rodarValidate(repo, ["demo"]);
  assert.equal(status, 0);
  assert.ok(!stdout.includes("PROV-"), "nem o que resolve nem a citação em prosa produzem achado");
});

test("mgr spec validate: a marca de pendência só vira aviso em feature com 06-completion.md", () => {
  const aberta = diretorioTemporario();
  artefatoComTexto(aberta, "demo", "01-brief.md", "o prazo [A DEFINIR]\n");
  assert.ok(!rodarValidate(aberta, ["demo"]).stdout.includes("PROV-3"), "feature aberta pode ter pendência");

  const fechada = diretorioTemporario();
  artefatoComTexto(fechada, "demo", "01-brief.md", "o prazo [A DEFINIR]\n");
  artefatoComTexto(fechada, "demo", "06-completion.md", "fechada\n");
  const { stdout, status } = rodarValidate(fechada, ["demo"]);
  assert.equal(status, 0, "PROV-3 é aviso: não bloqueia");
  assert.match(stdout, /PROV-3/);
  assert.match(stdout, /não distingue uma pendência real de uma citação/, "a mensagem declara o que não sabe");
});

test("mgr spec validate: o envelope --json não mudou de forma", () => {
  const repo = diretorioTemporario();
  artefatoComTexto(repo, "demo", "01-brief.md", "a origem disto [code:src/sumiu.js:1]\n");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  let saida = null;
  try { execFileSync("node", [bin, "spec", "validate", "demo", "--json"], ptBR(repo)); }
  catch (erro) { saida = erro.stdout + ""; }
  const payload = JSON.parse(saida);
  assert.deepEqual(Object.keys(payload).sort(), ["files", "findings", "schemaVersion", "scope", "summary"]);
  assert.equal(payload.summary.errors, 1);
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina no payload");
});

test("mgr spec validate continua idêntico ao lado do next", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "com-estado.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo));
  assert.match(stdout, /0 erro\(s\)/);
  assert.ok(!stdout.includes("PLAN-6"), "status válido não produz aviso");
});

// `mgr spec status` (ADR-0015). Locale fixado, como o CI exige.
const repoComArtefatos = (arvore) => {
  const repo = diretorioTemporario();
  for (const [slug, arquivos] of Object.entries(arvore)) {
    mkdirSync(path.join(repo, "specs", slug), { recursive: true });
    for (const nome of arquivos) writeFileSync(path.join(repo, "specs", slug, nome), "x");
  }
  return repo;
};
const rodarStatus = (repo, args) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  try { return { stdout: execFileSync("node", [bin, "spec", "status", ...args], ptBR(repo)), status: 0 }; }
  catch (erro) { return { stdout: erro.stdout, status: erro.status }; }
};

test("mgr spec status: marca o que existe e diz o que falta escrever", () => {
  const repo = repoComArtefatos({ demo: ["01-brief.md", "02-prd.md"] });
  const { stdout, status } = rodarStatus(repo, ["demo"]);
  assert.equal(status, 0);
  assert.match(stdout, /brief prd -spec -plan -execution -completion/);
  assert.match(stdout, /escrever:\s+spec/);
});

// O caso real: quatro features em disco têm handoff E completion.
test("mgr spec status: handoff de feature concluída não vira trabalho pendente", () => {
  const repo = repoComArtefatos({
    demo: ["01-brief.md", "02-prd.md", "03-spec.md", "04-plan.md", "05-execution.md",
           "06-completion.md", ".handoff.md"],
  });
  const { stdout } = rodarStatus(repo, ["demo"]);
  assert.match(stdout, /em disco; ele nunca é removido automaticamente/);
  assert.ok(!/pendente/i.test(stdout), "a saída nunca chama o arquivo de trabalho pendente");
  assert.match(stdout, /todos os artefatos estão em disco/);
});

test("mgr spec status: o aviso sai em toda resposta humana", () => {
  const repo = repoComArtefatos({ demo: ["01-brief.md"] });
  for (const args of [["demo"], ["--all"]]) {
    assert.match(rodarStatus(repo, args).stdout, /EXISTÊNCIA DE ARQUIVO, não progresso/);
  }
});

test("mgr spec status --all: uma linha por feature, em ordem estável", () => {
  const repo = repoComArtefatos({ zebra: ["01-brief.md"], alfa: ["01-brief.md", "02-prd.md"] });
  const { stdout, status } = rodarStatus(repo, ["--all"]);
  assert.equal(status, 0);
  assert.ok(stdout.indexOf("alfa") < stdout.indexOf("zebra"), "ordem estável, não a do readdir");
  assert.match(stdout, /alfa\s+2\/6/);
  assert.match(stdout, /zebra\s+1\/6/);
});

test("mgr spec status: slug inexistente sai com 1", () => {
  const repo = repoComArtefatos({ demo: ["01-brief.md"] });
  assert.equal(rodarStatus(repo, ["nao-existe"]).status, 1);
});

test("mgr spec status --all sem feature nenhuma sai com 1", () => {
  const repo = diretorioTemporario();
  mkdirSync(path.join(repo, "specs"), { recursive: true });
  assert.equal(rodarStatus(repo, ["--all"]).status, 1);
});

test("mgr spec status --json: envelope estável, com basis e warning, e sem campo sem fonte", () => {
  const repo = repoComArtefatos({ demo: ["01-brief.md", "02-prd.md"] });
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "spec", "status", "demo", "--json"], ptBR(repo)));

  assert.deepEqual(Object.keys(payload).sort(),
    ["artifacts", "basis", "found", "handoff", "nextReady", "schemaVersion", "slug", "specRoot", "warning"]);
  assert.equal(payload.basis, "file-existence", "token estável, para ramificar sem casar tradução");
  assert.ok(payload.warning.length > 0);
  for (const artefato of payload.artifacts) {
    assert.deepEqual(Object.keys(artefato).sort(), ["id", "path", "requires", "status"],
      "`approved` e `checkpoint` não têm fonte mecânica e não entram no payload");
    assert.notEqual(artefato.status, "done", "existência de arquivo não é conclusão de etapa");
  }
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina");
});

test("mgr spec validate e mgr spec next continuam idênticos ao lado do status", () => {
  const repo = diretorioTemporario();
  planoDeFixture(repo, "demo", "com-estado.md");
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  assert.match(execFileSync("node", [bin, "spec", "validate", "--all"], ptBR(repo)), /0 erro\(s\)/);
  assert.match(execFileSync("node", [bin, "spec", "next", "demo"], ptBR(repo)), /^P0\.2$/m);
});

test("mgr spec status --all --json: o envelope do modo --all também tem basis e warning", () => {
  const repo = repoComArtefatos({ alfa: ["01-brief.md"], beta: ["01-brief.md", "02-prd.md"] });
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "spec", "status", "--all", "--json"], ptBR(repo)));

  assert.deepEqual(Object.keys(payload).sort(), ["basis", "features", "schemaVersion", "warning"]);
  assert.equal(payload.basis, "file-existence");
  assert.ok(payload.warning.length > 0, "a CA-4 diz TODO payload, e este é o outro");
  assert.deepEqual(payload.features.map((f) => f.slug), ["alfa", "beta"]);
  for (const feature of payload.features) {
    for (const artefato of feature.artifacts) {
      assert.deepEqual(Object.keys(artefato).sort(), ["id", "path", "requires", "status"]);
    }
  }
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina");
});

// A §5 promete derivar o slug do diretório atual. Até esta feature, nenhum dos três comandos
// conseguia: a borda passava `repo = cwd`, e a relativização dava sempre `..`.
test("os três comandos spec funcionam de DENTRO de specs/<slug>/", () => {
  const repo = repoComArtefatos({ demo: ["01-brief.md", "02-prd.md"] });
  const fixtures = fileURLToPath(new URL("./fixtures/plans", import.meta.url));
  writeFileSync(path.join(repo, "specs", "demo", "04-plan.md"),
    readFileSync(path.join(fixtures, "com-estado.md"), "utf8"));
  writeFileSync(path.join(repo, "package.json"), "{}");

  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const deDentro = { ...ptBR(repo), cwd: path.join(repo, "specs", "demo") };

  assert.match(execFileSync("node", [bin, "spec", "status"], deDentro), /specs[/\\]demo/);
  assert.match(execFileSync("node", [bin, "spec", "next"], deDentro), /^P0\.2$/m);
  assert.match(execFileSync("node", [bin, "spec", "validate"], deDentro), /0 erro\(s\)/);
});

// `mgr agents` (ADR-0017). Locale fixado, como as fatias anteriores exigem.
const rodarAgents = (repo, args) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  try { return { stdout: execFileSync("node", [bin, "agents", ...args], ptBR(repo)), status: 0 }; }
  catch (erro) { return { stdout: erro.stdout + "", stderr: erro.stderr + "", status: erro.status }; }
};
const repoComConfig = (config) => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], ...config }), "utf8");
  return repo;
};

test("mgr agents: diz o valor E a origem de cada um, por motor", () => {
  const { stdout, status } = rodarAgents(repoComConfig({}), []);
  assert.equal(status, 0);
  for (const intent of catalog.INTENTS) assert.match(stdout, new RegExp(`^${intent}\\s`, "m"));
  assert.match(stdout, /esforço=high \(default\)/, "o esforço herdado sai como default");
  assert.match(stdout, /esforço=não suportado por este motor/, "o copilot não tem effort");
  assert.ok(!stdout.includes("modelo=opus"), "nenhum motor recebe identificador publicado");
});

test("mgr agents: o que o autor escreveu sai como configurado", () => {
  const repo = repoComConfig({ agents: { execution: { model: { "claude-code": "sonnet" } } } });
  const { stdout } = rodarAgents(repo, ["execution"]);
  assert.match(stdout, /modelo=sonnet \(configurado\)/);
  assert.match(stdout, /esforço=low \(default\)/, "o que não foi escrito não vira escolha dele");
  assert.ok(!stdout.includes("drafting"), "pedindo uma intenção, só ela sai");
});

test("mgr agents: avisa que mudar o effort exige update", () => {
  const { stdout } = rodarAgents(repoComConfig({}), []);
  assert.match(stdout, /Mudar o `effort` só passa a valer depois de `mgr update`/,
    "sem isto o autor ajusta o esforço e conclui que a configuração não funciona");
});

test("mgr agents: com as duas chaves, avisa o conflito", () => {
  const repo = repoComConfig({ reviewGate: { effort: "high" }, agents: { review: { effort: "max" } } });
  const { stdout } = rodarAgents(repo, []);
  assert.match(stdout, /`agents\.review` vence/);
  const semConflito = rodarAgents(repoComConfig({ reviewGate: { effort: "high" } }), []);
  assert.ok(!semConflito.stdout.includes("vence"), "sem conflito, nenhum aviso é inventado");
});

test("mgr agents: intenção desconhecida sai com código diferente de zero", () => {
  const { status, stderr } = rodarAgents(repoComConfig({}), ["revisao"]);
  assert.equal(status, 1);
  assert.match(stderr, /desconhecida \(esperado drafting \| execution \| review\)/);
});

test("mgr agents --json tem envelope estável e nenhum caminho absoluto", () => {
  const repo = repoComConfig({});
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "agents", "--json"], ptBR(repo)));
  assert.deepEqual(Object.keys(payload).sort(), ["aliasOverridden", "intents", "schemaVersion"]);
  assert.deepEqual(Object.keys(payload.intents), catalog.INTENTS);
  const daRedacao = payload.intents.drafting;
  assert.deepEqual(Object.keys(daRedacao).sort(), ["agent", "enabled", "engines", "needs"]);
  assert.equal(daRedacao.engines.copilot.effort, null, "não suportado vem nulo, não inventado");
  assert.deepEqual(daRedacao.engines.copilot.skipped, ["effort"]);
  assert.ok(!JSON.stringify(payload).includes(repo), "nenhum caminho absoluto da máquina");
});

test("a mensagem do install nomeia O AGENTE escrito, não o gate", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node",
    [bin, "install", repo, "--engine", "claude-code", "--scope", "project", "--all-skills", "-y"],
    ptBR(repo));
  for (const intent of catalog.INTENTS) {
    const agente = catalog.AGENTS[intent].agent;
    assert.match(stdout, new RegExp(`agente ${agente} gravado`),
      `chamar ${agente} de "gate de validação" seria a saída mentindo sobre o que escreveu`);
  }
});

// `agentChanges` — o antes e o depois de cada agente, no núcleo (ADR-0017).
const instalarNoRepo = (repo) =>
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));

test("na primeira instalação o ANTES é nulo, que é diferente de vazio", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const { agentChanges } = instalarNoRepo(repo);

  assert.equal(agentChanges.length, catalog.INTENTS.length);
  for (const mudanca of agentChanges) {
    assert.equal(mudanca.before, null, `${mudanca.agent}: arquivo que não existia`);
    assert.equal(mudanca.after.model, null, `${mudanca.agent}: sem default publicado`);
    assert.ok(mudanca.after.effort, `${mudanca.agent}: o esforço segue declarado`);
  }
});

test("valor que não mudou sai com antes igual a depois", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarNoRepo(repo);
  const { agentChanges } = instalarNoRepo(repo);

  for (const mudanca of agentChanges) {
    assert.deepEqual(mudanca.before, mudanca.after, `${mudanca.agent}: nada mudou, e o par diz isso`);
  }
});

test("mudar o config muda SÓ o agente e o campo mudados", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  instalarNoRepo(repo);
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { execution: { model: { "claude-code": "sonnet" } } } }), "utf8");
  const { agentChanges } = instalarNoRepo(repo);

  const doTask = agentChanges.find((m) => m.agent === "mgr-task");
  assert.equal(doTask.before.model, null, "antes: herdado, porque o default não publica modelo");
  assert.equal(doTask.after.model, "sonnet");
  assert.equal(doTask.before.effort, doTask.after.effort, "o effort não foi tocado");

  for (const mudanca of agentChanges.filter((m) => m.agent !== "mgr-task")) {
    assert.deepEqual(mudanca.before, mudanca.after, `${mudanca.agent}: não foi mexido`);
  }
});

test("agente bloqueado por arquivo alheio não produz mudança nenhuma", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  const dir = path.join(repo, ".claude", "agents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mgr-review.md"), "agente do usuário", "utf8");
  const { agentChanges } = instalarNoRepo(repo);

  assert.ok(!agentChanges.some((m) => m.agent === "mgr-review"), "o que não foi escrito não mudou");
  assert.equal(agentChanges.length, catalog.INTENTS.length - 1);
});

test("intenção desligada não produz mudança", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { drafting: { enabled: false } } }), "utf8");
  const { agentChanges } = instalarNoRepo(repo);
  assert.ok(!agentChanges.some((m) => m.agent === "mgr-draft"));
});

test("agentDeclares devolve nulo para arquivo ausente, e o campo ausente vira nulo", () => {
  assert.equal(agentDeclares("/nao/existe.md"), null);
  const arquivo = path.join(diretorioTemporario(), "a.md");
  writeFileSync(arquivo, "---\nname: x\ntools: Read\n---\n\ncorpo\n", "utf8");
  assert.deepEqual(agentDeclares(arquivo), { model: null, effort: null },
    "existir sem o campo é diferente de o arquivo não existir");
});

// `mgr update` deixa de reescrever o agente em silêncio (ADR-0017, P1.9).
const rodarUpdate = (repo) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  return execFileSync("node", [bin, "update", repo], ptBR(repo));
};
const instalarPelaCli = (repo) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  execFileSync("node", [bin, "install", repo, "--engine", "claude-code", "--scope", "project",
    "--all-skills", "-y"], ptBR(repo));
};

test("update sem mudança nenhuma NÃO inventa linha sobre agente", () => {
  const repo = diretorioTemporario();
  instalarPelaCli(repo);
  const stdout = rodarUpdate(repo);
  for (const intent of catalog.INTENTS) {
    assert.ok(!stdout.includes(`${catalog.AGENTS[intent].agent} (claude-code)`),
      `${intent}: relatar o que ficou igual encheria a saída de linha sem informação`);
  }
});

test("update depois de mudar o config diz o que mudou, campo a campo", () => {
  const repo = diretorioTemporario();
  instalarPelaCli(repo);
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { execution: { model: { "claude-code": "sonnet" }, effort: "medium" } } }),
    "utf8");
  const stdout = rodarUpdate(repo);

  assert.match(stdout, /mgr-task \(claude-code\): model de null para sonnet/,
    "antes era herdado; declarar um modelo é a mudança que o update relata");
  assert.match(stdout, /mgr-task \(claude-code\): effort de low para medium/);
  assert.ok(!stdout.includes("mgr-review (claude-code)"), "o que não mudou não aparece");
  assert.ok(!stdout.includes("mgr-draft (claude-code)"));
});

test("update que grava um agente pela primeira vez diz isso", () => {
  const repo = diretorioTemporario();
  instalarPelaCli(repo);
  rmSync(path.join(repo, ".claude", "agents", "mgr-draft.md"));
  const stdout = rodarUpdate(repo);
  assert.match(stdout, /mgr-draft \(claude-code\): gravado pela primeira vez/);
  assert.ok(!stdout.includes("mgr-task (claude-code)"), "os outros seguem calados");
});

// RN-1, "uma fonte só": o plano carrega a política que será gravada (ADR-0017, achado do gate).
test("com `agents.review` e SEM `reviewGate`, o plano carrega o que será gravado", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { review: { model: { "claude-code": "sonnet" }, effort: "high" } } }),
    "utf8");

  const plan = installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] });
  // Afirma sobre a fonte que o `execute` de fato usa. O plano trazia um `reviewGate` duplicado,
  // removido em 2026-09-11 pela mesma razão que tirou o `readReviewGate`: campo repetido diverge.
  assert.equal(plan.agents.policies.review.model["claude-code"], "sonnet",
    "ler o apelido aqui fazia o plano contradizer o arquivo escrito");
  assert.equal(plan.agents.policies.review.effort, "high");

  installer.execute(plan);
  const gravado = readFileSync(path.join(repo, ".claude", "agents", "mgr-review.md"), "utf8");
  assert.match(gravado, /model: sonnet/, "o que o plano prometeu é o que o disco recebeu");
  assert.match(gravado, /effort: high/);
});

test("o roteamento da skill de review usa a MESMA política que escreve o agente", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { review: { enabled: false } } }), "utf8");

  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));
  const skill = readFileSync(path.join(repo, ".claude", "skills", "code-analyzer", "SKILL.md"), "utf8");
  assert.ok(!existsSync(path.join(repo, ".claude", "agents", "mgr-review.md")), "o agente não foi escrito");
  assert.ok(!/context: fork/.test(skill),
    "rotear para um agente que não existe em disco era o terceiro sintoma do mesmo defeito");
});

// `mgr tokens` — o consumidor da medição (ADR-0017). Sem ele, `src/tokens.js` era código que
// nenhum caminho de usuário alcançava, e a QUAL-6 do guia reprova isso.
const FIXTURE_TRANSCRIPT = fileURLToPath(new URL("./fixtures/transcripts/exemplo.jsonl", import.meta.url));
const rodarTokens = (repo, args) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  try { return { stdout: execFileSync("node", [bin, "tokens", ...args], ptBR(repo)), status: 0 }; }
  catch (erro) { return { stdout: erro.stdout + "", stderr: erro.stderr + "", status: erro.status }; }
};

test("mgr tokens: sem transcript, recusa e ensina o que passar", () => {
  const { status, stderr } = rodarTokens(diretorioTemporario(), []);
  assert.equal(status, 1);
  assert.match(stderr, /nenhum transcript informado/);
});

test("mgr tokens: reporta total, contexto e cache À PARTE", () => {
  const { stdout, status } = rodarTokens(diretorioTemporario(), [FIXTURE_TRANSCRIPT]);
  assert.equal(status, 0, "sem teto, medir não reprova");
  assert.match(stdout, /total\s+213/);
  assert.match(stdout, /cache lido\s+7916/);
  assert.ok(!stdout.includes("8129"), "somar o cache ao total é o erro que o comando não comete");
});

test("mgr tokens: o primeiro transcript é a conversa, os demais são agentes", () => {
  const repo = diretorioTemporario();
  const doAgente = path.join(repo, "agente.jsonl");
  writeFileSync(doAgente, `${JSON.stringify({ type: "assistant", message: { role: "assistant", usage: { input_tokens: 90, output_tokens: 10 } } })}\n`, "utf8");
  const { stdout } = rodarTokens(repo, [FIXTURE_TRANSCRIPT, doAgente]);
  assert.match(stdout, /total\s+313/, "213 da conversa mais 100 do agente");
  assert.match(stdout, /agentes\s+100\s+·\s+1 transcript/);
  assert.match(stdout, /contexto 25/, "o agente tem janela própria e não mexe no contexto da conversa");
});

test("mgr tokens: sem teto declarado, mede e sai zero", () => {
  const { stdout, status } = rodarTokens(diretorioTemporario(), [FIXTURE_TRANSCRIPT]);
  assert.equal(status, 0);
  assert.match(stdout, /Nenhum teto declarado/);
});

test("mgr tokens: acima do teto declarado, sai com código diferente de zero", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { budget: { totalTokens: 100 } } }), "utf8");
  const acima = rodarTokens(repo, [FIXTURE_TRANSCRIPT]);
  assert.equal(acima.status, 1);
  assert.match(acima.stdout, /ACIMA do teto declarado: 213 contra 100/);

  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { budget: { totalTokens: 1000 } } }), "utf8");
  const dentro = rodarTokens(repo, [FIXTURE_TRANSCRIPT]);
  assert.equal(dentro.status, 0);
  assert.match(dentro.stdout, /Dentro do teto declarado: 213 de 1000/);
});

test("mgr tokens --json tem envelope estável e nenhum caminho absoluto", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "tokens", FIXTURE_TRANSCRIPT, "--json"], ptBR(repo)));
  assert.deepEqual(Object.keys(payload).sort(), [
    "agentsCounted", "agentsTotal", "budget", "cacheRead", "conversationContext",
    "conversationTotal", "schemaVersion", "total", "verdict",
  ]);
  assert.equal(payload.verdict, "no-budget");
  assert.ok(!JSON.stringify(payload).includes(repo));
});

// `inherit` no frontmatter e o aviso do default (ADR-0017).
test("`effort: inherit` faz o arquivo do agente sair sem a linha, e o agente segue escrito", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], agents: { review: { model: { "claude-code": "opus" }, effort: "inherit" } } }),
    "utf8");
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));

  const texto = readFileSync(path.join(repo, ".claude", "agents", "mgr-review.md"), "utf8");
  assert.match(texto, /model: opus/, "o que foi declarado segue declarado");
  assert.ok(!texto.includes("effort:"), "o que foi marcado como herdado não é escrito");
});

test("o aviso do modelo herdado aparece, e SOME quando todas as intenções declaram", () => {
  const semNada = rodarAgents(diretorioTemporario(), []);
  assert.match(semNada.stdout, /Rodando no modelo da sessão: drafting, execution, review/);
  assert.match(semNada.stdout, /a lista de modelos é da sua conta/,
    "a razão é dita, não só o fato — é ela que explica por que não há default");

  const declarado = Object.fromEntries(catalog.INTENTS.map((intent) =>
    [intent, { model: { "claude-code": "opus" } }]));
  const { stdout } = rodarAgents(repoComConfig({ agents: declarado }), []);
  assert.ok(!stdout.includes("Rodando no modelo da sessão"),
    "avisar sobre o que já foi resolvido vira ruído, e ruído ensina a ignorar a saída");
});

test("o aviso nomeia SÓ as intenções que estão herdando", () => {
  const { stdout } = rodarAgents(repoComConfig({ agents: { execution: { model: { "claude-code": "haiku" } } } }), []);
  assert.match(stdout, /Rodando no modelo da sessão: drafting, review/);
  assert.ok(!/Rodando no modelo da sessão: [^.]*execution/.test(stdout), "a que declarou não é nomeada");
});

// F-3 do segundo review: com `inherit`, a saída dizia "não suportado" de um motor que suporta.
test("`effort: inherit` sai como HERDADO no claude-code, e não como não suportado", () => {
  const repo = repoComConfig({ agents: { review: { effort: "inherit" } } });
  const { stdout } = rodarAgents(repo, ["review"]);
  const doClaude = stdout.split("\n").find((linha) => linha.includes("claude-code"));
  assert.match(doClaude, /esforço=herdado da sessão/, "o claude-code SUPORTA effort");
  assert.ok(!doClaude.includes("não suportado"), "dizer isso é a saída mentindo sobre a plataforma");

  const doCopilot = stdout.split("\n").find((linha) => linha.includes("copilot"));
  assert.match(doCopilot, /esforço=não suportado por este motor/, "e o copilot de fato não suporta");
});

test("com `inherit`, a chave `effort` NÃO some do payload --json", () => {
  const repo = repoComConfig({ agents: { review: { effort: "inherit" } } });
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const payload = JSON.parse(execFileSync("node", [bin, "agents", "review", "--json"], ptBR(repo)));
  const doClaude = payload.intents.review.engines["claude-code"];
  assert.ok(Object.hasOwn(doClaude, "effort"), "`undefined` some do stringify; a §5 contrata a chave");
  assert.equal(doClaude.effort, null);
  assert.deepEqual(doClaude.skipped, [], "não há capacidade faltando: foi escolha do autor");
});

// `mgr agents set` — a escrita pela borda. Os motores vêm do MANIFESTO, então o repositório de
// teste precisa dos dois arquivos, e não só do config.
const repoComMotores = (engines, config = {}) => {
  const repo = repoComConfig(config);
  writeFileSync(path.join(installer.coreDir("project", repo), "manifest.json"),
    JSON.stringify({ version: "0.0.0", engines, core: installer.coreDir("project", repo) }), "utf8");
  return repo;
};
const configDe = (repo) =>
  JSON.parse(readFileSync(path.join(installer.coreDir("project", repo), "config.json"), "utf8"));

test("mgr agents set: identificador de modelo desconhecido é aceito", () => {
  const repo = repoComMotores(["claude-code"]);
  const { stdout, status } = rodarAgents(repo, ["set", "drafting", "--model", "modelo-da-minha-conta"]);
  assert.equal(status, 0);
  assert.match(stdout, /modelo=modelo-da-minha-conta/);
  assert.equal(configDe(repo).agents.drafting.model["claude-code"], "modelo-da-minha-conta",
    "a lista de modelos é da conta de quem instala, e lista nossa recusaria modelo válido (RN-2)");
});

test("mgr agents set: sem --engine, escreve para os motores do manifesto, e nomeia os dois", () => {
  const repo = repoComMotores(["claude-code", "copilot"]);
  const { stdout } = rodarAgents(repo, ["set", "execution", "--model", "haiku"]);
  assert.deepEqual(configDe(repo).agents.execution.model, { "claude-code": "haiku", copilot: "haiku" });
  for (const engine of ["claude-code", "copilot"]) {
    assert.match(stdout, new RegExp(`^\\s+${engine}\\s.*modelo=haiku`, "m"), `${engine} na saída`);
  }
});

test("mgr agents set: `--effort` com `--engine` mostra TODOS os motores, porque vale para todos", () => {
  const repo = repoComMotores(["claude-code", "copilot"]);
  const { stdout } = rodarAgents(repo, ["set", "review", "--engine", "copilot", "--effort", "max"]);
  assert.equal(configDe(repo).agents.review.effort, "max", "o esforço é da intenção, não do motor");
  assert.match(stdout, /claude-code.*esforço=max/,
    "mostrar só o motor pedido esconderia que o esforço passou a valer no outro também");
});

test("mgr agents set: sem motor instalado, `--model` é recusado em vez de gravar no escuro", () => {
  const repo = repoComConfig({});
  const { stderr, status } = rodarAgents(repo, ["set", "review", "--model", "opus"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /nenhum motor instalado neste projeto/);
  assert.equal(Object.hasOwn(configDe(repo), "agents"), false);
});

test("mgr agents set: motor não instalado é recusado, e nada é gravado", () => {
  const repo = repoComMotores(["claude-code"]);
  const { stderr, status } = rodarAgents(repo, ["set", "review", "--engine", "copilot", "--model", "x"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /copilot.*não está instalado.*instalados: claude-code/s);
  assert.equal(Object.hasOwn(configDe(repo), "agents"), false,
    "gravar e ignorar deixaria o autor achando que configurou");
});

test("mgr agents set: esforço fora da escala reprova, e o config fica intocado", () => {
  const repo = repoComMotores(["claude-code"]);
  const { stderr, status } = rodarAgents(repo, ["set", "review", "--effort", "extremo"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /invalid agents\.review\.effort: "extremo"/);
  assert.equal(Object.hasOwn(configDe(repo), "agents"), false);
});

test("mgr agents set: sem campo nenhum, e sem intenção, são recusados", () => {
  const repo = repoComMotores(["claude-code"]);
  const semCampo = rodarAgents(repo, ["set", "review"]);
  assert.notEqual(semCampo.status, 0);
  assert.match(semCampo.stderr, /nada a escrever/);

  const semIntencao = rodarAgents(repo, ["set"]);
  assert.notEqual(semIntencao.status, 0);
  assert.match(semIntencao.stderr, /diga a intenção a configurar/);

  const desconhecida = rodarAgents(repo, ["set", "revisao", "--effort", "max"]);
  assert.notEqual(desconhecida.status, 0);
  assert.match(desconhecida.stderr, /intenção `revisao` desconhecida/);
});

test("mgr agents set: uma frase por campo escrito, e só pelos escritos", () => {
  const repo = repoComMotores(["claude-code"]);
  const soModelo = rodarAgents(repo, ["set", "drafting", "--model", "opus"]);
  assert.match(soModelo.stdout, /Escrevendo `agents.drafting` em .mgr-core\/config.json/,
    "a escrita em disco é anunciada ANTES de acontecer, como o `mgr registry add` já faz");
  assert.match(soModelo.stdout, /`model` passa a valer na próxima invocação/);
  assert.ok(!soModelo.stdout.includes("`effort` só passa a valer"),
    "anunciar efeito de campo que não foi escrito é a saída mentindo");

  const osDois = rodarAgents(repo, ["set", "review", "--model", "opus", "--effort", "max"]);
  assert.match(osDois.stdout, /`model` passa a valer na próxima invocação/);
  assert.match(osDois.stdout, /`effort` só passa a valer depois de `mgr update`/,
    "os dois campos passam a valer em momentos diferentes, e dizer só \"pronto\" esconde isso");
});

test("mgr agents set: o comando NÃO roda o update, e o arquivo do agente fica como estava", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  execFileSync("node", [bin, "install", "--engine", "claude-code", "--arch", "hexagonal",
    "--project-id", "x", "-y", repo], { encoding: "utf8" });
  const doAgente = path.join(repo, ".claude", "agents", "mgr-review.md");
  const antes = readFileSync(doAgente, "utf8");

  const { status } = rodarAgents(repo, ["set", "review", "--effort", "max"]);
  assert.equal(status, 0);
  assert.equal(readFileSync(doAgente, "utf8"), antes,
    "reescrever o disco do autor sem ele pedir é mudança de estado que o comando não anunciou");
});

test("o predicado de quem está herdando tem um lugar só", () => {
  const policies = Object.fromEntries(catalog.INTENTS.map((intent) =>
    [intent, { ...catalog.AGENTS[intent].defaults }]));
  assert.deepEqual(inheritingModel(catalog.INTENTS, ["claude-code"], policies), catalog.INTENTS);

  policies.execution = { ...policies.execution, model: { "claude-code": "haiku" } };
  assert.deepEqual(inheritingModel(catalog.INTENTS, ["claude-code"], policies), ["drafting", "review"]);
});

test("mgr tokens: caminho que não existe é ERRO, não medição zero", () => {
  const { status, stderr, stdout } = rodarTokens(diretorioTemporario(), ["nao-existe.jsonl"]);
  assert.equal(status, 1, "um erro de digitação saía com `total 0` e cara de medida real");
  assert.match(stderr, /transcript não encontrado: nao-existe\.jsonl/);
  assert.ok(!stdout.includes("total"), "nada é medido quando a entrada é inválida");
});

test("mgr tokens: o caminho ausente é nomeado, um a um", () => {
  const { stderr } = rodarTokens(diretorioTemporario(), [FIXTURE_TRANSCRIPT, "sumiu-a.jsonl", "sumiu-b.jsonl"]);
  assert.match(stderr, /sumiu-a\.jsonl, sumiu-b\.jsonl/, "quem lê precisa saber QUAL caminho errou");
  assert.ok(!stderr.includes("exemplo.jsonl"), "o que existe não é acusado");
});

test("os comandos novos aparecem no help, nos dois idiomas", () => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  // Rodado de um diretório SEM manifesto: o idioma da CLI é manifesto > locale, e num repo com
  // manifesto o `LC_ALL` não manda — foi o que a primeira versão deste teste supôs errado.
  const limpo = diretorioTemporario();
  for (const [locale, agentes, medicao] of [["pt_BR.UTF-8", /^\s+agents\s+qual modelo/m, /^\s+tokens\s+quanto o fluxo/m],
    ["C", /^\s+agents\s+which model/m, /^\s+tokens\s+how much the flow/m]]) {
    const stdout = execFileSync("node", [bin, "help"],
      { encoding: "utf8", cwd: limpo, env: { ...process.env, LC_ALL: locale } });
    assert.match(stdout, agentes, `${locale}: comando que não está no help ninguém descobre`);
    assert.match(stdout, medicao, locale);
  }
});

// F-6 do terceiro review: o plano e o `status` colapsavam "herdado" e "não suportado".
test("o plano e o status distinguem herdado de NÃO SUPORTADO pelo motor", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const doPlano = execFileSync("node", [bin, "install", repo, "--engine", "both", "--scope",
    "project", "--all-skills", "-y"], ptBR(repo));
  // A moldura da CLI quebra a linha em largura fixa: o contrato é o texto, não o layout.
  const semQuebras = (texto) => texto.replace(/[│┌└├─╮╯]/g, " ").replace(/\s+/g, " ");
  assert.match(semQuebras(doPlano), /copilot: modelo=[^|]*?esforço=não suportado por este motor/,
    "o copilot NÃO tem campo de esforço; dizer `esforço da sessão` descarta o valor em silêncio");
  assert.ok(!semQuebras(doPlano).includes("esforço=esforço da sessão"), "a frase antiga sumiu");

  const doStatus = execFileSync("node", [bin, "status", repo], ptBR(repo));
  assert.match(semQuebras(doStatus), /copilot: modelo=[^|]*?esforço=não suportado por este motor/,
    "a mesma função serve as duas telas");
});

test("o claude-code, que suporta esforço, segue dizendo herdado", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const stdout = execFileSync("node", [bin, "install", repo, "--engine", "claude-code", "--scope",
    "project", "--all-skills", "-y"], ptBR(repo));
  const limpo = stdout.replace(/[│┌└├─╮╯]/g, " ").replace(/\s+/g, " ");
  assert.match(limpo, /claude-code: modelo=/, "o plano lista o claude-code");
  assert.ok(!limpo.includes("esforço=não suportado"), "o claude-code suporta esforço");
});

// CA-6, o caso que de fato mudou: config legado que NÃO declara modelo, contando com o default.
// A fixture `config-legado.json` declara `opus`, então ela cobre o outro caso.
test("config legado SEM modelo mantém `effort` e perde a linha `model:`", () => {
  const repo = diretorioTemporario();
  mkdirSync(installer.coreDir("project", repo), { recursive: true });
  writeFileSync(path.join(installer.coreDir("project", repo), "config.json"),
    JSON.stringify({ registries: [], reviewGate: { enabled: true, effort: "max" } }), "utf8");
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { names: ["code-analyzer"] }));

  const texto = readFileSync(path.join(repo, ".claude", "agents", "mgr-review.md"), "utf8");
  assert.match(texto, /effort: max/, "o que o autor escreveu continua valendo");
  assert.ok(!texto.includes("model:"),
    "e o que ele não escreveu deixou de vir de um default publicado (P2.10)");
});

// `mgr precompact --hook` — o gatilho mecânico das leis L3.2 e L3.4 (ADR-0018). O que se protege
// aqui é o caso ruim: o hook não pode derrubar a sessão de quem só abriu o editor.
const PLANO_EM_ANDAMENTO = [
  "<!-- mgr-plan-format: 1 -->", "# Plano", "", "## P1 — Core", "",
  "### P1.1 — task de teste", "- **priority:** P1", "- **depends_on:** []",
  "- **files:** [src/a.js]", "- **artifact:** 1 coisa declarada", "- **done_when:** pronto",
  "- **helper_skill:** none", "- **status:** todo",
].join("\n");

const repoComFeature = () => {
  const repo = diretorioTemporario();
  mkdirSync(path.join(repo, "specs", "alfa"), { recursive: true });
  writeFileSync(path.join(repo, "specs", "alfa", "04-plan.md"), `${PLANO_EM_ANDAMENTO}\n`, "utf8");
  return repo;
};

const rodarPrecompact = (repo, engine, payload) => {
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  const { stdout, stderr, status } = spawnSync("node", [bin, "precompact", "--hook", engine],
    { ...ptBR(repo), input: payload });
  return { stdout, stderr, status };
};

// O stdout do evento de pré-compactação é o ENVELOPE, e nada além dele. Parsear em vez de casar
// regex é o que separa "a mensagem existe" de "a mensagem chega pelo canal que a plataforma lê".
const envelopeDe = (stdout) => JSON.parse(stdout);

test("mgr precompact: grava o hand-off e avisa pelo canal que o usuário lê", () => {
  const repo = repoComFeature();
  const { stdout, status } = rodarPrecompact(repo, "claude-code", '{"trigger":"auto"}');
  assert.equal(status, 0);
  const { systemMessage } = envelopeDe(stdout);
  assert.match(systemMessage, /Hand-off de `alfa` gravado/);
  assert.match(systemMessage, /sessão NOVA/, "a sugestão de sessão nova é pedido explícito do autor");
  assert.match(readFileSync(path.join(repo, "specs", "alfa", ".handoff.md"), "utf8"),
    /O que este hand-off NÃO sabe/);
});

// O stdout do PreCompact vai para o debug log: a doc lista as quatro exceções em que ele vira
// contexto, e este evento não está entre elas. Texto solto ali é mensagem que ninguém lê.
test("mgr precompact: o stdout é só o envelope, e o log vai para o stderr", () => {
  const repo = repoComFeature();
  const { stdout, stderr } = rodarPrecompact(repo, "claude-code", '{"trigger":"auto"}');
  assert.doesNotThrow(() => envelopeDe(stdout),
    "log no stdout tornaria o envelope impossível de parsear, e o aviso não chegaria");
  assert.match(stderr, /gravando o hand-off em/, "LOG-1: antes de alterar estado em disco");
  assert.match(stderr, /hand-off criado em/, "LOG-1: logo depois");
  assert.match(stderr, /lendo a árvore de trabalho do git/, "LOG-2: antes do subprocesso");
  assert.match(stderr, /git devolveu \d+ arquivo/, "LOG-2: logo depois");
  assert.ok(!stdout.includes("[mgr]"), "o canal de log e o canal de aviso não se misturam");
});

test("mgr precompact: hand-off existente é PRESERVADO e ganha seção", () => {
  const repo = repoComFeature();
  const arquivo = path.join(repo, "specs", "alfa", ".handoff.md");
  writeFileSync(arquivo, "# Hand-off escrito pelo agente\n\nDecisão que só a conversa sabia.\n", "utf8");
  rodarPrecompact(repo, "claude-code", '{"trigger":"auto"}');
  const texto = readFileSync(arquivo, "utf8");
  assert.match(texto, /Decisão que só a conversa sabia/,
    "o do agente é mais rico que o do hook; sobrescrever perderia informação na hora mais cara");
  assert.match(texto, /Hand-off automático — compactação de contexto/);
});

test("mgr precompact: sem feature em andamento, nenhum arquivo é escrito", () => {
  const repo = diretorioTemporario();
  const { stdout, status } = rodarPrecompact(repo, "claude-code", '{"trigger":"auto"}');
  assert.equal(status, 0);
  assert.match(envelopeDe(stdout).systemMessage, /Nenhuma feature em andamento/);
  assert.equal(existsSync(path.join(repo, "specs")), false, "hand-off inventado engana a retomada");
});

test("mgr precompact: o bloqueio sai 2 e o motivo vai na decisão declarada", () => {
  const repo = repoComFeature();
  const { stdout, status } = rodarPrecompact(repo, "claude-code", '{"trigger":"manual"}');
  assert.equal(status, 2, "a doc diz que exit 2 bloqueia a compactação deste evento");
  const { hookSpecificOutput } = envelopeDe(stdout);
  assert.deepEqual({ ...hookSpecificOutput, reason: undefined },
    { hookEventName: "PreCompact", decision: "deny", reason: undefined },
    "é o idioma que a doc documenta para bloquear este evento");
  assert.match(hookSpecificOutput.reason, /Compactação bloqueada pelo MGR/);
  assert.match(hookSpecificOutput.reason, /peça de novo que passa/,
    "prometer o que não acontece seria pior que não avisar");
  const { systemMessage } = envelopeDe(stdout);
  assert.match(systemMessage, /compactação foi impedida desta vez/);
  assert.ok(!systemMessage.includes("vai acontecer"),
    "dizer que a compactação vai acontecer no envelope que a impediu é a saída se contradizendo");
});

test("mgr precompact: quem insiste passa, e o método sai da frente", () => {
  const repo = repoComFeature();
  assert.equal(rodarPrecompact(repo, "claude-code", '{"trigger":"manual"}').status, 2);
  const segunda = rodarPrecompact(repo, "claude-code", '{"trigger":"manual"}');
  assert.equal(segunda.status, 0, "bloquear sempre tiraria o /compact do usuário para sempre");
  assert.match(envelopeDe(segunda.stdout).systemMessage, /você pediu de novo/);
  assert.equal(envelopeDe(segunda.stdout).hookSpecificOutput, undefined,
    "passar e declarar deny ao mesmo tempo diria à plataforma duas coisas contrárias");
});

// Sem a guarda, o hand-off era escrito dizendo ter vindo de um motor inexistente e só depois a
// decisão falhava — arquivo com fato inventado dentro, que é o que a RN-2 proíbe.
test("mgr precompact: motor desconhecido sai em silêncio e NÃO grava nada", () => {
  const repo = repoComFeature();
  const { stdout, status } = rodarPrecompact(repo, "cursor", '{"trigger":"manual"}');
  assert.equal(status, 0, "derrubar a sessão de quem só abriu o editor é o que a DT-8 proíbe");
  assert.equal(stdout, "");
  assert.equal(existsSync(path.join(repo, "specs", "alfa", ".handoff.md")), false);
});

test("mgr precompact: o copilot nunca bloqueia, porque a plataforma não deixa", () => {
  const repo = repoComFeature();
  for (const trigger of ["manual", "auto"]) {
    assert.equal(rodarPrecompact(repo, "copilot", `{"trigger":"${trigger}"}`).status, 0);
  }
});

test("mgr precompact: entrada estranha nunca derruba a sessão", () => {
  const repo = repoComFeature();
  for (const payload of ["", "nao-e-json", "null", "[]", '{"trigger":42}']) {
    assert.equal(rodarPrecompact(repo, "claude-code", payload).status, 0,
      `payload ${JSON.stringify(payload)}: exceção aqui poluiria o contexto de quem só abriu o editor`);
  }
});

// P1.6 — a entrada do evento novo, e só onde o motor tem o evento.
test("o MGR grava uma entrada por evento que o motor declara, e nenhuma a mais", () => {
  const repo = diretorioTemporario();
  for (const id of engineIds()) {
    const motor = engineDescriptor(id);
    writeHook(id, repo, { command: "node mgr" });
    const gravado = JSON.parse(readFileSync(path.join(repo, ...motor.hookFile), "utf8"));
    const esperados = [motor.hookEvents.sessionStart, motor.compaction.event].filter(Boolean);
    assert.deepEqual(Object.keys(gravado.hooks).sort(), [...esperados].sort(),
      `${id}: gravar hook em evento que o motor não tem é escrever no vazio`);
  }
});

// O `done_when` da P1.6 pede isto textualmente: "um descritor de teste com `event: null` não recebe
// nenhuma". Motor registrado nenhum está nesse estado hoje — o antigravity e o deep code estarão —,
// então o único jeito de afirmar o ramo é com descritor de mesa, como a P1.3 fez para a decisão.
test("motor sem evento de compactação NÃO recebe entrada de hook para este eixo", () => {
  const deMesa = {
    hookEvents: { sessionStart: "OnStart" },
    hookMatchers: { sessionStart: null, preCompact: "manual|auto" },
    hookTimeouts: { sessionStart: null, preCompact: 15 },
    compaction: { event: null, block: null, notice: null },
  };
  assert.deepEqual(eventsFor(deMesa, "de-mesa", "CMD").map(({ event }) => event), ["OnStart"],
    "gravar hook em evento que a plataforma não tem é escrever no vazio no arquivo do usuário");

  const comEvento = { ...deMesa, compaction: { event: "OnCompact", block: null, notice: null } };
  assert.deepEqual(eventsFor(comEvento, "de-mesa", "CMD").map(({ event }) => event),
    ["OnStart", "OnCompact"], "tendo o evento, a entrada é gravada mesmo sem poder bloquear");
});

test("o matcher gravado é o do EVENTO, não o do motor", () => {
  const repo = diretorioTemporario();
  const motor = engineDescriptor("claude-code");
  writeHook("claude-code", repo, { command: "node mgr" });
  const gravado = JSON.parse(readFileSync(path.join(repo, ...motor.hookFile), "utf8"));
  assert.equal(gravado.hooks.SessionStart[0].matcher, "startup");
  assert.equal(gravado.hooks.PreCompact[0].matcher, "manual|auto",
    "`startup` num PreCompact é aceito e ignorado: o hook nunca dispararia, e nada avisaria");
});

test("entrada alheia no evento novo é preservada, e o uninstall tira só a do MGR", () => {
  const repo = diretorioTemporario();
  const motor = engineDescriptor("claude-code");
  const arquivo = path.join(repo, ...motor.hookFile);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const alheia = { matcher: "manual", hooks: [{ type: "command", command: "script-do-usuario.sh" }] };
  writeFileSync(arquivo, JSON.stringify({ hooks: { PreCompact: [alheia] } }), "utf8");

  writeHook("claude-code", repo, { command: "node mgr" });
  const comOsDois = JSON.parse(readFileSync(arquivo, "utf8"));
  assert.equal(comOsDois.hooks.PreCompact.length, 2);
  assert.deepEqual(comOsDois.hooks.PreCompact[0], alheia, "o arquivo é do usuário, não do MGR");

  removeHook("claude-code", repo);
  const depois = JSON.parse(readFileSync(arquivo, "utf8"));
  assert.deepEqual(depois.hooks.PreCompact, [alheia]);
  assert.equal(Object.hasOwn(depois.hooks, "SessionStart"), false, "contêiner vazio some");
});

test("o uninstall apaga o arquivo que era só do MGR, nos dois eventos", () => {
  const repo = diretorioTemporario();
  for (const id of engineIds()) {
    writeHook(id, repo, { command: "node mgr" });
    removeHook(id, repo);
    assert.equal(existsSync(path.join(repo, ...engineDescriptor(id).hookFile)), false,
      `${id}: o arquivo foi criado pelo MGR e não sobrou nada dele`);
  }
});

// A doc do copilot classifica o `preCompact` como "No — notification only" e diz que a saída dele
// não é processada: ali o aviso NÃO TEM CANAL. Imprimir de qualquer jeito faria o método parecer
// avisar; a degradação é declarada onde o usuário pode ler, no CHANGELOG e nos READMEs.
test("mgr precompact: motor sem canal de aviso não imprime no vazio", () => {
  const repo = repoComFeature();
  const { stdout, stderr, status } = rodarPrecompact(repo, "copilot", '{"trigger":"manual"}');
  assert.equal(status, 0);
  assert.equal(stdout, "", "saída num canal que a plataforma descarta é aviso que ninguém recebe");
  assert.match(stderr, /gravando o hand-off em/, "o hand-off é gravado igual, e o log registra");
  assert.match(readFileSync(path.join(repo, "specs", "alfa", ".handoff.md"), "utf8"), /Feature:/);
});

test("mgr precompact: sem feature em andamento, não bloqueia nem carimba", () => {
  const repo = diretorioTemporario();
  const { status } = rodarPrecompact(repo, "claude-code", '{"trigger":"manual"}');
  assert.equal(status, 0, "bloquear sem ter gravado nada só obstrui: não há estado para preservar");
  assert.equal(existsSync(path.join(repo, ".mgr-core")), false,
    "a invariante 2 diz que sem feature em andamento NENHUM arquivo é escrito");
});

test("mgr precompact: manifesto corrompido não derruba o hook", () => {
  const repo = repoComFeature();
  mkdirSync(path.join(repo, ".mgr-core"), { recursive: true });
  writeFileSync(path.join(repo, ".mgr-core", "manifest.json"), "{ isto nao e json", "utf8");
  const { status, stderr } = rodarPrecompact(repo, "claude-code", '{"trigger":"auto"}');
  assert.equal(status, 0);
  assert.ok(!(stderr || "").includes("SyntaxError"),
    "stack trace no stderr de um hook é o ruído no contexto do agente que a DT-8 quer impedir");
});

test("o uninstall tira os DOIS eventos, e não deixa resto", () => {
  const repo = diretorioTemporario();
  const bin = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
  execFileSync("node", [bin, "install", repo, "--engine", "both", "--scope", "project",
    "--project-id", "x", "--arch", "hexagonal", "-y"], { encoding: "utf8" });
  for (const id of engineIds()) {
    const gravado = JSON.parse(readFileSync(path.join(repo, ...engineDescriptor(id).hookFile), "utf8"));
    assert.deepEqual(Object.keys(gravado.hooks).sort(), writtenEvents(id).sort(),
      `${id}: o install grava exatamente os eventos que o núcleo declara`);
  }
  execFileSync("node", [bin, "uninstall", repo, "--scope", "project", "-y"], { encoding: "utf8" });
  for (const id of engineIds()) {
    assert.equal(existsSync(path.join(repo, ...engineDescriptor(id).hookFile)), false,
      `${id}: o arquivo era só do MGR e não sobrou nada dele`);
  }
});

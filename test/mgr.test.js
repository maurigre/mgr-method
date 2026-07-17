import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import * as bundle from "../src/bundle.js";
import { buildRuntime, buildSkill, resolveUserLanguage } from "../src/builder.js";
import * as installer from "../src/installer.js";
import * as catalog from "../src/catalog.js";
import { collectInstallAnswers, detectUserLanguage, CANCELLED } from "../src/prompts.js";
import { validateAll, validateSkill, checkSkill } from "../src/validator.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-"));
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
  const repo = tmp();
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
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code", "copilot"], "project", repo, { architecture: "onion" }));
  for (const dir of [".claude/skills", ".github/skills"]) {
    assert.ok(existsSync(path.join(repo, dir, "spec-init", "SKILL.md")), dir);
    assert.ok(existsSync(path.join(repo, dir, "arch-onion", "SKILL.md")), dir);
  }
  const man = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.deepEqual(man.engines, ["claude-code", "copilot"]);
});

test("migra instalação antiga (runtime-launcher) para o novo layout", () => {
  const repo = tmp();
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
  const repo = tmp();
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
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal", projectId: "nestapp-workspace" }));
  const man = JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  assert.equal(man.projectId, "nestapp-workspace");
  assert.match(readFileSync(path.join(repo, ".mgr-core", ".env"), "utf8"), /MGR_PROJECT_ID=nestapp-workspace/);
});

test("update re-sincroniza preservando o conjunto instalado", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean", language: "java" }));
  const res = installer.update("project", repo);
  assert.ok(res.skills.includes("arch-clean") && res.skills.includes("junit-clean"));
  assert.ok(!res.skills.includes("arch-hexagonal"));
});

test("userLanguage atravessa o plano até o manifesto; update preserva o valor existente", () => {
  const repo = tmp();
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "clean", userLanguage: "en" }));
  const manPath = path.join(repo, ".mgr-core", "manifest.json");
  assert.equal(JSON.parse(readFileSync(manPath, "utf8")).userLanguage, "en");
  installer.update("project", repo);
  assert.equal(JSON.parse(readFileSync(manPath, "utf8")).userLanguage, "en");
});

test("update backfilla userLanguage pt-BR em manifesto da era anterior", () => {
  const repo = tmp();
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
  const repo = tmp();
  installer.execute(installer.planInstall(["copilot"], "project", repo, { architecture: "hexagonal" }));
  assert.ok(existsSync(path.join(repo, ".github/skills/code-analyzer/SKILL.md")));
  assert.ok(!existsSync(path.join(repo, ".claude")));
});

test("instalação com --skills-dir (custom) resolve o token do shared", () => {
  const repo = tmp();
  const custom = path.join(repo, "meus-skills");
  const plan = installer.planInstall([], "project", repo, { skillsDir: custom, names: ["spec-init", "arch-clean"] });
  assert.deepEqual(plan.engines, ["custom"]);
  installer.execute(plan);
  assert.ok(existsSync(path.join(custom, "spec-init", "SKILL.md")));
  assert.ok(existsSync(path.join(custom, "_shared", "arch", "cross-cutting-rules.md")));
  assert.ok(!readFileSync(path.join(custom, "arch-clean", "SKILL.md"), "utf8").includes("{{MGR_ARCH_RULES}}"));
});

test("detect, installs e detectPrior enxergam a instalação", () => {
  const repo = tmp();
  assert.equal(installer.detectPrior("project", repo), null);
  assert.deepEqual(installer.installs("project", repo), []);
  installer.execute(installer.planInstall(["claude-code"], "project", repo, { architecture: "hexagonal" }));

  assert.ok(installer.detect(repo).some((f) => f.path.endsWith(path.join(".claude", "skills")) && f.count >= 1));
  const prior = installer.detectPrior("project", repo);
  assert.ok(prior && prior.model === "self-contained");
  assert.equal(installer.installs("project", repo).length, 1);
});

test("update e uninstall exigem instalação existente", () => {
  const repo = tmp();
  assert.throws(() => installer.update("project", repo), /rode `mgr install`/);
  assert.throws(() => installer.uninstall("project", repo), /nada a desinstalar/);
});

test("resolveUserLanguage troca o token pelo idioma ou pelo fallback", () => {
  const linha = `Output language: ${catalog.USER_LANGUAGE_TOKEN} — always.`;
  assert.equal(resolveUserLanguage(linha, "pt-BR"), "Output language: pt-BR — always.");
  assert.equal(resolveUserLanguage(linha, null), `Output language: ${catalog.USER_LANGUAGE_FALLBACK} — always.`);
  assert.equal(resolveUserLanguage("sem token", "en"), "sem token");
});

test("install limpa a fonte co-locada legada (nomes pt) e não deixa token de idioma", () => {
  const repo = tmp();
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
  const repo = tmp();
  const ask = {
    multiselect: async () => ["claude-code"],
    select: async ({ message }) =>
      /Arquitetura/.test(message) ? "clean" : /Linguagem/.test(message) ? "java" : /Idioma/.test(message) ? "pt-BR" : "project",
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
  const repo = tmp();
  const ask = {
    multiselect: async () => ["copilot"],
    select: async ({ message }) =>
      /Arquitetura/.test(message) ? "onion" : /Linguagem/.test(message) ? "outra" : /Idioma/.test(message) ? "outro" : "project",
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
  const repo = tmp();
  const CANCEL = Symbol("cancel");
  const cancelando = (onde) => ({
    multiselect: async () => (onde === "engines" ? CANCEL : ["claude-code"]),
    select: async ({ message }) => {
      if (onde === "scope" && /Escopo/.test(message)) return CANCEL;
      if (onde === "arch" && /Arquitetura/.test(message)) return CANCEL;
      if (onde === "lang" && /Linguagem/.test(message)) return CANCEL;
      if (onde === "userlang" && /Idioma/.test(message)) return CANCEL;
      if (/Idioma/.test(message)) return "en";
      return /Arquitetura/.test(message) ? "hexagonal" : /Linguagem/.test(message) ? "java" : "project";
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
  const repo = tmp();
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
  const run = (args) => execFileSync("node", [bin, ...args], { encoding: "utf8" });

  assert.match(run(["version"]), /mgr-method \d+\.\d+\.\d+/);
  assert.ok(run(["list"]).includes("spec-init"));
  assert.ok(run(["validate"]).includes("spec-init"));
  assert.match(run(["help"]), /Uso: mgr/);

  const repo = tmp();
  const flags = ["--engine", "claude-code", "--arch", "hexagonal", "--project-id", "x", "-y"];

  run(["install", ...flags, "--dry-run", repo]);
  assert.ok(!existsSync(path.join(repo, ".claude")), "dry-run não escreve");

  run(["install", ...flags, repo]);
  assert.match(run(["status", repo]), /self-contained/);
  assert.match(run(["update", repo]), /Re-sincronizado/);
  assert.match(run(["uninstall", "-y", repo]), /Desinstalado/);

  const out = path.join(tmp(), "rt");
  run(["build", "--out", out]);
  assert.ok(existsSync(path.join(out, "skills")));

  assert.throws(() => run(["comando-inexistente"]), /Command failed/);
  assert.throws(() => run(["install", "--flag-invalida"]), /Command failed/);
});

test("CLI: install migra instalação antiga sem crash (smoke)", () => {
  const repo = tmp();
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
  assert.throws(() => installer.planInstall(["motor-x"], "project", tmp(), { architecture: "hexagonal" }), /motor inválido/);
});

test("buildRuntime gera skills + shared num diretório", () => {
  const dir = path.join(tmp(), "rt");
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
  assert.throws(() => buildSkill("nao-existe", path.join(tmp(), "skills")), /skill inexistente/);
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

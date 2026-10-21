import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutPorMotor } from "./fixtures/layout-por-motor.js";
import { tempDir } from "../scripts/lib/tmp.mjs";

const MGR = fileURLToPath(new URL("../bin/mgr.js", import.meta.url));
const EXPORT_PLUGIN = fileURLToPath(new URL("../scripts/export-plugin.mjs", import.meta.url));
const CORE_FILES = [
  "src/installer.js",
  "src/builder.js",
  "src/hooks.js",
  "src/doctor.js",
  "src/manifest.js",
  "src/catalog.js",
  "bin/mgr.js",
];
const MODEL = "self-contained-layered-config";
const RUNTIME_REL = ".mgr-core/runtime/bin/mgr-runtime.js";
const MARKER = "mgr-session-hook";
const CLAUDE_HOOK = ".claude/settings.local.json";
const COPILOT_HOOK = ".github/copilot/settings.local.json";
const CLAUDE_SKILLS = ".claude/skills";
const COPILOT_SKILLS = ".github/skills";
const FOREIGN_CLAUDE = { matcher: "alheio", hooks: [{ type: "command", command: "echo alheio" }] };
const FOREIGN_COPILOT = { type: "command", bash: "echo alheio" };

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function mgr(args, cwd) {
  return spawnSync(process.execPath, [MGR, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, LC_ALL: "C" },
    ...(cwd ? { cwd } : {}),
  });
}

function git(args, cwd) {
  return spawnSync("git", args, { encoding: "utf8", cwd, env: { ...process.env, LC_ALL: "C" } });
}

function novoRepo() {
  return tempDir("mgr-oraculo-core-");
}

function plantarHooksAlheios(tmp) {
  mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  writeFileSync(path.join(tmp, CLAUDE_HOOK), JSON.stringify({ hooks: { SessionStart: [FOREIGN_CLAUDE] } }, null, 2));
  mkdirSync(path.join(tmp, ".github/copilot"), { recursive: true });
  writeFileSync(
    path.join(tmp, COPILOT_HOOK),
    JSON.stringify({ version: 1, hooks: { sessionStart: [FOREIGN_COPILOT] } }, null, 2),
  );
}

function instalar(tmp, engines) {
  return mgr(["install", "--engine", engines, "--user-language", "en", "-y", tmp]);
}

function desinstalar(tmp) {
  return mgr(["uninstall", "-y", tmp]);
}

function arquivosDe(dir) {
  const saida = [];
  if (!existsSync(dir)) return saida;
  for (const nome of readdirSync(dir)) {
    const completo = path.join(dir, nome);
    if (statSync(completo).isDirectory()) saida.push(...arquivosDe(completo));
    else saida.push(completo);
  }
  return saida;
}

function snapshotDe(dir) {
  const mapa = {};
  for (const arq of arquivosDe(dir)) {
    mapa[path.relative(dir, arq)] = sha256(readFileSync(arq));
  }
  return mapa;
}

function skillsQueChamamRuntime(tmp, skillsRel) {
  return arquivosDe(path.join(tmp, skillsRel))
    .filter((arq) => arq.endsWith("SKILL.md") && !arq.includes(`${path.sep}_shared${path.sep}`))
    .filter((arq) => readFileSync(arq, "utf8").includes("mgr-runtime.js"));
}

function comandosDoMgr(arquivo) {
  const json = JSON.parse(readFileSync(arquivo, "utf8"));
  const saida = [];
  for (const [event, itens] of Object.entries(json.hooks || {})) {
    for (const item of itens) {
      if (Array.isArray(item.hooks)) {
        for (const h of item.hooks) {
          if (h.command?.includes(MARKER)) {
            saida.push({ event, matcher: item.matcher, timeout: h.timeout, command: h.command });
          }
        }
      } else if (item.bash?.includes(MARKER)) {
        saida.push({ event, matcher: item.matcher, timeout: item.timeout, command: item.bash });
      }
    }
  }
  return saida;
}

function sessionStartCopilot(tmp) {
  const [entrada] = comandosDoMgr(path.join(tmp, COPILOT_HOOK)).filter((c) => c.event === "sessionStart");
  return entrada;
}

test("should point the method skills and both hook files to the single runtime copy", () => {
  const tmp = novoRepo();
  try {
    plantarHooksAlheios(tmp);
    const install = instalar(tmp, "claude-code,copilot");
    assert.equal(install.status, 0, install.stderr);

    for (const skillsRel of [CLAUDE_SKILLS, COPILOT_SKILLS]) {
      const skills = skillsQueChamamRuntime(tmp, skillsRel);
      assert.ok(skills.length >= 5, `${skillsRel}: ${skills.length} skills chamam o runtime`);
      for (const arq of skills) {
        const texto = readFileSync(arq, "utf8");
        assert.ok(texto.includes(RUNTIME_REL), arq);
        assert.ok(!texto.includes("_shared/mgr"), arq);
      }
    }

    const claude = comandosDoMgr(path.join(tmp, CLAUDE_HOOK));
    const copilot = comandosDoMgr(path.join(tmp, COPILOT_HOOK));
    for (const c of [...claude, ...copilot]) {
      const caminho = /"([^"]+)"/.exec(c.command);
      assert.ok(caminho, c.command);
      assert.equal(caminho[1], path.join(tmp, RUNTIME_REL));
      assert.ok(existsSync(caminho[1]), caminho[1]);
    }

    const claudeSession = claude.find((c) => c.event === "SessionStart");
    assert.equal(claudeSession.matcher, "startup");
    assert.equal(claudeSession.timeout, undefined);
    const claudePre = claude.find((c) => c.matcher === "manual|auto");
    assert.equal(claudePre.timeout, 15);

    const copilotSession = copilot.find((c) => c.event === "sessionStart");
    assert.equal(copilotSession.matcher, undefined);
    assert.equal(copilotSession.timeout, 15);
    const copilotPre = copilot.find((c) => c.matcher === "manual|auto");
    assert.equal(copilotPre.timeout, 15);

    const claudeJson = JSON.parse(readFileSync(path.join(tmp, CLAUDE_HOOK), "utf8"));
    assert.deepEqual(claudeJson.hooks.SessionStart.find((e) => e.matcher === "alheio"), FOREIGN_CLAUDE);
    const copilotJson = JSON.parse(readFileSync(path.join(tmp, COPILOT_HOOK), "utf8"));
    assert.deepEqual(copilotJson.hooks.sessionStart.find((e) => e.bash === "echo alheio"), FOREIGN_COPILOT);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("should keep version and agents working through the runtime after the claude folder is gone", () => {
  const tmp = novoRepo();
  try {
    const install = instalar(tmp, "claude-code,copilot");
    assert.equal(install.status, 0, install.stderr);
    rmSync(path.join(tmp, ".claude"), { recursive: true, force: true });
    const runtime = path.join(tmp, RUNTIME_REL);

    const version = spawnSync(process.execPath, [runtime, "version"], { encoding: "utf8", input: "", cwd: tmp, env: { ...process.env, LC_ALL: "C" } });
    assert.equal(version.status, 0, version.stderr);

    const agents = spawnSync(process.execPath, [runtime, "agents", "--json"], { encoding: "utf8", input: "", cwd: tmp, env: { ...process.env, LC_ALL: "C" } });
    assert.equal(agents.status, 0, agents.stderr);

    const hook = sessionStartCopilot(tmp);
    assert.ok(hook, "entrada sessionStart do MGR no hook do copilot");
    const sessao = spawnSync("sh", ["-c", hook.command], { encoding: "utf8", input: "", cwd: tmp, env: { ...process.env, LC_ALL: "C" } });
    assert.equal(sessao.status, 0, sessao.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("should remove the legacy runtime from claude and keep the copilot one byte for byte", async () => {
  const tmp = novoRepo();
  try {
    const install = instalar(tmp, "claude-code,copilot");
    assert.equal(install.status, 0, install.stderr);
    await layoutPorMotor(tmp, { model: MODEL });

    const copilotLegacy = path.join(tmp, COPILOT_SKILLS, "_shared/mgr");
    const antesSkills = snapshotDe(copilotLegacy);
    const antesHook = readFileSync(path.join(tmp, COPILOT_HOOK));

    const res = instalar(tmp, "claude-code");
    assert.equal(res.status, 0, res.stderr);

    assert.equal(existsSync(path.join(tmp, CLAUDE_SKILLS, "_shared/mgr")), false);
    assert.deepEqual(snapshotDe(copilotLegacy), antesSkills);
    assert.deepEqual(readFileSync(path.join(tmp, COPILOT_HOOK)), antesHook);
    assert.ok(res.stdout.includes("old MGR runtime kept"), res.stdout);
    assert.ok(res.stdout.includes(".github/skills/_shared/mgr"), res.stdout);

    const hook = sessionStartCopilot(tmp);
    assert.ok(hook, "entrada sessionStart do copilot");
    const sessao = spawnSync("sh", ["-c", hook.command], { encoding: "utf8", input: "", cwd: tmp, env: { ...process.env, LC_ALL: "C" } });
    assert.equal(sessao.status, 0, sessao.stderr);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("should leave no mgr-core, no legacy runtime and no mgr hook after uninstall, keeping foreign hooks", () => {
  const tmp = novoRepo();
  try {
    plantarHooksAlheios(tmp);
    const install = instalar(tmp, "claude-code,copilot");
    assert.equal(install.status, 0, install.stderr);
    const res = desinstalar(tmp);
    assert.equal(res.status, 0, res.stderr);

    assert.equal(existsSync(path.join(tmp, ".mgr-core")), false);
    assert.equal(existsSync(path.join(tmp, CLAUDE_SKILLS, "_shared/mgr")), false);
    assert.equal(existsSync(path.join(tmp, COPILOT_SKILLS, "_shared/mgr")), false);

    const claudeTexto = readFileSync(path.join(tmp, CLAUDE_HOOK), "utf8");
    const copilotTexto = readFileSync(path.join(tmp, COPILOT_HOOK), "utf8");
    assert.equal(claudeTexto.includes(MARKER), false);
    assert.equal(copilotTexto.includes(MARKER), false);
    assert.ok(JSON.parse(claudeTexto).hooks.SessionStart.some((e) => e.matcher === "alheio"));
    assert.ok(JSON.parse(copilotTexto).hooks.sessionStart.some((e) => e.bash === "echo alheio"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("should keep the git index and rev-list unchanged across install, update and uninstall", () => {
  const tmp = novoRepo();
  try {
    assert.equal(git(["init", "-q"], tmp).status, 0);
    git(["config", "user.email", "t@example.invalid"], tmp);
    git(["config", "user.name", "t"], tmp);
    assert.equal(git(["commit", "--allow-empty", "-m", "base"], tmp).status, 0);

    const estado = () => ({
      index: sha256(readFileSync(path.join(tmp, ".git/index"))),
      revs: git(["rev-list", "--all"], tmp).stdout,
    });
    const antes = estado();

    const install = instalar(tmp, "claude-code,copilot");
    assert.equal(install.status, 0, install.stderr);
    assert.deepEqual(estado(), antes);

    const update = mgr(["update", "-y", tmp]);
    assert.equal(update.status, 0, update.stderr);
    assert.deepEqual(estado(), antes);

    const uninstall = desinstalar(tmp);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.deepEqual(estado(), antes);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("should not mention child_process in the core CLI and installer sources", () => {
  for (const rel of CORE_FILES) {
    const texto = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
    assert.equal(texto.includes("child_process"), false, rel);
  }
});

test("should export a junit-clean plugin with no mgr-runtime or MGR_RUNTIME reference", () => {
  const tmp = novoRepo();
  try {
    const res = spawnSync(process.execPath, [EXPORT_PLUGIN, "junit-clean", "diagnosing-bugs", "--out", tmp], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, LC_ALL: "C" },
    });
    assert.equal(res.status, 0, res.stderr);
    const exportados = arquivosDe(tmp);
    assert.ok(exportados.length > 0, "nenhum arquivo exportado");
    for (const arq of exportados) {
      const texto = readFileSync(arq, "utf8");
      assert.equal(texto.includes("mgr-runtime"), false, arq);
      assert.equal(texto.includes("MGR_RUNTIME"), false, arq);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

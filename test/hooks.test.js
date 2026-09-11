import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hookCommand, hookFilePath, HOOK_FILES, HOOK_MARKER, removeHook, writeHook } from "../src/hooks.js";

const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-hooks-"));
const MGR = "/usr/local/bin/mgr";

const ler = (file) => JSON.parse(readFileSync(file, "utf8"));

const escreverSettings = (repo, engine, conteudo) => {
  const file = hookFilePath(engine, repo);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(conteudo, null, 2), "utf8");
  return file;
};

test("cada motor recebe o formato nativo dele, no arquivo project-local", () => {
  const repo = diretorioTemporario();

  const claude = ler(writeHook("claude-code", repo, { command: MGR }));
  assert.equal(hookFilePath("claude-code", repo), path.join(repo, ".claude", "settings.local.json"));
  assert.equal(claude.hooks.SessionStart[0].matcher, "startup");
  assert.equal(claude.hooks.SessionStart[0].hooks[0].command, hookCommand(MGR, "claude-code"));
  assert.equal(claude.version, undefined, "claude-code não usa envelope de versão");

  const copilot = ler(writeHook("copilot", repo, { command: MGR }));
  assert.equal(hookFilePath("copilot", repo), path.join(repo, ".github", "copilot", "settings.local.json"));
  assert.equal(copilot.version, 1, "copilot exige o envelope");
  assert.equal(copilot.hooks.sessionStart[0].bash, hookCommand(MGR, "copilot"));
  assert.equal(copilot.hooks.sessionStart[0].type, "command");
});

test("o comando gravado carrega o marcador de posse e o motor", () => {
  for (const engine of Object.keys(HOOK_FILES)) {
    const command = hookCommand(MGR, engine);
    assert.ok(command.includes(HOOK_MARKER), "sem marcador não há como provar posse");
    assert.ok(command.includes(`--hook ${engine}`));
  }
});

test("instalar duas vezes não duplica a entrada do MGR", () => {
  const repo = diretorioTemporario();
  writeHook("claude-code", repo, { command: MGR });
  const file = writeHook("claude-code", repo, { command: "/outro/caminho/mgr" });

  const entradas = ler(file).hooks.SessionStart;
  assert.equal(entradas.length, 1, "substitui, nunca acumula");
  assert.ok(entradas[0].hooks[0].command.startsWith("/outro/caminho/mgr"), "o comando é atualizado");
});

test("conteúdo alheio do usuário é preservado ao instalar e ao remover", () => {
  const repo = diretorioTemporario();
  const original = {
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "meu-script.sh" }] }],
      PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "formatar.sh" }] }],
    },
  };
  const file = escreverSettings(repo, "claude-code", original);

  writeHook("claude-code", repo, { command: MGR });
  const comMgr = ler(file);
  assert.deepEqual(comMgr.permissions, original.permissions, "chave alheia intacta");
  assert.deepEqual(comMgr.hooks.PostToolUse, original.hooks.PostToolUse, "outro evento intacto");
  assert.equal(comMgr.hooks.SessionStart.length, 2, "o hook do usuário continua ao lado");
  assert.equal(comMgr.hooks.SessionStart[0].hooks[0].command, "meu-script.sh", "e vem primeiro");

  removeHook("claude-code", repo);
  assert.deepEqual(ler(file), original, "remover devolve o arquivo exatamente ao que era");
});

test("arquivo criado pelo MGR é apagado ao remover; sem arquivo, remover é no-op", () => {
  const repo = diretorioTemporario();
  const file = writeHook("copilot", repo, { command: MGR });
  assert.ok(existsSync(file));

  removeHook("copilot", repo);
  assert.ok(!existsSync(file), "não sobra arquivo órfão com só o envelope");
  assert.equal(removeHook("copilot", repo), null, "remover de novo não quebra");
});

test("remover preserva o arquivo quando o usuário tem outras chaves", () => {
  const repo = diretorioTemporario();
  escreverSettings(repo, "copilot", { version: 1, model: "gpt-5" });
  const file = writeHook("copilot", repo, { command: MGR });

  removeHook("copilot", repo);
  assert.deepEqual(ler(file), { version: 1, model: "gpt-5" }, "só a entrada do MGR sai");
});

test("motor desconhecido é erro explícito", () => {
  const repo = diretorioTemporario();
  assert.throws(() => writeHook("cursor", repo, { command: MGR }), /invalid engine for session hook/);
  assert.throws(() => hookFilePath("cursor", repo), /invalid engine for session hook/);
});

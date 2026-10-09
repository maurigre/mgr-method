import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planOwnedHooks, syncOwnedHooks } from "../src/hooks.js";

const COMANDO = 'node "/projeto/.claude/skills/_shared/mgr/bin/mgr-runtime.js"';

function comArquivo(hooks, fn) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-hooks-sync-"));
  try {
    mkdirSync(path.join(repo, ".claude"), { recursive: true });
    writeFileSync(path.join(repo, ".claude", "settings.local.json"), JSON.stringify({ hooks }, null, 2) + "\n", "utf8");
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

const entrada = (comando) => ({ matcher: "startup", hooks: [{ type: "command", command: comando, timeout: 5 }] });

test("should report no rewritten event when the MGR command is already the current one", () => {
  const atual = `${COMANDO} detect --hook claude-code # mgr-session-hook`;
  const compactacao = { matcher: "manual|auto", hooks: [{ type: "command", command: `${COMANDO} precompact --hook claude-code # mgr-session-hook`, timeout: 15 }] };
  comArquivo({ SessionStart: [entrada(atual)], PreCompact: [compactacao] }, (repo) => {
    const result = syncOwnedHooks("claude-code", repo, { command: COMANDO });
    assert.equal(result.outcome, "synced");
    assert.deepEqual(result.rewritten, [], "instalação já convergida não tem linha de diferença (X-23)");
    assert.deepEqual(result.added, []);
  });
});

test("should leave the file byte for byte untouched when nothing changes, whatever its formatting", () => {
  const atual = `${COMANDO} detect --hook claude-code # mgr-session-hook`;
  const compactacao = { matcher: "manual|auto", hooks: [{ type: "command", command: `${COMANDO} precompact --hook claude-code # mgr-session-hook`, timeout: 15 }] };
  comArquivo({ SessionStart: [entrada(atual)], PreCompact: [compactacao] }, (repo) => {
    const file = path.join(repo, ".claude", "settings.local.json");
    writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [entrada(atual)], PreCompact: [compactacao] } }), "utf8");
    const before = readFileSync(file);
    assert.deepEqual(planOwnedHooks("claude-code", repo, { command: COMANDO }), { added: [], rewrite: [] });
    const result = syncOwnedHooks("claude-code", repo, { command: COMANDO });
    assert.deepEqual(result, { outcome: "synced", file, added: [], rewritten: [] });
    assert.ok(readFileSync(file).equals(before), "o arquivo não pode ser regravado quando nada muda (X-25)");
  });
});

test("should plan the rewrite of the events whose command will change, without writing", () => {
  comArquivo({ SessionStart: [entrada('node "/old/mgr.js" detect --hook claude-code # mgr-session-hook')] }, (repo) => {
    const file = path.join(repo, ".claude", "settings.local.json");
    const before = readFileSync(file);
    assert.deepEqual(planOwnedHooks("claude-code", repo, { command: COMANDO }), { added: ["PreCompact"], rewrite: ["SessionStart"] });
    assert.deepEqual(planOwnedHooks("claude-code", repo), { added: ["PreCompact"], rewrite: [] }, "sem command não há o que reescrever");
    assert.ok(readFileSync(file).equals(before), "o cálculo não escreve");
  });
});

test("should report the rewritten event when the MGR command changed", () => {
  comArquivo({ SessionStart: [entrada('node "/old/mgr.js" detect --hook claude-code # mgr-session-hook')] }, (repo) => {
    const result = syncOwnedHooks("claude-code", repo, { command: COMANDO });
    assert.deepEqual(result.rewritten, ["SessionStart"]);
  });
});

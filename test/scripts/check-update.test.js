import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { describeItem, judgeUpdate, main, parseArgs, STEPS } from "../../scripts/check-update.mjs";

function fatosVerdes(sobrescritos = {}) {
  return {
    registry: { ok: true, detail: "" },
    steps: STEPS.map((step) => ({ step, exit: 0 })),
    userBefore: { "README.md": "h1", "src/app.js": "h2" },
    after: { "README.md": "h1", "src/app.js": "h2" },
    emptyDirsAfter: [],
    ...sobrescritos,
  };
}

test("should return ok with no failures and no warnings when every fact is green", () => {
  const resultado = judgeUpdate(fatosVerdes());
  assert.deepStrictEqual(resultado, { ok: true, failures: [], warnings: [] });
});

test("should fail with a single registry failure and a network message when the registry is unreachable", () => {
  const resultado = judgeUpdate(fatosVerdes({ registry: { ok: false, reason: "unreachable", detail: "ENOTFOUND registry.npmjs.org" } }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "registry", detail: "ENOTFOUND registry.npmjs.org" }]);
  assert.ok(describeItem(resultado.failures[0]).includes("registro npm inacessivel"));
});

test("should fail as not-published and not blame the network when the origin version is not in the registry", () => {
  const resultado = judgeUpdate(fatosVerdes({ registry: { ok: false, reason: "not-published", detail: "E404" } }));
  assert.deepStrictEqual(resultado.failures, [{ kind: "not-published", detail: "E404" }]);
  assert.ok(describeItem(resultado.failures[0]).includes("nao publicada"));
  assert.ok(!describeItem(resultado.failures[0]).includes("inacessivel"));
});

test("should fail with setup and run no step judgement when the test project could not be prepared", () => {
  const resultado = judgeUpdate(fatosVerdes({ setup: { ok: false, detail: "git init saiu 127" } }));
  assert.deepStrictEqual(resultado, { ok: false, failures: [{ kind: "setup", detail: "git init saiu 127" }], warnings: [] });
});

test("should fail naming the step when any single step exits 1", () => {
  for (const step of STEPS) {
    const steps = STEPS.map((nome) => ({ step: nome, exit: nome === step ? 1 : 0 }));
    const resultado = judgeUpdate(fatosVerdes({ steps }));
    assert.equal(resultado.ok, false, step);
    assert.deepStrictEqual(resultado.failures, [{ kind: "step", step, exit: 1 }], step);
  }
});

test("should fail with step-missing naming uninstall when the uninstall step did not run", () => {
  const steps = STEPS.filter((step) => step !== "uninstall").map((step) => ({ step, exit: 0 }));
  const resultado = judgeUpdate(fatosVerdes({ steps }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "step-missing", step: "uninstall" }]);
});

test("should fail when a green step does not compensate a red doctor step", () => {
  const steps = [
    { step: "install", exit: 0 },
    { step: "update", exit: 0 },
    { step: "doctor", exit: 2 },
    { step: "uninstall", exit: 0 },
  ];
  const resultado = judgeUpdate(fatosVerdes({ steps }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "step", step: "doctor", exit: 2 }]);
});

test("should fail with user-missing and the path when a user file is gone after uninstall", () => {
  const resultado = judgeUpdate(fatosVerdes({ after: { "src/app.js": "h2" } }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "user-missing", path: "README.md" }]);
});

test("should fail with user-changed and the path when a user file hash differs after uninstall", () => {
  const resultado = judgeUpdate(fatosVerdes({ after: { "README.md": "h1-alterado", "src/app.js": "h2" } }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "user-changed", path: "README.md" }]);
});

test("should fail with mgr-leftover and the path when a file not in the user snapshot survives uninstall", () => {
  const after = { "README.md": "h1", "src/app.js": "h2", ".mgr-core/manifest.json": "h3" };
  const resultado = judgeUpdate(fatosVerdes({ after }));
  assert.equal(resultado.ok, false);
  assert.deepStrictEqual(resultado.failures, [{ kind: "mgr-leftover", path: ".mgr-core/manifest.json" }]);
});

test("should stay ok and warn with empty-dir when an empty folder survives and nothing else fails", () => {
  const resultado = judgeUpdate(fatosVerdes({ emptyDirsAfter: [".claude"] }));
  assert.equal(resultado.ok, true);
  assert.deepStrictEqual(resultado.warnings, [{ kind: "empty-dir", path: ".claude" }]);
  assert.ok(describeItem(resultado.warnings[0]).includes("nao reprova"));
});

test("should default to version 0.5.0 and no tarball when no argument is given", () => {
  assert.deepStrictEqual(parseArgs([]), { from: ["0.5.0"], tarball: null });
});

test("should keep every --from in order when the flag is repeated", () => {
  assert.deepStrictEqual(parseArgs(["--from", "0.5.0", "--from", "0.7.0"]), {
    from: ["0.5.0", "0.7.0"],
    tarball: null,
  });
});

test("should return an error for an unknown flag, a flag without value and a shell-injected version", () => {
  assert.ok(parseArgs(["--bogus", "x"]).error);
  assert.ok(parseArgs(["--from"]).error);
  assert.ok(parseArgs(["--from", "latest; rm"]).error);
});

test("should reject a flag whose value is another flag and accept the same flag with a real value", () => {
  assert.ok(parseArgs(["--tarball", "--from"]).error);
  assert.equal(parseArgs(["--tarball", "x.tgz"]).error, undefined);
});

test("should accept a pre-release origin and reject versions cut at the boundary", () => {
  assert.deepStrictEqual(parseArgs(["--from", "0.7.0-rc.1"]).from, ["0.7.0-rc.1"]);
  assert.ok(parseArgs(["--from", "0.5"]).error);
  assert.ok(parseArgs(["--from", "0.5.0-"]).error);
});

test("should exit 2 from main on an invalid argument before running anything", () => {
  assert.equal(main(["--nada"]), 2);
});

test("should resolve the tarball to an absolute path ending with the given name", () => {
  const { tarball } = parseArgs(["--tarball", "x.tgz"]);
  assert.ok(path.isAbsolute(tarball));
  assert.ok(tarball.endsWith("x.tgz"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SPECS_DIR } from "../../src/sdd/artifacts.js";
import {
  applyArchive,
  decide,
  localDate,
  parseDate,
  planArchive,
} from "../../src/sdd/archive.js";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const DESTINO = path.join(SPECS_DIR, "archive", "2026-11-24-x");
const NOW = new Date(2026, 10, 24, 23, 30);

const fatos = (sobrescritos = {}) => ({
  slug: "x",
  location: { state: "active" },
  date: { ok: true, date: "2026-11-24" },
  plan: { present: true, tasks: [{ id: "P0.1", status: "done" }] },
  completion: { present: true, codes: [] },
  sdd: { ok: true },
  destinationExists: false,
  ...sobrescritos,
});

const repoCom = (arquivos) => {
  const repo = tempDir("mgr-arch-");
  mkdirSync(path.join(repo, "docs", "sdd"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "sdd", "CONSTITUTION.md"), "# Constituicao\n");
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const completo = path.join(repo, caminho);
    mkdirSync(path.dirname(completo), { recursive: true });
    writeFileSync(completo, conteudo);
  }
  return repo;
};

const codigos = (resultado) => resultado.reasons.map(({ code }) => code);

test("should archive when every condition holds, into specs/archive/<date>-<slug>", () => {
  assert.deepEqual(decide(fatos()), { outcome: "archive", slug: "x", destination: DESTINO, sddWarnings: 0 });
});

test("should refuse with no-plan when the plan file is absent", () => {
  const resultado = decide(fatos({ plan: { present: false, tasks: [] } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "no-plan" }] });
});

test("should refuse with no-tasks when the plan declares no task", () => {
  const resultado = decide(fatos({ plan: { present: true, tasks: [] } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "no-tasks" }] });
});

test("should refuse with tasks-not-done listing the ids of the open tasks", () => {
  const tasks = [{ id: "P0.1", status: "done" }, { id: "P0.2", status: "todo" }, { id: "P0.3", status: "doing" }];
  const resultado = decide(fatos({ plan: { present: true, tasks } }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "tasks-not-done", ids: ["P0.2", "P0.3"] }],
  });
});

test("should not count a task whose status is 'concluído' as done", () => {
  const tasks = [{ id: "P0.1", status: "done" }, { id: "P0.2", status: "concluído" }];
  const resultado = decide(fatos({ plan: { present: true, tasks } }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "tasks-not-done", ids: ["P0.2"] }],
  });
});

test("should refuse with no-completion when the completion file is absent", () => {
  const resultado = decide(fatos({ completion: { present: false, codes: [] } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "no-completion" }] });
});

test("should refuse with completion-findings carrying the finding codes and the slug", () => {
  const resultado = decide(fatos({ completion: { present: true, codes: ["DOC-3", "DOC-4"] } }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "completion-findings", codes: ["DOC-3", "DOC-4"], slug: "x" }],
  });
});

test("should refuse with sdd-check-failed carrying the sdd-check reason", () => {
  const resultado = decide(fatos({ sdd: { ok: false, reason: "sdd-ausente" } }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "sdd-check-failed", reason: "sdd-ausente" }],
  });
});

test("should refuse with destination-exists carrying the destination that is taken", () => {
  const resultado = decide(fatos({ destinationExists: true }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "destination-exists", destination: DESTINO }],
  });
});

test("should report the plan, completion and sdd reasons together, in that order", () => {
  const resultado = decide(fatos({
    plan: { present: true, tasks: [{ id: "P0.1", status: "todo" }] },
    completion: { present: false, codes: [] },
    sdd: { ok: false, reason: "sdd-ausente" },
  }));
  assert.deepEqual(codigos(resultado), ["tasks-not-done", "no-completion", "sdd-check-failed"]);
});

test("should refuse with reserved-slug when the slug is the archive folder itself", () => {
  const resultado = decide(fatos({ slug: "archive", location: { state: "reserved" } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "reserved-slug" }] });
});

test("should refuse with not-found when the slug is neither active nor archived", () => {
  const resultado = decide(fatos({ location: { state: "absent" } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "not-found", slug: "x" }] });
});

test("should refuse with already-archived carrying the paths already in the archive", () => {
  const paths = [path.join(SPECS_DIR, "archive", "2026-01-05-x")];
  const resultado = decide(fatos({ location: { state: "archived", paths } }));
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "already-archived", paths }] });
});

test("should refuse with invalid-date carrying the rejected value", () => {
  const resultado = decide(fatos({ date: { ok: false, reason: "invalid-date", value: "2026-02-30" } }));
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "invalid-date", value: "2026-02-30" }],
  });
});

test("should accept a real calendar date that is not after today", () => {
  assert.deepEqual(parseDate("2026-01-15", "2026-11-24"), { ok: true, date: "2026-01-15" });
  assert.deepEqual(parseDate("2026-11-24", "2026-11-24"), { ok: true, date: "2026-11-24" });
});

test("should reject malformed date strings and missing dates as invalid-date", () => {
  for (const valor of ["2026-1-1", "", undefined]) {
    assert.deepEqual(parseDate(valor, "2026-11-24"), { ok: false, reason: "invalid-date" }, `valor: ${valor}`);
  }
});

test("should reject a date that does not exist in the calendar as invalid-date", () => {
  assert.deepEqual(parseDate("2026-02-30", "2026-11-24"), { ok: false, reason: "invalid-date" });
});

test("should reject a date after today as future-date", () => {
  assert.deepEqual(parseDate("2026-11-25", "2026-11-24"), { ok: false, reason: "future-date" });
});

test("should take the local calendar day, not the UTC day, at 23:30", () => {
  assert.equal(localDate(NOW), "2026-11-24");
});

test("should move the feature folder, hidden files included, to the archive", () => {
  const repo = repoCom({ "specs/x/01-brief.md": "b", "specs/x/.handoff.md": "h" });
  const resultado = applyArchive(repo, { slug: "x", destination: DESTINO });
  assert.deepEqual(resultado, { outcome: "moved", from: path.join(SPECS_DIR, "x"), to: DESTINO });
  assert.equal(existsSync(path.join(repo, SPECS_DIR, "x")), false);
  assert.equal(existsSync(path.join(repo, DESTINO, "01-brief.md")), true);
  assert.equal(existsSync(path.join(repo, DESTINO, ".handoff.md")), true);
});

test("should report move-failed with the code and remove the archive folder created by this call", () => {
  const repo = repoCom({ "specs/outra/01-brief.md": "b" });
  const resultado = applyArchive(repo, { slug: "x", destination: DESTINO });
  assert.deepEqual(resultado, {
    outcome: "move-failed",
    from: path.join(SPECS_DIR, "x"),
    to: DESTINO,
    code: "ENOENT",
  });
  assert.equal(existsSync(path.join(repo, SPECS_DIR, "outra", "01-brief.md")), true);
  assert.equal(existsSync(path.join(repo, SPECS_DIR, "archive")), false);
});

test("should keep the archive folder on a failed move when it existed before the call", () => {
  const repo = repoCom({ "specs/outra/01-brief.md": "b", "specs/archive/.keep": "" });
  const resultado = applyArchive(repo, { slug: "x", destination: DESTINO });
  assert.equal(resultado.outcome, "move-failed");
  assert.equal(resultado.code, "ENOENT");
  assert.equal(existsSync(path.join(repo, SPECS_DIR, "archive", ".keep")), true);
});

test("should refuse to overwrite an existing destination with EEXIST and change nothing", () => {
  const repo = repoCom({
    "specs/x/01-brief.md": "b",
    "specs/archive/2026-11-24-x/01-brief.md": "antigo",
  });
  const resultado = applyArchive(repo, { slug: "x", destination: DESTINO });
  assert.deepEqual(resultado, {
    outcome: "move-failed",
    from: path.join(SPECS_DIR, "x"),
    to: DESTINO,
    code: "EEXIST",
  });
  assert.equal(existsSync(path.join(repo, SPECS_DIR, "x", "01-brief.md")), true);
  assert.equal(existsSync(path.join(repo, DESTINO, "01-brief.md")), true);
});

test("should archive a feature with a done plan and a completion declaring no SDD change", () => {
  const repo = repoCom({
    "specs/x/04-plan.md": "### P0.1 — x\n- **status:** done\n",
    "specs/x/06-completion.md": "# Fechamento\n\n## Diff do SDD (local)\n\nNão houve alteração no SDD: motivo.\n",
  });
  const resultado = planArchive(repo, "x", { now: NOW });
  assert.equal(resultado.outcome, "archive");
  assert.equal(resultado.destination, DESTINO);
  assert.ok(resultado.sddWarnings > 0, "o docs/sdd minimo gera avisos do sdd-check, que nao bloqueiam");
});

test("should refuse with no-completion when planArchive reads a feature without a completion file", () => {
  const repo = repoCom({ "specs/x/04-plan.md": "### P0.1 — x\n- **status:** done\n" });
  const resultado = planArchive(repo, "x", { now: NOW });
  assert.deepEqual(codigos(resultado), ["no-completion"]);
});

test("should refuse with invalid-date when the date option is malformed", () => {
  const repo = repoCom({ "specs/x/04-plan.md": "### P0.1 — x\n- **status:** done\n" });
  const resultado = planArchive(repo, "x", { date: "2026-02-30", now: NOW });
  assert.deepEqual(resultado, {
    outcome: "refused",
    reasons: [{ code: "invalid-date", value: "2026-02-30" }],
  });
});

test("should refuse with reserved-slug when planArchive receives the archive slug", () => {
  const repo = repoCom({ "specs/archive/.keep": "" });
  const resultado = planArchive(repo, "archive", { now: NOW });
  assert.deepEqual(resultado, { outcome: "refused", reasons: [{ code: "reserved-slug" }] });
});

test("should carry the number of sdd-check warnings without refusing", () => {
  const resultado = decide(fatos({ sdd: { ok: true, warnings: [{ code: "no-review-rules" }, { code: "missing-canonical" }] } }));
  assert.equal(resultado.outcome, "archive");
  assert.equal(resultado.sddWarnings, 2);
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { SEVERITIES, STRICT_EXEMPT, blocking, create, findingTexts, isError, summarize } from "../../src/sdd/findings.js";
import { InvariantError } from "../../src/core/errors.js";
import { getMessages } from "../../src/core/messages.js";
import { renderText, text } from "../../src/core/ui-text.js";

const valido = {
  code: "PLAN-1", severity: "error", file: "04-plan.md", line: 12, task: "P0.1",
  message: text("artifactPlan1Message", "P9.9"),
  remediation: text("artifactPlan1Remediation", "P9.9", ["P0.1"]),
  example: text("artifactPlan1Example"),
};

test("um achado sem remediação não pode ser criado", () => {
  assert.throws(() => create({ ...valido, remediation: undefined }), InvariantError);
  assert.throws(() => create({ ...valido, remediation: undefined }), /has no `remediation`/);
  assert.throws(() => create({ ...valido, remediation: text("chaveQueNaoExiste") }), /has no `remediation`/);
});

test("um achado sem exemplo não pode ser criado", () => {
  assert.throws(() => create({ ...valido, example: undefined }), /has no `example`/);
  assert.throws(() => create({ ...valido, example: {} }), InvariantError);
});

test("code, message e severidade também são obrigatórios", () => {
  assert.throws(() => create({ ...valido, code: "" }), /has no `code`/);
  assert.throws(() => create({ ...valido, message: undefined }), /has no `message`/);
  assert.throws(() => create({ ...valido, severity: "critical" }), /invalid severity: "critical"/);
});

test("should carry the canonical english text in the frozen finding", () => {
  const finding = create(valido);
  const en = getMessages("en");
  assert.deepEqual(Object.keys(finding), ["code", "severity", "file", "line", "task", "message", "remediation", "example"]);
  assert.equal(finding.message, renderText(en, valido.message));
  assert.equal(finding.remediation, renderText(en, valido.remediation));
  assert.equal(finding.example, renderText(en, valido.example));
});

test("should return the descriptors of a finding made by create", () => {
  const finding = create(valido);
  assert.deepEqual(findingTexts(finding), {
    message: valido.message, remediation: valido.remediation, example: valido.example,
  });
});

test("should throw InvariantError for a finding that did not come from create", () => {
  const copia = { ...create(valido) };
  assert.throws(() => findingTexts(copia), InvariantError);
});

test("o achado válido nasce pronto e imutável", () => {
  const finding = create(valido);
  assert.equal(finding.code, "PLAN-1");
  assert.equal(finding.task, "P0.1");
  assert.throws(() => { finding.code = "PLAN-2"; }, TypeError);
});

test("line e task são opcionais: nem toda regra tem task", () => {
  const doArquivo = create({ ...valido, code: "PLAN-0", severity: "warning", line: undefined, task: undefined });
  assert.equal(doArquivo.line, null);
  assert.equal(doArquivo.task, null);
});

test("summarize conta por severidade e isError distingue", () => {
  const findings = [
    create(valido),
    create({ ...valido, code: "PLAN-5", severity: "warning" }),
    create({ ...valido, code: "PLAN-2" }),
  ];
  assert.deepEqual(summarize(findings), { errors: 2, warnings: 1 });
  assert.equal(isError(findings[1]), false);
  assert.deepEqual(SEVERITIES, ["error", "warning"]);
});

// A decisão de `blocking` tem duas condições que só importam juntas: o modo estrito e a isenção
// do código. Os testes de CLI exercitavam só o lado isento — trocar a expressão inteira por
// `false` mantinha a suíte verde, e a política mudou de módulo nesta fatia.
const erro = (code) => create({ ...valido, code, severity: "error" });
const aviso = (code) => create({ ...valido, code, severity: "warning" });

test("blocking: erro bloqueia nos dois modos, e o modo frouxo ignora todo aviso", () => {
  assert.equal(blocking([erro("PLAN-1")]), 1);
  assert.equal(blocking([erro("PLAN-1")], { strict: true }), 1);
  assert.equal(blocking([aviso("PLAN-5"), aviso("SPEC-4"), aviso("PLAN-0")]), 0);
});

test("blocking: --strict bloqueia o aviso NÃO isento, e só ele", () => {
  assert.equal(blocking([aviso("PLAN-5")], { strict: true }), 1, "aviso comum reprova em modo estrito");
  assert.equal(blocking([aviso("SPEC-4")], { strict: true }), 1);
  assert.equal(blocking([aviso("PLAN-0")], { strict: true }), 0, "formato legado é isento (RN-2)");
  assert.equal(blocking([aviso("SPEC-0")], { strict: true }), 0);
  assert.deepEqual(STRICT_EXEMPT, ["PLAN-0", "SPEC-0"]);
});

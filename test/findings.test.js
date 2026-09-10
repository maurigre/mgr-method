import { test } from "node:test";
import assert from "node:assert/strict";
import { SEVERITIES, STRICT_EXEMPT, blocking, create, isError, summarize } from "../src/findings.js";

const valido = {
  code: "PLAN-1", severity: "error", file: "04-plan.md", line: 12, task: "P0.1",
  message: "depends_on aponta para P9.9, que não existe",
  remediation: "Corrija o id ou crie a task P9.9.",
  example: "- **depends_on:** [P0.1]",
};

test("um achado sem remediação não pode ser criado", () => {
  assert.throws(() => create({ ...valido, remediation: undefined }), /sem `remediation`/);
  assert.throws(() => create({ ...valido, remediation: "   " }), /sem `remediation`/);
});

test("um achado sem exemplo não pode ser criado", () => {
  assert.throws(() => create({ ...valido, example: undefined }), /sem `example`/);
  assert.throws(() => create({ ...valido, example: "" }), /sem `example`/);
});

test("code, message e severidade também são obrigatórios", () => {
  assert.throws(() => create({ ...valido, code: "" }), /sem `code`/);
  assert.throws(() => create({ ...valido, message: "" }), /sem `message`/);
  assert.throws(() => create({ ...valido, severity: "critical" }), /severidade inválida: "critical"/);
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

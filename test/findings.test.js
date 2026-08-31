import { test } from "node:test";
import assert from "node:assert/strict";
import { SEVERITIES, create, isError, summarize } from "../src/findings.js";

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

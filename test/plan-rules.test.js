import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/plan-parser.js";
import { check, checkConsistency, checkPresence } from "../src/plan-rules.js";

const plano = (corpo, comMarcador = true) =>
  parse(`${comMarcador ? "<!-- mgr-plan-format: 1 -->\n" : ""}${corpo}`);
const codigos = (findings) => findings.map((f) => f.code).sort();

test("PLAN-1 acusa dependência para task que não existe", () => {
  const parsed = plano("### P0.1 — a\n- **depends_on:** [P9.9]\n- **done_when:** x\n- **artifact:** y\n");
  const [finding] = checkConsistency(parsed, "04-plan.md");
  assert.equal(finding.code, "PLAN-1");
  assert.equal(finding.task, "P0.1");
  assert.match(finding.message, /P9\.9/);
  assert.match(finding.remediation, /Ids válidos aqui: P0\.1/);
});

test("PLAN-1 não acusa dependência que existe", () => {
  const parsed = plano("### P0.1 — a\n### P1.1 — b\n- **depends_on:** [P0.1]\n");
  assert.deepEqual(checkConsistency(parsed, "f"), []);
});

test("PLAN-2 acusa ciclo direto e ciclo INDIRETO", () => {
  const direto = plano("### P0.1 — a\n- **depends_on:** [P0.2]\n### P0.2 — b\n- **depends_on:** [P0.1]\n");
  assert.ok(checkConsistency(direto, "f").some((f) => f.code === "PLAN-2"));

  const indireto = plano(
    "### P0.1 — a\n- **depends_on:** [P0.2]\n### P0.2 — b\n- **depends_on:** [P0.3]\n### P0.3 — c\n- **depends_on:** [P0.1]\n",
  );
  const ciclo = checkConsistency(indireto, "f").find((f) => f.code === "PLAN-2");
  assert.ok(ciclo, "ciclo A→B→C→A tem de ser detectado");
  assert.match(ciclo.message, /→/);
});

test("PLAN-2 relata o ciclo uma vez, não uma por task", () => {
  const parsed = plano("### P0.1 — a\n- **depends_on:** [P0.2]\n### P0.2 — b\n- **depends_on:** [P0.1]\n");
  assert.equal(checkConsistency(parsed, "f").filter((f) => f.code === "PLAN-2").length, 1);
});

test("PLAN-3 acusa mais de 3 arquivos e aceita exatamente 3", () => {
  const quatro = plano("### P0.1 — a\n- **files:** [a, b, c, d]\n");
  assert.deepEqual(codigos(checkConsistency(quatro, "f")), ["PLAN-3"]);

  const tres = plano("### P0.1 — a\n- **files:** [a, b, c]\n");
  assert.deepEqual(checkConsistency(tres, "f"), []);
});

test("as regras de consistência rodam TAMBÉM sem marcador, mas como AVISO — nunca reprovam", () => {
  const legado = plano("### P0.1 — a\n- **depends_on:** [P9.9]\n", false);
  assert.equal(legado.format.declared, false);
  const findings = checkConsistency(legado, "f");
  assert.deepEqual(codigos(findings), ["PLAN-1"], "a regra RODA: o autor vê a dependência quebrada");
  assert.equal(findings[0].severity, "warning", "mas não reprova: RN-2 — legado degrada com aviso");
});

test("a MESMA regra reprova quando o formato é declarado", () => {
  const declarado = plano("### P0.1 — a\n- **depends_on:** [P9.9]\n- **artifact:** x\n- **done_when:** y\n");
  assert.equal(checkConsistency(declarado, "f")[0].severity, "error");
});

test("todo achado emitido tem remediação e exemplo — garantido pelo construtor", () => {
  const parsed = plano("### P0.1 — a\n- **depends_on:** [P9.9]\n- **files:** [a, b, c, d]\n");
  const findings = checkConsistency(parsed, "f");
  assert.ok(findings.length >= 2);
  for (const finding of findings) {
    assert.ok(finding.remediation.length > 0, `${finding.code} sem remediação`);
    assert.ok(finding.example.length > 0, `${finding.code} sem exemplo`);
  }
});

test("PLAN-0 avisa sobre o formato não declarado e NÃO reprova", () => {
  const legado = plano("### P0.1 — a\n", false);
  const findings = checkPresence(legado, "f");
  assert.deepEqual(codigos(findings), ["PLAN-0"]);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].remediation, /nenhum plano existente é reprovado/);
});

test("PLAN-4 NÃO roda sem marcador, mesmo com task sem done_when", () => {
  const legado = plano("### P0.1 — a\n### P0.2 — b\n### P0.3 — c\n", false);
  assert.deepEqual(codigos(checkPresence(legado, "f")), ["PLAN-0"], "só o aviso, nenhum PLAN-4");
});

test("PLAN-4 roda com marcador e nomeia o que falta", () => {
  const semNada = plano("### P0.1 — a\n");
  const [finding] = checkPresence(semNada, "f");
  assert.equal(finding.code, "PLAN-4");
  assert.match(finding.message, /sem done_when e sem artifact/);
  assert.match(finding.remediation, /QUANTIDADE exatos \(L4\.3\)/);

  const soArtifact = plano("### P0.1 — a\n- **artifact:** 1 módulo\n");
  assert.match(checkPresence(soArtifact, "f")[0].message, /sem done_when$/);
});

test("PLAN-4 não acusa task completa", () => {
  const completa = plano("### P0.1 — a\n- **artifact:** 1 módulo\n- **done_when:** verde\n");
  assert.deepEqual(checkPresence(completa, "f"), []);
});

test("PLAN-5 avisa quando bloqueante depende de complementar", () => {
  const parsed = plano("### P0.1 — a\n- **artifact:** x\n- **done_when:** y\n- **depends_on:** [P2.1]\n### P2.1 — b\n- **artifact:** x\n- **done_when:** y\n");
  const aviso = checkPresence(parsed, "f").find((f) => f.code === "PLAN-5");
  assert.ok(aviso);
  assert.equal(aviso.severity, "warning");
  assert.match(aviso.message, /P0 depende de `P2\.1`, que é P2/);
});

test("PLAN-5 não avisa na ordem natural", () => {
  const parsed = plano("### P0.1 — a\n- **artifact:** x\n- **done_when:** y\n### P1.1 — b\n- **artifact:** x\n- **done_when:** y\n- **depends_on:** [P0.1]\n");
  assert.ok(!checkPresence(parsed, "f").some((f) => f.code === "PLAN-5"));
});

// --- P1.4: a prova da RN-2, sobre fixtures VERSIONADAS ---
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "plans");

test("nenhuma das formas reais de plano produz erro", () => {
  for (const nome of readdirSync(FIXTURES)) {
    const findings = check(parse(readFileSync(path.join(FIXTURES, nome), "utf8")), nome);
    assert.deepEqual(
      findings.filter((f) => f.severity === "error").map((f) => f.code), [],
      `${nome}: a feature não pode reprovar plano escrito antes dela existir (RN-2)`,
    );
  }
});

test("os planos sem marcador recebem o aviso PLAN-0, nunca erro", () => {
  for (const nome of ["legado-puro.md", "misto.md"]) {
    const findings = check(parse(readFileSync(path.join(FIXTURES, nome), "utf8")), nome);
    assert.ok(findings.some((f) => f.code === "PLAN-0" && f.severity === "warning"), nome);
    assert.equal(findings.filter((f) => f.severity === "error").length, 0, nome);
  }
});

test("os planos vivos, quando existem, também produzem zero erros", () => {
  const raizSpecs = path.join(RAIZ, "specs");
  if (!existsSync(raizSpecs)) return;
  const erros = [];
  for (const entrada of readdirSync(raizSpecs, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const arquivo = path.join(raizSpecs, entrada.name, "04-plan.md");
    if (!existsSync(arquivo)) continue;
    erros.push(...check(parse(readFileSync(arquivo, "utf8")), entrada.name).filter((f) => f.severity === "error"));
  }
  assert.deepEqual(erros.map((f) => `${f.file}:${f.code}`), []);
});

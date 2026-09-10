import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/spec-parser.js";
import { check } from "../src/spec-rules.js";
import { validateSpecs } from "../src/spec-validator.js";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(RAIZ, "test", "fixtures", "specs");
const spec = (corpo, comMarcador = true) => parse(`${comMarcador ? "<!-- mgr-spec-format: 1 -->\n" : ""}${corpo}`);
const codigos = (findings) => findings.map((f) => f.code);

test("SPEC-0 avisa sobre formato não declarado e NÃO reprova", () => {
  const findings = check(spec("- [ ] **CA-1:** x\n", false), "03-spec.md");
  assert.deepEqual(codigos(findings), ["SPEC-0"]);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].remediation, /nenhuma spec existente é reprovada/);
});

test("sem marcador, NENHUMA outra regra roda — nem sobre spec sem critério nenhum", () => {
  assert.deepEqual(codigos(check(spec("# só prosa\n", false), "f")), ["SPEC-0"]);
});

test("SPEC-1 reprova spec declarada sem nenhum critério", () => {
  const findings = check(spec("# spec\n## Visão\ntexto\n"), "f");
  assert.deepEqual(codigos(findings), ["SPEC-1"]);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].example, /\*\*CA-1:\*\*/);
});

test("SPEC-2 reprova identidade duplicada, apontando a primeira ocorrência", () => {
  const findings = check(spec("- [ ] **CA-1:** a\n- [ ] **CA-1:** b\n"), "f");
  assert.deepEqual(codigos(findings), ["SPEC-2"]);
  assert.match(findings[0].message, /já aparece na linha 2/);
  assert.equal(findings[0].task, "CA-1");
});

test("SPEC-3 reprova critério com identidade e sem enunciado", () => {
  const findings = check(spec("- [ ] **CA-1:** \n- [ ] **CA-2:** tem corpo\n"), "f");
  assert.deepEqual(codigos(findings), ["SPEC-3"]);
  assert.equal(findings[0].task, "CA-1");
});

test("SPEC-4 avisa sobre buraco na numeração, sem reprovar", () => {
  const findings = check(spec("- [ ] **CA-1:** a\n- [ ] **CA-3:** c\n"), "f");
  assert.deepEqual(codigos(findings), ["SPEC-4"]);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /falta CA-2/);
});

test("SPEC-4 não avisa em numeração contínua, nem quando começa fora do 1", () => {
  assert.deepEqual(check(spec("- [ ] **CA-1:** a\n- [ ] **CA-2:** b\n"), "f"), []);
  assert.deepEqual(check(spec("- [ ] **CA-5:** a\n- [ ] **CA-6:** b\n"), "f"), []);
});

test("uma spec bem formada não produz achado nenhum", () => {
  const findings = check(parse(readFileSync(path.join(FIXTURES, "formato-1.md"), "utf8")), "formato-1.md");
  assert.deepEqual(findings, []);
});

test("as três formas reais não produzem ERRO nenhum", () => {
  for (const nome of readdirSync(FIXTURES)) {
    const findings = check(parse(readFileSync(path.join(FIXTURES, nome), "utf8")), nome);
    assert.deepEqual(
      findings.filter((f) => f.severity === "error").map((f) => f.code), [],
      `${nome}: a feature não pode reprovar spec escrita antes dela existir (RN-2)`,
    );
  }
});

test("todo achado emitido tem remediação e exemplo", () => {
  const casos = [
    spec("# sem critério\n"),
    spec("- [ ] **CA-1:** a\n- [ ] **CA-1:** b\n"),
    spec("- [ ] **CA-1:** \n"),
    spec("- [ ] **CA-1:** a\n- [ ] **CA-4:** d\n"),
    spec("# legado\n", false),
  ];
  for (const parsed of casos) {
    for (const finding of check(parsed, "f")) {
      assert.ok(finding.remediation.trim().length > 0, `${finding.code} sem remediação`);
      assert.ok(finding.example.trim().length > 0, `${finding.code} sem exemplo`);
    }
  }
});

test("as specs vivas, quando existem, produzem zero erros", () => {
  const raizSpecs = path.join(RAIZ, "specs");
  if (!existsSync(raizSpecs)) return;
  const erros = [];
  for (const entrada of readdirSync(raizSpecs, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const arquivo = path.join(raizSpecs, entrada.name, "03-spec.md");
    if (!existsSync(arquivo)) continue;
    erros.push(...check(parse(readFileSync(arquivo, "utf8")), entrada.name).filter((f) => f.severity === "error"));
  }
  assert.deepEqual(erros.map((f) => `${f.file}:${f.code}`), []);
});

test("o template do método passa no próprio validador", () => {
  const template = path.join(RAIZ, "skills", "spec-create", "templates", "03-spec.md");
  const parsed = parse(readFileSync(template, "utf8"));
  assert.equal(parsed.format.declared, true, "o template declara o formato que ele ensina");
  assert.deepEqual(check(parsed, "template").map((f) => f.code), []);
});

test("SPEC-2 pega a colisão por número: `CA-1` e `CA-01` são o mesmo critério para quem lê", () => {
  const achados = check(parse("<!-- mgr-spec-format: 1 -->\n- [ ] **CA-1:** a\n- [ ] **CA-01:** b\n"), "03-spec.md");
  const duplicado = achados.find((f) => f.code === "SPEC-2");
  assert.ok(duplicado, "comparar por string deixaria o par escapar da SPEC-2 e da SPEC-4");
  assert.match(duplicado.message, /`CA-01` colide com `CA-1`/);
});

test("o contador só soma o que foi conferido: spec sem marcador não entra", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "mgr-spec-"));
  const escrever = (slug, corpo) => {
    mkdirSync(path.join(repo, "specs", slug), { recursive: true });
    writeFileSync(path.join(repo, "specs", slug, "03-spec.md"), corpo);
  };
  escrever("declarada", "<!-- mgr-spec-format: 1 -->\n- [ ] **CA-1:** a\n- [ ] **CA-2:** b\n");
  escrever("legada", "# antiga\n\n- [ ] **CA-1:** nunca foi conferida\n");
  const { criteria, findings } = validateSpecs(repo, {});
  assert.equal(criteria, 2, "os da spec sem marcador não foram conferidos, então não contam");
  assert.deepEqual(findings.map((f) => f.code), ["SPEC-0"]);
});

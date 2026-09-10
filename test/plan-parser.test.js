import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, STATUS_VALUES, STATUS_DONE } from "../src/plan-parser.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const novo = `<!-- mgr-plan-format: 1 -->
# Plano — x

### P0.1 — título livre, no idioma do usuário
- **priority:** P0
- **depends_on:** []
- **files:** [src/a.js, test/a.test.js]
- **artifact:** 1 módulo com create()
- **done_when:** o teste passa
- **helper_skill:** none

### P1.1 — outro
- **priority:** P1
- **depends_on:** [P0.1]
- **files:** [src/b.js]
- **artifact:** 1 função
- **done_when:** verde
`;

test("o formato declarado é lido do marcador", () => {
  assert.deepEqual(parse(novo).format, { declared: true, version: 1 });
  assert.deepEqual(parse("# sem marcador\n### P0.1 — x\n").format, { declared: false, version: 0 });
});

test("a identidade é o ID da task, e o título fica livre", () => {
  const { tasks } = parse(novo);
  assert.deepEqual(tasks.map((t) => t.id), ["P0.1", "P1.1"]);
  assert.equal(tasks[0].line, 4);
});

test("os campos são lidos pela chave em inglês, com a prosa no idioma do usuário", () => {
  const [primeira] = parse(novo).tasks;
  assert.equal(primeira.priority, "P0");
  assert.deepEqual(primeira.dependsOn, []);
  assert.deepEqual(primeira.files, ["src/a.js", "test/a.test.js"]);
  assert.equal(primeira.artifact, "1 módulo com create()");
  assert.equal(primeira.doneWhen, "o teste passa");
  assert.equal(primeira.helperSkill, "none");
  assert.deepEqual(parse(novo).tasks[1].dependsOn, ["P0.1"]);
});

test("lista aceita com e sem colchete, e o travessão vale como vazia", () => {
  const semColchete = parse("### P0.1 — x\n- **files:** src/a.js, src/b.js\n");
  assert.deepEqual(semColchete.tasks[0].files, ["src/a.js", "src/b.js"]);
  const travessao = parse("### P0.1 — x\n- **depends_on:** —\n");
  assert.deepEqual(travessao.tasks[0].dependsOn, []);
});

test("chave desconhecida é ignorada, não quebra", () => {
  const { tasks } = parse("### P0.1 — x\n- **objetivo:** algo\n- **done_when:** ok\n");
  assert.equal(tasks[0].doneWhen, "ok");
  assert.equal(tasks.length, 1);
});

test("campo fora de qualquer task é ignorado", () => {
  const { tasks } = parse("- **done_when:** órfão\n### P0.1 — x\n- **done_when:** ok\n");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].doneWhen, "ok");
});

// --- P0.3: as três formas reais, congeladas como fixture VERSIONADA ---
// As fixtures existem porque `specs/` é gitignored por decisão do projeto: um teste que lesse
// só os planos vivos passaria na máquina do autor e falharia no CI e em qualquer clone.
const FIXTURES = path.join(RAIZ, "test", "fixtures", "plans");
const fixture = (nome) => parse(readFileSync(path.join(FIXTURES, nome), "utf8"));

test("o parser lê as três formas de plano que existem no mundo real", () => {
  assert.equal(fixture("legado-puro.md").format.declared, false);
  assert.equal(fixture("misto.md").format.declared, false, "misto sem marcador continua legado");
  assert.deepEqual(fixture("formato-1.md").format, { declared: true, version: 1 });
  // `invalidos/` fica de fora: o defeito lá é deliberado, e este teste afirma sobre forma real.
  for (const nome of readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
    assert.ok(fixture(nome).tasks.length > 0, `nenhuma task reconhecida em ${nome}`);
  }
});

test("no plano misto, o depends_on em inglês é lido mesmo sem marcador", () => {
  const [, segunda] = fixture("misto.md").tasks;
  assert.deepEqual(segunda.dependsOn, ["P0.1"], "é o ganho que a decisão do marcador preserva");
});

// Reforço de ambiente: quando os planos vivos existem (máquina do autor), eles também valem como
// amostra. Ausentes — CI, clone limpo — o teste acima já garante o comportamento.
test("os planos vivos, quando existem, também são lidos sem quebra", () => {
  const raizSpecs = path.join(RAIZ, "specs");
  if (!existsSync(raizSpecs)) return;
  const planos = readdirSync(raizSpecs, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => path.join(raizSpecs, entrada.name, "04-plan.md"))
    .filter(existsSync);
  for (const plano of planos) {
    assert.doesNotThrow(() => parse(readFileSync(plano, "utf8")), `quebrou em ${plano}`);
  }
});

// ADR-0014 — o estado da task. Ausência vale `todo` e NUNCA vira `done`: é o que separa
// "reofereço algo já feito" de "pulo algo que falta", e só o primeiro é aceitável.
test("status ausente vale todo; presente entra cru, para a regra julgar", () => {
  const { tasks } = parse([
    "<!-- mgr-plan-format: 1 -->",
    "### P0.1 — feita", "- **status:** done",
    "### P0.2 — sem a chave",
    "### P0.3 — valor no idioma do usuário", "- **status:** concluído",
  ].join("\n"));
  assert.deepEqual(tasks.map((task) => task.status), ["done", "todo", "concluído"]);
  assert.equal(STATUS_DONE, "done");
  assert.deepEqual(STATUS_VALUES, ["todo", "done"], "vocabulário fechado, fonte única");
});

test("os planos reais continuam sem estado declarado — a chave é nova", () => {
  const semEstado = ["formato-1.md", "legado-puro.md", "misto.md"].every((nome) => {
    const { tasks } = parse(readFileSync(path.join(RAIZ, "test", "fixtures", "plans", nome), "utf8"));
    return tasks.every((task) => task.status === "todo");
  });
  assert.ok(semEstado, "nenhuma fixture usa `status`, então o parse delas não pode ter mudado");
});

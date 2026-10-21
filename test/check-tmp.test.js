import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLeftovers } from "../scripts/check-tmp.mjs";
import { tempDir } from "../scripts/lib/tmp.mjs";
import { pidMorto } from "./helpers/pid-morto.js";

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "check-tmp.mjs");
const viva = (pid) => pid === 111;

function rodarCheck(sandbox, args = []) {
  return spawnSync(process.execPath, [CHECK, ...args], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: sandbox },
  });
}

test("should flip from ignored to dead-run when only the liveness changes", () => {
  const vivo = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "111-aaaaaa", kept: false }],
    isAlive: viva,
  });
  const morto = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "222-aaaaaa", kept: false }],
    isAlive: viva,
  });
  assert.deepStrictEqual(vivo, { problems: [], ignored: [{ pid: 111, name: "111-aaaaaa" }] });
  assert.deepStrictEqual(morto, { problems: [{ kind: "dead-run", name: "222-aaaaaa" }], ignored: [] });
});

test("should flip from dead-run to kept when only the marker changes", () => {
  const semMarca = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "222-aaaaaa", kept: false }],
    isAlive: viva,
  });
  const comMarca = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "222-aaaaaa", kept: true }],
    isAlive: viva,
  });
  assert.deepStrictEqual(semMarca, { problems: [{ kind: "dead-run", name: "222-aaaaaa" }], ignored: [] });
  assert.deepStrictEqual(comMarca, { problems: [{ kind: "kept", name: "222-aaaaaa" }], ignored: [] });
});

test("should flip from unknown to dead-run when only the name shape changes", () => {
  const fora = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "xyz", kept: false }],
    isAlive: viva,
  });
  const dentro = findLeftovers({
    tmpNames: [],
    baseEntries: [{ name: "222-xyz", kept: false }],
    isAlive: viva,
  });
  assert.deepStrictEqual(fora, { problems: [{ kind: "unknown", name: "xyz" }], ignored: [] });
  assert.deepStrictEqual(dentro, { problems: [{ kind: "dead-run", name: "222-xyz" }], ignored: [] });
});

test("should flip from nothing to outside-base when only the name changes from the base", () => {
  const base = findLeftovers({ tmpNames: ["mgr-method"], baseEntries: [], isAlive: viva });
  const outro = findLeftovers({ tmpNames: ["mgr-x"], baseEntries: [], isAlive: viva });
  assert.deepStrictEqual(base, { problems: [], ignored: [] });
  assert.deepStrictEqual(outro, { problems: [{ kind: "outside-base", name: "mgr-x" }], ignored: [] });
});

test("should return empty lists and never null when both inputs are empty", () => {
  const resultado = findLeftovers({ tmpNames: [], baseEntries: [], isAlive: viva });
  assert.deepStrictEqual(resultado, { problems: [], ignored: [] });
  assert.notEqual(resultado.problems, null);
  assert.notEqual(resultado.ignored, null);
});

test("should exit 0 with the OK line when the base exists and is empty", () => {
  const sandbox = tempDir("mgr-check-tmp-test-");
  mkdirSync(path.join(sandbox, "mgr-method"));
  mkdirSync(path.join(sandbox, "outra-ferramenta"));
  const resultado = rodarCheck(sandbox);
  assert.equal(resultado.status, 0);
  assert.ok(resultado.stdout.includes(`check-tmp OK — nenhuma sobra em ${sandbox}`));
});

test("should exit 0 when the base is absent", () => {
  const sandbox = tempDir("mgr-check-tmp-test-");
  const resultado = rodarCheck(sandbox);
  assert.equal(resultado.status, 0);
});

test("should exit 1 with each literal leftover line and the summary for one of each kind", () => {
  const sandbox = tempDir("mgr-check-tmp-test-");
  const base = path.join(sandbox, "mgr-method");
  const morto = pidMorto();
  const mortoAaaa = `${morto}-aaaaaa`;
  const mortoBbbb = `${morto}-bbbbbb`;
  mkdirSync(path.join(sandbox, "mgr-x"));
  mkdirSync(path.join(base, mortoAaaa), { recursive: true });
  mkdirSync(path.join(base, mortoBbbb), { recursive: true });
  writeFileSync(path.join(base, mortoBbbb, ".mgr-keep"), "");
  mkdirSync(path.join(base, "estranho"));

  const resultado = rodarCheck(sandbox);
  const linhas = resultado.stderr.split("\n");

  assert.equal(resultado.status, 1);
  assert.ok(
    linhas.includes(
      `check-tmp: sobra fora da base: ${path.join(sandbox, "mgr-x")} (temporario so por tempDir de scripts/lib/tmp.mjs)`,
    ),
  );
  assert.ok(linhas.includes(`check-tmp: sobra de processo encerrado: ${path.join(base, mortoAaaa)}`));
  assert.ok(
    linhas.includes(
      `check-tmp: preservado a pedido (MGR_KEEP_TMP=1): ${path.join(base, mortoBbbb)}; apague quando terminar`,
    ),
  );
  assert.ok(linhas.includes(`check-tmp: entrada desconhecida na base: ${path.join(base, "estranho")}`));
  assert.ok(linhas.includes("check-tmp: 4 sobra(s) no diretorio temporario"));
});

test("should exit 0 and print the ignored line when a folder belongs to the live test process", () => {
  const sandbox = tempDir("mgr-check-tmp-test-");
  const base = path.join(sandbox, "mgr-method");
  const nome = `${process.pid}-cccccc`;
  mkdirSync(path.join(base, nome), { recursive: true });

  const resultado = rodarCheck(sandbox);

  assert.equal(resultado.status, 0);
  assert.ok(resultado.stdout.split("\n").includes(`check-tmp: ignorado, processo ${process.pid} vivo: ${path.join(base, nome)}`));
});

test("should exit 2 with the no-argument line when any argument is passed", () => {
  const sandbox = tempDir("mgr-check-tmp-test-");
  const resultado = rodarCheck(sandbox, ["arquivo.test.js"]);
  assert.equal(resultado.status, 2);
  assert.ok(
    resultado.stderr
      .split("\n")
      .includes("check-tmp: nao recebe argumentos; para rodar um arquivo de teste use node --test <arquivo>"),
  );
});

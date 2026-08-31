import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CORE_ROLES, LAWS_TOKEN, checkLaws, checkResolved, parseLaws } from "../scripts/check-laws.mjs";
import { existsSync } from "node:fs";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "mgr-laws-"));
const ponteirosOk = Object.fromEntries(
  Object.keys(CORE_ROLES).map((skill) => [skill, { hasPointer: true, declaresRole: true }]),
);

test("fonte íntegra não produz problema nenhum, com um ou muitos espaços", () => {
  const fonte = [
    "### L1.1 — Um espaço `[Verifier]`",
    "### L2.1 — Muitos espaços      `[All]`",
    "### L3.1 — Dois papéis `[Executor, Verifier]`",
  ].join("\n");
  assert.deepEqual(checkLaws(parseLaws(fonte), ponteirosOk), []);
});

test("LAW-1 acusa ID de lei duplicado", () => {
  const fonte = "### L1.1 — A `[All]`\n### L1.1 — B `[All]`";
  const problemas = checkLaws(parseLaws(fonte), ponteirosOk);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /^LAW-1 L1\.1: duplicate id/);
});

test("LAW-2 acusa papel fora da matriz e cabeçalho sem papel", () => {
  const semPapel = checkLaws(parseLaws("### L1.1 — Sem papel"), ponteirosOk);
  assert.match(semPapel[0], /^LAW-2 line 1: law header does not declare a role/);

  const papelInvalido = checkLaws(parseLaws("### L1.1 — X `[Architect]`"), ponteirosOk);
  assert.match(papelInvalido[0], /^LAW-2 L1\.1: unknown role "Architect"/);
});

test("LAW-3 acusa skill do CORE sem ponteiro e ponteiro sem papel nomeado", () => {
  const semPonteiro = checkLaws(parseLaws("### L1.1 — X `[All]`"), {
    "spec-execute": { hasPointer: false, declaresRole: false },
  });
  assert.match(semPonteiro[0], /^LAW-3 spec-execute: CORE skill without/);

  const semPapel = checkLaws(parseLaws("### L1.1 — X `[All]`"), {
    "spec-execute": { hasPointer: true, declaresRole: false },
  });
  assert.match(semPapel[0], /^LAW-3 spec-execute: pointer present but/);
});

test("LAW-4 acusa lei órfã: papel válido que nenhuma skill do CORE carrega", () => {
  const problemas = checkLaws(parseLaws("### L4.3 — O trilho `[Executor]`"), ponteirosOk);
  assert.deepEqual(problemas, [], "com spec-execute no CORE, a lei do Executor não é órfã");

  const orfa = checkLaws(parseLaws("### L9.9 — X `[Reviewer]`"), ponteirosOk);
  assert.equal(orfa.filter((p) => p.startsWith("LAW-4")).length, 1, "papel desconhecido não mapeia para skill");
});

test("LAW-5 acusa token cru sobrando numa skill instalada", () => {
  const dir = path.join(tmp(), "skills");
  mkdirSync(path.join(dir, "spec-create"), { recursive: true });
  writeFileSync(path.join(dir, "spec-create", "SKILL.md"), `ponteiro: ${LAWS_TOKEN}\n`, "utf8");
  const problemas = checkResolved(dir);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /^LAW-5 spec-create: .* left unresolved/);
});

test("LAW-5 não acusa quando o token já foi resolvido", () => {
  const dir = path.join(tmp(), "skills");
  mkdirSync(path.join(dir, "spec-create"), { recursive: true });
  writeFileSync(path.join(dir, "spec-create", "SKILL.md"), "ponteiro: _shared/laws/execution-laws.md\n", "utf8");
  assert.deepEqual(checkResolved(dir), []);
});

test("a fonte real do repositório passa em todas as regras, com os ponteiros REAIS", () => {
  // Ponteiros fabricados fariam a LAW-3 nunca conferir as skills de verdade: remover a
  // linha-ponteiro de uma skill do CORE passaria despercebido, que é o oposto do gate.
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const fonte = path.join(raiz, "shared", "laws", "execution-laws.md");
  const ponteirosReais = {};
  for (const [skill, papel] of Object.entries(CORE_ROLES)) {
    const md = path.join(raiz, "skills", skill, "SKILL.md");
    assert.ok(existsSync(md), `skill do CORE ausente: ${skill}`);
    const texto = readFileSync(md, "utf8");
    ponteirosReais[skill] = {
      hasPointer: texto.includes(LAWS_TOKEN),
      declaresRole: new RegExp(`role is \\*\\*${papel}\\*\\*`).test(texto),
    };
  }
  const problemas = checkLaws(parseLaws(readFileSync(fonte, "utf8")), ponteirosReais);
  assert.deepEqual(problemas, [], "o repositório é a fixture positiva definitiva");
});

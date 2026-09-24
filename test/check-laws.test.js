import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CHARTER_TOKEN, CORE_ROLES, LAWS_TOKEN, SHARED_TREE_NAME, checkCharter, checkCharterResolved, checkLaws, checkResolved, parseCharter, parseLaws } from "../scripts/check-laws.mjs";
import { existsSync } from "node:fs";
import { SHARED_DIR, LAWS_INSTALLED } from "../src/catalog.js";

const diretorioTemporario = () => mkdtempSync(path.join(os.tmpdir(), "mgr-laws-"));
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
  const dir = path.join(diretorioTemporario(), "skills");
  mkdirSync(path.join(dir, "spec-create"), { recursive: true });
  writeFileSync(path.join(dir, "spec-create", "SKILL.md"), `ponteiro: ${LAWS_TOKEN}\n`, "utf8");
  const problemas = checkResolved(dir);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /^LAW-5 spec-create\/SKILL\.md: .* left unresolved/,
    "a mensagem nomeia o ARQUIVO e nao a pasta: com varios .md por skill, a pasta nao diz onde esta");
});

test("shouldReproveAnyMethodTokenAndNotOnlyTheLawsOne", () => {
  const dir = path.join(diretorioTemporario(), "skills");
  mkdirSync(path.join(dir, "code-analyzer"), { recursive: true });
  writeFileSync(path.join(dir, "code-analyzer", "SKILL.md"), "idioma: {{MGR_USER_LANGUAGE}}\n", "utf8");
  assert.match(checkResolved(dir)[0], /\{\{MGR_USER_LANGUAGE\}\} left unresolved/,
    "a versao anterior so procurava o token das leis, entao os outros tres sobravam sem ninguem ver");
});

test("shouldReproveATokenLeftUnderSharedAndNotOnlyInsideASkill", () => {
  const dir = path.join(diretorioTemporario(), "skills");
  mkdirSync(path.join(dir, "_shared", "charter"), { recursive: true });
  writeFileSync(path.join(dir, "_shared", "charter", "core-principles.md"), "aponta: {{MGR_CHARTER}}\n", "utf8");
  assert.match(checkResolved(dir)[0], /^LAW-5 _shared\/charter\/core-principles\.md:/,
    "e o buraco que a emenda do ADR-0022 declarou: nada sob _shared/ era conferido, nem pelo doctor");
});

test("LAW-5 não acusa quando o token já foi resolvido", () => {
  const dir = path.join(diretorioTemporario(), "skills");
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

const PRIMICIA = (id, partes = ["**Statement.**", "**Case.**", "**Provenance.**"]) =>
  `### ${id} — Titulo\n\n${partes.map((parte) => `${parte} texto`).join("\n\n")}\n`;

const COM_PONTEIRO = `x ${CHARTER_TOKEN} y`;

test("shouldParseEveryWellFormedPrincipleWithItsBody", () => {
  const principles = parseCharter(PRIMICIA("CP-1") + PRIMICIA("CP-2"));
  assert.deepEqual(principles.map(({ id }) => id), ["CP-1", "CP-2"]);
  assert.ok(principles[0].body.includes("**Case.**"),
    "o corpo tem de ir ate o proximo cabecalho, senao a conferencia das tres partes olha o nada");
});

test("shouldReproveHeadingThatIsNotAPrinciple", () => {
  const problems = checkCharter(parseCharter("### CP1 - sem travessao\n"), COM_PONTEIRO);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^CHT-3 /,
    "parseLaws pula cabecalho desconhecido em silencio, e primicia que some calada e pior que carta nenhuma");
});

test("shouldReproveMissingStatementCaseOrProvenance", () => {
  for (const faltando of ["**Statement.**", "**Case.**", "**Provenance.**"]) {
    const partes = ["**Statement.**", "**Case.**", "**Provenance.**"].filter((parte) => parte !== faltando);
    const problems = checkCharter(parseCharter(PRIMICIA("CP-1", partes)), COM_PONTEIRO);
    assert.equal(problems.length, 1, `faltando ${faltando} tem de dar exatamente um problema`);
    assert.match(problems[0], /^CHT-2 CP-1: missing the /,
      "o codigo do defeito vem antes de quem o tem, como o LAW-2 ja faz, para nao confundir com o id da primicia");
  }
});

test("shouldReproveDuplicatePrincipleId", () => {
  const problems = checkCharter(parseCharter(PRIMICIA("CP-1") + PRIMICIA("CP-1")), COM_PONTEIRO);
  assert.equal(problems.filter((problem) => problem.startsWith("CHT-1")).length, 1);
});

test("shouldReproveLawsSourceWithoutThePointerToTheCharter", () => {
  const problems = checkCharter(parseCharter(PRIMICIA("CP-1")), "leis sem ponteiro nenhum");
  assert.deepEqual(problems, [`CHT-4 L0.1: the laws source does not carry the ${CHARTER_TOKEN} pointer to the charter`]);
});

test("shouldAcceptAnIntactCharter", () => {
  assert.deepEqual(checkCharter(parseCharter(PRIMICIA("CP-1") + PRIMICIA("CP-2")), COM_PONTEIRO), [],
    "o caso negativo: um verificador so testado contra defeito prova que sabe falhar, nao que sabe passar");
});

test("shouldKeepTheRealCharterIntactWithSevenPrinciples", () => {
  const carta = parseCharter(readFileSync("shared/charter/core-principles.md", "utf8"));
  const leis = readFileSync("shared/laws/execution-laws.md", "utf8");
  assert.equal(carta.filter(({ id }) => id).length, 7);
  assert.deepEqual(checkCharter(carta, leis), []);
});

const ARVORE_INSTALADA = () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "mgr-carta-"));
  const dir = path.join(repo, ".claude", "skills");
  mkdirSync(path.join(dir, "_shared", "laws"), { recursive: true });
  mkdirSync(path.join(dir, "_shared", "charter"), { recursive: true });
  writeFileSync(path.join(dir, "_shared", "charter", "core-principles.md"), "carta");
  const apontado = path.join(".claude", "skills", "_shared", "charter", "core-principles.md");
  writeFileSync(path.join(dir, "_shared", "laws", "execution-laws.md"),
    `the MGR core principles are the charter at ${apontado}, and\n`);
  return { repo, dir };
};

test("shouldAcceptAnInstalledTreeWhereTheCharterPointerResolves", () => {
  const { dir } = ARVORE_INSTALADA();
  assert.deepEqual(checkCharterResolved(dir), [],
    "o caso negativo: instalacao recem-feita tem o token resolvido e o arquivo no lugar");
});

test("shouldReproveTheRawTokenLeftInTheInstalledLaws", () => {
  const { dir } = ARVORE_INSTALADA();
  const leis = path.join(dir, "_shared", "laws", "execution-laws.md");
  writeFileSync(leis, `the charter at ${CHARTER_TOKEN}, and\n`);
  assert.match(checkCharterResolved(dir)[0], /left unresolved in the installed laws/,
    "o mgr doctor nao alcanca _shared, entao se a CHT-4 nao pegar isto ninguem pega");
});

test("shouldReproveACharterPointerThatResolvesToNothing", () => {
  const { dir } = ARVORE_INSTALADA();
  rmSync(path.join(dir, "_shared", "charter", "core-principles.md"));
  assert.match(checkCharterResolved(dir)[0], /which does not exist/,
    "e o risco que o ADR-0022 nomeia: o ponteiro apontando para o vazio sem ninguem notar");
});

test("shouldProveIndependenceFromProcessWorkingDirectory", () => {
  const { dir } = ARVORE_INSTALADA();
  rmSync(path.join(dir, "_shared", "charter", "core-principles.md"));

  const chamariz = mkdtempSync(path.join(os.tmpdir(), "mgr-chamariz-"));
  mkdirSync(path.join(chamariz, ".claude", "skills", "_shared", "charter"), { recursive: true });
  writeFileSync(path.join(chamariz, ".claude", "skills", "_shared", "charter", "core-principles.md"), "arquivo");

  const cwdAtual = process.cwd();
  try {
    process.chdir(chamariz);
    const problemas = checkCharterResolved(dir);
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /which does not exist/,
      "resolucao de caminho deve acontecer contra a arvore sob analise e nao contra o CWD do processo");
  } finally {
    process.chdir(cwdAtual);
  }
});

test("shouldIgnoreATreeWithNoInstalledLaws", () => {
  assert.deepEqual(checkCharterResolved(mkdtempSync(path.join(os.tmpdir(), "mgr-vazio-"))), [],
    "arvore sem leis instaladas nao e defeito da carta: nao ha o que conferir");
});

test("shouldCloseAPrincipleBodyAtTheNextSectionAndNotSwallowTrailingProse", () => {
  const texto = "### CP-1 — T\n\n**Statement.** a\n\n**Case.** b\n\n**Provenance.** c\n\n## Adding\n\n**Case.** prosa\n";
  const [primeira] = parseCharter(texto);
  assert.ok(!primeira.body.includes("prosa"),
    "sem fechar em `## ` o corpo da ultima primicia absorvia a prosa final e uma parte escrita la contaria por acaso");
});

test("shouldLockTheMirrorOfTheScriptAgainstTheCatalogSource", () => {
  assert.equal(
    SHARED_TREE_NAME,
    SHARED_DIR,
    "the verifier mirror in check-laws.mjs is deliberate to keep it independent from the source it verifies; "
    + "divergence must become red, never silent",
  );
  assert.deepEqual(
    [SHARED_TREE_NAME, "laws", "execution-laws.md"],
    LAWS_INSTALLED,
    "the installed laws segments must match the catalog source — breaking this test means the mirror diverged",
  );
  assert.equal(
    LAWS_TOKEN,
    "{{MGR_LAWS}}",
    "the laws token copy in the script must stay in sync",
  );
  assert.equal(
    CHARTER_TOKEN,
    "{{MGR_CHARTER}}",
    "the charter token copy in the script must stay in sync",
  );
});

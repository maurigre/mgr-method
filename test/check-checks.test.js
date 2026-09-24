import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { DOCUMENTS, extractIds, checkConsistency } from "../scripts/check-checks.mjs";
import { CHECKS } from "../src/doctor.js";

const diretorio = fileURLToPath(new URL(".", import.meta.url));
const raiz = path.join(diretorio, "..");

test("shouldProduceNoProblemWhenCodeAndDocumentIdsMatch", () => {
  const codeIds = new Set(["check-a", "check-b"]);
  const validDoc = `
| id | Compares |
|---|---|
| \`check-a\` | something |
| \`check-b\` | something else |
`.trim();

  const documentResults = [
    {
      path: "README.md",
      ...extractIds(validDoc, "| id | Compares |"),
    },
  ];

  const problems = checkConsistency(codeIds, documentResults);
  assert.equal(problems.length, 0, "matching ids produce no problems");
});

test("shouldReportMissingIdInDocumentWithChk1", () => {
  const codeIds = new Set(["check-a", "check-b"]);
  const docWithMissing = `
| id | Compares |
|---|---|
| \`check-a\` | something |
`.trim();

  const documentResults = [
    {
      path: "README.md",
      ...extractIds(docWithMissing, "| id | Compares |"),
    },
  ];

  const problems = checkConsistency(codeIds, documentResults);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^CHK-1 README\.md: missing id 'check-b'/,
    "id in code but missing from document is reported with CHK-1");
});

test("shouldReportExtraIdInDocumentWithChk2", () => {
  const codeIds = new Set(["check-a"]);
  const docWithExtra = `
| id | Compares |
|---|---|
| \`check-a\` | something |
| \`check-extra\` | unwanted |
`.trim();

  const documentResults = [
    {
      path: "README.md",
      ...extractIds(docWithExtra, "| id | Compares |"),
    },
  ];

  const problems = checkConsistency(codeIds, documentResults);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^CHK-2 README\.md: extra id 'check-extra'/,
    "id in document but missing from code is reported with CHK-2");
});

test("shouldReportMissingHeaderWithChk3", () => {
  const codeIds = new Set(["check-a"]);
  const docWithoutHeader = "no header here";

  const documentResults = [
    {
      path: "README.md",
      ...extractIds(docWithoutHeader, "| id | Compares |"),
    },
  ];

  const problems = checkConsistency(codeIds, documentResults);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^CHK-3 README\.md: expected header not found/,
    "missing header is reported with CHK-3, not silenced");
});

test("shouldExtractIdsFromMarkdownTableCorrectly", () => {
  const markdown = `
| id | Compares |
|---|---|
| \`orphan-skill\` | first |
| \`missing-skill\` | second |
| \`architecture-skill\` | third |
`.trim();

  const { ids, headerFound } = extractIds(markdown, "| id | Compares |");
  assert.ok(headerFound);
  assert.deepEqual([...ids].sort(), ["architecture-skill", "missing-skill", "orphan-skill"]);
});

test("shouldStopExtractingWhenTableEnds", () => {
  const markdown = `
| id | Compares |
|---|---|
| \`check-a\` | something |

Some other content here
| \`check-b\` | should not be extracted |
`.trim();

  const { ids } = extractIds(markdown, "| id | Compares |");
  assert.deepEqual([...ids], ["check-a"], "extraction stops at first blank line");
});

test("shouldConfirmRealDocumentsAreCoherentWithCodeToday", () => {
  const codeIds = new Set(CHECKS.map((check) => check.id));

  let documents = DOCUMENTS;

  const presentes = documents.filter((doc) => existsSync(path.join(raiz, doc.path)));
  assert.ok(presentes.length > 0, "algum documento registrado tem de existir, senao o caso nao afirma nada");
  documents = presentes;

  const documentResults = [];
  for (const doc of documents) {
    const fullPath = path.join(raiz, doc.path);
    const text = readFileSync(fullPath, "utf8");
    const result = extractIds(text, doc.header);
    documentResults.push({
      path: doc.path,
      ...result,
    });
  }

  const problems = checkConsistency(codeIds, documentResults);
  assert.equal(problems.length, 0,
    "real documents in the repository are coherent with CHECKS today — this test breaks when someone adds a check without updating all documents");
});

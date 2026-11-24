import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { getMessages } from "../../src/core/messages.js";
import { renderText, text } from "../../src/core/ui-text.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: RAIZ });

async function qual8De(codigo, arquivo) {
  const [resultado] = await eslint.lintText(codigo, { filePath: path.join(RAIZ, arquivo) });
  return resultado.messages.filter((m) => m.message.startsWith("QUAL-8"));
}

test("should report zero QUAL-8 messages over src and bin", async () => {
  const resultados = await eslint.lintFiles(["src/**/*.js", "bin/**/*.js"]);
  const achados = resultados.flatMap((r) =>
    r.messages
      .filter((m) => m.message.startsWith("QUAL-8"))
      .map((m) => `${path.relative(RAIZ, r.filePath)}:${m.line} ${m.message}`),
  );
  assert.deepEqual(achados, []);
});

test("should flag new Error", async () => {
  const msgs = await qual8De('throw new Error("x");', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a class extending Error outside src/core/errors.js", async () => {
  const msgs = await qual8De("class Falha extends Error {}", "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should accept a class extending Error inside src/core/errors.js", async () => {
  const msgs = await qual8De("class LocalizedError extends Error {}", "src/core/errors.js");
  assert.equal(msgs.length, 0);
});

test("should flag new Error inside src/core/errors.js", async () => {
  const msgs = await qual8De('throw new Error("x");', "src/core/errors.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal with words in an output point", async () => {
  const msgs = await qual8De('console.log("duas palavras");', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal wrapped in three nested calls in an output point", async () => {
  const msgs = await qual8De('io.out(pc.bgCyan(pc.black(pc.bold(" mgr install "))));', "bin/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a template literal in process.stderr.write", async () => {
  const msgs = await qual8De("process.stderr.write(`erro ${a}`);", "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal in a clack p.log call", async () => {
  const msgs = await qual8De('p.log.warn("aviso grave");', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal in a message property", async () => {
  const msgs = await qual8De('const a = { message: "texto solto" };', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal in problems.push", async () => {
  const msgs = await qual8De('problems.push("texto solto");', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should flag a literal in warnings.push", async () => {
  const msgs = await qual8De('warnings.push("texto solto");', "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should still flag when an eslint-disable comment is on the line", async () => {
  const codigo = 'console.log("duas palavras"); // eslint-disable-line no-restricted-syntax\n';
  const msgs = await qual8De(`// eslint-disable-next-line no-restricted-syntax\n${codigo}`, "src/x.js");
  assert.equal(msgs.length, 1);
});

test("should not flag data inside JSON.stringify in an output point", async () => {
  const msgs = await qual8De('io.out(JSON.stringify({ a: "duas palavras" }));', "src/x.js");
  assert.equal(msgs.length, 0);
});

test("should not flag src/core/messages.js", async () => {
  const msgs = await qual8De('console.log("duas palavras");', "src/core/messages.js");
  assert.equal(msgs.length, 0);
});

test("should flag a literal with words hidden as a parameter of a message key call", async () => {
  const mensagens = await qual8De('console.log(M.errorPrefix("frase solta aqui"));\n', "src/commands/exemplo.js");
  assert.equal(mensagens.length, 1, "a loose sentence must not hide inside M.<key>(...)");
});

test("should not flag a named constant passed as data to a message key call", async () => {
  const mensagens = await qual8De("io.err(M.errorPrefix(M.unknownCommand(`${COMANDO} ${x}`)));\n", "src/commands/exemplo.js");
  assert.deepEqual(mensagens, []);
});

test("should still flag a loose sentence next to a message key call", async () => {
  const mensagens = await qual8De("io.err(M.errorPrefix(M.aborted), \"frase solta aqui\");\n", "src/commands/exemplo.js");
  assert.equal(mensagens.length, 1, "a loose sentence beside a message key call must be flagged");
});

test("should flag every piece of a sentence built by concatenation in an output point", async () => {
  const mensagens = await qual8De('io.out("manifesto " + file + " tem " + total + " problemas");\n', "src/commands/exemplo.js");
  assert.equal(mensagens.length, 3, "a sentence assembled from pieces is never localized whole");
});

test("should flag a concatenated literal that comes after a variable", async () => {
  const mensagens = await qual8De('console.log(file + " tem problema");\n', "src/x.js");
  assert.equal(mensagens.length, 1);
});

test("should not flag a message key call concatenated with data", async () => {
  const mensagens = await qual8De("io.out(M.errorPrefix(COMANDO) + sufixo);\n", "src/commands/exemplo.js");
  assert.deepEqual(mensagens, []);
});

for (const [forma, codigo] of [
  ["a ternary branch", 'io.out(pronto ? "tudo certo aqui" : M.falhou);\n'],
  ["an array element joined for output", 'io.out(["primeira linha solta", M.outra].join("\\n"));\n'],
  ["the object of a method call", 'console.log("frase solta aqui".trim());\n'],
  ["a message key call concatenated with a loose literal", 'io.out(M.chave(COMANDO) + " e mais texto");\n'],
  ["a literal inside a message key call inside a concatenation", 'io.out(M.chave("frase solta aqui") + sufixo);\n'],
]) {
  test(`should flag a literal with words in ${forma} at an output point`, async () => {
    const mensagens = await qual8De(codigo, "src/commands/exemplo.js");
    assert.equal(mensagens.length, 1);
  });
}

for (const [forma, codigo] of [
  ["a comparison operand", 'io.out(estado === "ausente" ? M.vazio : M.cheio);\n'],
  ["a JSON.stringify payload", 'io.out(JSON.stringify({ outcome: "no-install", nota: "texto de dado" }));\n'],
  ["a property value of an options object", 'p.select({ initialValue: "alongside", options: [{ value: "replace", label: M.rotulo }] });\n'],
]) {
  test(`should not flag ${forma} at an output point because it is data by position`, async () => {
    const mensagens = await qual8De(codigo, "src/commands/exemplo.js");
    assert.deepEqual(mensagens, []);
  });
}

for (const [ponto, codigo] of [
  ["a clack note", 'p.note("frase solta aqui", M.titulo);\n'],
  ["a glue out helper", 'out("frase solta aqui");\n'],
  ["a glue warn helper", 'warn(`frase solta ${x}`);\n'],
  ["the CLI bail", 'bail("frase solta aqui");\n'],
  ["a prompt call", 'ask.text({ message: M.pergunta, placeholder: M.exemplo, defaultValue: x }, "frase solta aqui");\n'],
  ["a spinner stop", 'spinner.stop("frase solta aqui");\n'],
  ["the hook writer", 'proc.escreverSync(fd, "frase solta aqui");\n'],
]) {
  test(`should flag a literal with words passed to ${ponto}`, async () => {
    const mensagens = await qual8De(codigo, "src/commands/exemplo.js");
    assert.equal(mensagens.length, 1);
  });
}

test("should not flag an array of identifiers given as a property value at an output point", async () => {
  const mensagens = await qual8De('ask.multiselect({ message: M.motores, initialValues: ["claude-code"] });\n', "src/exemplo.js");
  assert.deepEqual(mensagens, []);
});

test("should not flag a ternary of codes inside an object pushed into problems", async () => {
  const mensagens = await qual8De('problems.push({ field, kind: vazio ? "container" : "element", expected: "scope-key" });\n', "src/exemplo.js");
  assert.deepEqual(mensagens, []);
});

test("should flag a concatenated or ternary literal returned as message prose", async () => {
  const mensagens = await qual8De('const achado = { message: grave ? "frase grave" : "frase " + nome };\n', "src/exemplo.js");
  assert.equal(mensagens.length, 2);
});

test("should flag a ternary literal pushed into problems", async () => {
  const mensagens = await qual8De('problems.push(vazio ? "lista vazia aqui" : text("chaveCheia"));\n', "src/exemplo.js");
  assert.equal(mensagens.length, 1);
});

test("should not flag the key and data codes of a localized descriptor pushed into problems", async () => {
  const mensagens = await qual8De('problems.push(text(cheio ? "chaveCheia" : "chaveVazia", nome));\nproblems.push({ field, kind: "container", expected: "scope-key" });\n', "src/exemplo.js");
  assert.deepEqual(mensagens, []);
});

test("should not flag new Error in src/plugin.js but still flag an output literal there", async () => {
  const semErro = await qual8De("throw new Error(\"invalid skill name\");\n", "src/plugin.js");
  assert.deepEqual(semErro, [], "src/plugin.js is vendored by the registry and keeps its canonical English error");
  const comSaida = await qual8De("console.log(\"frase solta aqui\");\n", "src/plugin.js");
  assert.equal(comSaida.length, 1, "only the new Error selector is off for src/plugin.js");
});

const EN = "en";
const PT = "pt-BR";
const URL_INDEX = "https://e.test/index.json";

const renderiza = (idioma, chave, params) => renderText(getMessages(idioma), text(chave, ...params));

function conferem(casos) {
  return casos.map(([chave, idioma, params, literal]) => ({
    caso: `${idioma} ${chave}`,
    obtido: renderiza(idioma, chave, params),
    literal,
  }));
}

const COLA_DO_DOCTOR = [
  ["doctorEsperado", PT, ["o corpo de a como o pacote o traz"], "    esperado:    o corpo de a como o pacote o traz"],
  ["doctorEncontrado", PT, ["ausente"], "    encontrado:  ausente"],
  ["doctorResolvaCom", PT, ["mgr update"], "    resolva com: mgr update"],
  ["doctorSemCorrecao", PT, [], "    sem correção automática"],
];

const AUDIT = [
  ["auditSkillUnreadable", PT, ["spec-create"], "spec-create — SKILL.md não pôde ser lido"],
  ["auditNothingToDeclare", PT, ["spec-create"], "spec-create — nenhuma das quatro classes"],
  ["auditDeclared", PT, ["net, fs"], "    declarado:     net, fs"],
  ["auditInferred", PT, ["net, fs"], "    inferido:      net, fs"],
  ["auditUndeclared", PT, ["net"], "    não declarado: net"],
  ["auditFindingLine", PT, ["net", 7, "fetch(x)"], "      net · linha 7: fetch(x)"],
  [
    "auditFooterInference",
    PT,
    [],
    "A inferência é a fonte de verdade (ADR-0007); a declaração é a afirmação que ela confere.",
  ],
  [
    "auditFooterNoAttestation",
    PT,
    [],
    "Ausência de achado NÃO é atestado de segurança: a análise tem falsos positivos e negativos.",
  ],
];

const VERSOES = [
  [
    "runtimeVersionSkew",
    PT,
    ["0.7.0-beta.9", "0.7.0-beta.10"],
    "runtime em 0.7.0-beta.9, manifesto em 0.7.0-beta.10: rode npx mgr-method@0.7.0-beta.10 update",
  ],
  [
    "distVersionMismatch",
    PT,
    ["0.7.0-beta.9", "0.7.0-beta.10"],
    "dist/mgr.min.js foi gerado para 0.7.0-beta.9 e o pacote está em 0.7.0-beta.10: rode npm run build",
  ],
  [
    "nodeTooOld",
    PT,
    [20, "v18.0.0"],
    "mgr-method requer Node >= 20 (encontrado v18.0.0).\nAtualize o Node (ex.: nvm install 20) e rode de novo.",
  ],
  ["runtimeVersionLine", PT, ["0.7.0"], "mgr-method 0.7.0 (runtime do projeto)"],
];

const ERROS_DE_USO_EN = [
  ["unsafeRegistryFilePath", EN, ["../x"], 'unsafe file path in registry entry: "../x"'],
  ["skillFileUnavailable", EN, ["https://e.test/a", 404], "skill file unavailable: https://e.test/a (HTTP 404)"],
  ["fileChecksumMismatch", EN, ["a.md", "aaa", "bbb"], "checksum mismatch for a.md: expected aaa, got bbb"],
  [
    "aggregateChecksumMismatch",
    EN,
    ["@r/s", "aaa", "bbb"],
    "aggregate checksum mismatch for @r/s: expected aaa, got bbb",
  ],
  ["skillPackageNoManifest", EN, ["mgr-manifest.json", "@r/s"], "skill package has no mgr-manifest.json: @r/s"],
  [
    "pluginManifestIndexMismatch",
    EN,
    ["mgr-manifest.json", "@r/s", "1.0.0", "@r/t", "2.0.0"],
    "mgr-manifest.json does not match the registry index: index has @r/s@1.0.0, manifest has @r/t@2.0.0",
  ],
  [
    "pluginTargetHoldsOtherSkill",
    EN,
    ["@r/s", ".claude/skills/s", "mgr-manifest.json"],
    "cannot install @r/s: .claude/skills/s already holds another skill (no mgr-manifest.json for @r/s)",
  ],
  ["pluginExtendsCircular", EN, ["@r/s"], 'circular "extends" chain involving @r/s'],
  [
    "pluginLockedAtVersion",
    EN,
    ["@r/s", "1.0.0"],
    "@r/s is locked at 1.0.0; updating a plugin is not supported yet (remove it first)",
  ],
  [
    "pluginCollidesWithMethodSkill",
    EN,
    ["@r/s", "spec-create", ".claude/skills/spec-create"],
    '@r/s collides with the method skill "spec-create" in .claude/skills/spec-create. '
      + "Resolving it requires an interactive choice; run `mgr add` instead",
  ],
  ["addRequiresTarget", EN, [], "mgr add requires at least one engine target"],
  ["pluginNotInstalled", EN, ["@r/s"], "skill not installed as a plugin: @r/s"],
  [
    "pluginHasDependents",
    EN,
    ["@r/s", ["@r/a", "@r/b"]],
    "@r/s is extended by @r/a, @r/b; remove the extending skill first",
  ],
  [
    "lockfileEntryMismatch",
    EN,
    ["@r/s", "mgr-skills.lock", "1.0.0", "sha256-aa", "2.0.0", "sha256-bb"],
    "@r/s does not match mgr-skills.lock: locked 1.0.0 (sha256-aa), registry serves 2.0.0 (sha256-bb)",
  ],
  [
    "lockfileExtendsNotLocked",
    EN,
    ["mgr-skills.lock", "@r/a", "@r/b"],
    "mgr-skills.lock is inconsistent: @r/a extends @r/b, which is not locked",
  ],
  ["unknownEngine", EN, ["foo", ["claude-code", "copilot"]], "unknown engine: foo (expected claude-code | copilot)"],
  ["invalidSessionHookEngine", EN, ["foo", ["a", "b"]], "invalid engine for session hook: foo (expected a | b)"],
  ["invalidHookReportEngine", EN, ["foo", ["a", "b"]], "invalid engine for hook report: foo (expected a | b)"],
  ["pluginEngineInvalid", EN, ["foo", ["a", "b"]], "invalid engine for plugin install: foo (expected a | b)"],
  ["skillMdNoFrontmatterToInject", EN, [], "SKILL.md has no YAML frontmatter to inject into"],
  ["skillMdNoFrontmatterToInject", EN, [], "SKILL.md has no YAML frontmatter to inject into"],
  [
    "lockfileVersionUnsupported",
    EN,
    ["mgr-skills.lock", 2, 1],
    "unsupported lockfileVersion in mgr-skills.lock: 2 (expected 1)",
  ],
  [
    "lockfileInstallDirUnsafe",
    EN,
    ["mgr-skills.lock", "@r/s", '"../x"'],
    'unsafe install dir in mgr-skills.lock for @r/s: "../x"',
  ],
  [
    "lockfileReplacesInvalid",
    EN,
    ["mgr-skills.lock", "@r/s", '"Bad"'],
    'invalid "replaces" in mgr-skills.lock for @r/s: "Bad" (expected a method skill name in kebab-case)',
  ],
  ["skillNotInLockfile", EN, ["mgr-skills.lock", "@r/s"], "skill not in mgr-skills.lock: @r/s"],
  [
    "runtimeIgnoreFileValueInvalid",
    EN,
    [["versioned", "unversioned"], "x"],
    "runtimeIgnoreFileFor: value must be versioned | unversioned, got x",
  ],
  ["skillMdNoFrontmatterToMark", EN, ["spec-create"], "SKILL.md of spec-create has no YAML frontmatter to mark"],
  ["agentFileNoFrontmatter", EN, [], "agent file has no frontmatter to replace"],
  [
    "manifestInvalidSkills",
    EN,
    ["manifest.json", '{"a":1}'],
    'invalid "skills" in manifest.json: {"a":1} (expected an array of skill names)',
  ],
  ["manifestUnsafeSkillName", EN, ["manifest.json", '"../x"'], 'unsafe skill name in manifest.json: "../x"'],
  ["pluginSkillNameInvalid", EN, ['"x"'], 'invalid skill name: "x" (expected "@registry/skill" in kebab-case)'],
  [
    "pluginManifestFileInvalid",
    EN,
    ["mgr-manifest.json", [text("pluginManifestAuthorRequired"), text("pluginManifestTestedModelsInvalid")]],
    'invalid mgr-manifest.json: "author" is required and must be a non-empty string; '
      + '"testedModels" must be an array of model display names',
  ],
  [
    "registryNameInvalid",
    EN,
    ['"Bad Name"'],
    'invalid registry name: "Bad Name" (kebab-case, it is the "@name" scope of the skills)',
  ],
  [
    "registryUrlInvalid",
    EN,
    ['"ftp://x"'],
    'invalid registry URL: "ftp://x" (expected the http(s) URL of the registry index.json)',
  ],
  ["registryAlreadyConfigured", EN, ["acme"], "registry already configured: acme (remove it first to change the URL)"],
  ["registryNotConfigured", EN, ["acme"], "registry not configured: acme"],
  [
    "registryIndexUnavailable",
    EN,
    [URL_INDEX, 404],
    "registry index unavailable: https://e.test/index.json (HTTP 404)",
  ],
  ["registryIndexNotJson", EN, [URL_INDEX], "registry index is not valid JSON: https://e.test/index.json"],
  [
    "registryIndexInvalid",
    EN,
    [URL_INDEX, [text("indexNotObject"), text("indexRegistryInvalid")]],
    "invalid registry index at https://e.test/index.json: index must be a JSON object; "
      + '"registry" must be a non-empty string',
  ],
  [
    "registryNotConfiguredForScope",
    EN,
    ["acme"],
    'registry not configured for scope "@acme": run `mgr registry add acme <index-url>` first',
  ],
  ["skillNotFoundInRegistry", EN, ["acme", "tool"], 'skill not found in registry "acme": tool'],
  [
    "detectionModeAutoUnavailable",
    EN,
    [],
    'detectionMode "auto" is not supported: installing a skill always requires a human confirmation, and '
      + "`mgr audit` reports findings but does not attest security, so it cannot replace that confirmation. "
      + 'Use detectionMode "suggest" (the default) or "manual".',
  ],
  ["detectionModeInvalid", EN, ['"x"', ["ask", "never"]], 'invalid detectionMode: "x" (expected ask | never)'],
  [
    "modelShapeInvalid",
    EN,
    ["agents.review", '"opus"'],
    'invalid agents.review.model: "opus" (expected a map of engine to model, e.g. {"claude-code": "opus"})',
  ],
  ["configValueNotObject", EN, ["config", "7"], "invalid config: 7 (expected an object)"],
  ["configValueNotObject", EN, ["agents", '"x"'], 'invalid agents: "x" (expected an object)'],
  ["configValueNotObject", EN, ["agents.review", "[]"], "invalid agents.review: [] (expected an object)"],
  ["configValueNotObject", EN, ["agents.budget", "1"], "invalid agents.budget: 1 (expected an object)"],
  ["configValueNotObject", EN, ["lawsPreamble", "true"], "invalid lawsPreamble: true (expected an object)"],
  [
    "configEnabledInvalid",
    EN,
    ["agents.review", '"yes"'],
    'invalid agents.review.enabled: "yes" (expected true | false)',
  ],
  [
    "configEnabledInvalid",
    EN,
    ["lawsPreamble", '"yes"'],
    'invalid lawsPreamble.enabled: "yes" (expected true | false)',
  ],
  [
    "policyEffortInvalid",
    EN,
    ["agents.review", '"extremo"', ["low", "high", "inherit"]],
    'invalid agents.review.effort: "extremo" (expected low | high | inherit)',
  ],
  [
    "policyModelEngineInvalid",
    EN,
    ["agents.review", "claude-code", '""'],
    'invalid agents.review.model.claude-code: "" (expected a non-empty model name)',
  ],
  ["agentsNothingToWrite", EN, [], "nothing to write for agents (expected at least one intent)"],
  [
    "agentsIntentNothingToWrite",
    EN,
    ["review"],
    "nothing to write for agents.review (expected model, effort, or both)",
  ],
  ["agentIntentUnknown", EN, ['"x"', ["a", "b"]], 'unknown agent intent: "x" (expected a | b)'],
  ["agentIntentRequestedTwice", EN, ['"review"'], 'agent intent requested twice: "review"'],
  ["agentIntentsUnknown", EN, [["x", "y"], ["a", "b"]], "unknown agent intent(s): x, y (expected a | b)"],
  [
    "projectOriginUnknown",
    EN,
    ['"x"', ["greenfield", "brownfield"]],
    'unknown project origin: "x" (expected greenfield | brownfield)',
  ],
  [
    "runtimeVersioningUnknown",
    EN,
    ['"x"', ["versioned", "unversioned"]],
    'unknown runtime versioning: "x" (expected versioned | unversioned)',
  ],
  [
    "budgetTotalTokensInvalid",
    EN,
    ["-1"],
    "invalid agents.budget.totalTokens: -1 (expected a non-negative integer)",
  ],
  [
    "modelRequestInvalid",
    EN,
    ["review", '"opus"'],
    'invalid model request for review: "opus" (expected a map of engine to model)',
  ],
  [
    "effortRequestInvalid",
    EN,
    ["review", '"x"'],
    'invalid effort request for review: "x" (expected a level name)',
  ],
  ["fileNotObject", EN, ["config.local.json"], "config.local.json must contain a JSON object; fix the file by hand"],
  [
    "localProjectIdInvalid",
    EN,
    ["config.local.json", '""'],
    'invalid projectId in config.local.json: "" (expected a non-empty string)',
  ],
  ["projectIdInvalid", EN, ['""'], 'invalid projectId: "" (expected a non-empty string)'],
  [
    "initialsValueInvalid",
    EN,
    ['"X"'],
    'invalid initials: "X" (expected 2 to 4 lowercase letters a-z)',
  ],
];

const CANCELAMENTO = [
  ["installCancelled", EN, ["@r/s"], "installation canceled by the user: @r/s"],
];

const INVARIANTES = [
  [
    "ignoreFileInvalid",
    EN,
    ["install", "x"],
    'install: ignoreFile must be "write" or "omit", got x',
  ],
  [
    "addRequiresConfirmCallback",
    EN,
    [],
    "mgr add requires a human confirmation callback (there is no bypass in this phase)",
  ],
  [
    "invariantFindingConditionInvalid",
    PT,
    ["x", "skill-declarada, skill-orfa"],
    'condição inválida: "x"; valores válidos são skill-declarada, skill-orfa',
  ],
  ["invariantFindingNoCode", PT, [], "achado sem `code`"],
  [
    "invariantFindingSeverityInvalid",
    PT,
    ["fatal", ["error", "warning"]],
    'achado com severidade inválida: "fatal" (use error | warning)',
  ],
  ["invariantFindingNoMessage", PT, ["SPEC-1"], "achado SPEC-1 sem `message`"],
  [
    "invariantFindingNoRemediation",
    PT,
    ["SPEC-1"],
    "achado SPEC-1 sem `remediation`: todo achado diz o que fazer, nunca só o que está errado",
  ],
  [
    "invariantFindingNoExample",
    PT,
    ["SPEC-1"],
    "achado SPEC-1 sem `example`: todo achado mostra a forma conforme",
  ],
];

const ERROS_DE_USO_PT = [
  [
    "unknownArchitecture",
    PT,
    ["x", ["clean", "hexagonal"]],
    "arquitetura desconhecida: x (use clean, hexagonal)",
  ],
  ["bundleResourceMissing", PT, ["skills", "/p/skills"], "recurso do MGR ausente: skills (esperado em /p/skills)"],
  [
    "managedBlockNoClosingLine",
    PT,
    ["CLAUDE.md"],
    "bloco do mgr-method sem linha de fechamento em CLAUDE.md; corrija o arquivo à mão",
  ],
  ["skillNotFoundOrNoSkillMd", PT, ["x"], "skill inexistente ou sem SKILL.md: x"],
  ["invalidEngine", PT, ["x"], "motor inválido: x"],
  ["unknownScope", PT, ["x"], "escopo desconhecido: x (use project | global)"],
  ["unknownScope", PT, ["x"], "escopo desconhecido: x (use project | global)"],
  ["noInstallationToUninstall", PT, [], "nenhuma instalação MGR encontrada — nada a desinstalar"],
];

const ACHADOS_DE_ARTEFATO = [
  [
    "artifactSpec0Message",
    PT,
    [],
    "spec sem o marcador de formato: as regras de critério não foram aplicadas",
  ],
  [
    "artifactSpec0Remediation",
    PT,
    [],
    "Acrescente o marcador na primeira linha para que a spec seja verificada. "
      + "Sem ele, nenhuma regra roda — nenhuma spec existente é reprovada por isto.",
  ],
  ["artifactSpec0Example", PT, [], "<!-- mgr-spec-format: 1 -->"],
  [
    "artifactSpec1Message",
    PT,
    [],
    "spec declara o formato, mas não tem nenhum critério de aceitação",
  ],
  [
    "artifactSpec1Remediation",
    PT,
    [],
    "Uma spec sem critério de aceitação não tem como ser verificada no fechamento. "
      + "Declare ao menos um, com identidade.",
  ],
  [
    "artifactSpec1Example",
    PT,
    [],
    "- [ ] **CA-1:** o comando sai com código 1 quando o plano tem dependência inexistente",
  ],
  [
    "artifactSpec2DuplicateMessage",
    PT,
    ["CA-1", 3],
    "identidade duplicada: `CA-1` já aparece na linha 3",
  ],
  [
    "artifactSpec2CollisionMessage",
    PT,
    ["CA-01", "CA-1", 3],
    "identidade duplicada: `CA-01` colide com `CA-1`, na linha 3",
  ],
  [
    "artifactSpec2Remediation",
    PT,
    [],
    "A identidade existe para ser citada numa reprovação. "
      + "Duas com o mesmo número tornam a citação ambígua — renumere.",
  ],
  ["artifactSpec2Example", PT, [], "- [ ] **CA-2:** <o próximo número livre>"],
  ["artifactSpec3Message", PT, ["CA-1"], "critério `CA-1` está vazio"],
  [
    "artifactSpec3Remediation",
    PT,
    [],
    "Enuncie o que se observa quando o critério é cumprido. Identidade sem enunciado não verifica nada.",
  ],
  ["artifactSpec3Example", PT, [], "- [ ] **CA-1:** os 10 planos existentes produzem zero erros"],
  [
    "artifactSpec4Message",
    PT,
    [["CA-3", "CA-4"]],
    "lacuna na numeração dos critérios: ausente(s) CA-3, CA-4",
  ],
  [
    "artifactSpec4Remediation",
    PT,
    [],
    "Confira se um critério foi removido sem renumerar. Se o buraco é intencional, ignore este aviso.",
  ],
  ["artifactSpec4Example", PT, [], "- [ ] **CA-1:** …\n- [ ] **CA-2:** …\n- [ ] **CA-3:** …"],
  [
    "artifactPlan0Message",
    PT,
    [],
    "plano sem o marcador de formato: as regras de presença não foram aplicadas",
  ],
  [
    "artifactPlan0Remediation",
    PT,
    [],
    "Acrescente o marcador na primeira linha para que o plano seja verificado por inteiro. "
      + "Sem ele, só as regras de consistência valem — nenhum plano existente é reprovado por isto.",
  ],
  ["artifactPlan0Example", PT, [], "<!-- mgr-plan-format: 1 -->"],
  [
    "artifactPlan1Message",
    PT,
    ["P0.9"],
    "depends_on aponta para `P0.9`, que não é uma task deste plano",
  ],
  [
    "artifactPlan1Remediation",
    PT,
    ["P0.9", ["P0.1", "P0.2"]],
    "Corrija o id, ou crie a task `P0.9`. Ids válidos aqui: P0.1, P0.2.",
  ],
  ["artifactPlan1Example", PT, [], "- **depends_on:** [P0.1, P0.2]"],
  [
    "artifactPlan2Message",
    PT,
    [["P0.1", "P0.2", "P0.1"]],
    "ciclo no DAG de dependências: P0.1 → P0.2 → P0.1",
  ],
  [
    "artifactPlan2Remediation",
    PT,
    [],
    "Quebre o ciclo: uma das tasks tem de poder começar sem a outra, ou as duas são a mesma task.",
  ],
  ["artifactPlan2Example", PT, [], "- **depends_on:** [P0.1]   (e P0.1 não depende desta)"],
  ["artifactPlan3Message", PT, [4, 3], "task com 4 arquivos; o teto é 3"],
  [
    "artifactPlan3Remediation",
    PT,
    [],
    "Quebre a task antes de executar — a granularidade existe para o trabalho caber num passo revisável.",
  ],
  ["artifactPlan3Example", PT, [], "- **files:** [src/a.js, test/a.test.js]"],
  ["artifactPlan4Message", PT, [["done_when", "artifact"]], "task sem done_when e sem artifact"],
  [
    "artifactPlan4Remediation",
    PT,
    [],
    "`artifact` declara o trilho — nome, forma, assinatura e QUANTIDADE exatos (L4.3). "
      + "`done_when` declara o critério observável que fecha a task.",
  ],
  [
    "artifactPlan4Example",
    PT,
    [],
    "- **artifact:** 1 módulo com parse(text)\n- **done_when:** o teste passa e falharia sem a regra",
  ],
  [
    "artifactPlan5Message",
    PT,
    [0, "P1.1", 1],
    "task de prioridade P0 depende de `P1.1`, que é P1",
  ],
  [
    "artifactPlan5Remediation",
    PT,
    [],
    "Confira se a prioridade está certa: bloqueante que espera complementar "
      + "normalmente indica que uma das duas está no bloco errado.",
  ],
  ["artifactPlan5Example", PT, [], "- **depends_on:** [P0.1]   (numa task P1.x)"],
  [
    "artifactPlan6Message",
    PT,
    ["feito", ["todo", "done"]],
    "status `feito` não é `todo` nem `done`",
  ],
  [
    "artifactPlan6Remediation",
    PT,
    [["todo", "done"]],
    "O vocabulário é fechado e em inglês, como as chaves: só `todo` e `done`. "
      + "Valor fora dele nunca conta como concluído, então a task será oferecida de novo.",
  ],
  ["artifactPlan6Example", PT, [], "- **status:** done"],
  [
    "artifactProv1Message",
    PT,
    ["[prd:x]", "prd"],
    "etiqueta malformada: `[prd:x]` usa o token `prd` e não tem a forma que a L1.10 declara",
  ],
  [
    "artifactProv1Remediation",
    PT,
    [],
    "Escreva a etiqueta numa das oito formas da L1.10. `prd` pede a seção, `adr` pede o número, "
      + "e `code` pede caminho e linha — linha começa em 1.",
  ],
  [
    "artifactProv1Example",
    PT,
    [],
    "A decisão veio daqui [prd:UC-1]\nO separador de bloco cercado vive aqui [code:src/core/markdown.js:1]",
  ],
  [
    "artifactProv2NoLineMessage",
    PT,
    ["src/a.js", 10, 99],
    "ponteiro quebrado: `src/a.js` tem 10 linha(s), e a etiqueta aponta para a 99",
  ],
  [
    "artifactProv2NoFileMessage",
    PT,
    ["src/a.js"],
    "ponteiro quebrado: `src/a.js` não existe em disco, a partir da raiz do repositório",
  ],
  [
    "artifactProv2Remediation",
    PT,
    [],
    "Reancore a etiqueta no lugar onde o fato vive hoje. "
      + "O caminho é relativo à raiz do repositório, e arquivo ignorado pelo git conta como existente.",
  ],
  [
    "artifactProvPointerExample",
    PT,
    [],
    "O separador de bloco cercado vive aqui [code:src/core/markdown.js:1]",
  ],
  [
    "artifactProv4Message",
    PT,
    ["../x.js"],
    "ponteiro para fora do projeto: `../x.js` escapa da raiz do repositório",
  ],
  [
    "artifactProv4Remediation",
    PT,
    [],
    "Ancore num caminho de dentro do projeto, relativo à raiz. "
      + "Um fato que vive fora do repositório não é conferível por quem clonar.",
  ],
  [
    "artifactProvPointerExample",
    PT,
    [],
    "O separador de bloco cercado vive aqui [code:src/core/markdown.js:1]",
  ],
  [
    "artifactProv3Message",
    PT,
    ["[A DEFINIR]"],
    "marca de pendência `[A DEFINIR]` ao fim da linha, numa feature com `06-completion.md`. "
      + "Este aviso detecta a POSIÇÃO da marca; ele não distingue uma pendência real de uma citação "
      + "que por acaso termina a linha",
  ],
  [
    "artifactProv3Remediation",
    PT,
    [],
    "Se é pendência, resolva-a ou diga por que ela sobrevive ao fechamento. "
      + "Se é citação, mova a marca para o meio da frase — fora do fim da linha, ela não é apontada.",
  ],
  [
    "artifactProv3Example",
    PT,
    [],
    "O prazo de migração do acervo ficou fora desta fatia, e a marca [A DEFINIR] citada aqui não é apontada.",
  ],
  [
    "artifactDoc3Message",
    PT,
    [],
    "fechamento sem a declaração do diff da documentação: "
      + "a Fase 6 pede a atualização incremental, e nada a registra aqui",
  ],
  [
    "artifactDoc3Remediation",
    PT,
    [],
    "Acrescente uma seção nomeando o que mudou na documentação do projeto, e os arquivos tocados. "
      + "O título é livre — a seção é reconhecida por conter `diff` e `sdd` ou `doc`.",
  ],
  [
    "artifactDoc3Example",
    PT,
    [],
    "## Diff do SDD\n\n- `docs/sdd/02-architecture.md` — o módulo novo entrou no diagrama",
  ],
  [
    "artifactDoc4Message",
    PT,
    ["Diff do SDD"],
    "a seção `Diff do SDD` não nomeia arquivo que exista nem declara que não houve alteração: "
      + "não há o que verificar",
  ],
  [
    "artifactDoc4Remediation",
    PT,
    [],
    "Nomeie os arquivos de documentação que a feature tocou, ou declare que nenhuma alteração foi "
      + "necessária — com a razão. Caminho que não resolve é o defeito que a DOC-2 da fonte única reprova.",
  ],
  [
    "artifactDoc4Example",
    PT,
    [],
    "## Diff do SDD\n\n- `03-contracts.md` — o comando novo entrou na tabela\n\nou\n\n"
      + "## Diff do SDD\n\nNenhuma alteração necessária: a feature não muda contrato nem arquitetura.",
  ],
];

const PROBLEMAS_DO_VALIDATOR = [
  [
    "skillIssueCompatibilityNotText",
    PT,
    ["a", 500],
    "a: `compatibility` tem de ser texto (o padrão define string de 1 a 500)",
  ],
  ["skillIssueCompatibilityTooLong", PT, ["a", 501, 500], "a: `compatibility` com 501 caracteres (> 500)"],
  [
    "skillIssueAllowedToolsYamlList",
    PT,
    ["a"],
    "a: `allowed-tools` como lista YAML: o padrão pede as ferramentas separadas por espaço numa linha",
  ],
  [
    "skillIssueAllowedToolsNotText",
    PT,
    ["a"],
    "a: `allowed-tools` tem de ser texto com as ferramentas separadas por espaço",
  ],
  [
    "skillIssueAllowedToolsEmpty",
    PT,
    ["a"],
    "a: `allowed-tools` presente e vazio: declare as ferramentas ou remova o campo",
  ],
  ["skillIssueMetadataEmpty", PT, ["a"], "a: `metadata` presente e vazio: declare as chaves ou remova o campo"],
  ["skillIssueMetadataNotMap", PT, ["a"], "a: `metadata` tem de ser um mapa de chave e valor, não texto"],
  [
    "skillIssueMetadataNotOneLevel",
    PT,
    ["a", "- x"],
    "a: `metadata` tem de ser um mapa de chave e valor de um nível; `- x` não é",
  ],
  ["skillIssueNoFrontmatter", PT, ["a"], "a: sem frontmatter YAML (--- ... ---)"],
  ["skillIssueFieldIsMap", PT, ["a", "name"], "a: `name` tem de ser texto, e veio como mapa"],
  ["skillIssueNoName", PT, ["a"], "a: frontmatter sem `name`"],
  ["skillIssueNameNotKebab", PT, ["a", "Bad_Name"], "a: `name` não é kebab-case: Bad_Name"],
  ["skillIssueNameDiffersFromFolder", PT, ["a", "b"], "a: `name` (b) difere do nome da pasta"],
  ["skillIssueNameTooLong", PT, ["a", 65, 64], "a: `name` com 65 caracteres (> 64)"],
  [
    "skillIssueDescriptionShort",
    PT,
    ["a"],
    "a: `description` ausente ou curta demais (o que faz E quando usar)",
  ],
  ["skillIssueTooManyLines", PT, ["a", 501, 500], "a: SKILL.md com 501 linhas (> 500); use references/"],
  ["skillIssueMissingSkillMd", PT, ["a"], "a: falta SKILL.md"],
];

const HANDOFF = [
  [
    "handoffTitle",
    PT,
    ["2026-11-16T10:00:00.000Z"],
    "## Hand-off automático — compactação de contexto em 2026-11-16T10:00:00.000Z",
  ],
  [
    "handoffOpeningManual",
    PT,
    ["claude-code"],
    "Gravado pelo hook de pré-compactação do `claude-code`. **Você pediu a compactação**, "
      + "e o método pôs o estado em disco antes de ela acontecer.",
  ],
  [
    "handoffOpeningAuto",
    PT,
    ["claude-code", "auto"],
    "Gravado pelo hook de pré-compactação do `claude-code`, gatilho `auto`. "
      + "**Não foi pedido por ninguém**: o motor anunciou que ia compactar, e o método pôs o estado em "
      + "disco antes.",
  ],
  [
    "handoffOpeningUnknownTrigger",
    PT,
    ["claude-code"],
    "Gravado pelo hook de pré-compactação do `claude-code`, gatilho desconhecido (o motor não o informou). "
      + "**Não foi pedido por ninguém**: o motor anunciou que ia compactar, e o método pôs o estado em "
      + "disco antes.",
  ],
  [
    "handoffFeature",
    PT,
    ["minha-feature", "specs/minha-feature/04-plan.md"],
    "**Feature:** `minha-feature` · plano em `specs/minha-feature/04-plan.md`",
  ],
  [
    "handoffTasks",
    PT,
    [5, 2],
    "**Tasks:** 5 no total, 2 com `status: done` declarado.",
  ],
  [
    "handoffNextTask",
    PT,
    ["P1.2", "1 módulo com parse(text)"],
    "**Próxima task:** `P1.2` — 1 módulo com parse(text)",
  ],
  [
    "handoffNextTaskNoArtifact",
    PT,
    ["P1.2"],
    "**Próxima task:** `P1.2` — sem artefato declarado",
  ],
  [
    "handoffNothingReady",
    PT,
    [],
    "**Próxima task:** nenhuma está pronta; as pendentes esperam dependência.",
  ],
  [
    "handoffArtifacts",
    PT,
    ["01-brief 02-prd -03-spec"],
    "**Artefatos em disco:** 01-brief 02-prd -03-spec",
  ],
  [
    "handoffManyFeatures",
    PT,
    ["`a`, `b`"],
    "**Havia mais de uma feature em andamento:** `a`, `b`. "
      + "Esta foi escolhida por ter o `05-execution.md` modificado mais recentemente — é desempate, "
      + "não certeza.",
  ],
  ["handoffChangedTitle", PT, [], "**Modificados e sem commit:**"],
  ["handoffUnknownTitle", PT, [], "### O que este hand-off NÃO sabe"],
  [
    "handoffUnknownBody",
    PT,
    [],
    "Ele foi montado por um hook, que **não vê a conversa**. O que foi decidido falando e ainda não "
      + "chegou ao disco **não está aqui** — nem a razão de decisões tomadas nesta sessão, nem o que estava "
      + "a meio caminho de ser escrito.",
  ],
  [
    "handoffSuggestion",
    PT,
    [],
    "**Sugestão:** abrir uma sessão nova e retomar por este arquivo, em vez de seguir numa janela já "
      + "compactada. Se algo importante foi decidido e não está escrito, escreva antes de continuar.",
  ],
];

const ACHADOS_DO_DOCTOR = [
  ["findingOrphanSkillExpected", PT, [], "declarada no manifesto, ou ausente do disco"],
  ["findingOrphanSkillFound", PT, [], "em disco e fora do manifesto"],
  ["findingMissingSkillExpected", PT, [], "presente, porque o manifesto a declara"],
  ["findingMissingAgentExpected", PT, [], "presente, porque o manifesto o declara"],
  ["findingMissingSharedExpected", PT, [], "presente, porque o conjunto instalado a exige"],
  [
    "findingArchitectureSkillExpected",
    PT,
    ["clean"],
    "presente, porque o manifesto declara a arquitetura clean",
  ],
  ["findingDivergentBodyExpected", PT, ["spec-create"], "o corpo de spec-create como o pacote o traz"],
  ["findingDivergentBodyFound", PT, [3], "difere a partir da linha 3 do corpo"],
  ["findingUnresolvedTokenExpected", PT, [], "todo token resolvido pelo install"],
  [
    "findingBodyCheckUnavailableExpected",
    PT,
    [],
    "manifesto na versão do pacote, para a comparação separar velho de adulterado",
  ],
  [
    "findingBodyCheckUnavailableFound",
    PT,
    ["0.7.0-beta.9", "0.7.0-beta.10"],
    "manifesto em 0.7.0-beta.9 e pacote em 0.7.0-beta.10: a divergência de corpo aqui é esperada",
  ],
  [
    "findingSourcesUnavailableExpected",
    PT,
    [],
    "as fontes do pacote (skills, `shared` e arquivos do runtime) ao alcance, para a comparação",
  ],
  [
    "findingSourcesUnavailableFound",
    PT,
    [],
    "as fontes do pacote não estão no projeto: o runtime copiado não as carrega",
  ],
  [
    "findingSharedCheckUnavailableExpected",
    PT,
    [],
    "manifesto na versão do pacote, para as fontes `shared` estarem disponíveis",
  ],
  [
    "findingSharedCheckUnavailableFound",
    PT,
    ["0.7.0-beta.9", "0.7.0-beta.10"],
    "manifesto em 0.7.0-beta.9 e pacote em 0.7.0-beta.10: a ausência de fonte `shared` aqui é esperada",
  ],
  ["findingRuntimeExpected", PT, [], "o runtime do MGR, com bin/mgr-runtime.js"],
  ["findingRuntimeEntryAbsent", PT, [], "bin/mgr-runtime.js ausente"],
  ["findingRuntimeDirAbsent", PT, [], "diretório do runtime ausente"],
  ["findingRuntimeVersionExpected", PT, ["0.7.0"], "versão 0.7.0, a do manifesto"],
  ["findingRuntimeVersionUnreadable", PT, [], "versão ilegível ou ausente"],
  [
    "findingRuntimeVersioningExpected",
    PT,
    [],
    "runtimeVersioning: versioned | unversioned, ou ausente",
  ],
  ["findingConfigUnreadable", PT, [], "config.json ilegível"],
  ["findingConfigValue", PT, ['"Versioned"'], 'valor "Versioned"'],
  [
    "findingIgnoreFileExpected",
    PT,
    [],
    "o arquivo de ignorar como o método o grava (runtimeVersioning: unversioned)",
  ],
  ["findingIgnoreFileDiffers", PT, [], "difere do que o método grava"],
  [
    "findingNoIgnoreFileExpected",
    PT,
    [],
    "sem arquivo de ignorar (runtimeVersioning: versioned)",
  ],
  ["findingAbsent", PT, [], "ausente"],
  ["findingPresent", PT, [], "presente"],
  [
    "findingRuntimeBodyExpected",
    PT,
    ["bin/mgr-runtime.js"],
    "bin/mgr-runtime.js do runtime como o pacote o traz",
  ],
  ["findingRuntimeBodyDiffers", PT, [], "difere do arquivo do pacote"],
  ["findingStaleInstallExpected", PT, ["0.7.0-beta.10"], "a versão do pacote, 0.7.0-beta.10"],
  ["findingBrokenHookExpected", PT, ["SessionStart"], "o binario de SessionStart presente"],
  ["findingBrokenHookFound", PT, ["/x/y.js"], "/x/y.js não existe"],
  ["findingLockfileUnavailableExpected", PT, [], "um lockfile, para haver o que comparar"],
  [
    "findingLockfileUnavailableFound",
    PT,
    [],
    "sem lockfile: o projeto não tem skill plugável",
  ],
  ["findingLockedAbsentExpected", PT, ["@r/s"], "@r/s instalada, porque o lockfile a trava"],
];

const PROBLEMAS_DO_MANIFESTO_DE_PLUGIN = [
  ["pluginManifestNotObject", EN, [], "manifest must be a JSON object"],
  [
    "pluginManifestNameInvalid",
    EN,
    ['"x"'],
    '"name" must be namespaced "@registry/skill" in kebab-case (got "x")',
  ],
  [
    "pluginManifestVersionInvalid",
    EN,
    ['"1"'],
    '"version" must be semver "MAJOR.MINOR.PATCH" (got "1")',
  ],
  ["pluginManifestAuthorRequired", EN, [], '"author" is required and must be a non-empty string'],
  [
    "pluginManifestDescriptionInvalid",
    EN,
    [40, 1024],
    '"description" must be a string of 40-1024 characters stating what the skill does and when to use it',
  ],
  [
    "pluginManifestCategoryInvalid",
    EN,
    [["a", "b"], '"z"'],
    '"category" must be one of: a, b (got "z")',
  ],
  [
    "pluginManifestCompatibilityInvalid",
    EN,
    [],
    '"compatibility" must be an object with an "mgr" version range string, e.g. {"mgr": ">=0.6.0"}',
  ],
  [
    "pluginManifestExtendsInvalid",
    EN,
    ['"x"'],
    '"extends" must be a namespaced skill name "@registry/skill" or null (got "x")',
  ],
  ["pluginManifestPermissionsInvalid", EN, [["a", "b"]], '"permissions" must be an array of: a, b'],
  [
    "pluginManifestCapabilitiesInvalid",
    EN,
    [],
    '"capabilities" must be an object with optional "requires" and "optional" string arrays',
  ],
  [
    "pluginManifestModelInvalid",
    EN,
    [],
    '"model" must map platform to a model display name, e.g. {"claude-code": "sonnet"}',
  ],
  [
    "pluginManifestEffortInvalid",
    EN,
    [["low", "high"], '"x"'],
    '"effort" must be one of: low, high (got "x")',
  ],
  [
    "pluginManifestEcosystemsInvalid",
    EN,
    [],
    '"ecosystems" must be an array of kebab-case project ecosystem tokens, e.g. ["java", "postgres"]',
  ],
  [
    "pluginManifestTestedModelsInvalid",
    EN,
    [],
    '"testedModels" must be an array of model display names',
  ],
];

const PROBLEMAS_DO_INDICE = [
  ["indexNotObject", EN, [], "index must be a JSON object"],
  ["indexVersionUnsupported", EN, ["2"], 'unsupported "indexVersion": 2 (expected 1)'],
  ["indexRegistryInvalid", EN, [], '"registry" must be a non-empty string'],
  [
    "indexCategoriesInvalid",
    EN,
    [],
    '"categories" must be an object mapping category to skill entries',
  ],
  ["indexCategoryNotArray", EN, ["tools"], 'category "tools" must be an array'],
  ["indexEntryNameInvalid", EN, ["@r/s", "tools"], '@r/s: invalid "name"'],
  ["indexEntryVersionMissing", EN, ["@r/s", "tools"], '@r/s: missing "version"'],
  ["indexEntryVersionMissing", EN, [undefined, "tools"], '<entry in tools>: missing "version"'],
  ["indexEntryDescriptionMissing", EN, ["@r/s", "tools"], '@r/s: missing "description"'],
  ["indexEntryChecksumInvalid", EN, ["@r/s", "tools"], '@r/s: "checksum" must be "sha256-<hex>"'],
  [
    "indexEntryFilesInvalid",
    EN,
    ["@r/s", "tools"],
    '@r/s: "files" must be a non-empty array of {path, url, sha256}',
  ],
];

const FAMILIAS = [
  ["the 4 doctor glue labels in pt-BR", COLA_DO_DOCTOR, 4],
  ["the 8 audit lines in pt-BR", AUDIT, 8],
  ["the version and Node messages in pt-BR", VERSOES, 4],
  ["the usage errors that were English, in English", ERROS_DE_USO_EN, 67],
  ["installCancelled in English", CANCELAMENTO, 1],
  ["the invariants in their original language", INVARIANTES, 8],
  ["the usage errors that were pt-BR, in pt-BR", ERROS_DE_USO_PT, 8],
  ["the artifact finding texts in pt-BR", ACHADOS_DE_ARTEFATO, 56],
  ["the 17 validator problems in pt-BR", PROBLEMAS_DO_VALIDATOR, 17],
  ["the hand-off texts in pt-BR", HANDOFF, 15],
  ["the 36 doctor finding texts in pt-BR", ACHADOS_DO_DOCTOR, 36],
  ["the plugin manifest problems in English", PROBLEMAS_DO_MANIFESTO_DE_PLUGIN, 14],
  ["the registry index problems in English", PROBLEMAS_DO_INDICE, 11],
];

const TOTAL_DE_CASOS = 249;

test("should keep the HEAD comparison table at 249 cases so it never shrinks in silence", () => {
  const total = FAMILIAS.reduce((soma, [, casos]) => soma + casos.length, 0);
  assert.equal(total, TOTAL_DE_CASOS);
});

for (const [nome, casos, quantidade] of FAMILIAS) {
  test(`should hold ${quantidade} cases for ${nome}`, () => {
    assert.equal(casos.length, quantidade);
  });

  test(`should render ${nome} byte for byte equal to the literal transcribed from HEAD feee3b4 or to its correction ratified on 2026-11-18 or on 2026-11-24`, () => {
    for (const { caso, obtido, literal } of conferem(casos)) {
      assert.equal(obtido, literal, caso);
    }
  });
}

test("should render the unknown runtime version as one whole sentence in each language", () => {
  assert.equal(renderiza(PT, "runtimeVersionLineUnknown", []), "mgr-method, versão desconhecida (runtime do projeto)");
  assert.equal(renderiza(EN, "runtimeVersionLineUnknown", []), "mgr-method, version unknown (project runtime)");
});

test("should render fileNotJson without the JSON.parse text of the platform (P-10)", () => {
  assert.equal(renderiza(EN, "fileNotJson", ["config.local.json"]), "config.local.json is not valid JSON; fix the file by hand");
  assert.equal(renderiza(PT, "fileNotJson", ["config.local.json"]), "config.local.json não é um JSON válido; corrija o arquivo à mão");
});

test("should render noInstallationToUpdate with the lifecycle command instead of the literal mgr install", () => {
  const comCicloDeVida = { lifecycle: "npx mgr-method" };
  assert.equal(
    renderText(getMessages(EN, comCicloDeVida), text("noInstallationToUpdate")),
    "no MGR installation found — run `npx mgr-method install` first",
  );
  assert.equal(
    renderText(getMessages(PT, comCicloDeVida), text("noInstallationToUpdate")),
    "nenhuma instalação MGR encontrada — rode `npx mgr-method install` antes",
  );
  assert.equal(
    renderiza(EN, "noInstallationToUpdate", []),
    "no MGR installation found — run `mgr install` first",
  );
  assert.equal(
    renderiza(PT, "noInstallationToUpdate", []),
    "nenhuma instalação MGR encontrada — rode `mgr install` antes",
  );
});

test("should render the English DOC-3 and DOC-4 examples with the title SDD diff, not a Portuguese title", () => {
  assert.equal(
    renderiza(EN, "artifactDoc3Example", []),
    "## SDD diff\n\n- `docs/sdd/02-architecture.md` — the new module entered the diagram",
  );
  assert.equal(
    renderiza(EN, "artifactDoc4Example", []),
    "## SDD diff\n\n- `03-contracts.md` — the new command entered the table\n\nor\n\n"
      + "## SDD diff\n\nNo change needed: the feature changes neither contract nor architecture.",
  );
});

const IGUAIS_POR_DESENHO = new Map([
  ["planConfig", "layout with a technical term"], ["planSkillsDir", "layout with a technical term"],
  ["planSkills", "layout with a technical term"], ["planHooks", "layout with a technical term"],
  ["planAgentIntent", "layout only"], ["statusConfig", "layout with a technical term"],
  ["statusSkillsDir", "layout with a technical term"], ["statusSkills", "layout with a technical term"],
  ["statusPluginsTitle", "layout with a technical term"], ["statusPluginItem", "layout only"],
  ["statusGate", "layout with a technical term"], ["pluginProposalName", "layout with a technical term"],
  ["pluginProposalChecksum", "layout with a technical term"], ["pluginsAvailableItem", "layout only"],
  ["specValidateHeader", "layout only"], ["specValidateItem", "layout only"],
  ["specNextTask", "layout only"], ["specNextFile", "layout only"],
  ["specNextSkill", "layout with a technical term"], ["tokensTotal", "layout with a technical term"],
  ["agentsIntent", "layout only"],
  ["specStatusRoot", "layout only"], ["specStatusLine", "layout only"],
  ["instructionsStateLine", "layout only"], ["artifactSpec0Example", "code example"],
  ["artifactSpec4Example", "code example"], ["artifactPlan0Example", "code example"],
  ["artifactPlan1Example", "code example"], ["artifactPlan3Example", "code example"],
  ["artifactPlan6Example", "code example"], ["installIntro", "command name"],
  ["addIntro", "command name"], ["versionLine", "product name and version"],
  ["existingSkillsLine", "layout with a technical term"], ["statusInstallSummary", "product name and version"],
]);

const AMOSTRA = "\u0001";
const renderizarAmostra = (valor) => {
  if (typeof valor === "string") return valor;
  for (const arg of [AMOSTRA, [AMOSTRA], 1]) {
    try {
      const texto = valor(arg, arg, arg, arg, arg, arg);
      if (typeof texto === "string") return texto;
    } catch {
      continue;
    }
  }
  return null;
};

test("should render every message key differently in en and pt-BR unless it is equal by design", () => {
  const en = getMessages("en");
  const pt = getMessages("pt-BR");
  const iguais = Object.keys(en)
    .filter((chave) => chave in pt && renderizarAmostra(en[chave]) !== null)
    .filter((chave) => renderizarAmostra(en[chave]) === renderizarAmostra(pt[chave]));
  const naoDeclaradas = iguais.filter((chave) => !IGUAIS_POR_DESENHO.has(chave));
  assert.deepEqual(naoDeclaradas, [],
    "a key with the same text in both tables is an untranslated sentence unless it is declared equal by design (QUAL-8)");
});

test("should keep the equal-by-design list exact so it never hides a translated key", () => {
  const en = getMessages("en");
  const pt = getMessages("pt-BR");
  const desatualizadas = [...IGUAIS_POR_DESENHO.keys()]
    .filter((chave) => !(chave in en) || renderizarAmostra(en[chave]) !== renderizarAmostra(pt[chave]));
  assert.deepEqual(desatualizadas, [], "a listed key that now differs must leave the list, or the list stops proving anything");
});

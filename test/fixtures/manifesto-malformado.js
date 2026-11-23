import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tempDir } from "../../scripts/lib/tmp.mjs";

const BIN = fileURLToPath(new URL("../../bin/mgr.js", import.meta.url));

const FORMAS_COMUNS = [["objeto", {}], ["string", "x"], ["numero", 7], ["booleano", true]];
export const formasLetaisDoManifesto = () => [
  ...["skills", "skillsDirs", "engines", "agents"]
    .flatMap((campo) => FORMAS_COMUNS.map(([forma, valor]) => ({ rotulo: `${campo} ${forma}`, campo, valor }))),
  { rotulo: "skillsDirs com elemento numerico", campo: "skillsDirs", valor: [1] },
  { rotulo: "agents com elemento numerico", campo: "agents", valor: [1] },
  { rotulo: "scope null", campo: "scope", valor: null },
  { rotulo: "scope ausente", campo: "scope", valor: undefined },
  { rotulo: "scope bogus", campo: "scope", valor: "bogus" },
  { rotulo: "scope numero", campo: "scope", valor: 7 },
  { rotulo: "scope booleano", campo: "scope", valor: true },
  { rotulo: "scope objeto", campo: "scope", valor: {} },
];
export const VAZAMENTOS_DE_EXCECAO = [/is not a function/, /The "path" argument/, /TypeError/, /\.(map|filter|some|flatMap|forEach)\b/,
  /at .*\.js:\d+/, /manifest\.(skills|skillsDirs|engines|agents)\b/];

export const raizBruta = (conteudo) => ({ bruto: conteudo });

const campo = (nome, valor) => (manifesto) => ({ ...manifesto, [nome]: valor });
const manter = (manifesto) => manifesto;
const ATUALIZAR = ["-y"];
const INSTALAR_SEM_MOTOR = ["-y"];
const INSTALAR_COM_MOTOR = ["-y", "--engine", "claude-code"];
const SEM_IDIOMA_NO_MANIFESTO = { idiomaNoManifesto: false };
// O `CA-2` e o `CA-1` no `install`: o id do caso diz o criterio que ele prova.
const NO_INSTALL = { "CA-1": "CA-2" };
const ESTES_DOIS = (id, plantar, extra = {}) => {
  const [criterio, rotulo] = id.split(/:(.*)/s);
  return [
    { id: `${id}:update`, comando: "update", args: ATUALIZAR, plantar, ...extra },
    { id: `${NO_INSTALL[criterio] ?? criterio}:${rotulo}:install`, comando: "install", args: INSTALAR_COM_MOTOR, plantar, ...extra },
  ];
};
const EXISTENTE_NO_TESTE_DE_IDIOMA = "test/e2e/output-language.test.js";

export const CASOS_DE_CLI = [
  ...ESTES_DOIS("CA-1:skillsDirs string", campo("skillsDirs", "x")),
  ...ESTES_DOIS("CA-1:skillsDirs array com elemento numerico", campo("skillsDirs", [1])),
  ...ESTES_DOIS("CA-3:agents objeto", campo("agents", { a: 1 })),
  ...ESTES_DOIS("CA-3:agents array com elemento numerico", campo("agents", [1])),
  ...ESTES_DOIS("CA-3:scope ausente", campo("scope", undefined)),
  ...ESTES_DOIS("CA-3:scope bogus", campo("scope", "bogus"), { jaCoberto: `${EXISTENTE_NO_TESTE_DE_IDIOMA}: repair announcement` }),
  ...ESTES_DOIS("CA-4:agentsDirs string", campo("agentsDirs", "x")),
  { id: "CA-5:update controle valido", comando: "update", args: ATUALIZAR, plantar: manter },
  { id: "CA-6:update engines numero", comando: "update", args: ATUALIZAR, plantar: campo("engines", 7) },
  { id: "CA-6:update engines objeto", comando: "update", args: ATUALIZAR, plantar: campo("engines", {}) },
  ...ESTES_DOIS("CA-7:engines numero com motor", campo("engines", 7)),
  { id: "CA-7:install engines numero sem motor", comando: "install", args: INSTALAR_SEM_MOTOR, plantar: campo("engines", 7) },
  { id: "CA-7:install engines objeto sem motor", comando: "install", args: INSTALAR_SEM_MOTOR, plantar: campo("engines", {}) },
  {
    id: "CA-8:update architecture numero", comando: "update", args: ATUALIZAR, plantar: campo("architecture", 7),
    jaCoberto: `${EXISTENTE_NO_TESTE_DE_IDIOMA}: refusal block`,
  },
  { id: "CA-8:update architecture mvc", comando: "update", args: ATUALIZAR, plantar: campo("architecture", "mvc") },
  { id: "CA-9:update language array com elemento numerico", comando: "update", args: ATUALIZAR, plantar: campo("language", [1]) },
  { id: "CA-9:update optional string", comando: "update", args: ATUALIZAR, plantar: campo("optional", "x") },
  { id: "CA-9:update optional array com elemento numerico", comando: "update", args: ATUALIZAR, plantar: campo("optional", [1]) },
  { id: "CA-9:update allSkills string", comando: "update", args: ATUALIZAR, plantar: campo("allSkills", "sim") },
  {
    id: "CA-9:update userLanguage numero", comando: "update", args: ATUALIZAR, plantar: campo("userLanguage", 7),
    ...SEM_IDIOMA_NO_MANIFESTO,
  },
  { id: "CA-9:update language cobol", comando: "update", args: ATUALIZAR, plantar: campo("language", "cobol") },
  { id: "CA-9:install language cobol", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("language", "cobol") },
  {
    id: "CA-10:install architecture numero sem flag", comando: "install", args: INSTALAR_COM_MOTOR,
    plantar: campo("architecture", 7), jaCoberto: `${EXISTENTE_NO_TESTE_DE_IDIOMA}: refusal block`,
  },
  { id: "CA-10:install architecture mvc sem flag", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("architecture", "mvc") },
  { id: "CA-10:install language array sem flag", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("language", [1]) },
  {
    id: "CA-10:install userLanguage numero sem flag", comando: "install", args: INSTALAR_COM_MOTOR,
    plantar: campo("userLanguage", 7), ...SEM_IDIOMA_NO_MANIFESTO,
  },
  { id: "CA-10:install optional string sem flag", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("optional", "x") },
  { id: "CA-10:install optional array sem flag", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("optional", [1]) },
  { id: "CA-10:install allSkills string sem flag", comando: "install", args: INSTALAR_COM_MOTOR, plantar: campo("allSkills", "sim") },
  { id: "CA-11:install controle valido", comando: "install", args: INSTALAR_COM_MOTOR, plantar: manter },
  ...ESTES_DOIS("CA-12:userLanguage ausente", campo("userLanguage", undefined), SEM_IDIOMA_NO_MANIFESTO),
  {
    id: "CA-13:install sem motor com dois motores", comando: "install", args: INSTALAR_SEM_MOTOR,
    plantar: campo("engines", ["claude-code", "copilot"]),
  },
  { id: "CA-14:update architecture null", comando: "update", args: ATUALIZAR, plantar: campo("architecture", null) },
  { id: "CA-15:update com --engine e engines numero", comando: "update", args: ["-y", "--engine", "copilot"], plantar: campo("engines", 7) },
  {
    id: "CA-16:update engines vazio sem engine", comando: "update", args: ATUALIZAR,
    plantar: (manifesto) => ({ ...manifesto, engine: undefined, engines: [] }),
  },
  {
    id: "CA-16:install engines vazio sem engine", comando: "install", args: INSTALAR_SEM_MOTOR,
    plantar: (manifesto) => ({ ...manifesto, engine: undefined, engines: [] }),
  },
  {
    id: "CA-16:update engine legado copilot", comando: "update", args: ATUALIZAR,
    plantar: (manifesto) => ({ ...manifesto, engine: "copilot", engines: [] }),
  },
  ...ESTES_DOIS("CA-18:model bogus", campo("model", "bogus")),
  ...ESTES_DOIS("CA-18:model self-contained-runtime", campo("model", "self-contained-runtime")),
  ...ESTES_DOIS("CA-18:model self-contained-layered-config", campo("model", "self-contained-layered-config")),
  ...ESTES_DOIS("CA-21:skills objeto", campo("skills", { a: 1 })),
  ...ESTES_DOIS("CA-21:skills com nome inseguro", campo("skills", ["../x"])),
  ...ESTES_DOIS("CA-22:raiz string", () => raizBruta("\"x\""), SEM_IDIOMA_NO_MANIFESTO),
  ...ESTES_DOIS("CA-22:raiz array", () => raizBruta("[]"), SEM_IDIOMA_NO_MANIFESTO),
  ...ESTES_DOIS("CA-23:raiz null", () => raizBruta("null"), SEM_IDIOMA_NO_MANIFESTO),
  ...ESTES_DOIS("CA-24:vazio", () => raizBruta(""), SEM_IDIOMA_NO_MANIFESTO),
  ...ESTES_DOIS("CA-24:json corrompido", () => raizBruta("{\"skills\": [\"a\","), SEM_IDIOMA_NO_MANIFESTO),
  ...["string:\"x\"", "array:[]", "null:null"].flatMap((entrada) => {
    const [rotulo, conteudo] = entrada.split(":");
    return ["status", "uninstall", "instructions"].map((comando) => ({
      id: `CA-22:${comando} raiz ${rotulo}`,
      comando,
      args: comando === "uninstall" ? ["-y"] : [],
      plantar: () => raizBruta(conteudo),
      ...SEM_IDIOMA_NO_MANIFESTO,
    }));
  }),
  { id: "CA-29:doctor optional objeto", comando: "doctor", args: [], plantar: campo("optional", {}) },
  { id: "CA-29:doctor allSkills string", comando: "doctor", args: [], plantar: campo("allSkills", "sim") },
  { id: "CA-29:doctor userLanguage numero", comando: "doctor", args: [], plantar: campo("userLanguage", 7), ...SEM_IDIOMA_NO_MANIFESTO },
  { id: "CA-29:doctor architecture mvc", comando: "doctor", args: [], plantar: campo("architecture", "mvc") },
  { id: "CA-29:doctor language array", comando: "doctor", args: [], plantar: campo("language", [1]) },
  { id: "CA-29:doctor agentsDirs objeto", comando: "doctor", args: [], plantar: campo("agentsDirs", {}) },
  { id: "CA-29:doctor skills com nome inseguro", comando: "doctor", args: [], plantar: campo("skills", ["../x"]) },
  { id: "CA-30:uninstall skillsDirs absoluto de fora", comando: "uninstall", args: ["-y"], plantar: campo("skillsDirs", ["/nao-existe-mgr/isca"]) },
  { id: "CA-30:uninstall agentsDirs de fora", comando: "uninstall", args: ["-y"], plantar: campo("agentsDirs", ["../isca"]) },
  {
    id: "CA-30:uninstall skillsDirs relativo de fora", comando: "uninstall", args: ["-y"], plantar: campo("skillsDirs", ["../fora"]),
    jaCoberto: `${EXISTENTE_NO_TESTE_DE_IDIOMA}: ignored uninstall path line`,
  },
  { id: "CA-31:uninstall engines numero", comando: "uninstall", args: ["-y"], plantar: campo("engines", 7) },
  {
    id: "CA-17:install custom com pasta dentro do projeto", comando: "install",
    args: (repo) => ["-y", "--skills-dir", path.join(repo, "minhas-skills")], plantar: manter,
  },
  {
    id: "CA-17:update custom declarado", comando: "update", args: ATUALIZAR,
    plantar: (m) => ({ ...m, engines: ["custom"], skillsDirs: ["minhas-skills"] }),
  },
  {
    id: "CA-17:uninstall custom declarado", comando: "uninstall", args: ["-y"],
    plantar: (m) => ({ ...m, engines: ["custom"], skillsDirs: ["minhas-skills"] }),
  },
];

export const CASOS_FORA_DO_LACO = [
  { id: "CA-19", razao: "o fluxo interativo exige terminal e nao e saida de CLI com -y; e conferido por script -qec na P2.5" },
  { id: "CA-20", razao: "o fluxo interativo (allSkills herdado) exige terminal; o adaptador de prompts e verificado na P2.5" },
  { id: "CA-25", razao: "readManifest lanca UsageError, sem saida de CLI; coberto por renderError nas duas tabelas em teste proprio" },
  { id: "CA-28", razao: "trava que le o texto das fontes, sem executar a CLI" },
  { id: "CA-26", razao: "propriedade de equivalencia entre doctor e update, sem texto proprio" },
  { id: "CA-27", razao: "ja coberto por tres testes de idioma de doctor neste arquivo (classes A, B e C)" },
  { id: "CA-32", razao: "migrateOld e chamado pela API, sem saida de CLI" },
  { id: "CA-33", razao: "ja coberto por teste proprio neste arquivo (rotulo [project]/[projeto])" },
];

export function rodar(cmd, dir, env = {}) {
  const home = tempDir("mgr-home-");
  try {
    const ambiente = { ...process.env, HOME: home, LC_ALL: "C", NO_COLOR: "1", ...env };
    for (const chave of ["LANG", "LANGUAGE", "LC_MESSAGES"]) delete ambiente[chave];
    const resultado = spawnSync("node", [BIN, ...cmd], { encoding: "utf8", cwd: dir, env: ambiente });
    return { code: resultado.status, stdout: `${resultado.stdout}`, stderr: `${resultado.stderr}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function controleValido() {
  const repo = tempDir("mgr-controle-");
  const { code, stderr } = rodar(["install", "--engine", "claude-code", "--language", "java", "--arch", "hexagonal",
    "--user-language", "pt-BR", "--project-id", "fixture", "-y", repo], repo);
  if (code !== 0) {
    rmSync(repo, { recursive: true, force: true });
    throw new Error(`fixture quebrada: install do controle saiu ${code}: ${stderr}`);
  }
  return repo;
}

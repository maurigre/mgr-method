import js from "@eslint/js";

// Globais do Node declarados a mao (em vez do pacote `globals`): sao poucos e explicitos,
// e mantem o projeto sem devDependency extra. Global novo em uso => `no-undef` acusa, e a
// correcao e acrescentar o nome aqui.
const globaisNode = {
  console: "readonly",
  process: "readonly",
  URL: "readonly",
  __MGR_BUILD_VERSION__: "readonly",
};

// Letras acentuadas enumeradas, sem intervalo `À-ÿ`: o intervalo inclui `×` e `÷`, que nao sao
// letra (guarda CLM-3 do check:claims).
const COM_PALAVRA = "/[A-Za-zÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç]{2}/";
const LITERAL = `Literal[value=${COM_PALAVRA}]`;
const TEMPLATE = `TemplateElement[value.raw=${COM_PALAVRA}]`;
const PONTOS_DE_SAIDA = [
  "CallExpression[callee.object.name='console']",
  "CallExpression[callee.object.name='io'][callee.property.name=/^(out|err)$/]",
  "CallExpression[callee.object.object.name='process'][callee.object.property.name=/^(stdout|stderr)$/][callee.property.name='write']",
  "CallExpression[callee.object.name='p']",
  "CallExpression[callee.object.object.name='p']",
  // Pontos de saida achados pelo review 3 (S1, caminho a): os ajudantes `out`/`info`/`warn` das
  // colas, o `bail` da CLI, os prompts (`ask.*`, `CLACK.*`), o spinner (`spinner.start`/`.stop`) e a
  // escrita do hook (`proc.*`, `escreverSync`).
  "CallExpression[callee.name=/^(out|info|warn|bail|escreverSync)$/]",
  "CallExpression[callee.object.name=/^(ask|CLACK|spinner|proc)$/]",
];
const PROSA_COMO_DADO = [
  "Property[key.name=/^(message|remediation|example)$/]",
  "CallExpression[callee.object.name=/^(problems|warnings)$/][callee.property.name='push']",
];

// Literal em QUALQUER profundidade abaixo da raiz (achados #13 e S1 dos reviews de 2026-11-17): a
// forma por caminhos enumerados deixava escapar ternario, array, `"...".trim()`, chamada dentro de
// `+` e `+` dentro de `message:`. Fica fora so o literal que e dado pela POSICAO: operando de
// comparacao (`x === "ausente"`), argumento de qualquer `JSON.<metodo>(...)` (dado de maquina, DT-16)
// e, nos pontos de saida, valor ou chave de propriedade, inclusive array que e valor de propriedade
// (`value: "alongside"`, `initialValues: ["claude-code"]`). Dentro de `M.<chave>(...)` nao ha
// excecao: dado com palavra vira constante nomeada (decisao do autor, #13).
const DADO_PELA_POSICAO = ":not(BinaryExpression[operator=/^[!=]==?$/] > *):not(CallExpression[callee.object.name='JSON'] *)";
const FORA_DE_PROPRIEDADE = ":not(Property > *):not(Property > ArrayExpression > *)";
function abaixoDe(raiz) {
  const filtro = DADO_PELA_POSICAO + FORA_DE_PROPRIEDADE;
  return [`${raiz} ${LITERAL}${filtro}`, `${raiz} TemplateLiteral${filtro} > ${TEMPLATE}`];
}

// Prosa devolvida como dado (`message:`, `problems.push`): o literal direto, ou atravessando so
// `+`, ternario e `||`/`&&`. O que esta dentro de `text`/`say`/`descriptor` (os apelidos de
// `src/core/ui-text.js`) e chave e parametro de frase localizada, e o objeto empurrado carrega codigos.
const MONTAGEM = ":matches(BinaryExpression[operator='+'], ConditionalExpression, LogicalExpression)";
const LOCALIZADO = ":not(CallExpression[callee.name=/^(text|say|descriptor)$/] *)";
function prosaEm(raiz, { foraDeObjeto }) {
  // No `push`, o objeto empurrado carrega codigos (`kind: c ? "container" : "element"`); a prosa
  // dentro dele so pode estar em `message:`, que a regra propria ja olha.
  const filtro = DADO_PELA_POSICAO + LOCALIZADO + (foraDeObjeto ? ":not(ObjectExpression *)" : "");
  return [
    `${raiz} > ${LITERAL}`,
    `${raiz} > TemplateLiteral > ${TEMPLATE}`,
    `${raiz} ${MONTAGEM} > ${LITERAL}${filtro}`,
    `${raiz} ${MONTAGEM} > TemplateLiteral${filtro} > ${TEMPLATE}`,
  ];
}

function qual8Seletores({ comClasse, comNewError }) {
  const seletores = [
    ...(comNewError
      ? [["NewExpression[callee.name='Error']", "QUAL-8: new Error(...) proibido em src/ e bin/; use UsageError ou InvariantError (src/core/errors.js)"]]
      : []),
    ...(comClasse
      ? [["ClassDeclaration[superClass.name='Error']", "QUAL-8: classe que estende Error carrega texto proprio; estenda UsageError ou InvariantError"]]
      : []),
    [PONTOS_DE_SAIDA.flatMap(abaixoDe).join(", "), "QUAL-8: texto literal em ponto de saida; o texto vem de src/core/messages.js"],
    [PROSA_COMO_DADO.slice(0, 1).flatMap((r) => prosaEm(r, { foraDeObjeto: false })).join(", "), "QUAL-8: prosa em message/remediation/example; use text(...) de src/core/ui-text.js com chave de src/core/messages.js"],
    [PROSA_COMO_DADO.slice(1).flatMap((r) => prosaEm(r, { foraDeObjeto: true })).join(", "), "QUAL-8: prosa em problems/warnings.push; use descritor de src/core/messages.js"],
  ];
  return seletores.map(([selector, message]) => ({ selector, message }));
}

export default [
  {
    // `specs/` e gitignored (artefatos SDD locais, com arneses de medicao que nao sao do produto).
    ignores: ["dist/", "coverage/", ".claude/", ".mgr-core/runtime/", "node_modules/", "specs/"],
  },

  js.configs.recommended,

  // Nucleo (src/) e CLI moderno (bin/mgr.js): ESM.
  {
    files: ["src/**/*.js", "bin/mgr.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globaisNode,
    },
  },

  // INV-2 (CONSTITUTION §2.1 / ADR-0001): a dependencia e top-down, bin/ -> src/.
  {
    files: ["src/**/*.js"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/bin/**", "../bin/*"],
              message:
                "INV-2 (ADR-0001): src/ NUNCA importa bin/. A dependencia e top-down: bin/ -> src/.",
            },
          ],
        },
      ],
    },
  },

  // Runtime do projeto (ADR-0023): copiado para dentro de cada projeto, so pode depender de
  // node: e de modulos relativos. Dependencia de pacote externo quebraria o runtime sem o npm.
  {
    files: ["bin/mgr-runtime.js", "bin/hook-io.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globaisNode,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@clack/prompts",
              message: "o runtime do projeto so usa node: e modulos relativos (ADR-0023)",
            },
            {
              name: "picocolors",
              message: "o runtime do projeto so usa node: e modulos relativos (ADR-0023)",
            },
          ],
          patterns: [
            {
              group: ["@clack/*"],
              message: "o runtime do projeto so usa node: e modulos relativos (ADR-0023)",
            },
          ],
        },
      ],
    },
  },

  // Launcher: roda ANTES do guard de versao, entao precisa continuar ES5 — e ele que entrega a
  // mensagem legivel em Node < 22 em vez de um crash minificado. `ecmaVersion: 5` faz sintaxe
  // moderna virar erro de parse.
  {
    files: ["bin/mgr.cjs"],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: "commonjs",
      globals: {
        ...globaisNode,
        require: "readonly",
        module: "writable",
        __dirname: "readonly",
      },
    },
    // ES5 nao tem `catch` sem parametro (e do ES2019): o parametro e obrigatorio mesmo sem uso.
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },

  // QUAL-8 (DT-16 b): texto de interface so na camada de idioma (src/core/messages.js). `noInlineConfig`
  // fecha o desvio por comentario `eslint-disable`. `bin/mgr.cjs` nao casa `bin/**/*.js`: a guarda
  // dele e o teste de paridade do DT-22. `src/core/errors.js` so fica fora do seletor da classe que
  // estende `Error` (e onde a base `LocalizedError` nasce), pelo bloco proprio dele, mais abaixo.
  {
    files: ["src/**/*.js", "bin/**/*.js"],
    ignores: ["src/core/messages.js", "src/core/errors.js", "src/plugin.js"],
    linterOptions: { noInlineConfig: true },
    rules: { "no-restricted-syntax": ["error", ...qual8Seletores({ comClasse: true, comNewError: true })] },
  },
  // `src/plugin.js` e vendorizado como copia literal pelo mgr-registry (scripts/plugin-schema.mjs,
  // conferido byte a byte no CI dele) e nao pode importar nada do produto (restricao de arquitetura,
  // ADR-0033 decisao 8). Por isso o `parseSkillName` lanca `Error` com o texto canonico ingles do
  // contrato com o registry, e so o seletor de `new Error` fica fora. Esse texto nunca e mostrado:
  // todo chamador do MGR valida antes com `isSkillName` e lanca `UsageError`, ou captura o `Error` e o
  // troca por descritor da camada (a leitura do indice).
  {
    files: ["src/plugin.js"],
    linterOptions: { noInlineConfig: true },
    rules: { "no-restricted-syntax": ["error", ...qual8Seletores({ comClasse: true, comNewError: false })] },
  },
  {
    files: ["src/core/errors.js"],
    linterOptions: { noInlineConfig: true },
    rules: { "no-restricted-syntax": ["error", ...qual8Seletores({ comClasse: false, comNewError: true })] },
  },

  // Ferramentas de desenvolvimento do repo (fora do tarball npm).
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globaisNode,
    },
  },

  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globaisNode,
    },
  },

  // tmp-organizado (RN-7, P-6): diretorio temporario so por `tempDir` de `scripts/lib/tmp.mjs`, que cria
  // sob <os.tmpdir()>/mgr-method/<pid>-XXXXXX/ e apaga ao fim do processo. O proprio helper e a unica
  // excecao. `noInlineConfig` fecha o desvio por comentario `eslint-disable`.
  {
    files: ["test/**/*.js", "scripts/**/*.mjs"],
    ignores: ["scripts/lib/tmp.mjs"],
    linterOptions: { noInlineConfig: true },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "MemberExpression[property.name=/^(tmpdir|mkdtemp|mkdtempSync)$/]",
          "MemberExpression[computed=true][property.value=/^(tmpdir|mkdtemp|mkdtempSync)$/]",
          "ImportSpecifier[imported.name=/^(tmpdir|mkdtemp|mkdtempSync)$/]",
          "ObjectPattern > Property[key.name=/^(tmpdir|mkdtemp|mkdtempSync)$/]",
        ].map((selector) => ({
          selector,
          message:
            "temporario so por tempDir(prefixo) de scripts/lib/tmp.mjs (tmp-organizado): ele limpa ao fim do processo",
        })),
      ],
    },
  },
];

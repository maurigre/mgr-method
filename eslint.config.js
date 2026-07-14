import js from "@eslint/js";

// Globais do Node declarados a mao (em vez do pacote `globals`): sao poucos e explicitos,
// e mantem o projeto sem devDependency extra. Global novo em uso => `no-undef` acusa, e a
// correcao e acrescentar o nome aqui.
const globaisNode = {
  console: "readonly",
  process: "readonly",
  URL: "readonly",
};

export default [
  {
    ignores: ["dist/", "coverage/", ".claude/", "node_modules/"],
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
  },

  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globaisNode,
    },
  },
];

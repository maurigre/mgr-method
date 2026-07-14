// Gate de convencao de commit — CONSTITUTION §5.
// Base: @commitlint/config-conventional, que ja entrega type-enum, header-max-length: 100,
// body-max-line-length: 100 e subject-full-stop: never, identicos ao que a §5 exige.
//
// `subject-case` fica no DEFAULT de proposito: o default proibe o subject *comecar* maiusculo,
// que e o que a §5 pede. Forcar `lower-case` (subject inteiro minusculo) reprovaria commits
// legitimos do proprio historico, como "docs: inicializa SDD do projeto".

// A §5 proibe mencionar IA/assistente no commit. O alvo e a ATRIBUICAO de autoria/assistencia
// a uma IA — nao a palavra em si: este projeto instala skills para Claude Code e GitHub Copilot,
// e o historico tem commits legitimos citando ".claude/" (caminho de diretorio) e "copilot"
// (nome de motor). Casar /claude/i cru reprovaria esses commits validos.
// Nota: "ia" solto NAO entra no padrao — em portugues casaria com "autossuficiencia",
// "migracao", "vida".
const ASSISTENTES = "claude|copilot|chatgpt|gpt|anthropic|openai|gemini|\\bai\\b";

const PADROES_DE_ATRIBUICAO = [
  // Trailer de co-autoria atribuido a uma IA (o "Co-Authored-By: Claude ..." classico).
  new RegExp(`co-authored-by\\s*:.*(${ASSISTENTES}|\\bbot\\b)`, "i"),
  // "Generated with Claude", "gerado por IA", "assistido por Copilot", ...
  new RegExp(
    `(generated|created|written|assisted|gerado|criado|escrito|assistido)\\s+(with|by|com|por)\\s+[^\\n]*(${ASSISTENTES}|\\bia\\b)`,
    "i",
  ),
  // Emoji de robo, comum em assinaturas automaticas de agente.
  /\u{1F916}/u,
];

export default {
  extends: ["@commitlint/config-conventional"],

  plugins: [
    {
      rules: {
        "no-ai-mention": ({ raw }) => {
          const mensagemCrua = raw || "";
          const violado = PADROES_DE_ATRIBUICAO.some((padrao) => padrao.test(mensagemCrua));
          return [
            !violado,
            "a CONSTITUTION §5 proibe atribuir autoria ou assistencia de IA no commit " +
              "(ex.: trailer 'Co-Authored-By: Claude', 'Generated with ...'). " +
              "O commit credita apenas o autor humano.",
          ];
        },
      },
    },
  ],

  rules: {
    // §5: Conventional Commits SEM scope. O config-conventional deixa o scope opcional.
    "scope-empty": [2, "always"],
    // §5: linha em branco apos o header. O default e warning — warning nao e gate.
    "body-leading-blank": [2, "always"],
    "no-ai-mention": [2, "always"],
  },
};

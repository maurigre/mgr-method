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

// Caractere que nao pertence a mensagem de commit, no header OU no corpo.
//
// Duas familias, e as duas foram medidas em 2026-09-18:
//   - **nao-ASCII**: acento, emoji, travessao, aspas curvas. O autor pediu "sem caracteres especiais
//     e sem emoji", e a preferencia `commit_header_alphanumeric_only` diz o mesmo do header;
//   - **crase**: e ASCII, mas e marcacao de markdown. Formatar nome de campo como codigo e habito de
//     documento, nao de mensagem de commit — e nao tinha precedente: o historico aprovado usa ZERO
//     crases, contra 66 que apareceram numa unica fatia antes desta regra existir.
//
// O que NAO entra no padrao, de proposito: a pontuacao que o header usa de verdade. Medido em 211
// commits do historico: `:` (189 vezes, exigido pelo conventional commits), `-` (87), `.` (74),
// `/` (45), `(` e `)` (21 cada), `,` (20), `#` (19, dos merges), `_` (10). Proibir "tudo que nao e
// alfanumerico" reprovaria praticamente todo commit legitimo, e e o mesmo erro que o comentario do
// `subject-case` acima ja evitou uma vez.
//
// **Consequencia declarada:** 86 dos 211 headers do historico tem nao-ASCII e NAO passariam nesta
// regra. Ela vale para commit novo; nao reescreve o passado. A convencao muda a partir daqui.
// Por ponto de codigo, e nao por faixa em regex: `/[^\x00-\x7F]/` traz caractere de controle para
// dentro do padrao, e o eslint reprova com `no-control-regex` — com razao, porque faixa com controle
// e ilegivel. Comparar o ponto de codigo diz a mesma coisa em palavra.
const foraDoAscii = (texto) => [...texto].filter((caractere) => caractere.codePointAt(0) > 127);
const CRASE = "`";

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
        "no-special-chars": ({ raw }) => {
          const mensagemCrua = raw || "";
          const achados = [
            ...new Set([
              ...foraDoAscii(mensagemCrua),
              ...(mensagemCrua.includes(CRASE) ? [CRASE] : []),
            ]),
          ];
          return [
            achados.length === 0,
            "a mensagem tem caractere que nao pertence a um commit: " +
              achados.map((caractere) => JSON.stringify(caractere)).join(" ") +
              ". Sem acento, sem emoji e sem crase, no header e no corpo. " +
              "A pontuacao do conventional commits segue permitida.",
          ];
        },

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
    "no-special-chars": [2, "always"],
  },
};

// Catálogo de skills: classifica o que é núcleo, por arquitetura, por linguagem e opcional.
// É a fonte da instalação SELETIVA — o instalador copia só o subconjunto que o projeto usa.

// Núcleo do fluxo SDD (sempre instalado). code-analyzer entra por ser o revisor invocado
// pelo spec-create; diagnosing-bugs, por ser a disciplina de diagnóstico de bug (útil em
// qualquer projeto), fecha a lacuna do fluxo entre especificar/planejar/revisar.
export const CORE = [
  "spec-init",
  "spec-create",
  "spec-execute",
  "adr-create",
  "code-analyzer",
  "diagnosing-bugs",
];

// Uma skill por arquitetura; instala apenas a escolhida.
export const ARCHITECTURES = {
  hexagonal: "arch-hexagonal",
  clean: "arch-clean",
  onion: "arch-onion",
  layered: "arch-layered",
};

// Skills auxiliares específicas por linguagem (ex.: helpers de teste).
export const LANGUAGE = {
  java: ["junit-clean"],
};

// Skills opcionais (o instalador pergunta).
export const OPTIONAL = ["evidence-capture"];

// Dependência das skills arch-*: a fonte transversal única, copiada junto.
export const ARCH_SHARED = "shared/arch/cross-cutting-rules.md";
// Token nas SKILL.md das arch-*, substituído no install pelo caminho real da fonte no motor.
export const ARCH_RULES_TOKEN = "{{MGR_ARCH_RULES}}";
// Token da linha-ponteiro de idioma presente em TODAS as SKILL.md, substituído no install
// pelo idioma de saída do usuário (manifest.userLanguage). Sem valor (ex.: `mgr build`),
// cai no fallback textual — a linha continua legível.
export const USER_LANGUAGE_TOKEN = "{{MGR_USER_LANGUAGE}}";
export const USER_LANGUAGE_FALLBACK = "the language the user writes in";

// Gate de validação (ADR-0010): a política padrão do agente que revisa. Mora aqui porque o
// catálogo já é o lugar que sabe coisas SOBRE as skills.
//
// `model` é MAPA POR MOTOR, não string — mesma forma do `mgr-manifest.json`, que
// `src/adapters.js` já lê. E a ausência de entrada para o `copilot` é deliberada, não
// esquecimento: a lista de modelos ali é da CONTA e não do produto (a conta usada na
// verificação de 2026-08-26 recusou seis identificadores e aceitou um), então qualquer default
// que o método publicasse seria palpite sobre a conta de terceiro. Sem entrada, o agente é
// escrito sem o campo e herda o modelo da sessão.
// Token no corpo do agente, substituído no install pelo caminho da `code-analyzer` INSTALADA.
// O agente não repete o procedimento de review — aponta para ele. Duplicar violaria a fonte
// única (CONSTITUTION §3.5) e as duas cópias divergiriam na primeira mudança da skill.
export const REVIEW_SKILL_TOKEN = "{{MGR_REVIEW_SKILL}}";
// Sem caminho resolvido (ex.: `mgr build`), a linha continua legível em vez de vazar o token.
export const REVIEW_SKILL_FALLBACK = "the installed code-analyzer skill";

export const REVIEW_GATE = {
  agent: "mgr-review",
  description:
    "MGR validation gate. Reviews code against the project's rules guide and its originating "
    + "spec, anchored in verbatim citation, and reports without changing anything.",
  skill: "code-analyzer",
  defaults: {
    enabled: true,
    model: { "claude-code": "opus" },
    effort: "max",
  },
};

export const architectures = () => Object.keys(ARCHITECTURES);
export const languages = () => Object.keys(LANGUAGE);
const ARCH_SKILLS = () => Object.values(ARCHITECTURES);

// Monta o subconjunto de skills a instalar a partir das escolhas do projeto.
export function selectSkills({ architecture = null, language = null, optional = [] } = {}) {
  const set = new Set(CORE);
  if (architecture) {
    const s = ARCHITECTURES[architecture];
    if (!s) throw new Error(`arquitetura desconhecida: ${architecture} (use ${architectures().join(", ")})`);
    set.add(s);
  }
  if (language && LANGUAGE[language]) for (const s of LANGUAGE[language]) set.add(s);
  for (const o of optional) if (OPTIONAL.includes(o)) set.add(o);
  return [...set];
}

// O conjunto tem alguma skill de arquitetura? (então precisa da fonte transversal)
export function needsArchShared(skills) {
  return skills.some((s) => ARCH_SKILLS().includes(s));
}

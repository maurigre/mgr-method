// Catálogo de skills: classifica o que é núcleo, por arquitetura, por linguagem e opcional.
// É a fonte da instalação SELETIVA — o instalador copia só o subconjunto que o projeto usa.

// Núcleo do fluxo SDD (sempre instalado). code-analyzer entra por ser o revisor invocado
// pelo spec-create.
export const CORE = ["spec-init", "spec-create", "spec-execute", "adr-create", "code-analyzer"];

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
export const ARCH_SHARED = "shared/arch/regras-transversais.md";
// Token nas SKILL.md das arch-*, substituído no install pelo caminho real da fonte no motor.
export const ARCH_RULES_TOKEN = "{{MGR_ARCH_RULES}}";

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

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

// Skills que acompanham TODA instalação sem pertencer ao fluxo SDD: elas configuram o MÉTODO em
// vez de conduzi-lo. Ficam fora do CORE de propósito — o CORE é o fluxo, e engordá-lo faria a
// próxima leitura confundir "sempre instalada" com "parte do fluxo".
export const TOOLING = ["configure-agents"];

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

// Árvore compartilhada dentro do diretório de skills do motor. Fonte única para não haver segunda
// cópia do literal em cinco pontos do código.
export const SHARED_DIR = "_shared";

// Dependência das skills arch-*: a fonte transversal única, copiada junto.
export const ARCH_SHARED = "shared/arch/cross-cutting-rules.md";
// Token nas SKILL.md das arch-*, substituído no install pelo caminho real da fonte no motor.
export const ARCH_RULES_TOKEN = "{{MGR_ARCH_RULES}}";
// Layout da fonte DENTRO do motor, em segmentos.
export const ARCH_INSTALLED = [SHARED_DIR, "arch", "cross-cutting-rules.md"];

// Leis de execução: fonte única das regras vinculantes do método (ADR-0011). Copiada SEMPRE,
// sem depender de arquitetura ou de skill escolhida — é núcleo, e o ponteiro existe em todas as
// skills do CORE. Antes da fonte única, a lei de controle de contexto vivia em duas cópias que
// já haviam divergido em quatro pontos.
export const LAWS_SHARED = "shared/laws/execution-laws.md";
// Token da linha-ponteiro nas SKILL.md do CORE, resolvido no install para o caminho no motor.
export const LAWS_TOKEN = "{{MGR_LAWS}}";
// Layout da fonte DENTRO do motor, em segmentos. Uma constante só: antes deste campo o caminho
// era remontado em cinco pontos, e a divergência entre duas dessas cópias foi o defeito do hook
// que anunciava a árvore do outro motor.
export const LAWS_INSTALLED = [SHARED_DIR, "laws", "execution-laws.md"];
// Carta de primícias (ADR-0022): o topo da hierarquia que a `L0.1` nomeia e nunca definiu. Mesmo
// molde das leis, com uma diferença que importa: o ponteiro NÃO vive nas SKILL.md, vive DENTRO do
// próprio arquivo de leis — quem o resolve é a cópia instalada dele.
export const CHARTER_SHARED = "shared/charter/core-principles.md";
export const CHARTER_TOKEN = "{{MGR_CHARTER}}";
export const CHARTER_INSTALLED = [SHARED_DIR, "charter", "core-principles.md"];

// Fonte de qualidade: usada pelo spec-init ao montar o guia de review. So o caminho INSTALADO e
// constante — o do pacote nao tem o papel de fallback de token que `LAWS_SHARED` e `CHARTER_SHARED`
// tem, e export sem consumidor viola a DES-6.
export const QUALITY_INSTALLED = [SHARED_DIR, "quality", "quality-rules.md"];
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

// Valor reservado: a intenção declara que NÃO quer modelo (ou esforço) declarado, e o agente herda
// o da sessão. Diferente de "ninguém configurou": é escolha explícita, e a saída distingue as duas.
export const INHERIT = "inherit";

export const REVIEW_GATE = {
  agent: "mgr-review",
  description:
    "MGR validation gate. Reviews code against the project's rules guide and its originating "
    + "spec, anchored in verbatim citation, and reports without changing anything.",
  skill: "code-analyzer",
  defaults: {
    enabled: true,
    // Sem identificador de modelo publicado: o agente herda o da sessão, e a saída AVISA.
    // Emenda ao ADR-0010, que publicava `opus` no claude-code por ser alias documentado. Com mais
    // motores na fila, a lista de modelos é DA CONTA em qualquer um deles, e a RN-4 proíbe
    // inventar identificador. Declarar um modelo por intenção é o que entrega o benefício.
    model: {},
    effort: "max",
  },
};

// As INTENÇÕES do fluxo, cada uma com o agente que a executa e a política padrão dela (ADR-0017).
//
// Chaves em INGLÊS porque são identidade parseável — a mesma razão do ADR-0003, e o inverso da
// dívida que o ADR-0016 registrou nas marcas de pendência. Nasceram como `redacao`/`execucao` e
// foram corrigidas antes de virarem contrato de configuração.
//
// `review` NÃO é uma cópia do `REVIEW_GATE`: é ele mesmo. Duplicar faria as duas divergirem na
// primeira mudança, e `reviewGate` continua sendo lido como apelido desta entrada.
//
// Os defaults de `model` só trazem `claude-code`, pela mesma razão escrita acima sobre o copilot:
// a lista de modelos é DA CONTA, e publicar default seria palpite sobre a conta de terceiro.
// `needs` diz de que a intenção PRECISA — `read` ou `write` —, e o descritor do motor traduz isso
// para a notação da plataforma. A necessidade é da intenção; a notação é do motor, e cada uma fica
// onde já morava.
//
// `review` pede `read` e isso é invariante do ADR-0010, não preferência: um revisor que pode editar
// não tem como reprovar em vez de "corrigir".
export const AGENTS = Object.freeze({
  review: Object.freeze({ ...REVIEW_GATE, needs: "read" }),
  drafting: Object.freeze({
    agent: "mgr-draft",
    // Devolve texto como resposta; só escreve em disco quando recebe o caminho exato.
    needs: "read",
    description:
      "MGR drafting agent. Writes the PRD and the technical spec from the brief and the SDD tiers "
      + "on disk, and returns the text; it never asks the user anything.",
    defaults: Object.freeze({
      enabled: true,
      model: Object.freeze({}),
      effort: "high",
    }),
  }),
  execution: Object.freeze({
    agent: "mgr-task",
    // Implementa a task, então escreve. É a única das três que escreve.
    needs: "write",
    description:
      "MGR task agent. Implements ONE approved plan task, producing exactly the artifact the plan "
      + "declares, and returns what it did; it never asks the user anything.",
    defaults: Object.freeze({
      enabled: true,
      model: Object.freeze({}),
      effort: "low",
    }),
  }),
});

// Ordem estável para a saída e para os testes: a que o fluxo executa, não a alfabética.
export const INTENTS = Object.freeze(["drafting", "execution", "review"]);

export const architectures = () => Object.keys(ARCHITECTURES);
export const languages = () => Object.keys(LANGUAGE);
const ARCH_SKILLS = () => Object.values(ARCHITECTURES);

// Monta o subconjunto de skills a instalar a partir das escolhas do projeto.
export function selectSkills({ architecture = null, language = null, optional = [] } = {}) {
  const set = new Set([...CORE, ...TOOLING]);
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

// O conjunto tem spec-init? (então precisa da fonte de qualidade)
export function needsQualityShared(skills) {
  return skills.includes("spec-init");
}

// A fonte da verdade sobre QUANDO cada fonte compartilhada é instalada vem da função
// `installEngine` em `src/builder.js`. Esta tabela existe para que verificação e instalação
// leiam a mesma coisa.
export const SHARED_SOURCES = [
  {
    inPackage: ["laws", "execution-laws.md"],
    installed: LAWS_INSTALLED,
    required: () => true,
  },
  {
    inPackage: ["charter", "core-principles.md"],
    installed: CHARTER_INSTALLED,
    required: () => true,
  },
  {
    inPackage: ["arch", "cross-cutting-rules.md"],
    installed: ARCH_INSTALLED,
    required: needsArchShared,
  },
  {
    inPackage: ["quality", "quality-rules.md"],
    installed: QUALITY_INSTALLED,
    required: needsQualityShared,
  },
];

// Retorna só as entradas de SHARED_SOURCES cujo predicado required é verdadeiro
export function requiredShared(skills) {
  return SHARED_SOURCES.filter((source) => source.required(skills));
}

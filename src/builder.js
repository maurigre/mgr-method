// Build das skills.
// Modelo autossuficiente por motor: o conteúdo completo das skills é escrito DIRETO na pasta
// do motor (.claude/skills ou .github/skills). Sem runtime compartilhado, sem lançadores —
// cada motor é independente e pode ser removido sem afetar o outro.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as bundle from "./bundle.js";
import * as catalog from "./catalog.js";
import * as engines from "./engines/index.js";
import { injectFrontmatter } from "./adapters.js";

export function buildSkill(name, destSkills) {
  const src = path.join(bundle.skillsDir(), name);
  if (!existsSync(path.join(src, "SKILL.md"))) {
    throw new Error(`skill inexistente ou sem SKILL.md: ${name}`);
  }
  const dest = path.join(destSkills, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

export function buildAll(destSkills, names) {
  mkdirSync(destSkills, { recursive: true });
  names = names || bundle.skillNames();
  return names.map((n) => buildSkill(n, destSkills));
}

// Gera um diretório com o conteúdo completo (utilitário do comando `mgr build`).
export function buildRuntime(runtimeDir, names) {
  names = names || bundle.skillNames();
  buildAll(path.join(runtimeDir, "skills"), names);
  for (const sub of ["shared"]) {
    const dst = path.join(runtimeDir, sub);
    rmSync(dst, { recursive: true, force: true });
    cpSync(bundle.pkgDir(sub), dst, { recursive: true });
  }
  return names;
}

// Resolve a linha-ponteiro das leis de execução para o caminho da fonte no motor (ADR-0011).
// Puro, como o resolveUserLanguage ao lado: a resolução é testável sem tocar em disco.
export function resolveLaws(text, lawsRef) {
  return text.replaceAll(catalog.LAWS_TOKEN, lawsRef || catalog.LAWS_SHARED);
}

// Resolve o ponteiro da carta DENTRO do texto das leis, e não numa SKILL.md: a `L0.1` é quem
// aponta para a carta, então quem carrega as leis alcança a carta por ela.
export function resolveCharter(text, charterRef) {
  return text.replaceAll(catalog.CHARTER_TOKEN, charterRef || catalog.CHARTER_SHARED);
}

// Resolve a linha-ponteiro de idioma de uma SKILL.md para o idioma de saída do usuário.
export function resolveUserLanguage(text, userLanguage) {
  return text.replaceAll(catalog.USER_LANGUAGE_TOKEN, userLanguage || catalog.USER_LANGUAGE_FALLBACK);
}

// Instala o conjunto de skills DIRETO na pasta do motor (modelo autossuficiente).
// Copia a fonte transversal (_shared/arch) quando há skill de arquitetura, resolve o token
// {{MGR_ARCH_RULES}} para o caminho passado em archRulesRef e o {{MGR_USER_LANGUAGE}} de
// todas as skills para userLanguage.
export function installEngine(engineSkillsDir, skills, { archRulesRef, lawsRulesRef, charterRulesRef, userLanguage, engineId, reviewGate } = {}) {
  mkdirSync(engineSkillsDir, { recursive: true });
  const dirs = skills.map((name) => buildSkill(name, engineSkillsDir));

  for (const name of skills) {
    const md = path.join(engineSkillsDir, name, "SKILL.md");
    const text = readFileSync(md, "utf8");
    if (text.includes(catalog.USER_LANGUAGE_TOKEN)) {
      writeFileSync(md, resolveUserLanguage(text, userLanguage), "utf8");
    }
  }

  if (reviewGate?.enabled && skills.includes(catalog.REVIEW_GATE.skill)) {
    const md = path.join(engineSkillsDir, catalog.REVIEW_GATE.skill, "SKILL.md");
    writeFileSync(md, routeReviewSkill(engineId, readFileSync(md, "utf8")), "utf8");
  }

  // Migração (CONSTITUTION §2.7): instalações ≤ 0.4.x têm a fonte co-locada com os nomes
  // pt antigos; sem esta limpeza o update deixaria o arquivo órfão ao lado do novo.
  for (const legacy of ["arch/regras-transversais.md", "quality/regras-qualidade.md"]) {
    rmSync(path.join(engineSkillsDir, "_shared", legacy), { force: true });
  }

  if (catalog.needsArchShared(skills)) {
    const dst = path.join(engineSkillsDir, "_shared", "arch");
    mkdirSync(dst, { recursive: true });
    const shared = path.join(bundle.pkgDir("shared"), "arch", "cross-cutting-rules.md");
    cpSync(shared, path.join(dst, "cross-cutting-rules.md"));

    const ref = archRulesRef || path.join("_shared", "arch", "cross-cutting-rules.md");
    const archSkills = Object.values(catalog.ARCHITECTURES);
    for (const name of skills) {
      if (!archSkills.includes(name)) continue;
      const md = path.join(engineSkillsDir, name, "SKILL.md");
      const text = readFileSync(md, "utf8").replaceAll(catalog.ARCH_RULES_TOKEN, ref);
      writeFileSync(md, text, "utf8");
    }
  }

  // Leis de execução (ADR-0011): fonte única, copiada SEMPRE — não depende de arquitetura nem
  // de qual skill foi escolhida. O ponteiro {{MGR_LAWS}} em cada SKILL.md do CORE é resolvido
  // para este caminho; sem a cópia, o ponteiro apontaria para o vazio.
  const destino = path.join(engineSkillsDir, ...catalog.LAWS_INSTALLED);
  mkdirSync(path.dirname(destino), { recursive: true });
  cpSync(path.join(bundle.pkgDir("shared"), "laws", "execution-laws.md"), destino);

  // A carta, pelo mesmo motivo e com a mesma incondicionalidade: `shared/` NÃO é copiado inteiro,
  // cada fonte tem o seu bloco, e sem este o ponteiro da `L0.1` apontaria para o vazio.
  const cartaDestino = path.join(engineSkillsDir, ...catalog.CHARTER_INSTALLED);
  mkdirSync(path.dirname(cartaDestino), { recursive: true });
  cpSync(path.join(bundle.pkgDir("shared"), "charter", "core-principles.md"), cartaDestino);
  const cartaRef = charterRulesRef || path.join(...catalog.CHARTER_INSTALLED);
  writeFileSync(destino, resolveCharter(readFileSync(destino, "utf8"), cartaRef), "utf8");

  const lawsRef = lawsRulesRef || path.join(...catalog.LAWS_INSTALLED);
  for (const name of skills) {
    const md = path.join(engineSkillsDir, name, "SKILL.md");
    const text = readFileSync(md, "utf8");
    if (text.includes(catalog.LAWS_TOKEN)) writeFileSync(md, resolveLaws(text, lawsRef), "utf8");
  }

  // Fonte de qualidade (co-locada) — usada pelo spec-init ao montar o guia de review.
  if (skills.includes("spec-init")) {
    const qdst = path.join(engineSkillsDir, "_shared", "quality");
    mkdirSync(qdst, { recursive: true });
    cpSync(path.join(bundle.pkgDir("shared"), "quality", "quality-rules.md"),
      path.join(qdst, "quality-rules.md"));
  }
  return dirs;
}

// Marcador de posse no arquivo do agente. `.claude/agents/` e `.github/agents/` são diretórios
// DO USUÁRIO: o método só toca arquivo que ele mesmo escreveu, identificado por este marcador —
// mesma regra do HOOK_MARKER em src/hooks.js. Sem isso, o uninstall apagaria trabalho alheio.
export const AGENT_MARKER = "mgr-managed-agent";

export const isOurAgent = (text) => text.includes(AGENT_MARKER);

// Resumo do gate para um motor: o que ele DE FATO vai valer ali. A decisão de capacidade
// mora aqui, no núcleo, e não na borda — que só formata (INV-5/INV-6). `model`/`effort` vêm
// `null` quando não se aplicam, e a borda escolhe a palavra que mostra ao usuário.
export function gateSummary(engineId, gate) {
  const engine = engines.get(engineId);
  const model = gate.model?.[engineId] || null;
  return {
    engine: engineId,
    model: engine.capabilities.agentModel ? model : null,
    // `?? null` porque `inherit` é normalizado para AUSÊNCIA no núcleo, e `undefined` some do
    // `JSON.stringify`: a chave `effort` desaparecia do payload, que a §5 contrata responder.
    effort: engine.capabilities.agentEffort ? (gate.effort ?? null) : null,
    // Declarado e não sustentado pelo motor: é isto, e só isto, que é degradação.
    skipped: [
      ...(model && !engine.capabilities.agentModel ? ["model"] : []),
      ...(engine.capabilities.agentEffort ? [] : ["effort"]),
    ],
  };
}

// As intenções que estão HERDANDO o modelo em todos os motores — nenhuma declarou um.
//
// Mora aqui, e não na borda, porque era o mesmo predicado escrito duas vezes lá: uma no plano do
// install e outra no `mgr agents`. Duas cópias da mesma decisão divergem na primeira mudança, que
// é o defeito que esta fatia já produziu uma vez por outro caminho.
export function inheritingModel(intents, engineIds, policies) {
  return intents.filter((intent) =>
    engineIds.every((engineId) => !gateSummary(engineId, policies[intent]).model));
}

// Monta o frontmatter do agente de UMA intenção, a partir do descritor do motor e da política
// dela (ADR-0017). O que a plataforma não suporta simplesmente não é escrito, e o motivo volta em
// `skipped` para a borda declarar a degradação em vez de escondê-la.
//
// `gateSummary` continua sendo a fonte da decisão de capacidade, sem alteração: ela recebe uma
// política e diz o que vale naquele motor, e isso nunca foi específico do gate.
export function agentFrontmatter(engineId, intent, policy) {
  const engine = engines.get(engineId);
  const descritor = catalog.AGENTS[intent];
  const { model, effort, skipped } = gateSummary(engineId, policy);
  const fields = [
    `name: ${descritor.agent}`,
    `description: ${descritor.description}`,
    `tools: ${engine.agentTools[descritor.needs]}`,
    ...(model ? [`model: ${model}`] : []),
    ...(effort ? [`effort: ${effort}`] : []),
  ];
  return { frontmatter: `---\n${fields.join("\n")}\n---`, skipped };
}

// O `model` e o `effort` que um arquivo de agente JÁ declara. Nulo quando o arquivo não existe —
// o que é diferente de existir sem o campo, e por isso os dois casos não podem virar o mesmo valor.
//
// Existe para o `update` poder dizer o que MUDOU em vez de reescrever em silêncio (ADR-0017). Mora
// aqui, e não na borda, porque ler e interpretar arquivo instalado é persistência, não formatação.
export function agentDeclares(file) {
  if (!existsSync(file)) return null;
  const frontmatter = readFileSync(file, "utf8").split("---")[1] ?? "";
  const campo = (nome) => frontmatter.match(new RegExp(`^${nome}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { model: campo("model"), effort: campo("effort") };
}

// Instala UM agente. Intenção desligada não escreve nada.
function installAgent(engineId, engineAgentsDir, intent, policy, { reviewSkillRef, userLanguage }) {
  if (!policy.enabled) return { written: [], skipped: [], blocked: [], change: null };

  const engine = engines.get(engineId);
  const descritor = catalog.AGENTS[intent];
  const source = readFileSync(path.join(bundle.agentsDir(), `${descritor.agent}.md`), "utf8");
  // O token da skill de review só existe no corpo do gate; nos outros o replaceAll não faz nada.
  const body = resolveUserLanguage(source, userLanguage)
    .replaceAll(catalog.REVIEW_SKILL_TOKEN, reviewSkillRef || catalog.REVIEW_SKILL_FALLBACK);

  const { frontmatter, skipped } = agentFrontmatter(engineId, intent, policy);
  const dest = path.join(engineAgentsDir, engine.agentFile(descritor.agent));

  // Prova de posse: arquivo de mesmo nome que não é nosso não é sobrescrito (ADR-0010).
  if (existsSync(dest) && !isOurAgent(readFileSync(dest, "utf8"))) {
    return { written: [], skipped, blocked: [dest], change: null };
  }

  // O ANTES é lido antes de escrever, porque depois ele não existe mais.
  const before = agentDeclares(dest);
  mkdirSync(engineAgentsDir, { recursive: true });
  writeFileSync(dest, `${frontmatter}\n\n${body}\n<!-- ${AGENT_MARKER} -->\n`, "utf8");
  return {
    written: [dest],
    skipped,
    blocked: [],
    change: { engine: engineId, intent, agent: descritor.agent, before, after: agentDeclares(dest) },
  };
}

// Instala os agentes de TODAS as intenções ligadas, no diretório de agentes do motor (ADR-0017).
//
// `policies` é o mapa que o `registry.readAgents` devolve. A ordem é a de `catalog.INTENTS`, que é
// a do fluxo e não a alfabética, para a saída ser estável e legível.
//
// `skipped` é acumulado SEM repetição: a capacidade que falta é do MOTOR, não da intenção, e
// repeti-la uma vez por agente faria a borda avisar três vezes a mesma coisa.
export function installAgents(engineId, engineAgentsDir, policies, opts = {}) {
  const written = [];
  const blocked = [];
  const changes = [];
  const skipped = new Set();
  for (const intent of catalog.INTENTS) {
    const resultado = installAgent(engineId, engineAgentsDir, intent, policies[intent], opts);
    written.push(...resultado.written);
    blocked.push(...resultado.blocked);
    if (resultado.change) changes.push(resultado.change);
    for (const capability of resultado.skipped) skipped.add(capability);
  }
  return { written, blocked, changes, skipped: [...skipped] };
}

// Bloco que manda o copilot delegar a revisão ao agente. Em inglês porque é conteúdo
// distribuído (ADR-0003). No claude-code isto não existe: lá o desvio é o frontmatter.
const delegationBlock = (agent) => `
## Delegation (copilot)

Run this review through the \`${agent}\` custom agent, not in this session. Use the \`task\`
tool to delegate, passing the files to review and the path of the rules guide. The agent runs
with its own model and without write tools; do not reproduce its work here, and report what it
returns.
`;

// Aplica na `code-analyzer` INSTALADA a forma de roteamento que o descritor do motor declara.
// A assimetria é real e fica declarada: no claude-code o desvio é ESTRUTURAL (a plataforma
// roteia pelo frontmatter); no copilot é INSTRUÇÃO (o modelo delega via `task`) — ADR-0010.
export function routeReviewSkill(engineId, text) {
  const engine = engines.get(engineId);
  const agent = catalog.REVIEW_GATE.agent;
  if (engine.routing === "fork") {
    return injectFrontmatter(text, { context: "fork", agent, background: "false" });
  }
  return `${text.trimEnd()}\n${delegationBlock(agent)}`;
}

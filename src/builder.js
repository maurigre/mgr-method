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

// Resolve a linha-ponteiro de idioma de uma SKILL.md para o idioma de saída do usuário.
export function resolveUserLanguage(text, userLanguage) {
  return text.replaceAll(catalog.USER_LANGUAGE_TOKEN, userLanguage || catalog.USER_LANGUAGE_FALLBACK);
}

// Instala o conjunto de skills DIRETO na pasta do motor (modelo autossuficiente).
// Copia a fonte transversal (_shared/arch) quando há skill de arquitetura, resolve o token
// {{MGR_ARCH_RULES}} para o caminho passado em archRulesRef e o {{MGR_USER_LANGUAGE}} de
// todas as skills para userLanguage.
export function installEngine(engineSkillsDir, skills, { archRulesRef, userLanguage, engineId, reviewGate } = {}) {
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
    effort: engine.capabilities.agentEffort ? gate.effort : null,
    // Declarado e não sustentado pelo motor: é isto, e só isto, que é degradação.
    skipped: [
      ...(model && !engine.capabilities.agentModel ? ["model"] : []),
      ...(engine.capabilities.agentEffort ? [] : ["effort"]),
    ],
  };
}

// Monta o frontmatter do agente para um motor, a partir do descritor e da política do gate.
// O que a plataforma não suporta simplesmente não é escrito, e o motivo volta em `skipped`
// para a borda declarar a degradação em vez de escondê-la.
export function agentFrontmatter(engineId, gate) {
  const engine = engines.get(engineId);
  const { model, effort, skipped } = gateSummary(engineId, gate);
  const fields = [
    `name: ${catalog.REVIEW_GATE.agent}`,
    `description: ${catalog.REVIEW_GATE.description}`,
    `tools: ${engine.agentTools}`,
    ...(model ? [`model: ${model}`] : []),
    ...(effort ? [`effort: ${effort}`] : []),
  ];
  return { frontmatter: `---\n${fields.join("\n")}\n---`, skipped };
}

// Instala o agente do gate no diretório de agentes do motor. Gate desligado = nada escrito.
export function installAgents(engineId, engineAgentsDir, gate, { reviewSkillRef, userLanguage } = {}) {
  if (!gate.enabled) return { written: [], skipped: [], blocked: [] };

  const engine = engines.get(engineId);
  const source = readFileSync(path.join(bundle.agentsDir(), `${catalog.REVIEW_GATE.agent}.md`), "utf8");
  const body = resolveUserLanguage(source, userLanguage)
    .replaceAll(catalog.REVIEW_SKILL_TOKEN, reviewSkillRef || catalog.REVIEW_SKILL_FALLBACK);

  const { frontmatter, skipped } = agentFrontmatter(engineId, gate);
  const dest = path.join(engineAgentsDir, engine.agentFile(catalog.REVIEW_GATE.agent));

  // Prova de posse: arquivo de mesmo nome que não é nosso não é sobrescrito (ADR-0010).
  if (existsSync(dest) && !isOurAgent(readFileSync(dest, "utf8"))) {
    return { written: [], skipped, blocked: [dest] };
  }

  mkdirSync(engineAgentsDir, { recursive: true });
  writeFileSync(dest, `${frontmatter}\n\n${body}\n<!-- ${AGENT_MARKER} -->\n`, "utf8");
  return { written: [dest], skipped, blocked: [] };
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

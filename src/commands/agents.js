// Cola dos comandos `mgr agents`, `mgr agents set` e `mgr agents apply`. Humble Object: aqui só há
// parse de flag, formatação e exit code; o IO (stdout/stderr, cor) entra por `io` e a raiz por
// `root`, para o teste exercitar sem processo filho. A decisão de `agents` e `set` vive em src/
// (registry, builder); o `apply` também lê o disco e grava o arquivo do agente, e só delega a troca
// do frontmatter ao builder.
import * as installer from "../installer.js";
import * as catalogo from "../catalog.js";
import { CONFIGURED, LOCAL_CONFIG_NAME, misplacedTeamKeys, readAgents, readPersonal, writeAgentPolicy } from "../registry.js";
import * as engineDescriptors from "../engines/index.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentFrontmatter, gateSummary, inheritingModel, isOurAgent, replaceAgentFrontmatter } from "../builder.js";

const engineIds = engineDescriptors.ids;

// `mgr agents` — qual modelo e qual esforço cada intenção usa, e DE ONDE veio cada valor
// (ADR-0017). A decisão vem do núcleo: `readAgents` diz o valor e a origem, `gateSummary` diz o que
// o motor sustenta. Aqui só se escolhe a palavra.
export function agents({ root, cwd, flags, positional, io, M }) {
  if (positional[0] === "set") return agentsSet({ root, cwd, flags, positional: positional.slice(1), io, M });
  if (positional[0] === "apply") return agentsApply({ root, cwd, flags, positional: positional.slice(1), io, M });
  const repo = root;
  const core = installer.coreDir("project", repo);
  const { policies, sources, aliasOverridden } = readAgents(core);

  const pedida = positional[0];
  if (pedida && !catalogo.INTENTS.includes(pedida)) {
    io.err(M.errorPrefix(M.agentsUnknown(pedida, catalogo.INTENTS.join(" | "))));
    return 1;
  }
  avisaChavesIgnoradas(core, io, M);
  const intents = pedida ? [pedida] : catalogo.INTENTS;
  const motores = engineIds();

  if (flags.json) {
    io.out(JSON.stringify({
      schemaVersion: 1,
      aliasOverridden,
      intents: Object.fromEntries(intents.map((intent) => [intent, {
        agent: catalogo.AGENTS[intent].agent,
        needs: catalogo.AGENTS[intent].needs,
        enabled: policies[intent].enabled,
        engines: Object.fromEntries(motores.map((engine) => {
          const { model, effort, skipped } = gateSummary(engine, policies[intent]);
          return [engine, {
            model, effort, skipped,
            modelSource: model ? sources[intent].model[engine] : null,
            effortSource: effort ? sources[intent].effort : null,
          }];
        })),
      }])),
    }, null, 2));
    return 0;
  }

  const palavraDaOrigem = (origem) =>
    (origem === CONFIGURED ? M.agentsSourceConfigured : M.agentsSourceDefault);
  for (const intent of intents) {
    io.out(M.agentsIntent(intent, catalogo.AGENTS[intent].agent));
    for (const engine of motores) {
      const { model, effort, skipped } = gateSummary(engine, policies[intent]);
      const textoDoModelo = model
        ? M.agentsValueFrom(model, palavraDaOrigem(sources[intent].model[engine]))
        : (skipped.includes("model") ? M.agentsUnsupported : M.agentsInherited);
      // Mesma forma do ramo do `model` logo acima: sem valor pode ser incapacidade do MOTOR ou
      // escolha do autor, e chamar as duas de "não suportado" faz a saída mentir sobre a
      // plataforma — o claude-code suporta `effort`.
      const textoDoEsforco = effort
        ? M.agentsValueFrom(effort, palavraDaOrigem(sources[intent].effort))
        : (skipped.includes("effort") ? M.agentsUnsupported : M.agentsInherited);
      io.out(M.agentsEngine(engine, textoDoModelo, textoDoEsforco));
    }
  }
  // O aviso do default: sem modelo declarado, o agente roda no da sessão. Some quando todas as
  // intenções mostradas têm modelo em algum motor — avisar sobre o que já foi resolvido vira ruído.
  const herdando = inheritingModel(intents, motores, policies);
  if (herdando.length) io.out(io.style.yellow(M.agentsInheritWarning(herdando.join(", "))));
  io.out("");
  io.out(io.style.dim(M.agentsEffortNote));
  if (aliasOverridden) io.out(M.agentsAliasNote);
  return 0;
}

// DT-2: chave do time em config.local.json e chave pessoal em config.json são IGNORADAS, e o aviso
// vai só para stderr. O stdout (texto e --json) não muda: é a guarda de paridade da F1. O arquivo
// pessoal com JSON inválido não derruba a leitura da política, que nunca o consultou; o erro dele
// aparece no comando que realmente o lê.
function avisaChavesIgnoradas(core, io, M) {
  // Camada pessoal ilegível não derruba a leitura da política (que mora no config do time), mas também
  // não some em silêncio: o erro, que nomeia o arquivo, vai para stderr, e stdout e exit ficam iguais.
  let ignoradas = [];
  let desconhecidas = [];
  try {
    ({ ignoredTeam: ignoradas, ignoredUnknown: desconhecidas } = readPersonal(core));
  } catch (error) {
    io.err(M.errorPrefix(error.message));
  }
  if (ignoradas.length) io.err(M.personalKeysIgnored(LOCAL_CONFIG_NAME, ignoradas.join(", ")));
  if (desconhecidas.length) io.err(M.personalKeysUnknown(LOCAL_CONFIG_NAME, desconhecidas.join(", ")));
  if (misplacedTeamKeys(core).includes("projectId")) io.err(M.projectIdPersonal);
}

// `mgr agents apply` — reescreve só o frontmatter dos agentes que o manifesto declara, a partir do
// config, sem rede e sem o pacote (DT-11). Ausente ou sem marcador não é tocado e faz o exit ser 1,
// para a skill não afirmar um efeito que não houve.
export function agentsApply({ root, io, M }) {
  const core = installer.coreDir("project", root);
  const manifesto = installer.detectPrior("project", root);
  if (!manifesto) return 0;
  const declarados = new Set((manifesto.agents || []).map((p) => path.normalize(p)));
  const { policies } = readAgents(core);
  let status = 0;
  for (const engine of manifesto.engines || [manifesto.engine]) {
    if (!engineIds().includes(engine)) continue;
    const descritor = engineDescriptors.get(engine);
    const dir = installer.engineAgentsDir(engine, "project", root);
    for (const intent of catalogo.INTENTS) {
      if (!policies[intent].enabled) continue;
      const agent = catalogo.AGENTS[intent].agent;
      const file = path.join(dir, descritor.agentFile(agent));
      const rel = path.relative(root, file);
      if (!declarados.has(path.normalize(rel))) continue;
      if (!existsSync(file)) {
        io.err(M.agentsApplyMissing(rel, manifesto.version));
        status = 1;
        continue;
      }
      const atual = readFileSync(file, "utf8");
      if (!isOurAgent(atual)) {
        io.err(M.agentsApplyNotOwned(rel));
        status = 1;
        continue;
      }
      const { frontmatter } = agentFrontmatter(engine, intent, policies[intent]);
      let substituicao;
      try {
        substituicao = replaceAgentFrontmatter(atual, frontmatter);
      } catch {
        io.err(M.agentsApplyNotOwned(rel));
        status = 1;
        continue;
      }
      const { text, changes } = substituicao;
      if (text === atual) continue;
      io.out(M.agentsApplyWriting(rel));
      writeFileSync(file, text, "utf8");
      io.out(M.agentsApplyWritten(rel));
      for (const mudanca of changes) {
        io.out(M.agentChanged(agent, engine, mudanca.field, mudanca.before, mudanca.after));
      }
    }
  }
  return status;
}

// `mgr agents set` — escreve a política de UMA intenção e diz o que passou a valer (ADR-0017).
//
// A decisão de MERGE e a validação são do núcleo (`writeAgentPolicy`); aqui só se resolve para
// QUAIS motores escrever, e se escolhe a palavra. Este comando NÃO roda o `update`: reescrever o
// arquivo do agente sem o autor pedir mexeria no disco dele por conta própria.
//
// `model` é mapa POR MOTOR e `effort` é da intenção inteira — por isso `--engine` só tem efeito
// sobre o modelo, e o esforço é escrito uma vez, sem motor.
function agentsSet({ root, flags, positional, io, M }) {
  const repo = root;
  const core = installer.coreDir("project", repo);

  const intent = positional[0];
  if (!intent) {
    io.err(M.errorPrefix(M.agentsSetNeedsIntent(catalogo.INTENTS.join(" | "))));
    return 1;
  }
  if (!catalogo.INTENTS.includes(intent)) {
    io.err(M.errorPrefix(M.agentsUnknown(intent, catalogo.INTENTS.join(" | "))));
    return 1;
  }
  if (flags.model === undefined && flags.effort === undefined) {
    io.err(M.errorPrefix(M.agentsSetNothing));
    return 1;
  }

  // Sem `--engine`, os motores vêm do manifesto — é o que o autor instalou, e não um palpite.
  const manifesto = installer.detectPrior("project", repo);
  const instalados = (manifesto?.engines || [manifesto?.engine]).filter((e) => engineIds().includes(e));
  const motores = flags.engines.length ? flags.engines : instalados;
  for (const engine of flags.engines) {
    // Motor não instalado é RECUSADO, e não gravado e ignorado: config que ninguém lê é pior que
    // erro na hora, porque o autor sai achando que configurou.
    if (!instalados.includes(engine)) {
      io.err(M.errorPrefix(M.agentsSetEngineNotInstalled(engine, instalados.join(", "))));
      return 1;
    }
  }
  if (flags.model !== undefined && !motores.length) {
    io.err(M.errorPrefix(M.agentsSetNoEngines));
    return 1;
  }

  const escrita = {};
  if (flags.model !== undefined) escrita.model = Object.fromEntries(motores.map((e) => [e, flags.model]));
  if (flags.effort !== undefined) escrita.effort = flags.effort;
  // Valor inválido sai pelo `throw` do núcleo, capturado no `main` — e nada é gravado.
  io.out(M.agentsSetWriting(intent));
  const policy = writeAgentPolicy(core, intent, escrita);
  io.out(M.agentsSetWritten(intent, catalogo.AGENTS[intent].agent));

  // `effort` vale para a INTENÇÃO inteira: mostrar só o motor do `--engine` esconderia que ele
  // passou a valer nos outros também. Com `--model` sozinho, mostra-se só onde se escreveu.
  const mostrados = (flags.effort !== undefined && instalados.length)
    ? instalados
    : (motores.length ? motores : engineIds());
  for (const engine of mostrados) {
    const { model, effort, skipped } = gateSummary(engine, policy);
    io.out(M.agentsEngine(engine,
      model || (skipped.includes("model") ? M.agentsUnsupported : M.agentsInherited),
      effort || (skipped.includes("effort") ? M.agentsUnsupported : M.agentsInherited)));
  }
  io.out("");
  // Uma frase por campo ESCRITO: os dois campos passam a valer em momentos diferentes, e dizer só
  // "pronto" deixaria o autor esperando efeito que ainda não existe.
  if (flags.model !== undefined) io.out(io.style.dim(M.agentsSetModelEffect));
  if (flags.effort !== undefined) io.out(io.style.dim(M.agentsSetEffortEffect));
  return 0;
}

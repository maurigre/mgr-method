/**
 * Orquestracao do `install` com terminal (DT-15, CA-19, CA-20), fora da borda (P3.1).
 *
 * O adaptador de perguntas (`ask`) e INJETADO, como em `collectInstallAnswers`: a borda passa o do @clack e o
 * teste passa um stub. Aqui moram a recusa antes da primeira pergunta, os padroes vindos da declaracao
 * anterior por escopo e o contexto de modelo, esforco, origem e versionamento do runtime. A borda so liga.
 */
import * as catalog from "./catalog.js";
import { supportsEffort, supportsModel } from "./engines/index.js";
import { readAgents, readOrigin, readRuntimeVersioning } from "./registry.js";
import { effortFlagLevels, resolveEffortFlags, resolveModelFlags } from "./cli-args.js";
import { collectInstallAnswers, detectUserLanguage } from "./prompts.js";
import { coreDir, explicitOfInstall, previousForQuestions, readPrior, scopeByManifestPresence } from "./installer.js";

/**
 * Faz as perguntas do `install` e devolve as respostas (ou o `CANCELLED` do adaptador).
 *
 * Antes da primeira pergunta, a resolucao do escopo provavel recusa o manifesto ilegivel, a raiz nao-objeto,
 * `skills` fora de forma e a declaracao que nenhuma pergunta nem flag cobre (`UsageError`). Os padroes e o
 * contexto seguem o escopo respondido.
 */
export async function askInstall(ask, { flags, repo, env, msg }) {
  const scopeGuess = flags.scope || scopeByManifestPresence(repo);
  const localeLanguage = detectUserLanguage(env);
  const explicitoDasFlags = explicitOfInstall(flags.engines, {
    skillsDir: null, language: flags.language || null, architecture: flags.arch || null,
    userLanguage: flags.userLanguage || null, optional: [], all: flags.allSkills === true,
  });
  const previousByScope = new Map();
  const previousDeclarationsOf = (scope) => {
    if (!previousByScope.has(scope)) {
      previousByScope.set(scope, previousForQuestions(readPrior(scope, repo), {
        scope, repo, localeLanguage, explicit: explicitoDasFlags,
      }));
    }
    return previousByScope.get(scope);
  };
  previousDeclarationsOf(scopeGuess);
  // O contexto le a configuracao pelo escopo escolhido e o `previous` le o manifesto pelo mesmo escopo. Flag
  // de modelo invalida nao recusa aqui: a validacao autoritativa, antes de qualquer escrita, e da borda.
  const contextFor = (chosenEngines, chosenScope) => {
    const core = coreDir(chosenScope, repo);
    const agents = readAgents(core);
    const resolved = resolveModelFlags(flags, { engines: chosenEngines, supportsModel });
    const effortsByFlag = resolveEffortFlags(flags, { engines: chosenEngines, supportsEffort, levels: effortFlagLevels });
    return {
      flagModels: resolved.ok ? resolved.models : {},
      flagEfforts: effortsByFlag.ok ? effortsByFlag.efforts : {},
      configured: agents.sources,
      enabledIntents: catalog.INTENTS.filter((intent) => agents.policies[intent].enabled !== false),
      originRecorded: Boolean(flags.origin) || readOrigin(core).state === "recorded",
      runtimeVersioningRecorded: readRuntimeVersioning(core).state !== "absent",
    };
  };
  return collectInstallAnswers(
    ask,
    {
      engines: flags.engines, scope: flags.scope, language: flags.language || null, architecture: flags.arch || null,
      userLanguage: flags.userLanguage || null, projectId: flags.projectId || null,
    },
    {
      repo, allSkills: flags.allSkills === true, env, msg, contextFor,
      previous: (chosenScope) => previousDeclarationsOf(chosenScope ?? scopeGuess),
    },
  );
}

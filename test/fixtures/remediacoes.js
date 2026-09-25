/**
 * Camada pura do guarda de remediacao.
 *
 * Verifica a COERENCIA entre o registro de remediacoes (CHECKS em src/doctor.js) e a tabela
 * de casos de teste (casos passada como argumento). Nao confere se a remediacao funciona —
 * isso e o runner, que roda comando de verdade.
 *
 * Nao verifica:
 * - Se a remediacao de fato resolve o problema (isso roda em verdade)
 * - Se um caso falha ou passa (medição de execução, não estrutura)
 * - Se a string declarada é um comando válido (validação de sintaxe)
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKS,
  PROVA_FUNCIONA,
  PROVA_NAO_FUNCIONA,
  PROVA_NAO_MEDIDA,
  SEM_REMEDIACAO,
} from "../../src/doctor.js";
import {
  instalacaoLimpa,
  descartar,
  ORFA,
  VERSAO_VELHA,
  HOOK_QUEBRADO,
  apagarFonteCompartilhada,
  plantarTokenEmShared,
  alterarCorpoEmShared,
} from "./instalacao.js";
import { diagnose } from "../../src/doctor.js";
import * as catalog from "../../src/catalog.js";

const BIN = fileURLToPath(new URL("../../bin/mgr.js", import.meta.url));

/**
 * Valida a coerencia entre o registro e a tabela de casos.
 *
 * Devolve array de strings de problema, cada uma com formato REM-N <id>(/<condicao>): descrição.
 * Array vazio significa registro e casos coerentes.
 *
 * @param {Array} checks - Registro CHECKS de src/doctor.js
 * @param {Array} casos - Tabela de casos com entradas {id, condicao}
 * @returns {Array} Array de strings de problema
 */
export function problemasDeCobertura(checks, casos) {
  const problemas = [];
  const estadosMedidos = [PROVA_FUNCIONA, PROVA_NAO_FUNCIONA, SEM_REMEDIACAO];

  for (const check of checks) {
    const { id, remediacoes = [] } = check;

    if (!remediacoes || remediacoes.length === 0) {
      problemas.push(`REM-1 ${id}: entrada sem remediacoes declaradas`);
      continue;
    }

    for (const remediacao of remediacoes) {
      const { condicao, prova, fix, razao, candidato } = remediacao;

      if (!condicao) {
        continue;
      }

      const temCaso = casos.some((caso) => caso.id === id && caso.condicao === condicao);

      if (estadosMedidos.includes(prova) && !temCaso) {
        problemas.push(
          `REM-2 ${id}/${condicao}: condicao declarada medida e sem caso no guarda`
        );
      }

      if (prova === PROVA_NAO_MEDIDA && !razao) {
        problemas.push(
          `REM-4 ${id}/${condicao}: ${prova} exige razao escrita`
        );
      }

      if (prova === PROVA_NAO_FUNCIONA && (!razao || !candidato)) {
        problemas.push(
          `REM-4 ${id}/${condicao}: ${prova} exige razao escrita`
        );
      }

      if ((prova === SEM_REMEDIACAO || prova === PROVA_NAO_FUNCIONA) && fix !== null) {
        problemas.push(
          `REM-5 ${id}/${condicao}: fix e prova incoerentes`
        );
      }

      if (prova === PROVA_FUNCIONA && fix === null) {
        problemas.push(
          `REM-5 ${id}/${condicao}: fix e prova incoerentes`
        );
      }
    }
  }

  for (const caso of casos) {
    const { id, condicao } = caso;
    const check = checks.find((c) => c.id === id);

    if (!check) {
      problemas.push(
        `REM-3 ${id}/${condicao}: caso aponta para condicao que o registro nao declara`
      );
      continue;
    }

    const temCondicao = (check.remediacoes || []).some((r) => r.condicao === condicao);
    if (!temCondicao) {
      problemas.push(
        `REM-3 ${id}/${condicao}: caso aponta para condicao que o registro nao declara`
      );
    }
  }

  return problemas;
}

/**
 * Seleciona um achado quando exatamente um casa com o predicado.
 *
 * Lanca Error quando zero ou dois ou mais casam: predicado frouxo que casa dois faria
 * o caso passar sem medir o que diz medir.
 *
 * @param {Array} findings - Lista de achados
 * @param {Function} identifica - Predicado que retorna true/false para cada achado
 * @returns {Object} O achado quando exatamente um casa
 * @throws {Error} Quando não for exatamente um achado
 */
export function selecionaAchado(findings, identifica) {
  const casados = findings.filter(identifica);

  if (casados.length === 0) {
    throw new Error(
      `selecionaAchado: nenhum achado casou com o predicado; zero significa predicado muito rigoroso`
    );
  }

  if (casados.length > 1) {
    throw new Error(
      `selecionaAchado: ${casados.length} achados casaram; predicado muito frouxo — teste não mede o que diz`
    );
  }

  return casados[0];
}

// Helpers para acessar dados da instalacao
function lerManifesto(repo) {
  try {
    return JSON.parse(readFileSync(path.join(repo, ".mgr-core", "manifest.json"), "utf8"));
  } catch {
    throw new Error("manifesto nao existe ou nao eh valido");
  }
}

function primeiraSkillDeclarada(repo) {
  const manifesto = lerManifesto(repo);
  const skill = manifesto.skills?.[0];
  if (!skill) throw new Error("nenhuma skill declarada no manifesto");
  return skill;
}

function skillPath(repo, nome) {
  const manifesto = lerManifesto(repo);
  const dir = (manifesto.skillsDirs ?? [".claude/skills"])[0];
  return path.join(repo, dir, nome);
}

function dirSkillsRelativo(repo) {
  const manifesto = lerManifesto(repo);
  return (manifesto.skillsDirs ?? [".claude/skills"])[0];
}

// Executa string do tipo "mgr update" e devolve {sucesso, razao?}
function executaComando(stringDoComando, repo) {
  const partes = stringDoComando.trim().split(/\s+/);
  if (partes[0] !== "mgr") {
    return { sucesso: false, razao: "comando deve comecar com 'mgr'" };
  }

  const args = [...partes.slice(1), repo];

  try {
    execFileSync(BIN, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
      encoding: "utf8",
    });
    return { sucesso: true };
  } catch (e) {
    const razao = e.signal === "SIGTERM"
      ? "timeout (10s)"
      : e.status
        ? `exit ${e.status}`
        : e.message;
    return { sucesso: false, razao };
  }
}

/**
 * Runner que executa o laco canonico para um caso.
 *
 * Devolve array de problemas (vazio quando o caso passa).
 * O laco: instalacao limpa -> zero antes -> planta -> um depois com fix correto ->
 * conforme prova (executa fix ou candidato ou nada) -> verifica resultado.
 *
 * @param {Object} caso - { id, condicao, planta, identifica, jaEstaEmLimpa? }
 * @param {Array} checks - Registro de remediacoes (padrão: CHECKS importado)
 * @returns {Promise<Array>} Array de strings de problema
 */
// O EXECUTOR e injetado, com o real como padrao — mesmo padrao do `exists` que `missingAgents` ja
// recebe e do `diff` que `lockfileDrift` recebe. Sem isso nao ha como provar que o runner executa a
// STRING DECLARADA no registro em vez de um comando fixo: medido em 2026-09-24, um teste que para no
// passo 4 passa igual com o runner executando comando fixo, e portanto nao guarda nada.
export async function rodaUmCaso(caso, checks = CHECKS, executa = executaComando) {
  const repo = instalacaoLimpa();
  const problemas = [];

  try {
    // Passo 2: zero antes (a menos que o caso ja tenha o achado na limpa)
    if (!caso.jaEstaEmLimpa) {
      const { findings } = diagnose(repo);
      const casado = findings.filter(caso.identifica);
      if (casado.length > 0) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: passo 2 falhou ` +
          `(predicado casou ${casado.length} achado(s) antes de plantar)`
        );
        return problemas;
      }
    }

    // Passo 3: plantar
    try {
      caso.planta(repo);
    } catch (e) {
      problemas.push(
        `caso ${caso.id}/${caso.condicao}: plantio lancou ${e.message}`
      );
      return problemas;
    }

    // Passo 4: exatamente um com fix correto
    const { findings } = diagnose(repo);
    let achado;
    try {
      achado = selecionaAchado(findings, caso.identifica);
    } catch (e) {
      problemas.push(
        `caso ${caso.id}/${caso.condicao}: passo 4 falhou - ${e.message}`
      );
      return problemas;
    }

    // Verificar fix contra o registro. O registro e passado por parametro para permitir
    // que o guarda do guarda injete um registro sintetico e prove que o runner executa
    // a string declarada no registro, nao um comando fixo.
    const registroDoCheck = checks.find((c) => c.id === caso.id);
    const remediacao = registroDoCheck?.remediacoes?.find((r) => r.condicao === caso.condicao);
    if (!remediacao) {
      problemas.push(
        `caso ${caso.id}/${caso.condicao}: condicao nao encontrada no registro`
      );
      return problemas;
    }

    if (achado.fix !== remediacao.fix) {
      problemas.push(
        `caso ${caso.id}/${caso.condicao}: fix divergiu ` +
        `(esperado: ${remediacao.fix}, achado: ${achado.fix})`
      );
      return problemas;
    }

    // Passo 5: executar conforme prova
    const { prova, fix, candidato } = remediacao;

    if (prova === PROVA_FUNCIONA) {
      const resultado = executa(fix, repo);
      if (!resultado.sucesso) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: execucao de "${fix}" falhou: ${resultado.razao}`
        );
        return problemas;
      }

      const { findings: depoisFix } = diagnose(repo);
      const casadoDepois = depoisFix.filter(caso.identifica);
      if (casadoDepois.length !== 0) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: apos "${fix}", predicado casou ` +
          `${casadoDepois.length} achado(s) em vez de 0`
        );
      }
    } else if (prova === PROVA_NAO_FUNCIONA) {
      const resultado = executa(candidato, repo);
      if (!resultado.sucesso) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: execucao de "${candidato}" falhou: ${resultado.razao}`
        );
        return problemas;
      }

      const { findings: depoisCandidato } = diagnose(repo);
      const casadoDepois = depoisCandidato.filter(caso.identifica);
      if (casadoDepois.length !== 1) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: apos "${candidato}", predicado casou ` +
          `${casadoDepois.length} achado(s) em vez de 1`
        );
      } else if (casadoDepois[0].fix !== null) {
        problemas.push(
          `caso ${caso.id}/${caso.condicao}: achado apos "${candidato}" tem fix nao-nulo`
        );
      }
    } else if (prova === SEM_REMEDIACAO) {
      // nao executa nada, so exige fix nulo (ja verificado acima)
    }
  } finally {
    descartar(repo);
  }

  return problemas;
}

/**
 * Roda todos os casos e devolve todos os problemas juntos.
 *
 * @param {Array} casos - Tabela de casos
 * @param {Array} checks - Registro de remediacoes (padrão: CHECKS importado)
 * @returns {Promise<Array>} Array de todos os problemas encontrados
 */
export async function rodaTodosCasos(casos, checks = CHECKS, executa = executaComando) {
  const todosProblemas = [];
  for (const caso of casos) {
    const problemas = await rodaUmCaso(caso, checks, executa);
    todosProblemas.push(...problemas);
  }
  return todosProblemas;
}

/**
 * O relatorio que separa o CONFERIDO do NAO CONFERIDO.
 *
 * Sem ele, "16 casos verdes" pode ser lido como "toda remediacao esta provada" — e nao esta: a
 * condicao `PROVA_NAO_MEDIDA` nao tem caso de proposito, porque forcar um seria FABRICAR prova para
 * algo que nao se conseguiu medir. Mesma disciplina do `check-checks`, que conta os documentos que
 * conferiu e nao os que registrou.
 */
export function relatorioDeCobertura(checks = CHECKS) {
  const conferidas = [];
  const naoConferidas = [];
  for (const entrada of checks) {
    for (const remediacao of entrada.remediacoes ?? []) {
      const alvo = remediacao.prova === PROVA_NAO_MEDIDA ? naoConferidas : conferidas;
      alvo.push({ id: entrada.id, condicao: remediacao.condicao, razao: remediacao.razao });
    }
  }
  return { conferidas, naoConferidas };
}

/**
 * Tabela de 16 casos — um por condicao medida.
 *
 * Exclui PROVA_NAO_MEDIDA (lockfile-drift/travado-ausente).
 * 14 casos rodam comando, 2 sao SEM_REMEDIACAO, 1 eh especial (ja na limpa).
 */
export const casosDeTeste = [
  {
    id: "orphan-skill",
    condicao: "em-disco",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      cpSync(skillPath(repo, skill), skillPath(repo, ORFA), { recursive: true });
    },
    identifica: (achado) => achado.check === "orphan-skill",
  },
  {
    id: "missing-skill",
    condicao: "declarada-ausente",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      const alvo = skillPath(repo, skill);
      if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
      rmSync(alvo, { recursive: true, force: true });
    },
    identifica: (achado) => achado.check === "missing-skill",
  },
  {
    id: "missing-agent",
    condicao: "declarado-ausente",
    planta: (repo) => {
      const manifesto = lerManifesto(repo);
      const agent = manifesto.agents?.[0];
      if (!agent) throw new Error("nenhum agente declarado");
      const alvo = path.join(repo, agent);
      if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
      rmSync(alvo, { force: true });
    },
    identifica: (achado) => achado.check === "missing-agent",
  },
  {
    id: "architecture-skill",
    condicao: "skill-ausente",
    planta: (repo) => {
      const manifesto = lerManifesto(repo);
      const arch = manifesto.architecture;
      if (!arch) throw new Error("arquitetura nao declarada");
      const skillName = `arch-${arch}`;
      const alvo = skillPath(repo, skillName);
      if (!existsSync(alvo)) throw new Error(`fixture quebrada: ${alvo} nao existe apos instalar`);
      rmSync(alvo, { recursive: true, force: true });
    },
    identifica: (achado) => achado.check === "architecture-skill",
  },
  {
    id: "divergent-body",
    condicao: "skill-declarada",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      const arquivo = path.join(skillPath(repo, skill), "SKILL.md");
      const conteudo = readFileSync(arquivo, "utf8");
      writeFileSync(arquivo, conteudo + "\nLINHA PLANTADA\n", "utf8");
    },
    identifica: (achado) =>
      achado.check === "divergent-body" &&
      achado.severity === "defect" &&
      !achado.file.includes("_shared"),
  },
  {
    id: "divergent-body",
    condicao: "skill-orfa",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      // O nome tem de ser de skill QUE EXISTE NO PACOTE: o divergentBody so roda quando ha fonte
      // correspondente, entao nome inventado nao produz achado nenhum. `ORFA` e skill real fora do
      // manifesto — e o caso real das tres orfas deste repositorio.
      const nomeOrfa = ORFA;
      const destino = skillPath(repo, nomeOrfa);
      cpSync(skillPath(repo, skill), destino, { recursive: true });
      const arquivo = path.join(destino, "SKILL.md");
      const conteudo = readFileSync(arquivo, "utf8");
      writeFileSync(arquivo, conteudo + "\nLINHA PLANTADA\n", "utf8");
    },
    identifica: (achado) =>
      achado.check === "divergent-body" && achado.file.includes(ORFA),
  },
  {
    id: "divergent-body",
    condicao: "fonte-compartilhada",
    planta: (repo) => {
      alterarCorpoEmShared(repo, dirSkillsRelativo(repo), catalog.QUALITY_INSTALLED);
    },
    identifica: (achado) =>
      achado.check === "divergent-body" &&
      achado.file.includes("_shared"),
  },
  {
    id: "divergent-body",
    condicao: "manifesto-atrasado",
    planta: (repo) => {
      const manifesto = lerManifesto(repo);
      manifesto.version = VERSAO_VELHA;
      writeFileSync(
        path.join(repo, ".mgr-core", "manifest.json"),
        JSON.stringify(manifesto, null, 2),
        "utf8"
      );
    },
    identifica: (achado) =>
      achado.check === "divergent-body" &&
      achado.severity === "unavailable",
  },
  {
    id: "unresolved-token",
    condicao: "skill-declarada",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      const arquivo = path.join(skillPath(repo, skill), "SKILL.md");
      const conteudo = readFileSync(arquivo, "utf8");
      writeFileSync(arquivo, conteudo + "\n{{MGR_PLANTADO}}\n", "utf8");
    },
    identifica: (achado) =>
      achado.check === "unresolved-token" &&
      !achado.file.includes("_shared"),
  },
  {
    id: "unresolved-token",
    condicao: "skill-orfa",
    planta: (repo) => {
      const skill = primeiraSkillDeclarada(repo);
      const nomeOrfa = ORFA;
      const destino = skillPath(repo, nomeOrfa);
      cpSync(skillPath(repo, skill), destino, { recursive: true });
      const arquivo = path.join(destino, "SKILL.md");
      const conteudo = readFileSync(arquivo, "utf8");
      writeFileSync(arquivo, conteudo + "\n{{MGR_PLANTADO}}\n", "utf8");
    },
    identifica: (achado) =>
      achado.check === "unresolved-token" && achado.file.includes(ORFA),
  },
  {
    id: "unresolved-token",
    condicao: "fonte-compartilhada",
    planta: (repo) => {
      plantarTokenEmShared(repo, dirSkillsRelativo(repo), catalog.LAWS_INSTALLED);
    },
    identifica: (achado) =>
      achado.check === "unresolved-token" &&
      achado.file.includes("_shared"),
  },
  {
    id: "stale-install",
    condicao: "manifesto-atrasado",
    planta: (repo) => {
      const manifesto = lerManifesto(repo);
      manifesto.version = VERSAO_VELHA;
      writeFileSync(
        path.join(repo, ".mgr-core", "manifest.json"),
        JSON.stringify(manifesto, null, 2),
        "utf8"
      );
    },
    identifica: (achado) =>
      achado.check === "stale-install" &&
      achado.severity === "warning",
  },
  {
    id: "broken-hook",
    condicao: "binario-ausente",
    planta: (repo) => {
      const settings = path.join(repo, ".claude", "settings.local.json");
      const atual = existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")) : {};
      writeFileSync(
        settings,
        JSON.stringify(
          {
            ...atual,
            hooks: {
              SessionStart: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `node "${HOOK_QUEBRADO}" detect --hook claude-code`,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2
        ),
        "utf8"
      );
    },
    identifica: (achado) => achado.check === "broken-hook",
  },
  {
    id: "lockfile-drift",
    condicao: "sem-lockfile",
    // Unico caso que ja nasce em instalacao limpa: nao ha lockfile, entao nao ha o que plantar. O
    // passo "zero achados antes" nao se aplica a ele — e o `jaEstaEmLimpa` existe SO para isto, e
    // nao afrouxa o laco dos outros 15.
    jaEstaEmLimpa: true,
    planta: () => {},
    identifica: (achado) =>
      achado.check === "lockfile-drift" &&
      achado.severity === "unavailable",
  },
  {
    id: "missing-shared",
    condicao: "fonte-ausente",
    planta: (repo) => {
      apagarFonteCompartilhada(repo, dirSkillsRelativo(repo), catalog.CHARTER_INSTALLED);
    },
    identifica: (achado) =>
      achado.check === "missing-shared" &&
      achado.severity === "defect",
  },
  {
    id: "missing-shared",
    condicao: "manifesto-atrasado",
    planta: (repo) => {
      const manifesto = lerManifesto(repo);
      manifesto.version = VERSAO_VELHA;
      writeFileSync(
        path.join(repo, ".mgr-core", "manifest.json"),
        JSON.stringify(manifesto, null, 2),
        "utf8"
      );
    },
    identifica: (achado) =>
      achado.check === "missing-shared" &&
      achado.severity === "unavailable",
  },
];

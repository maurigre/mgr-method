import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as bundle from "./bundle.js";
import { diff } from "./lockfile.js";

// Verificacoes de integridade da instalacao (U2 do programa de superioridade).
//
// Cada verificacao e uma funcao PURA que recebe fato e devolve achados. Quem le disco e quem imprime
// sao outros, pela divisao da secao 2.1 da constituicao.
//
// A lista e FECHADA e cada verificacao declara o que nao alcanca: ausencia de achado significa "as
// verificacoes que eu faco nao acharam nada", nunca "esta integro". Mesma disciplina do `mgr audit`.
//
// Criterio de entrada, medido antes de qualquer codigo: verificacao sem CASO NEGATIVO conhecido nao
// entra. Alarme falso em caso normal treina quem usa a ignorar o comando, e isso e pior que a
// ausencia do comando.

export const DEFECT = "defect";
export const WARNING = "warning";
// Terceiro estado, e ele NAO e defeito nem aviso: a verificacao nao pode ser feita porque falta o
// insumo. Chamar isso de aviso faria o relatorio reclamar de projeto que so nao tem plugin.
export const UNAVAILABLE = "unavailable";

// A remediacao de cinco das seis verificacoes e a MESMA: rodar `mgr update`. Medido por experimento
// em 2026-09-18 — defeito plantado, update rodado, estado conferido. NAO ha `--fix`: o achado apenas
// NOMEIA o comando, e quem o roda e a pessoa (DT-5).
export const FIX_UPDATE = "mgr update";
export const NO_FIX = null;
export const FIX_RESTORE = "mgr install";

const achado = ({ check, severity, file, expected, found, fix }) => ({
  check, severity, file, expected, found, fix,
});

/**
 * Skill em disco que o manifesto nao declara.
 *
 * SEM correcao automatica, e a razao e um defeito ja publicado: na 0.6.0-beta.1 o `mgr remove` apagou
 * a skill do proprio metodo, e a correcao registrada foi "nunca apagar pasta que nao instalou".
 * Ninguem sabe de onde uma orfa veio — pode ser plugin, resto de instalacao ou arquivo posto a mao.
 */
export function orphanSkills({ declared, onDisk, skillsDir }) {
  return onDisk
    .filter((name) => !declared.includes(name))
    .map((name) => achado({
      check: "orphan-skill",
      severity: DEFECT,
      file: `${skillsDir}/${name}`,
      expected: "declarada no manifesto, ou ausente do disco",
      found: "em disco e fora do manifesto",
      fix: NO_FIX,
    }));
}

/** Skill que o manifesto declara e que nao esta em disco. */
export function missingSkills({ declared, onDisk, skillsDir }) {
  return declared
    .filter((name) => !onDisk.includes(name))
    .map((name) => achado({
      check: "missing-skill",
      severity: DEFECT,
      file: `${skillsDir}/${name}/SKILL.md`,
      expected: "presente, porque o manifesto a declara",
      found: "ausente",
      fix: FIX_UPDATE,
    }));
}

/** Agente que o manifesto declara e cujo arquivo nao existe. */
export function missingAgents({ declared, exists }) {
  return declared
    .filter((caminho) => !exists(caminho))
    .map((caminho) => achado({
      check: "missing-agent",
      severity: DEFECT,
      file: caminho,
      expected: "presente, porque o manifesto o declara",
      found: "ausente",
      fix: FIX_UPDATE,
    }));
}

/**
 * Arquitetura declarada sem a skill correspondente.
 *
 * Arquitetura nula nao e defeito: e instalacao que nao escolheu arquitetura, e o install permite.
 */
export function architectureSkill({ architecture, onDisk, skillsDir }) {
  if (!architecture) return [];
  const esperada = `arch-${architecture}`;
  if (onDisk.includes(esperada)) return [];
  return [achado({
    check: "architecture-skill",
    severity: DEFECT,
    file: `${skillsDir}/${esperada}/SKILL.md`,
    expected: `presente, porque o manifesto declara a arquitetura ${architecture}`,
    found: "ausente",
    fix: FIX_UPDATE,
  })];
}

// Token que o install resolve. Fonte unica em `src/catalog.js`; aqui basta o formato, porque a
// verificacao so precisa saber QUE a linha carrega token, nao qual.
const TOKEN = /\{\{MGR_[A-Z_]+\}\}/;

// O `+ 5` pula tambem a quebra de linha depois do fechamento, para a primeira linha do corpo ser a
// linha 1. Com `+ 4` o corpo comecava com linha vazia e todo numero relatado saia deslocado em 1.
const corpoDe = (texto) => {
  if (!texto.startsWith("---")) return texto;
  const fim = texto.indexOf("\n---", 3);
  return fim === -1 ? texto : texto.slice(fim + 5);
};

/**
 * Linhas do corpo que divergem entre a fonte e o instalado.
 *
 * Compara o CORPO, porque o frontmatter instalado carrega o que o install injeta por motor. E
 * **ignora a linha que carrega token na fonte**, porque o install a resolve por construcao —
 * compara-la acusaria 100% das instalacoes, inclusive as recem-feitas (medido: 7 de 7).
 *
 * Custo da omissao, medido em 2026-09-18: 24 de 1961 linhas do corpo das 13 skills carregam token,
 * ou seja 1%. Reusar o resolvedor do install seria mais preciso, mas acusaria quem mudou o idioma no
 * config depois de instalar — e isso e "instalacao velha", que tem verificacao propria. Dois alarmes
 * para o mesmo fato e o que a `RN-3` proibe.
 */
export function divergentBody({ name, source, installed, file }) {
  const daFonte = corpoDe(source).split("\n");
  const doInstalado = corpoDe(installed).split("\n");
  // A PRIMEIRA linha divergente, e nao a contagem: um bloco inserido desloca o indice e faz toda
  // linha seguinte "diferir", entao contar produziria numero inflado. Medido: uma secao a mais na
  // fonte do `spec-create` gera 116 linhas "diferentes", quando o fato e uma secao.
  const primeira = daFonte.findIndex((linha, ordem) => !TOKEN.test(linha) && linha !== doInstalado[ordem]);
  if (primeira === -1 && daFonte.length === doInstalado.length) return [];
  const ondeComeca = primeira === -1 ? Math.min(daFonte.length, doInstalado.length) + 1 : primeira + 1;
  return [achado({
    check: "divergent-body",
    severity: DEFECT,
    file,
    expected: `o corpo da skill ${name} como o pacote o traz`,
    found: `difere a partir da linha ${ondeComeca} do corpo`,
    // A P0.3 MEDIU que o `update` restaura o corpo. `NO_FIX` diria que nao ha o que fazer, e ha —
    // a `CA-8` cobra o comando exato, nao a ausencia de rotina propria de escrita.
    fix: FIX_UPDATE,
  })];
}

/**
 * Token que sobrou no instalado.
 *
 * O install resolve todos; sobrar um significa instalacao parcial, e o `mgr update` corrige —
 * medido por experimento.
 */
/**
 * A comparacao de corpo so DISTINGUE instalacao velha de arquivo adulterado quando as versoes batem.
 *
 * Com o manifesto atras do pacote, divergencia de corpo e o estado ESPERADO de quem ainda nao rodou
 * `mgr update` — reporta-la como defeito inverte a `CA-4` e da o alarme mais grave ao caso normal,
 * que e o que a `RN-3` proibe. Enquanto isso durar, a verificacao se declara INDISPONIVEL, como a do
 * lockfile ja faz quando nao ha lockfile.
 *
 * E **um** achado, nao um por skill: a causa e uma so, e dois alarmes para o mesmo fato e ruido.
 */
export function bodyCheckAvailability({ manifestVersion, packageVersion, file }) {
  if (manifestVersion === packageVersion) return [];
  return [achado({
    check: "divergent-body",
    severity: UNAVAILABLE,
    file,
    expected: "manifesto na versao do pacote, para a comparacao separar velho de adulterado",
    found: `manifesto em ${manifestVersion} e pacote em ${packageVersion}: a divergencia de corpo aqui e esperada`,
    fix: FIX_UPDATE,
  })];
}

export function unresolvedTokens({ installed, file }) {
  const sobraram = [...new Set(installed.match(new RegExp(TOKEN.source, "g")) || [])];
  if (!sobraram.length) return [];
  return [achado({
    check: "unresolved-token",
    severity: DEFECT,
    file,
    expected: "todo token resolvido pelo install",
    found: sobraram.join(" "),
    fix: FIX_UPDATE,
  })];
}

/**
 * Manifesto atras do pacote.
 *
 * **Aviso, nao defeito.** E o estado normal de quem nao rodou `update`, e trata-lo como defeito
 * faria o comando sair vermelho em quase todo projeto — o que a `RN-3` proibe. A separacao entre
 * "velha" e "adulterada" e o que impede o alarme falso.
 */
export function staleInstall({ manifestVersion, packageVersion, file }) {
  if (manifestVersion === packageVersion) return [];
  return [achado({
    check: "stale-install",
    severity: WARNING,
    file,
    expected: `a versao do pacote, ${packageVersion}`,
    found: manifestVersion,
    fix: FIX_UPDATE,
  })];
}

// O binario que um comando de hook invoca. O install escreve `node "<caminho absoluto>"`, e o
// caminho e o unico trecho entre aspas.
const BINARIO = /"([^"]+)"/;

/**
 * Hook que aponta para binario que nao existe.
 *
 * O caminho e ABSOLUTO e de maquina: um projeto movido de lugar, ou um metodo desinstalado, deixa o
 * hook apontando para o vazio — e a falha so aparece na proxima sessao do motor.
 *
 * **Sem correcao automatica:** reescrever o arquivo de settings mexe em configuracao de quem usa, e
 * ela pode ter conteudo que o metodo nao pos. Reportar e parar.
 */
export function brokenHooks({ hooks, exists, file }) {
  const achados = [];
  for (const [evento, entradas] of Object.entries(hooks ?? {})) {
    for (const entrada of entradas ?? []) {
      for (const comando of entrada.hooks ?? []) {
        const alvo = (comando.command ?? "").match(BINARIO)?.[1];
        if (!alvo || exists(alvo)) continue;
        achados.push(achado({
          check: "broken-hook",
          severity: DEFECT,
          file,
          expected: `o binario de ${evento} presente`,
          found: `${alvo} nao existe`,
          fix: NO_FIX,
        }));
      }
    }
  }
  return achados;
}

/**
 * Divergencia entre o lockfile e os plugins em disco.
 *
 * **Reusa `lockfile.diff()`**, que existe desde a Fase 1 e nunca teve consumidor de producao: ate
 * aqui so um teste a chamava. Reimplementar seria a duplicacao que a `QUAL-6` reprova.
 *
 * **Sem lockfile a verificacao se declara INDISPONIVEL**, e isso nao e erro: ele so existe onde ha
 * skill plugavel, e a maioria dos projetos nao tem.
 */
export function lockfileDrift({ lockfile, installedPlugins, diff, file }) {
  if (!lockfile) {
    return [achado({
      check: "lockfile-drift",
      severity: UNAVAILABLE,
      file,
      expected: "um lockfile, para haver o que comparar",
      found: "sem lockfile: o projeto nao tem skill plugavel",
      fix: NO_FIX,
    })];
  }
  // So o `missing`. O `unexpected` do `diff` e "em disco e fora do lockfile", que e exatamente o que
  // `orphanSkills` ja reporta — e dois alarmes para o mesmo fato e o que a `RN-3` proibe.
  const { missing } = diff(lockfile, installedPlugins);
  return missing.map((nome) => achado({
    check: "lockfile-drift",
    severity: DEFECT,
    file,
    expected: `${nome} instalada, porque o lockfile a trava`,
    found: "ausente",
    fix: FIX_RESTORE,
  }));
}

// ---------------------------------------------------------------------------
// Leitura de disco. Fica no nucleo pelo mesmo desenho de `validator.js` e `audit.js`: juntar
// manifesto, disco e pacote e LOGICA, e a secao 2.1 manda logica no nucleo. Acesso ao pacote so por
// `src/bundle.js` (secao 2.4).
// ---------------------------------------------------------------------------

export const AUDITED = "audited";
export const NO_INSTALL = "no-install";

const leJson = (caminho) => {
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Nomes do lockfile cuja pasta esta em disco.
 *
 * O lockfile guarda a pasta escolhida na instalacao em `entry.dir`, e o plugin vive em
 * `<dir de skills do motor>/<entry.dir>`. Presente em QUALQUER um dos diretorios conta como
 * instalado: o mesmo plugin pode ir para mais de um motor.
 */
const pluginsEmDisco = (lockfile, dirsDeSkills) =>
  Object.entries(lockfile?.skills ?? {})
    .filter(([, entrada]) => dirsDeSkills.some((base) => existsSync(path.join(base, entrada?.dir ?? "", "SKILL.md"))))
    .map(([nome]) => nome);

const skillsEmDisco = (dir) => {
  try {
    return readdirSync(dir).filter((nome) => existsSync(path.join(dir, nome, "SKILL.md"))).sort();
  } catch {
    return [];
  }
};

/**
 * Roda a lista fechada sobre um projeto.
 *
 * Devolve sempre a mesma forma, com `outcome` discriminando — o padrao que `plan-next`, `spec-status`
 * e `audit` ja usam, e que a `DES-1` pede no lugar de `null` como sentinela.
 *
 * **Nao escreve nada.** O comando e diagnostico; a acao e de quem le (DT-5).
 */
export function diagnose(repo, { packageVersion } = {}) {
  const coreDir = path.join(repo, ".mgr-core");
  const manifesto = leJson(path.join(coreDir, "manifest.json"));
  if (!manifesto) return { outcome: NO_INSTALL, findings: [], checks: 0 };

  const versaoDoPacote = packageVersion ?? bundle.readVersion();
  const dirDasSkills = (manifesto.skillsDirs ?? []).map((relativo) => path.join(repo, relativo));
  const emDisco = [...new Set(dirDasSkills.flatMap(skillsEmDisco))].filter((nome) => nome !== "_shared");
  const declaradas = manifesto.skills ?? [];
  const primeiroDir = dirDasSkills[0] ?? path.join(repo, ".claude", "skills");
  const relativoDoDir = path.relative(repo, primeiroDir) || ".";

  const achados = [
    ...orphanSkills({ declared: declaradas, onDisk: emDisco, skillsDir: relativoDoDir }),
    ...missingSkills({ declared: declaradas, onDisk: emDisco, skillsDir: relativoDoDir }),
    ...missingAgents({
      declared: manifesto.agents ?? [],
      exists: (relativo) => existsSync(path.join(repo, relativo)),
    }),
    ...architectureSkill({ architecture: manifesto.architecture, onDisk: emDisco, skillsDir: relativoDoDir }),
    ...staleInstall({ manifestVersion: manifesto.version, packageVersion: versaoDoPacote, file: ".mgr-core/manifest.json" }),
  ];

  // Roda ANTES do laco: se a comparacao de corpo esta indisponivel, ela nao roda por skill.
  const corpoIndisponivel = bodyCheckAvailability({
    manifestVersion: manifesto.version,
    packageVersion: versaoDoPacote,
    file: ".mgr-core/manifest.json",
  });
  achados.push(...corpoIndisponivel);

  for (const nome of emDisco) {
    const instalado = path.join(primeiroDir, nome, "SKILL.md");
    const daFonte = path.join(bundle.skillsDir(), nome, "SKILL.md");
    if (!existsSync(instalado)) continue;
    const conteudo = readFileSync(instalado, "utf8");
    const relativo = path.relative(repo, instalado);
    achados.push(...unresolvedTokens({ installed: conteudo, file: relativo }));
    if (!corpoIndisponivel.length && existsSync(daFonte)) {
      achados.push(...divergentBody({
        name: nome,
        source: readFileSync(daFonte, "utf8"),
        installed: conteudo,
        file: relativo,
      }));
    }
  }

  const arquivoDeHook = path.join(repo, ".claude", "settings.local.json");
  achados.push(...brokenHooks({
    hooks: leJson(arquivoDeHook)?.hooks,
    exists: (caminho) => existsSync(caminho),
    file: path.relative(repo, arquivoDeHook),
  }));

  // Os plugins REALMENTE em disco. Com a lista fixa em `[]`, todo plugin travado virava "ausente" e
  // o projeto com lockfile legitimo saia com defeito por plugin — alarme falso em caso normal.
  const travado = leJson(path.join(repo, "mgr-skills.lock"));
  achados.push(...lockfileDrift({
    lockfile: travado,
    installedPlugins: pluginsEmDisco(travado, dirDasSkills),
    diff,
    file: "mgr-skills.lock",
  }));

  return { outcome: AUDITED, findings: achados, checks: 9 };
}

/** Se o diagnostico BLOQUEIA: so `defect`. Aviso e indisponivel nao mudam o codigo de saida. */
export const hasDefect = ({ findings }) => findings.some(({ severity }) => severity === DEFECT);


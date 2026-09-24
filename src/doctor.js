import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as bundle from "./bundle.js";
import * as catalog from "./catalog.js";
import * as engineDescriptors from "./engines/index.js";
import { routeReviewSkill } from "./builder.js";
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
 * Fonte compartilhada cobrada quando o conjunto instalado a exige.
 *
 * As fontes compartilhadas sao regras transversais que todas as skills precisam respeitar ou
 * que algumas skills especializadas usam. `laws` e `charter` sao incondicionais (ADR-0011 e
 * ADR-0022), instaladas sempre; `arch` e `quality` dependem do conjunto de skills instaladas.
 * Quando uma fonte esta faltando, a remediacao e `mgr update`, que o `doctor` apenas NOMEIA
 * em vez de executar.
 */

/**
 * O que estas duas verificacoes de `_shared/` NAO alcancam, porque a lista e fechada e cada uma
 * declara o que omite (`src/doctor.js:11-12`, `RN-7`):
 *
 * - **so `.md`**: arquivo de outro formato sob `_shared/` nao entra na varredura de token;
 * - **conteudo extra nao e cobrado**: nao existe "orfa de `_shared/`", arquivo a mais nao acusa;
 * - **nada de semantica**: ponteiro que aponta para o arquivo ERRADO, mas existente, passa — isso
 *   segue sendo assunto do `CHT-4` em `scripts/check-laws.mjs`, que nao e distribuido;
 * - **nao separa skew de commit dentro da mesma versao**: o escudo compara VERSOES;
 * - **nao corrige**: o achado nomeia `mgr update`, quem roda e a pessoa;
 * - **escopo global fora de alcance**: o diretorio e resolvido contra o repositorio;
 * - **diretorio ilegivel** devolve o que deu para ler, sem achado proprio.
 *
 * Ausencia de achado nunca significa "a arvore compartilhada esta integra".
 */
export function missingShared({ expected, exists, skillsDir }) {
  return expected
    .filter((descritor) => !exists(path.join(skillsDir, ...descritor.installed)))
    .map((descritor) => achado({
      check: "missing-shared",
      severity: DEFECT,
      file: path.join(skillsDir, ...descritor.installed),
      expected: "presente, porque o conjunto instalado a exige",
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
    expected: `o corpo de ${name} como o pacote o traz`,
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

/**
 * Fonte compartilhada ausente porque o manifesto esta atras do pacote.
 *
 * Com o manifesto atras do pacote, a ausencia de uma fonte compartilhada e o estado ESPERADO
 * de quem ainda nao rodou `mgr update`. A ausencia de `charter/` e exatamente esse caso: ela
 * so passou a ser instalada com o ADR-0022, e projetos atualizados em duas fases ficam com o
 * manifesto declarando uma versao enquanto o pacote ja vem com `charter/`. Reportar como defeito
 * daria o alarme mais grave ao caso normal, que e o que a `RN-3` proibe.
 *
 * E **um** achado, nao um por fonte: a causa e uma so (manifesto velho), e dois alarmes para o
 * mesmo fato e ruido.
 */
export function sharedCheckAvailability({ manifestVersion, packageVersion, file }) {
  if (manifestVersion === packageVersion) return [];
  return [achado({
    check: "missing-shared",
    severity: UNAVAILABLE,
    file,
    expected: "manifesto na versao do pacote, para fontes compartilhadas estarem disponiveis",
    found: `manifesto em ${manifestVersion} e pacote em ${packageVersion}: a ausencia de fonte compartilhada aqui e esperada`,
    fix: FIX_UPDATE,
  })];
}

/**
 * Registro que enumera todas as verificações de integridade.
 *
 * A contagem de verificações e DERIVADA deste registro e nunca escrita em lugar nenhum do código.
 * Token e corpo em `_shared/` não são entradas novas, porque são alcance maior da mesma
 * verificação `divergent-body` e `unresolved-token` — mesmo id, mesma mensagem, mesma remediação.
 * Um documento que enumere as verificações tem de ter uma linha por entrada daqui.
 */
export const CHECKS = [
  { id: "orphan-skill", cobre: "skill em disco que o manifesto não declara" },
  { id: "missing-skill", cobre: "skill que o manifesto declara e que não está em disco" },
  { id: "missing-agent", cobre: "agente que o manifesto declara e cujo arquivo não existe" },
  { id: "architecture-skill", cobre: "arquitetura declarada sem a skill correspondente" },
  { id: "divergent-body", cobre: "corpo de arquivo que diverge entre a fonte e o instalado" },
  { id: "unresolved-token", cobre: "token não resolvido no instalado" },
  { id: "stale-install", cobre: "manifesto atrás do pacote" },
  { id: "broken-hook", cobre: "hook que aponta para binário que não existe" },
  { id: "lockfile-drift", cobre: "plugin travado e não instalado" },
  { id: "missing-shared", cobre: "fonte compartilhada cobrada quando o conjunto a exige" },
];

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

// Lê recursivamente todos os arquivos `.md` sob o diretório `_shared/` de um motor.
// Devolve lista vazia se o diretório não existir.
const arquivosMdEmShared = (dirDoMotor) => {
  const compartilhadoDir = path.join(dirDoMotor, catalog.SHARED_DIR);
  if (!existsSync(compartilhadoDir)) return [];

  const resultado = [];
  const lerRecursivo = (dir) => {
    try {
      const entradas = readdirSync(dir, { withFileTypes: true });
      for (const entrada of entradas) {
        const caminhoCompleto = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          lerRecursivo(caminhoCompleto);
        } else if (entrada.isFile() && entrada.name.endsWith(".md")) {
          resultado.push(caminhoCompleto);
        }
      }
    } catch {
      // Ignora erro de leitura: diretorio ilegivel devolve o que deu para ler, e a lista de limites
  // desta verificacao declara que ela nao alcanca isso. NAO e silencio por descuido — e limite
  // escrito, que e o que a `L2.6` exige de um instrumento que nao consegue fazer o trabalho todo.
    }
  };

  lerRecursivo(compartilhadoDir);
  return resultado;
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
  const emDisco = [...new Set(dirDasSkills.flatMap(skillsEmDisco))].filter((nome) => nome !== catalog.SHARED_DIR);
  const declaradas = manifesto.skills ?? [];
  const primeiroDir = dirDasSkills[0] ?? path.join(repo, ".claude", "skills");
  const relativoDoDir = path.relative(repo, primeiroDir) || ".";

  // As arvores a conferir, cada uma sabendo de QUE MOTOR e — nunca por posicao em `skillsDirs`, que
  // e a regra de `src/installer.js:82-83` e o defeito que ela custou.
  //
  // A QUEDA importa e foi paga com defeito real: instalacao feita com `--skills-dir` grava
  // `engines: ["custom"]`, e manifesto legado pode nao ter `engines` nenhum. Filtrar so por motor
  // conhecido deixava `arvores` VAZIA e o comando saia 0 sem conferir nada — medido em 2026-09-24
  // contra o commit de partida, que acusava. Sem motor reconhecido, cai para os `skillsDirs` do
  // manifesto, com `engine: null` (nenhuma transformacao por motor a esperar).
  const arvoresPorMotor = (manifesto.engines ?? [])
    .filter((e) => engineDescriptors.ids().includes(e))
    .map((engine) => ({ engine, dir: path.join(repo, engineDescriptors.get(engine).skillsDir[manifesto.scope]) }));
  const arvores = arvoresPorMotor.length
    ? arvoresPorMotor
    : dirDasSkills.map((dir) => ({ engine: null, dir }));

  // O gate de review e DERIVADO, e nao lido: o manifesto nao grava se ele estava ligado, porque
  // `src/installer.js:115` decidiu que campo duplicado diverge. O mesmo `gate` que liga o
  // `routeReviewSkill` instala o agente do gate, entao a presenca do arquivo do agente daquele motor
  // responde a pergunta. `test/doctor.test.js` trava essa equivalencia: se ela deixar de valer, e
  // vermelho e nao silencio.
  const gateLigado = (engine) => engine !== null && (manifesto.agents ?? [])
    .some((caminho) => path.basename(caminho)
      === engineDescriptors.get(engine).agentFile(catalog.REVIEW_GATE.agent));

  // O corpo que se ESPERA no motor, e nao a fonte crua: cada motor transforma a skill do gate do
  // seu jeito (`routing` no descritor), e comparar contra a fonte crua acusaria toda instalacao
  // limpa daquele motor. Medido em 2026-09-24 no copilot, que acrescenta um bloco ao corpo.
  const corpoEsperado = (engine, nome, fonte) => (nome === catalog.REVIEW_GATE.skill && gateLigado(engine)
    ? routeReviewSkill(engine, fonte)
    : fonte);

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

  // Roda ANTES do laco: se a disponibilidade de fonte compartilhada esta indisponivel,
  // ela nao roda por motor.
  const compartilhadoIndisponivel = sharedCheckAvailability({
    manifestVersion: manifesto.version,
    packageVersion: versaoDoPacote,
    file: catalog.SHARED_DIR,
  });
  achados.push(...compartilhadoIndisponivel);

  // Por MOTOR, e nunca por posicao em `skillsDirs` — a regra esta em `src/installer.js:82-83`, e o
  // custo dela tambem: indexar por posicao fazia o hook do copilot anunciar a arvore do claude-code.
  // Medido em 2026-09-24: sem isto, defeito plantado no segundo motor saia com o comando dando 0.
  for (const { engine, dir: dirDoMotor } of arvores) {
    for (const nome of emDisco) {
      const instalado = path.join(dirDoMotor, nome, "SKILL.md");
      if (!existsSync(instalado)) continue;
      const daFonte = path.join(bundle.skillsDir(), nome, "SKILL.md");
      const conteudo = readFileSync(instalado, "utf8");
      const relativo = path.relative(repo, instalado);
      achados.push(...unresolvedTokens({ installed: conteudo, file: relativo }));
      if (!corpoIndisponivel.length && existsSync(daFonte)) {
        achados.push(...divergentBody({
          name: nome,
          source: corpoEsperado(engine, nome, readFileSync(daFonte, "utf8")),
          installed: conteudo,
          file: relativo,
        }));
      }
    }

    // Token nao resolvido em `_shared/` roda SEMPRE, fora do escudo de versao: subarvore pode
    // legitimamente nao existir numa versao anterior, mas token sobrando nunca e legitimo em versao
    // alguma — significa que o install falhou em resolve-lo (RN-5, decisao 2 do CHECKPOINT 1).
    for (const arquivo of arquivosMdEmShared(dirDoMotor)) {
      const conteudo = readFileSync(arquivo, "utf8");
      const relativo = path.relative(repo, arquivo);
      achados.push(...unresolvedTokens({ installed: conteudo, file: relativo }));
    }

    // Existencia e corpo, esses sim sob o escudo: com o manifesto atras do pacote, a ausencia de uma
    // fonte compartilhada e o estado esperado de quem ainda nao rodou `mgr update`.
    if (!compartilhadoIndisponivel.length) {
      const necessarias = catalog.requiredShared(declaradas);
      const dirRelativoDoMotor = path.relative(repo, dirDoMotor) || ".";
      achados.push(...missingShared({
        expected: necessarias,
        exists: (caminho) => existsSync(path.join(repo, caminho)),
        skillsDir: dirRelativoDoMotor,
      }));

      // Corpo divergente em _shared/
      if (!corpoIndisponivel.length) {
        for (const descritor of necessarias) {
          const caminhoInstalado = path.join(dirDoMotor, ...descritor.installed);
          if (!existsSync(caminhoInstalado)) continue;
          const daFonte = path.join(bundle.sharedDir(), ...descritor.inPackage);
          if (!existsSync(daFonte)) continue;
          const conteudo = readFileSync(caminhoInstalado, "utf8");
          const relativo = path.relative(repo, caminhoInstalado);
          const nomeDescritivo = descritor.installed.join("/");
          achados.push(...divergentBody({
            name: nomeDescritivo,
            source: readFileSync(daFonte, "utf8"),
            installed: conteudo,
            file: relativo,
          }));
        }
      }
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

  return { outcome: AUDITED, findings: achados, checks: CHECKS.length };
}

/** Se o diagnostico BLOQUEIA: so `defect`. Aviso e indisponivel nao mudam o codigo de saida. */
export const hasDefect = ({ findings }) => findings.some(({ severity }) => severity === DEFECT);


// Medidor de custo de comissões — núcleo puro (task P0.1) e IO com resolução
// de caminho (task P1.1).
// Ferramenta de desenvolvimento do repo — fora do tarball npm.
//
// Uso:
//   estimateTokens(chars)     — L3.3 completa: chars * 0.25 * 1.2
//   parseCostTable(texto)     — parse da tabela sob ## Custo de comissão
//   measureArtifacts(lista)   — agrega e calcula totais
//   resolveSlugPath(slug)     — DT-9: tenta mgr spec status, cai em layout literal
//   measureSlice(slug)        — lê artefatos e registro, imprime saída
//   main(argv)                — entry point, resolve exit code por DT-2

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// O 1.2 existe porque essa fatia inteira foi medida com chars / 4 — metade da
// formula — e todos os numeros sairam 20% baixos. A formula completa ja estava
// na L3.3, e o 1.2 e a outra metade da lei, nao margem de seguranca. Remover o
// 1.2 volta a meia formula e vai quebrar o teste P3.
export function estimateTokens(chars) {
  return Math.trunc(chars * 0.25 * 1.2);
}

// Parseia a tabela de custo da secao ## Custo de comissão (ou sem acento,
// ## Custo de comissao). A tabela tem exatamente 8 colunas:
// task | agente | modelo | esforço | tokens | chamadas | determinado | linhas
//
// Problemas relatados (cada um nomeado com a linha): secao inexistente,
// linha com numero de colunas != 8, tokens ou chamadas nao inteiro,
// `determinado` fora de forma/decisao, `linhas` nao inteiro nem travessao, e
// tabela sem nenhuma linha de dado.
//
// NUNCA ignora linha malformada em silencio — isso e o defeito que a L2.6
// proibe. Instrumento que pula erro sem relatar promete verificacao que
// nao entrega.
//
// "30.717" com ponto NAO e inteiro valido — separador de milhar e ambiguo
// entre locales, e o parser nao deve adivinhar qual locale o usuario esperava.
// Marcador de custo nao devolvido pelo harness (task feita no orquestrador). Travessao
// unicode porque e o que o autor escreve na tabela, e um ASCII `-` seria ambiguo com
// subtracao ou com linha de separador.
const NAO_DEVOLVIDO = "\u2014";
const DETERMINADO_VALIDO = ["forma", "decisao"];

export function parseCostTable(texto) {
  const linhas = [];
  const problemas = [];

  // Busca pela secao — aceita com acento ou sem.
  const regexSecao = /^##\s+Custo de comiss[ãa]o\s*$/m;
  const matchSecao = texto.match(regexSecao);

  if (!matchSecao) {
    problemas.push("Secao '## Custo de comissao' nao encontrada");
    return { linhas, problemas };
  }

  // Encontra o indice onde a secao comeca.
  const indiceSecao = texto.substring(0, matchSecao.index).split("\n").length - 1;

  // Processa as linhas apos a secao.
  const linhasTexto = texto.split("\n");
  let candidatas = 0;
  let processandoTabela = false;

  for (let i = indiceSecao + 1; i < linhasTexto.length; i++) {
    const linha = linhasTexto[i];

    // Primeira linha que comeca com | marca o inicio da tabela.
    if (!processandoTabela && linha.trim().startsWith("|")) {
      processandoTabela = true;
      continue;
    }

    // Linha de separador (exemplo: |---|---|---|---|---|---|).
    if (processandoTabela && linha.trim().match(/^\|(\s*-+\s*\|)+\s*$/)) {
      continue;
    }

    // Para na primeira linha que nao e tabela apos encontrar dados.
    if (processandoTabela && !linha.trim().startsWith("|")) {
      break;
    }

    // Processa linhas de dado da tabela.
    if (processandoTabela && linha.trim().startsWith("|")) {
      candidatas += 1;
      const colunas = linha.split("|").map((col) => col.trim()).filter((col) => col);

      // Valida numero de colunas.
      if (colunas.length !== 8) {
        problemas.push(`Linha ${i + 1}: esperadas 8 colunas, obteve ${colunas.length}`);
        continue;
      }

      // Extrai os campos.
      const [task, agente, modelo, esforco, tokensStr, chamadasStr, determinadoStr, linhasStr] = colunas;

      // Valida determinado — deve ser "forma" ou "decisao".
      if (!DETERMINADO_VALIDO.includes(determinadoStr)) {
        problemas.push(`Linha ${i + 1}: 'determinado' nao e "forma" nem "decisao": "${determinadoStr}"`);
        continue;
      }

      // Task feita no proprio orquestrador nao tem numero devolvido: o harness so reporta
      // custo de COMISSAO. Medido na propria fatia: as tasks P1.3 e P2.1 foram escritas no
      // orquestrador, e nao existe fonte para o custo delas — ele cai na primeira das tres
      // parcelas que a saida declara nao medir. `NAO_DEVOLVIDO` e a declaracao disso: a
      // linha CONTA como presente (a task nao e lacuna de registro), e fica FORA do total,
      // com a exclusao declarada. Zero seria afirmar que foi de graca.
      if (tokensStr === NAO_DEVOLVIDO && chamadasStr === NAO_DEVOLVIDO) {
        linhas.push({
          task,
          agente,
          modelo,
          esforco,
          tokens: NAO_DEVOLVIDO,
          chamadas: NAO_DEVOLVIDO,
          determinado: determinadoStr,
          linhasEntregues: linhasStr === NAO_DEVOLVIDO ? NAO_DEVOLVIDO : Number(linhasStr),
        });
        continue;
      }

      // Valida tokens como inteiro.
      if (!tokensStr || !/^\d+$/.test(tokensStr)) {
        problemas.push(`Linha ${i + 1}: 'tokens' nao e inteiro valido: "${tokensStr}"`);
        continue;
      }

      // Valida chamadas como inteiro.
      if (!chamadasStr || !/^\d+$/.test(chamadasStr)) {
        problemas.push(`Linha ${i + 1}: 'chamadas' nao e inteiro valido: "${chamadasStr}"`);
        continue;
      }

      // Valida linhas — aceita inteiro ou NAO_DEVOLVIDO.
      if (linhasStr !== NAO_DEVOLVIDO && !/^\d+$/.test(linhasStr)) {
        problemas.push(`Linha ${i + 1}: 'linhas' nao e inteiro nem travessao: "${linhasStr}"`);
        continue;
      }

      linhas.push({
        task,
        agente,
        modelo,
        esforco,
        tokens: Number(tokensStr),
        chamadas: Number(chamadasStr),
        determinado: determinadoStr,
        linhasEntregues: linhasStr === NAO_DEVOLVIDO ? NAO_DEVOLVIDO : Number(linhasStr),
      });
    }
  }

  // Tabela VAZIA e achado. Tabela com linha RECUSADA nao e: a recusa ja foi relatada
  // com o numero da linha, e repetir a consequencia ao lado da causa daria dois achados
  // para um defeito. Medido na P1.2: o caso de coluna faltando devolvia 2 problemas, e o
  // teste esperava 1. Nomear a causa, nunca a consequencia.
  if (processandoTabela && candidatas === 0) {
    problemas.push("Tabela sob '## Custo de comissao' nao tem nenhuma linha de dado");
  }

  return { linhas, problemas };
}

// Recebe lista de artefatos com nome e tamanho em caracteres, devolve
// medições agregadas. Cada artefato ganha o calculo de tokens pela L3.3.
// Lista vazia devolve totais em 0 — nao e problema, porque quem decide se
// a ausencia importa e a P1.1 (IO e decisoes sobre o resultado).
export function measureArtifacts(lista) {
  const artefatos = lista.map((item) => ({
    nome: item.nome,
    linhas: item.linhas,
    tokens: estimateTokens(item.chars),
  }));

  const totalLinhas = artefatos.reduce((sum, a) => sum + a.linhas, 0);
  const totalTokens = artefatos.reduce((sum, a) => sum + a.tokens, 0);

  return { artefatos, totalLinhas, totalTokens };
}

// DT-9: resolve caminho da fatia via mgr spec status --json, cai em layout literal.
// Devolve { paths, method, problem } onde paths e lista de caminhos dos artefatos
// declarados. Se method == "literal layout" e nao tem arquivo no disco, problem sera
// nomeado. Se spec status falhar, cai automaticamente para layout literal.
// `specsDir` e injetado (Humble Object, o mesmo padrao do `fetchImpl` em src/registry.js e
// do `exists = existsSync` em src/installer.js). Sem ele, testar a contagem de artefato
// extra exigia ESCREVER dentro de `specs/` — a pasta real de especificacoes do projeto —
// durante o `npm test`. Medido na P1.2: o teste criava `specs/test-measure-cost-<ts>/`
// porque nao havia outra via, e lixo ficaria lá se a limpeza nao chegasse ao `finally`.
export function resolveSlugPath(slug, specsDir = "specs", registra = console.error) {
  // Tenta mgr spec status <slug> --json primeiro.
  // O CLI so resolve fatia sob `specs/`. Com `specsDir` injetado o chamador mede outra
  // arvore, logo o CLI nao se aplica e o ramo literal e o certo — nao um fallback por
  // falha. A saida declara qual dos dois foi usado.
  // LOG-2: par de logs em volta do subprocesso, no formato do check-clean.mjs:34-37.
  const usaCli = specsDir === "specs";
  if (usaCli) registra(`  resolvendo caminhos de ${slug} via mgr spec status`);
  const resultado = !usaCli ? { status: 1 } : spawnSync(process.execPath, ["bin/mgr.js", "spec", "status", slug, "--json"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (usaCli) registra(`  mgr spec status devolveu status ${resultado.status}`);

  if (resultado.status === 0 && resultado.stdout) {
    try {
      const payload = JSON.parse(resultado.stdout);
      if (payload.artifacts && Array.isArray(payload.artifacts)) {
        const canonicos = payload.artifacts
          .filter((art) => art.status === "present")
          .map((art) => art.path);
        // O `spec status` devolve SO os 6 artefatos canonicos. Um .md extra na pasta da
        // fatia (registro de leitura de fonte, medicao de apoio) ficava de fora EM
        // SILENCIO, e o total era apresentado como o da fatia — omissao silenciosa, que
        // e o que a L2.6 e a DT-7 proibem. Medido na propria fatia que criou este
        // instrumento: 6 arquivos em disco, 5 contados.
        const extras = extraArtifacts(payload.specRoot || join(specsDir, slug), canonicos);
        return { paths: [...canonicos, ...extras], canonicos, extras, method: "mgr spec status", problems: [] };
      }
    } catch {
      // JSON invalido: cai no fallback literal, que e a resposta. O erro em si nao
      // informa nada que a saida nao diga ao declarar qual caminho foi usado.
    }
  }

  // Fallback: layout literal specs/<slug>/*.md.
  const sliceDir = join(specsDir, slug);
  if (!existsSync(sliceDir)) {
    return { paths: [], canonicos: [], extras: [], method: "literal layout", problems: [`Diretorio da fatia nao existe: ${sliceDir}`] };
  }

  const arquivos = readdirSync(sliceDir)
    .filter((nome) => nome.endsWith(".md"))
    .map((nome) => join(sliceDir, nome))
    .sort();

  if (arquivos.length === 0) {
    return { paths: [], canonicos: [], extras: [], method: "literal layout", problems: [`Nenhum artefato .md encontrado em ${sliceDir}`] };
  }

  // No fallback nao existe "canonico" declarado: tudo que esta na pasta e artefato.
  return { paths: arquivos, canonicos: arquivos, extras: [], method: "literal layout", problems: [] };
}

// Os .md da pasta da fatia que o `spec status` nao declarou. Nada e descartado: o que
// nao e canonico aparece marcado como extra, com a origem declarada na saida.
function extraArtifacts(sliceDir, canonicos) {
  if (!existsSync(sliceDir)) return [];
  const jaContados = new Set(canonicos.map((caminho) => caminho.split("/").pop()));
  return readdirSync(sliceDir)
    .filter((nome) => nome.endsWith(".md") && !jaContados.has(nome))
    .map((nome) => join(sliceDir, nome))
    .sort();
}

// Le os artefatos .md de uma lista de caminhos, retorna artefatos com chars/linhas
// e lista de problemas (artefatos declarados que nao existem).
export function readSliceArtifacts(declaredPaths) {
  const artefatos = [];
  const findings = [];

  for (const caminho of declaredPaths) {
    if (!existsSync(caminho)) {
      findings.push(`Artefato declarado nao existe: ${caminho}`);
      continue;
    }

    const conteudo = readFileSync(caminho, "utf8");
    const linhas = conteudo.split("\n").length - 1;
    // `conteudo.length` conta CARACTERE, nao byte — e "1 character" e o que a L3.3 diz.
    // Quem escreveu esta fatia mediu primeiro com `chars / 4` (20% baixo) e depois com
    // tamanho em BYTES (3% alto em texto acentuado, porque `ã` ocupa 2 bytes e e 1
    // caractere). As duas medicoes estavam erradas; esta nao.
    const chars = conteudo.length;
    const nome = caminho.split("/").pop();

    artefatos.push({ nome, linhas, chars });
  }

  return { artefatos, findings };
}

// Le o arquivo 05-execution.md da fatia e extrai a tabela de custo.
// Retorna { linhas, problemas } onde problemas vem de parseCostTable.
function readExecutionRecord(sliceDir) {
  const executionPath = join(sliceDir, "05-execution.md");

  if (!existsSync(executionPath)) {
    return { linhas: [], problemas: ["05-execution.md nao encontrado"] };
  }

  const conteudo = readFileSync(executionPath, "utf8");
  return parseCostTable(conteudo);
}

// Le o arquivo 04-plan.md e extrai tasks que estao com status: done.
// Devolve lista de IDs de task (ex: ["P0.1", "P0.2"]).
//
// A FORMA do cabecalho e a mesma que `src/plan-parser.js:18` aceita: `#{2,4}` seguido do id,
// SEM exigir travessao. Isto e uma SEGUNDA COPIA dessa forma, e e defeito conhecido desta casa
// — fonte unica exigiria exportar `TASK_HEADER` de `src/plan-parser.js`, e o `CA-8` desta fatia
// proibe tocar `src/`. Fica nomeado como fatia propria, nao como desenho aceitavel.
//
// Medido em 2026-10-01: a versao anterior exigia `###` E travessao. O plano desta fatia usa
// `##`, logo `readDoneTasks` devolvia ZERO task e a conferencia do `DT-7` **nao podia falhar**
// — ausencia de achado nao era conformidade. `L2.6`: instrumento que nao falha nao mede nada.
const TASK_HEADER = /^#{2,4}\s+(P\d+\.\d+)\b/;

function readDoneTasks(sliceDir) {
  const planPath = join(sliceDir, "04-plan.md");

  if (!existsSync(planPath)) {
    return [];
  }

  const linhas = readFileSync(planPath, "utf8").split("\n");

  // Os inicios primeiro, para que o fim de cada secao seja o inicio da seguinte. A versao
  // anterior usava `linhas.indexOf(linha)`, que devolve a PRIMEIRA ocorrencia do texto da
  // linha — dois cabecalhos iguais apontariam para a mesma secao.
  const inicios = [];
  for (let i = 0; i < linhas.length; i++) {
    const match = linhas[i].match(TASK_HEADER);
    if (match) inicios.push({ id: match[1], linha: i });
  }

  const tasks = [];
  for (let k = 0; k < inicios.length; k++) {
    const fim = k + 1 < inicios.length ? inicios[k + 1].linha : linhas.length;
    const textoSecao = linhas.slice(inicios[k].linha, fim).join("\n");
    if (textoSecao.includes("- **status:** done")) {
      tasks.push(inicios[k].id);
    }
  }

  return tasks;
}

// Confere se tasks com status done tem linha correspondente no registro de custo.
// Devolve lista de nomes de tasks que estao done mas sem registro.
// `linhasRecusadas` > 0 significa que o registro tem linha que o parser nao conseguiu ler,
// logo NAO se sabe quais tasks estao registradas. Afirmar "sem linha no registro" ali seria
// relatar a CONSEQUENCIA de um defeito ja nomeado — o principio que este arquivo declara
// na secao da tabela vazia. Medido em 2026-10-01 contra `metodo-mede-o-custo`, que esta na
// forma de 6 colunas: a versao sem esta guarda devolvia **7 afirmacoes falsas**, uma por
// task, dizendo que a linha nao existia quando ela existe. Em vez delas, uma declaracao do
// que NAO foi conferido — silencio nao e aprovacao.
function checkDoneTasksInRecord(sliceDir, costRecords, linhasRecusadas = 0) {
  const doneTasks = readDoneTasks(sliceDir);
  if (linhasRecusadas > 0) {
    if (doneTasks.length === 0) return [];
    return [
      `Registro com ${linhasRecusadas} linha(s) recusada(s): a conferencia de task done sem `
      + `linha de custo NAO foi feita para as ${doneTasks.length} task(s) done`,
    ];
  }
  const recordTasks = new Set(costRecords.map((r) => r.task));
  const missings = [];

  for (const taskId of doneTasks) {
    if (!recordTasks.has(taskId)) {
      missings.push(`Task ${taskId} com status done mas sem linha no registro de custo`);
    }
  }

  return missings;
}

// Formata a saida VERBATIM conforme a secao 3 da spec.
// `TOTAL 0 0` e `artefato / comissao: 0,0%` sao numeros plausiveis para uma fatia que custou
// centenas de milhares de tokens — exatamente o que a `L2.6` chama de instrumento que nao mede
// nada. Medido contra `metodo-mede-o-custo`: imprimia `0,0%` para ~213k de comissao.
//
// A PRIMEIRA versao desta guarda olhava `cost.linhas.length === 0 && cost.recusadas > 0`, e o
// gate isolado de 2026-10-01 mostrou que ela cobria UM dos dois caminhos: fatia inteira feita
// no orquestrador parseia sem recusa, soma zero, e caia no ramo normal imprimindo `0,0%` **sem
// nenhum achado**. Medido. A condicao certa nao e sobre COMO o total ficou vazio — e sobre o
// total estar vazio, e por isso ela e derivada DEPOIS do laco.
function formatOutput(slug, method, measured, cost) {
  let output = `measure:cost — ${slug}  (caminhos via ${method === "mgr spec status" ? "mgr spec status" : "layout literal"})\n\n`;

  // Tabela de artefatos.
  output += "  artefato                  linhas   tokens (estimado)\n";
  for (const art of measured.artefatos) {
    const nomeFormatado = art.nome.padEnd(26);
    const linhasFormatado = String(art.linhas).padStart(6);
    const tokensFormatado = String(art.tokens).padStart(13);
    output += `  ${nomeFormatado}${linhasFormatado}${tokensFormatado}\n`;
  }
  output += `  ${"TOTAL".padEnd(26)}${String(measured.totalLinhas).padStart(6)}${String(measured.totalTokens).padStart(13)}\n\n`;

  // Tabela de custo de comissao.
  output += "  custo de comissao (do registro em 05-execution.md)\n";
  // O cabecalho e MONTADO com as mesmas larguras das linhas de dado, nunca escrito a mao. A
  // versao literal anterior dava `tokens` 9 e `chamadas` 8 onde os dados usam 7 e 9: um
  // deslocamento de uma coluna, invisivel a olho e visivel no `cat -A`. Larguras escritas em
  // dois lugares divergem — e divergiram.
  output += `  ${"task".padEnd(10)}${"agente".padEnd(14)}${"modelo".padEnd(8)}${"esforco".padEnd(9)}`
    + `${"tokens".padStart(7)}${"chamadas".padStart(9)}  ${"determinado".padEnd(13)}${"linhas".padStart(6)}\n`;

  // `tokens`/`chamadas` trazem o travessao `NAO_DEVOLVIDO` quando o harness nao devolveu
  // numero (task do orquestrador). Imprimir `0` afirmaria que foi de graca; o travessao diz
  // o que e: nao ha numero. Nao se usa `null` aqui — DES-1/QUAL-1 proibem sentinela.
  const semNumero = (valor, largura) => String(valor).padStart(largura);
  let totalTokensComissao = 0;
  let totalChamadas = 0;
  let totalLinhasEntregues = 0;
  let semTamanho = 0;
  let semCusto = 0;
  for (const linha of cost.linhas) {
    const taskFormatado = linha.task.padEnd(10);
    const agenteFormatado = linha.agente.padEnd(14);
    const modeloFormatado = linha.modelo.padEnd(8);
    const esforcoFormatado = linha.esforco.padEnd(9);
    const tokensFormatado = semNumero(linha.tokens, 7);
    const chamadasFormatado = semNumero(linha.chamadas, 9);
    if (linha.tokens === NAO_DEVOLVIDO) semCusto += 1;
    const determinadoFormatado = String(linha.determinado).padEnd(13);
    const linhasFormatado = semNumero(linha.linhasEntregues, 6);
    output += `  ${taskFormatado}${agenteFormatado}${modeloFormatado}${esforcoFormatado}${tokensFormatado}${chamadasFormatado}  ${determinadoFormatado}${linhasFormatado}\n`;
    if (linha.tokens !== NAO_DEVOLVIDO) totalTokensComissao += linha.tokens;
    if (linha.chamadas !== NAO_DEVOLVIDO) totalChamadas += linha.chamadas;
    // `linhas` fora do total pela mesma razao que `tokens`: travessao e ausencia declarada,
    // e somar zero no lugar afirmaria que a task nao entregou nada.
    if (linha.linhasEntregues === NAO_DEVOLVIDO) semTamanho += 1;
    else totalLinhasEntregues += linha.linhasEntregues;
  }
  const naoMensuravel = totalTokensComissao === 0;
  if (naoMensuravel) {
    output += `  ${"TOTAL".padEnd(10)}${" ".padEnd(14)}${" ".padEnd(8)}${" ".padEnd(9)}${"nao medido".padStart(16)}  ${" ".padEnd(13)}${String(totalLinhasEntregues).padStart(6)}\n`;
  } else {
    output += `  ${"TOTAL".padEnd(10)}${" ".padEnd(14)}${" ".padEnd(8)}${" ".padEnd(9)}${String(totalTokensComissao).padStart(7)}${String(totalChamadas).padStart(9)}  ${" ".padEnd(13)}${String(totalLinhasEntregues).padStart(6)}\n`;
  }
  // A exclusao e DECLARADA. Total que some linha sem numero mentiria; total que as omita
  // sem dizer quantas foram esconderia a parcela — as duas coisas que a L2.6 proibe.
  if (semCusto > 0) {
    output += `  ${semCusto} linha(s) com custo NAO DEVOLVIDO, fora do total (task feita no orquestrador)\n`;
  }
  if (semTamanho > 0) {
    output += `  ${semTamanho} linha(s) sem tamanho entregue, fora do total de linhas\n`;
  }
  output += "\n";

  // Razao artefato / comissao.
  let razao = 0;
  if (totalTokensComissao > 0) {
    razao = (measured.totalTokens / totalTokensComissao) * 100;
  }
  if (naoMensuravel) {
    output += "  artefato / comissao: nao medido (nenhuma linha do registro devolveu custo)\n\n";
  } else {
    const razaoFormatada = razao.toFixed(1).replace(".", ",");
    output += `  artefato / comissao: ${razaoFormatada}%\n\n`;
  }

  // Bloco do NAO medido.
  output += "  NAO medido: a janela do orquestrador, o retrabalho de comissao que voltou\n";
  output += "  errada, e as idas e voltas com o autor. Isto e o custo das COMISSOES, nunca\n";
  output += "  o custo da sessao.\n\n";

  // Nota sobre tokens estimados.
  output += "  tokens sao ESTIMADOS pela L3.3 (0,25/caractere + 20%); contagem real exigiria\n";
  output += "  chamada de API, que este metodo nao faz.\n";

  return output;
}

// Orquestra a medicao: resolve caminho, le artefatos, le registro, imprime saida.
// Devolve { problems, canMeasure } onde canMeasure indica se conseguiu medir
// (decisão de exit code por DT-2).
// `specsDir` existe para TESTE, e nao por generalidade especulativa: sem ele o `main` so
// alcanca `specs/`, que neste projeto e gitignored — logo em checkout limpo a metade "exit 0"
// do `CA-4` nunca executava, e o gate de 2026-10-01 reprovou exatamente isso. O default
// mantem o comportamento do CLI identico.
export function measureSlice(slug, specsDir = "specs") {
  const { paths, method, problems: resolveProblems } = resolveSlugPath(slug, specsDir);

  // DT-2: fatia inexistente ou caminho que nao resolve = exit != 0.
  if (resolveProblems.length) {
    return { findings: resolveProblems, canMeasure: false, output: "" };
  }

  // Le artefatos.
  const { artefatos, findings: artifactFindings } = readSliceArtifacts(paths);
  let findings = artifactFindings;

  // Le registro de custo.
  const sliceDir = join(specsDir, slug);
  const { linhas: costLinhas, problemas: costProblemas } = readExecutionRecord(sliceDir);
  findings = findings.concat(costProblemas);

  // Confere tasks done sem registro (DT-7).
  const missingTaskRecords = checkDoneTasksInRecord(sliceDir, costLinhas, costProblemas.length);
  findings = findings.concat(missingTaskRecords);

  // Calcula totais dos artefatos.
  const measured = measureArtifacts(artefatos);

  // A saida e DEVOLVIDA, nao impressa aqui. Quem imprime e o `main`. Sem esta costura nao
  // havia ponto onde afirmar o TEXTO, e duas das cinco mutacoes que a §4 da spec planejou
  // (remover a declaracao do que nao e medido; numero alto virar exit != 0) **nao tinham
  // como ficar vermelhas** — achados E1/E2 do gate isolado.
  const output = formatOutput(slug, method, measured, { linhas: costLinhas, recusadas: costProblemas.length });

  // DT-2: mediu, com ou sem achado, exit 0.
  return { findings, canMeasure: true, output };
}

// Entry point: processa argumentos, imprime, decide exit code por DT-2.
// EXPORTADO para o teste poder afirmar o exit code por valor, sem subir processo.
export function main(argv, imprime = console.log, specsDir = "specs") {
  if (argv.length === 0) {
    console.error("erro: slug nao informado");
    return 1;
  }

  const slug = argv[0];
  const { canMeasure, findings, output } = measureSlice(slug, specsDir);
  if (output) imprime(output);
  // DT-7: achado e impresso e NAO muda o exit code.
  for (const finding of findings) imprime(`  ACHADO: ${finding}`);

  // DT-2: exit 0 se mediu (com ou sem achado); exit != 0 se nao conseguiu medir.
  return canMeasure ? 0 : 1;
}

// Roda main() apenas quando o arquivo e executado diretamente, nao quando importado
// (permite que os testes importem as funcoes sem rodar nada, padrao do check-laws.mjs).
if (process.argv[1] && process.argv[1].endsWith("measure-cost.mjs")) {
  process.exit(main(process.argv.slice(2)));
}

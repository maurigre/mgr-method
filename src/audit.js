// Inferência das quatro classes de capacidade perigosa do ADR-0007:26-33, no conteúdo de uma skill.
//
// Devolve achados com linha e trecho, nunca veredito: ausência de achado não atesta segurança, e a
// lista de ferramentas de uma skill NÃO é inferida. As duas restrições, e a medição que produziu
// cada limite do detector, estão no ADR-0021.

import path from "node:path";
import { readFileSync } from "node:fs";
import * as bundle from "./bundle.js";
import { frontmatter } from "./validator.js";

// As quatro classes, com o nome em inglês (ADR-0003: identificadores no distribuído em inglês).
export const EXFILTRATION = "exfiltration";
export const EMBEDDED_SHELL = "embedded-shell";
export const SELF_MODIFICATION = "self-modification";
export const OVERRIDE_ATTEMPT = "override-attempt";

export const CLASSES = [EXFILTRATION, EMBEDDED_SHELL, SELF_MODIFICATION, OVERRIDE_ATTEMPT];

// Lista FECHADA: casar qualquer palavra seguida de argumento marcaria prosa comum.
const EXECUTAVEIS = "npm|node|npx|git|bash|sh|zsh|python3?|pip3?|mvn|gradle|make|docker|kubectl|curl|wget|jq|rg|grep|sed|awk|find|rm|mv|cp|chmod|chown|mkdir|cat|tar|unzip|ssh|scp|eval|mgr";
const EM_CRASE = new RegExp("`\\s*(?:" + EXECUTAVEIS + ")\\s+[^`]*`");
const ABRE_BLOCO_SHELL = /^\s*```\s*(?:bash|sh|shell|zsh|console|terminal)\b/i;
// Cerca sem tag só conta quando a primeira linha não vazia começa com executável; sem isso, todo
// bloco de exemplo de formato viraria achado.
const ABRE_BLOCO_SEM_TAG = /^\s*```\s*$/;
// Três crases ou mais: a cerca de quatro é markdown aninhado, e exigir exatamente três a deixava
// sem fechar, tornando todo o resto do arquivo um achado.
const FECHA_BLOCO = /^\s*`{3,}\s*$/;
const COMECA_COM_EXECUTAVEL = new RegExp("^\\s*(?:" + EXECUTAVEIS + ")\\s");

// O endereço local fica fora: apontar para o próprio app em execução é uso legítimo, e marcá-lo é o
// falso positivo que o ADR-0021 registra.
// Host com TLD ou IPv4 puro: exigir só TLD deixava o IP de fora, e era a evasão mais barata.
const URL_EXTERNA = /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?![\w.-]))(?:[a-z0-9.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})/i;
// Sem `fetch`: é palavra de prosa, e marcaria toda skill que cita fonte com URL.
const FERRAMENTA_DE_REDE = /\b(curl|wget|nc|netcat|scp|ssh)\b/i;
// Conteúdo local entrando na chamada, por `@arquivo` ou por cano vindo de leitura.
const CARGA_LOCAL = /(--data(?:-binary|-raw)?|[-]d)\s+@|\bcat\s+[^|]+\|\s*(?:curl|wget|nc)\b/i;

// Alvos nomeados, não inferidos.
const AUTO_MODIFICACAO = /(\.mgr-core\/config|\bmgr\s+agents\s+set\b|\bmgr\s+(?:install|update|add|remove)\b|\bmgr-skills\.lock\b)/i;

// Locução fechada, não proximidade entre palavras: o ADR-0021 registra a medição de que varrer prosa
// produz falso positivo e falso negativo.
const OVERRIDES = [
  "ignore previous instruction",
  "ignore all previous",
  "ignore the above",
  "disregard previous",
  "disregard the above",
  "disregard your instruction",
  "forget your instruction",
  "forget all previous",
  "override your instruction",
  "you are now a",
  "new instructions:",
  "system prompt:",
];

const semAcento = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const achado = (capability, line, texto) => ({
  capability,
  line,
  excerpt: texto.trim().slice(0, 160),
});

/**
 * As classes de capacidade perigosa que o conteúdo revela, com a linha e o trecho de cada achado.
 *
 * Puro, sem IO — o mesmo desenho de `doc-rules`, `plan-parser` e `spec-parser`. Quem lê disco e quem
 * imprime são outros (INV-5, e a divisão Borda/Núcleo da §2.1 da constituição).
 *
 * Devolve **lista**, e lista vazia significa "nenhuma das quatro classes apareceu" — nunca "é
 * seguro". A diferença está declarada no cabeçalho deste módulo e é o veto do ADR-0007.
 */
export function inferCapabilities(text) {
  const achados = [];
  const linhas = String(text ?? "").split("\n");
  let dentroDeBlocoShell = false;

  linhas.forEach((linha, indice) => {
    const numero = indice + 1;
    const limpo = semAcento(linha);

    // --- comando shell embutido ---
    if (dentroDeBlocoShell) {
      if (FECHA_BLOCO.test(linha)) dentroDeBlocoShell = false;
      else if (linha.trim()) achados.push(achado(EMBEDDED_SHELL, numero, linha));
    } else if (ABRE_BLOCO_SHELL.test(linha)) {
      dentroDeBlocoShell = true;
    } else if (ABRE_BLOCO_SEM_TAG.test(linha)) {
      // A busca para no fim do bloco: sem isso, uma cerca vazia fazia a "primeira linha" ser texto
      // DEPOIS dela, e o estado saía errado.
      const doBloco = linhas.slice(indice + 1);
      const fim = doBloco.findIndex((seguinte) => FECHA_BLOCO.test(seguinte));
      const primeira = (fim === -1 ? doBloco : doBloco.slice(0, fim)).find((seguinte) => seguinte.trim());
      dentroDeBlocoShell = primeira !== undefined && COMECA_COM_EXECUTAVEL.test(primeira);
    } else if (EM_CRASE.test(linha)) {
      achados.push(achado(EMBEDDED_SHELL, numero, linha));
    }

    // --- exfiltração: precisa de destino EXTERNO, não da menção de uma ferramenta ---
    const paraFora = URL_EXTERNA.test(linha) && FERRAMENTA_DE_REDE.test(linha);
    if (paraFora || CARGA_LOCAL.test(linha)) {
      achados.push(achado(EXFILTRATION, numero, linha));
    }

    // --- auto-modificação ---
    if (AUTO_MODIFICACAO.test(linha)) {
      achados.push(achado(SELF_MODIFICATION, numero, linha));
    }

    // --- tentativa de override ---
    if (OVERRIDES.some((locucao) => limpo.includes(locucao))) {
      achados.push(achado(OVERRIDE_ATTEMPT, numero, linha));
    }
  });

  return achados;
}

/**
 * As classes presentes, sem repetição e na ordem de `CLASSES`.
 *
 * Existe porque a comparação com o declarado acontece **em termos de classe**, e não de achado: uma
 * skill com trinta comandos embutidos tem a mesma classe que uma com um.
 */
export function capabilitiesOf(text) {
  const presentes = new Set(inferCapabilities(text).map(({ capability }) => capability));
  return CLASSES.filter((classe) => presentes.has(classe));
}

// ---------------------------------------------------------------------------
// A comparação declarado × inferido, e os três ramos do ADR-0007
// ---------------------------------------------------------------------------

// Os três ramos do ADR-0007:29-32, e nenhum a mais.
export const MATCHES = "matches";
export const EXCEEDS = "exceeds";
export const UNDECLARED = "undeclared";
// Fora dos três ramos: eles pressupõem inferência, e uma skill sem nenhuma das quatro classes é o
// caso mais limpo, não o pior.
export const NOTHING_TO_DECLARE = "nothing-to-declare";

// Só o comando embutido é declarável: `allowed-tools` pré-aprova ferramenta, e ninguém declara
// exfiltração nem tentativa de override. Quando essas aparecem, são sempre não declaradas.
const FERRAMENTA_DE_SHELL = /\b(bash|sh|shell|zsh|powershell|pwsh|terminal|run_command)\b/i;

export function declaredCapabilities(allowedTools) {
  if (typeof allowedTools !== "string" || allowedTools.trim() === "") return [];
  return FERRAMENTA_DE_SHELL.test(allowedTools) ? [EMBEDDED_SHELL] : [];
}

/**
 * Compara o declarado com o inferido **em termos de classe** e devolve o ramo do ADR-0007.
 *
 * Classe, e não ferramenta: uma skill com trinta comandos embutidos está no mesmo ramo que uma com
 * um. É a decisão 1 do ADR-0021, e o motivo é medido — inferir a lista de ferramentas a partir da
 * prosa produz falso positivo e falso negativo.
 *
 * **Limite conhecido, e está no ADR-0021 como consequência negativa:** a comparação acontece em
 * termos de classe, então declarar `allowed-tools` a menos **dentro** da mesma classe não é pego.
 */
export function compare(text, allowedTools) {
  const inferred = capabilitiesOf(text);
  const declared = declaredCapabilities(allowedTools);
  const excedentes = inferred.filter((classe) => !declared.includes(classe));

  if (!inferred.length) return { branch: NOTHING_TO_DECLARE, inferred, declared, undeclared: [] };
  if (!excedentes.length) return { branch: MATCHES, inferred, declared, undeclared: [] };
  // `declared` vazio com algo inferido é o terceiro ramo; `declared` com algo e ainda sobrando é o
  // segundo. A diferença importa: o segundo é declaração INCOMPLETA, e o ADR manda tratá-la como
  // bloqueio ou warning forte, porque o autor afirmou um escopo e o conteúdo excede.
  return {
    branch: declared.length ? EXCEEDS : UNDECLARED,
    inferred,
    declared,
    undeclared: excedentes,
  };
}

// Leitura de disco: percorrer as skills e comparar é lógica, e a §2.1 manda lógica no núcleo. Mesmo
// desenho de `src/validator.js`, com acesso ao pacote só por `src/bundle.js` (§2.4).

/**
 * Audita UMA skill do pacote: lê o `SKILL.md`, extrai o `allowed-tools` declarado e compara.
 *
 * Devolve sempre a mesma forma, com `outcome` discriminando — o padrão que `plan-next`,
 * `spec-status` e `precompact` já usam, e que a `DES-1` pede no lugar de `null` como sentinela.
 */
export function auditSkill(name) {
  const arquivo = path.join(bundle.skillsDir(), name, "SKILL.md");
  let texto;
  try {
    texto = readFileSync(arquivo, "utf8");
  } catch {
    return { name, outcome: UNREADABLE, branch: null, inferred: [], declared: [], undeclared: [], findings: [] };
  }
  const declarado = frontmatter(texto)["allowed-tools"];
  return {
    name,
    outcome: AUDITED,
    ...compare(texto, typeof declarado === "string" ? declarado : undefined),
    findings: inferCapabilities(texto),
  };
}

export const AUDITED = "audited";
export const UNREADABLE = "unreadable";

/** Audita as skills do pacote, na ordem em que o `bundle` as descobre. */
export function auditAll(names) {
  return (names ?? bundle.skillNames()).map(auditSkill);
}

/**
 * Se a auditoria BLOQUEIA.
 *
 * **Só o ramo `EXCEEDS` bloqueia**, e a razão é o texto do `ADR-0007`: ele manda *"bloqueio ou
 * warning forte"* para *"declarou X e detectou X+Y"*, e para *"não declarou"* manda **confirmação
 * obrigatória** — que é exigência do fluxo de instalação, não falha de gate.
 *
 * Tratar `UNDECLARED` como bloqueio faria o próprio MGR reprovar a si mesmo por 5 das 13 skills, e
 * declararia como defeito o comportamento que o fornecedor dos motores recomenda (*"when in doubt,
 * omit"*).
 */
export const blocks = (resultados) => resultados.some(({ branch }) => branch === EXCEEDS);

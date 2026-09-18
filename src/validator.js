// Validação: garante que cada SKILL.md conforma ao spec de Agent Skills.
import { readFileSync } from "node:fs";
import path from "node:path";
import * as bundle from "./bundle.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Limites do padrão agentskills.io (https://agentskills.io/specification, lido em 2026-09-17). O
// hífen duplo que ele também proíbe já é reprovado pelo `NAME_RE`, cujos segmentos são `[a-z0-9]+`.
const MAX_NAME = 64;
const MAX_COMPATIBILITY = 500;

// Sem espaço e sem hífen inicial: o hífen delata sequência YAML lida como par.
const CHAVE_DE_MAPA = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const SO_ASPAS_OU_VAZIO = /^\s*(?:""|'')?\s*$/;
// Olha o TEXTO porque o parser filtra linhas sem `:`, e a lista desapareceria antes do mapa.
const LISTA_APOS_FERRAMENTAS = /^allowed-tools:\s*$\n(?:\s*#.*\n)*\s*-\s+\S/m;
const MAX_LINES = 500;

export function frontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};

  const linhas = text.slice(3, end).split("\n")
    .map((linha) => {
      const conteudo = linha.trimStart();
      return { recuo: linha.length - conteudo.length, conteudo };
    })
    .filter(({ conteudo }) => conteudo && !conteudo.startsWith("#") && conteudo.includes(":"));

  const meta = {};
  let mapaAberto = null;
  let recuoDoMapa = 0;

  linhas.forEach(({ recuo, conteudo }, ordem) => {
    const corte = conteudo.indexOf(":");
    const chave = conteudo.slice(0, corte).trim();
    const valor = conteudo.slice(corte + 1).trim();

    // Trocaria o protótipo em vez de criar propriedade, e a leitura resolveria pela cadeia.
    if (chave === "__proto__") return;

    if (recuo === 0) {
      const seguinte = linhas[ordem + 1];
      // `chave:` sem nada recuado abaixo vale `""`, e o `checkSkill` depende disso para dizer
      // "frontmatter sem `name`".
      const abreMapa = valor === "" && seguinte !== undefined && seguinte.recuo > 0;
      meta[chave] = abreMapa ? {} : valor;
      mapaAberto = abreMapa ? chave : null;
      recuoDoMapa = abreMapa ? seguinte.recuo : 0;
      return;
    }

    // Uma guarda cobre os dois casos inválidos: linha órfã (sem mapa aberto, `recuoDoMapa` é 0) e
    // profundidade 2 ou mais, que o padrão não define.
    if (recuo !== recuoDoMapa) return;

    meta[mapaAberto][chave] = valor;
  });

  return meta;
}

// Forma dos campos opcionais, quando presentes. Não julga o VALOR: quem olha capacidade real é o
// `mgr audit`, pelo conteúdo.
function checkOptionalFields(name, meta, { listaYaml = false } = {}) {
  const problems = [];

  if (meta.compatibility !== undefined) {
    if (typeof meta.compatibility !== "string") {
      problems.push(`${name}: \`compatibility\` tem de ser texto (o padrão define string de 1 a ${MAX_COMPATIBILITY})`);
    } else if (meta.compatibility.length > MAX_COMPATIBILITY) {
      problems.push(`${name}: \`compatibility\` com ${meta.compatibility.length} caracteres (> ${MAX_COMPATIBILITY})`);
    }
  }

  // Vírgula não é reprovada: o claude-code documenta aceitar espaço, vírgula ou lista YAML, e
  // reprovar forma que o motor aceita é reprovar por convenção de escrita (ADR-0020).
  const ferramentas = meta["allowed-tools"];
  if (ferramentas !== undefined) {
    // Lista YAML tem mensagem própria: quem a escreveu declarou ferramentas, e "presente e vazio"
    // responderia a um erro que ele não cometeu.
    if (listaYaml) {
      problems.push(`${name}: \`allowed-tools\` como lista YAML: o padrão pede as ferramentas separadas por espaço numa linha`);
      return problems;
    }
    if (typeof ferramentas !== "string") {
      problems.push(`${name}: \`allowed-tools\` tem de ser texto com as ferramentas separadas por espaço`);
    } else if (SO_ASPAS_OU_VAZIO.test(ferramentas)) {
      // As aspas entram porque o parser não as desfaz, e `""` escaparia do `trim()`.
      problems.push(`${name}: \`allowed-tools\` presente e vazio: declare as ferramentas ou remova o campo`);
    }
  }

  // O padrão define `metadata` como "a map from string keys to string values". Texto no lugar do
  // mapa é o erro que o parser de linha antigo produzia em silêncio.
  if (meta.metadata !== undefined) {
    // `metadata:` sem nada abaixo chega como string vazia, e quem escreveu isso pretendia um mapa.
    const vazio = meta.metadata === "" || (typeof meta.metadata === "object" && Object.keys(meta.metadata).length === 0);
    if (vazio) {
      problems.push(`${name}: \`metadata\` presente e vazio: declare as chaves ou remova o campo`);
    } else if (typeof meta.metadata !== "object") {
      problems.push(`${name}: \`metadata\` tem de ser um mapa de chave e valor, não texto`);
    } else {
      // Sequência YAML faz o parser fabricar a chave `"- author"`; profundidade 2 deixa valor vazio
      // como rastro do nível descartado. Nenhum dos dois é mapa string->string.
      const invalida = Object.entries(meta.metadata)
        .find(([chave, valor]) => !CHAVE_DE_MAPA.test(chave) || valor === "");
      if (invalida) {
        problems.push(`${name}: \`metadata\` tem de ser um mapa de chave e valor de um nível; \`${invalida[0]}\` não é`);
      }
    }
  }

  return problems;
}

// Lógica pura de validação (sem IO): recebe o nome esperado e o conteúdo do SKILL.md.
export function checkSkill(name, text) {
  const problems = [];
  const meta = frontmatter(text);
  if (Object.keys(meta).length === 0) {
    problems.push(`${name}: sem frontmatter YAML (--- ... ---)`);
    return problems;
  }
  // Campo obrigatório lido como mapa é forma inválida: sem esta guarda, `(meta.description || "")`
  // devolve o objeto, `.length` é `undefined`, e uma skill sem descrição utilizável passa.
  for (const campo of ["name", "description"]) {
    if (meta[campo] !== undefined && typeof meta[campo] !== "string") {
      problems.push(`${name}: \`${campo}\` tem de ser texto, e veio como mapa`);
    }
  }
  if (problems.length) return problems;

  const nm = meta.name || "";
  if (!nm) problems.push(`${name}: frontmatter sem \`name\``);
  else {
    if (!NAME_RE.test(nm)) problems.push(`${name}: \`name\` não é kebab-case: ${nm}`);
    if (nm !== name) problems.push(`${name}: \`name\` (${nm}) difere do nome da pasta`);
  }
  // O retorno antecipado acima garante que `nm` é texto.
  if (nm.length > MAX_NAME) {
    problems.push(`${name}: \`name\` com ${nm.length} caracteres (> ${MAX_NAME})`);
  }
  if ((meta.description || "").length < 40) {
    problems.push(`${name}: \`description\` ausente ou curta demais (o que faz E quando usar)`);
  }
  problems.push(...checkOptionalFields(name, meta, { listaYaml: LISTA_APOS_FERRAMENTAS.test(text) }));
  const nLines = text.split("\n").length;
  if (nLines > MAX_LINES) {
    problems.push(`${name}: SKILL.md com ${nLines} linhas (> ${MAX_LINES}); use references/`);
  }
  return problems;
}

export function validateSkill(name) {
  const md = path.join(bundle.skillsDir(), name, "SKILL.md");
  let text;
  try {
    text = readFileSync(md, "utf8");
  } catch {
    return [`${name}: falta SKILL.md`];
  }
  return checkSkill(name, text);
}

export function validateAll(names) {
  names = names || bundle.skillNames();
  const out = {};
  for (const n of names) out[n] = validateSkill(n);
  return out;
}

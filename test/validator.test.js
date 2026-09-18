import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSkill, frontmatter } from "../src/validator.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = path.join(raiz, "skills");
const AS_TREZE = readdirSync(skillsDir)
  .filter((nome) => existsSync(path.join(skillsDir, nome, "SKILL.md")))
  .sort();
const textoDe = (nome) => readFileSync(path.join(skillsDir, nome, "SKILL.md"), "utf8");

test("as skills do CORE em disco são as treze medidas", () => {
  assert.equal(AS_TREZE.length, 13,
    "a fixture desta suíte é o disco: se o número mudar, os testes abaixo passam a medir outro conjunto");
});

test("a leitura atual devolve name e description de cada uma das treze", () => {
  for (const nome of AS_TREZE) {
    const lido = frontmatter(textoDe(nome));
    assert.equal(lido.name, nome, `${nome}: o name lido tem de ser o da pasta, como é hoje`);
    assert.ok(lido.description?.length > 40, `${nome}: a description lida hoje passa de 40 caracteres`);
  }
});

const CAMPOS_ESPERADOS = {
  "junit-clean": ["compatibility", "description", "license", "name"],
};
const CAMPOS_PADRAO = ["description", "license", "name"];

test("cada skill declara exatamente os campos que esta fatia decidiu, e nenhum a mais", () => {
  for (const nome of AS_TREZE) {
    assert.deepEqual(Object.keys(frontmatter(textoDe(nome))).sort(), CAMPOS_ESPERADOS[nome] ?? CAMPOS_PADRAO,
      `${nome}: campo a mais ou a menos aqui é declaração que não passou pelo P0 desta fatia`);
  }
});

test("o valor lido é o texto da linha no arquivo, byte a byte", () => {
  for (const nome of AS_TREZE) {
    const cru = textoDe(nome);
    const inicio = cru.indexOf("description:") + "description:".length;
    const doArquivo = cru.slice(inicio, cru.indexOf("\n", inicio)).trim();
    assert.equal(frontmatter(cru).description, doArquivo,
      `${nome}: o parser não pode alterar o valor — comparar com o arquivo é o que prova isso`);
  }
});

test("sem frontmatter devolve objeto vazio, como hoje", () => {
  assert.deepEqual(frontmatter("sem nada"), {});
  assert.deepEqual(frontmatter("---\nsem fim do bloco"), {});
});

const comBloco = (corpo) => `---\n${corpo}\n---\n`;

test("mapa de um nível é lido como objeto", () => {
  const lido = frontmatter(comBloco("name: foo\nmetadata:\n  author: mgr-method\n  version: \"1.0\""));
  assert.deepEqual(lido.metadata, { author: "mgr-method", version: '"1.0"' });
});

test("as chaves do mapa NÃO vazam para o topo", () => {
  const lido = frontmatter(comBloco("name: foo\nmetadata:\n  author: mgr-method\n  version: \"1.0\""));
  assert.deepEqual(Object.keys(lido).sort(), ["metadata", "name"],
    "`author` no topo é o defeito exato que este parser tinha: quem lesse `lido.author` acertaria por acidente");
  assert.equal(lido.author, undefined);
  assert.equal(lido.version, undefined);
});

test("a chave de topo depois do mapa volta ao topo", () => {
  const lido = frontmatter(comBloco("metadata:\n  author: x\nlicense: Source-Available v1.0"));
  assert.equal(lido.license, "Source-Available v1.0",
    "fechar o mapa ao voltar para o recuo zero é o que permite declarar campo depois dele");
  assert.deepEqual(lido.metadata, { author: "x" });
});

test("chave sem valor e sem bloco recuado continua sendo string vazia", () => {
  const lido = frontmatter(comBloco("name:\ndescription: algo"));
  assert.equal(lido.name, "", "virar objeto aqui degradaria a mensagem de `checkSkill` para entrada malformada");
  assert.equal(checkSkill("foo", comBloco("name:\ndescription: algo")).filter((p) => p.includes("sem `name`")).length, 1);
});

test("profundidade 2 é entrada inválida, e é descartada em vez de achatada", () => {
  const lido = frontmatter(comBloco("metadata:\n  a:\n    b: 1"));
  assert.deepEqual(lido.metadata, { a: "" },
    "achatar `b` para dentro de `metadata` faria o parser inventar um mapa que o padrão não define");
  assert.equal(lido.b, undefined);
});

test("linha recuada sem mapa aberto é descartada", () => {
  const lido = frontmatter(comBloco("name: foo\n  orfa: valor"));
  assert.deepEqual(Object.keys(lido), ["name"],
    "promover a órfã a chave de topo era exatamente o defeito antigo; quem a descarta é a comparação de recuo");
});

const valida = (corpo) => checkSkill("foo", `---\nname: foo\ndescription: ${"d".repeat(60)}\n${corpo}\n---\n`);
const so = (corpo, trecho) => valida(corpo).filter((p) => p.includes(trecho));

test("name acima de 64 caracteres reprova, e 64 passa", () => {
  const desc = "d".repeat(60);
  const longo = "a".repeat(65);
  assert.equal(checkSkill(longo, `---\nname: ${longo}\ndescription: ${desc}\n---\n`)
    .filter((p) => p.includes("caracteres")).length, 1, "o padrão diz `Max 64 characters` e isto não era conferido");
  const exato = "a".repeat(64);
  assert.deepEqual(checkSkill(exato, `---\nname: ${exato}\ndescription: ${desc}\n---\n`), [],
    "64 é o limite e tem de passar: reprovar no limite é reprovar por defeito de comparação");
});

test("hífen duplo já era reprovado pelo kebab-case, e segue sendo", () => {
  const desc = "d".repeat(60);
  assert.equal(checkSkill("pdf--processing", `---\nname: pdf--processing\ndescription: ${desc}\n---\n`)
    .filter((p) => p.includes("kebab-case")).length, 1);
});

test("compatibility acima de 500 reprova, e 500 passa", () => {
  assert.equal(so(`compatibility: ${"c".repeat(501)}`, "compatibility").length, 1);
  assert.deepEqual(so(`compatibility: ${"c".repeat(500)}`, "compatibility"), []);
});

test("compatibility como mapa reprova", () => {
  assert.equal(so("compatibility:\n  qualquer: coisa", "tem de ser texto").length, 1,
    "o padrão define string de 1 a 500; mapa é forma inválida");
});

test("allowed-tools como mapa ou vazio reprova, e texto passa", () => {
  assert.equal(so("allowed-tools:\n  Read: sim", "tem de ser texto").length, 1);
  assert.equal(so("allowed-tools:", "presente e vazio").length, 1,
    "campo presente e vazio é pior que ausente: parece declaração e não declara nada");
  assert.deepEqual(so("allowed-tools: Read Grep Glob", "allowed-tools"), []);
});

test("allowed-tools separado por vírgula NÃO reprova", () => {
  assert.deepEqual(so("allowed-tools: Read, Grep", "allowed-tools"), [],
    "o motor aceita vírgula; reprovar aqui seria reprovar por convenção de escrita");
});

test("metadata como texto ou vazio reprova, e mapa passa", () => {
  assert.equal(so("metadata: texto solto", "mapa de chave e valor").length, 1,
    "texto no lugar do mapa é exatamente o que o parser de linha antigo produzia em silêncio");
  assert.equal(so("metadata:", "presente e vazio").length, 1);
  assert.deepEqual(so("metadata:\n  author: mgr-method", "metadata"), []);
});

test("as treze seguem passando depois das regras novas", () => {
  for (const nome of AS_TREZE) {
    assert.deepEqual(checkSkill(nome, textoDe(nome)), [],
      `${nome}: as regras novas alcançam mais, e nenhuma das 13 pode passar a reprovar sem defeito real (CA-15)`);
  }
});

test("campo obrigatório lido como mapa reprova, nos dois", () => {
  const comoMapa = (campo, resto) => checkSkill("foo", `---\n${resto}\n${campo}:\n  Use when: algo\n---\n`);
  assert.match(comoMapa("description", "name: foo")[0], /`description` tem de ser texto/);
  assert.match(comoMapa("name", `description: ${"d".repeat(60)}`)[0], /`name` tem de ser texto/);
});

test("name como mapa não produz mensagem de tamanho inventada", () => {
  const achados = checkSkill("foo", `---\nname:\n  length: 65\ndescription: ${"d".repeat(60)}\n---\n`);
  assert.equal(achados.length, 1, "um problema, e o certo: a forma do campo");
  assert.ok(!achados[0].includes("caracteres"),
    "`{length: \"65\"}` coagido daria `\"65\" > 64` verdadeiro e uma mensagem sobre tamanho que não existe");
});

test("recuo de UM espaço abre o mapa", () => {
  const lido = frontmatter("---\nmetadata:\n author: x\n---\n");
  assert.deepEqual(lido.metadata, { author: "x" },
    "a fronteira é 0/1: com todos os testes em recuo 2, `> 0` e `> 1` decidem igual");
});

test("irmão SUB-recuado é descartado, não absorvido pelo mapa", () => {
  const lido = frontmatter("---\nmetadata:\n    author: x\n  outra: y\n---\n");
  assert.deepEqual(lido.metadata, { author: "x" },
    "com `>` no lugar de `!==`, `outra` entraria no mapa; é a fronteira que faltava");
});

test("metadata em sequência YAML reprova em vez de fabricar chave", () => {
  const achados = checkSkill("foo", `---\nname: foo\ndescription: ${"d".repeat(60)}\nmetadata:\n  - author: x\n---\n`);
  assert.match(achados[0], /`metadata` tem de ser um mapa/,
    "o item `- author: x` tem `:`, sobrevive ao filtro, e o parser FABRICAVA a chave `- author`");
});

test("metadata com profundidade 2 reprova em vez de normalizar em silêncio", () => {
  const achados = checkSkill("foo", `---\nname: foo\ndescription: ${"d".repeat(60)}\nmetadata:\n  a:\n    b: 1\n---\n`);
  assert.match(achados[0], /`metadata` tem de ser um mapa/,
    "descartar o nível fundo e passar com `{a: \"\"}` é normalizar entrada inválida, não descartá-la");
});

test("allowed-tools como lista YAML reprova com a mensagem da LISTA", () => {
  const achados = checkSkill("foo", `---\nname: foo\ndescription: ${"d".repeat(60)}\nallowed-tools:\n  - Read\n  - Grep\n---\n`);
  assert.match(achados[0], /como lista YAML/,
    "quem escreveu a lista declarou duas ferramentas: dizer-lhe `presente e vazio` responde a erro que ele não cometeu");
});

test("allowed-tools com aspas vazias conta como vazio", () => {
  const achados = checkSkill("foo", `---\nname: foo\ndescription: ${"d".repeat(60)}\nallowed-tools: ""\n---\n`);
  assert.match(achados[0], /presente e vazio/, "o parser não desfaz aspas, então `\"\"` escapava do trim");
});

test("__proto__ como chave não contamina a leitura", () => {
  const lido = frontmatter("---\nname: foo\n__proto__:\n  author: x\n---\n");
  assert.equal(lido.author, undefined, "resolver `author` pela cadeia de protótipo é leitura que ninguém declarou");
  assert.deepEqual(Object.keys(lido), ["name"]);
});

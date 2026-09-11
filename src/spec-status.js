import { existsSync } from "node:fs";
import path from "node:path";
import { SPECS_DIR, artifactFiles, slugs } from "./artifacts.js";

// Estado de artefato de uma feature (ADR-0015). O comando existe para as skills pararem de
// ASSUMIR caminho — suposição de estrutura é a classe de alucinação que o programa nomeia.
//
// A regra deste módulo, em uma frase: ele responde o que existe em disco, e **nada além disso**.
// Não diz que uma etapa terminou, não diz que alguém aprovou, não diz em que fase o autor está.
// Essas três coisas não têm fonte mecânica, e afirmá-las seria a promessa que a L1.9 proíbe.

// Os seis artefatos canônicos do fluxo, com `requires` DECLARADO como dado — nunca inferido do
// número no nome do arquivo. É isto que permite ao consumidor parar de conhecer a sequência.
//
// `risk-closure.md` e `regression-baseline.json` ficam FORA de propósito: existem em 4 e 3 das 12
// features, nasceram de exigência por feature e não de etapa do fluxo, e tratá-los como canônicos
// faria oito features parecerem incompletas.
export const ARTIFACTS = Object.freeze([
  { id: "brief", file: "01-brief.md", requires: [] },
  { id: "prd", file: "02-prd.md", requires: ["brief"] },
  { id: "spec", file: "03-spec.md", requires: ["prd"] },
  { id: "plan", file: "04-plan.md", requires: ["spec"] },
  { id: "execution", file: "05-execution.md", requires: ["plan"] },
  { id: "completion", file: "06-completion.md", requires: ["execution"] },
].map(({ id, file, requires }) => Object.freeze({ id, file, requires: Object.freeze(requires) })));

// O vocabulário NÃO tem `done`. O documento de origem propunha `done|ready|blocked|missing`, mas
// `done` afirma conclusão de etapa a partir de existência de arquivo — exatamente o que o próprio
// documento adverte contra duas linhas adiante. `missing` sai por redundância: `ready` e `blocked`
// já dizem que o arquivo não existe, e acrescentam o motivo.
export const PRESENT = "present";
export const READY = "ready";
export const BLOCKED = "blocked";

// Token estável, em inglês, para o consumidor programático ramificar sem casar texto traduzido.
// A frase para humano é do módulo de mensagens; as duas cumprem papéis diferentes (ADR-0015).
export const BASIS = "file-existence";

// Decisão pura. Recebe o mapa `id -> caminho relativo` dos artefatos que EXISTEM e devolve a
// mesma forma sempre.
//
// `path` vem `null` para quem não existe, e isso não é sentinela: `status` é o discriminador
// explícito, e o caminho ausente só acompanha o que o estado já disse (DES-1).
export function describe(caminhosPresentes) {
  const presente = (id) => caminhosPresentes.has(id);
  const artifacts = ARTIFACTS.map(({ id, requires }) => ({
    id,
    path: caminhosPresentes.get(id) ?? null,
    status: presente(id) ? PRESENT : (requires.every(presente) ? READY : BLOCKED),
    // A MESMA referência da tabela canônica: congelada acima, para um `push` no consumidor não
    // alterar o módulo inteiro. Saída de núcleo nasce pronta (DES-8), como em `findings.create`.
    requires,
  })).map(Object.freeze);
  return {
    artifacts,
    // `nextReady` é sobre ARTEFATO, não sobre task: qual falta escrever, não qual fazer dentro de
    // um plano. Quem responde a segunda é o `mgr spec next`, e as duas não se duplicam.
    nextReady: artifacts.filter((artefato) => artefato.status === READY).map((artefato) => artefato.id),
  };
}

const HANDOFF_FILE = ".handoff.md";

// O handoff é FATO DO ARQUIVO: existe ou não, e onde está. Nada mais.
//
// Medido em 2026-09-11: os 4 `.handoff.md` em disco pertencem a features que têm `06-completion.md`
// escrito. São restos que ninguém apagou, e chamá-los de "trabalho pendente" seria falso em 4 de 4.
//
// Também NÃO se infere obsolescência cruzando com o `completion`: um handoff pode ser legítimo numa
// feature cujo `06` foi escrito cedo, e inferir seria julgamento disfarçado de dado (ADR-0015).
function handoffDe(repo, slug) {
  const caminho = path.join(repo, SPECS_DIR, slug, HANDOFF_FILE);
  return existsSync(caminho)
    ? { exists: true, path: path.relative(repo, caminho) }
    : { exists: false, path: null };
}

// Estado de UMA feature. `found: false` quando o slug não existe em disco — quem chama decide o
// que fazer, em vez de receber estrutura vazia que parece uma feature no começo.
export function statusFor(repo, { slug }) {
  if (!slugs(repo).includes(slug)) return { found: false, slug, specRoot: null };

  const caminhos = new Map();
  for (const { id, file } of ARTIFACTS) {
    const [encontrado] = artifactFiles(repo, slug, file);
    if (encontrado) caminhos.set(id, path.relative(repo, encontrado));
  }
  return {
    found: true,
    slug,
    specRoot: path.join(SPECS_DIR, slug),
    ...describe(caminhos),
    handoff: handoffDe(repo, slug),
    basis: BASIS,
  };
}

// Todas as features, na ordem estável de `slugs`. Vazio quando não há nenhuma.
export function statusAll(repo) {
  return slugs(repo).map((slug) => statusFor(repo, { slug }));
}

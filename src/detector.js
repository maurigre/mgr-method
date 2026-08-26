// Detecção de ecossistema do projeto (ADR-0009): lê uma LISTA FECHADA de caminhos conhecidos
// e devolve tokens com a evidência que os justificou. Somente leitura — nada é escrito, e
// nada lido daqui vira nome de skill, URL ou comando: o conteúdo do projeto é EVIDÊNCIA,
// nunca fonte de execução (é o vetor de prompt injection que D03 nomeia).
//
// Não há travessia de árvore: o custo é fixo e o usuário sabe exatamente onde o MGR olhou.
// Monorepo com módulos em subpastas fica de fora nesta versão — ampliar exige evidência.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Caminho presente ⇒ ecossistema. `application.*` não entra aqui: dele só interessa o
// conteúdo (ver SERVICE_MARKERS), porque o arquivo em si não diz qual é o ecossistema.
export const PATH_MARKERS = [
  { file: "pom.xml", ecosystem: "java" },
  { file: "build.gradle", ecosystem: "java" },
  { file: "build.gradle.kts", ecosystem: "java" },
  { file: "package.json", ecosystem: "node" },
  { file: "docker-compose.yml", ecosystem: "docker" },
  { file: "docker-compose.yaml", ecosystem: "docker" },
  { file: "compose.yml", ecosystem: "docker" },
  { file: "compose.yaml", ecosystem: "docker" },
];

// Arquivos cujo CONTEÚDO é inspecionado. Os de configuração Spring vivem no caminho
// convencional de Maven/Gradle; não são procurados em lugar nenhum.
const CONTENT_FILES = [
  "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  path.join("src", "main", "resources", "application.yml"),
  path.join("src", "main", "resources", "application.yaml"),
  path.join("src", "main", "resources", "application.properties"),
];

// Marcadores ANCORADOS, não busca por palavra solta: `image:` no início da linha (comentário
// começa com `#` e por isso não casa) ou esquema de URI. Sem parser de YAML — quanto menos o
// MGR interpreta de arquivo que pode vir de repositório hostil, menor a superfície.
export const SERVICE_MARKERS = [
  { ecosystem: "postgres", pattern: /^\s*image:\s*["']?(?:[\w.-]+\/)*postgres[:\s"']|jdbc:postgresql:|postgresql:\/\//mi },
  { ecosystem: "mysql", pattern: /^\s*image:\s*["']?(?:[\w.-]+\/)*mysql[:\s"']|jdbc:mysql:|mysql:\/\//mi },
  { ecosystem: "rabbitmq", pattern: /^\s*image:\s*["']?(?:[\w.-]+\/)*rabbitmq[:\s"']|amqps?:\/\//mi },
  { ecosystem: "redis", pattern: /^\s*image:\s*["']?(?:[\w.-]+\/)*redis[:\s"']|rediss?:\/\//mi },
  { ecosystem: "mongodb", pattern: /^\s*image:\s*["']?(?:[\w.-]+\/)*mongo[:\s"']|mongodb(?:\+srv)?:\/\//mi },
];

// Teto de leitura: o modelo de ameaça desta feature inclui repositório hostil, e um
// compose de 1 GB não pode virar consumo de memória do CLI. Acima do teto, o caminho ainda
// conta como evidência de ecossistema; só o conteúdo deixa de ser inspecionado.
export const MAX_SCAN_BYTES = 256 * 1024;

function readWithinCap(file) {
  const size = statSync(file, { throwIfNoEntry: false })?.size;
  return size === undefined || size > MAX_SCAN_BYTES ? null : readFileSync(file, "utf8");
}

// Ecossistemas do projeto, com o arquivo que serviu de evidência para cada um. A evidência
// existe para o usuário ver POR QUE a skill está sendo proposta: sugestão sem justificativa
// é indistinguível de sugestão inventada.
export function detect(repo) {
  const encontrados = new Map();
  const registrar = (ecosystem, evidence) => {
    if (!encontrados.has(ecosystem)) encontrados.set(ecosystem, { ecosystem, evidence });
  };

  for (const marker of PATH_MARKERS) {
    if (existsSync(path.join(repo, marker.file))) registrar(marker.ecosystem, marker.file);
  }

  for (const relative of CONTENT_FILES) {
    const file = path.join(repo, relative);
    if (!existsSync(file)) continue;
    const conteudo = readWithinCap(file);
    if (conteudo === null) continue;
    for (const marker of SERVICE_MARKERS) {
      if (marker.pattern.test(conteudo)) registrar(marker.ecosystem, relative);
    }
  }
  return [...encontrados.values()];
}

// Casa o que foi detectado no projeto com o que o registry publica. A skill declara a que
// ecossistema serve (`ecosystems` do manifest, ADR-0009); sem o campo, ela nunca é sugerida —
// só instalada por nome, como antes. Skill já travada no lockfile não se repete.
export function suggest(detected, index, lockfile) {
  const evidencePorEcossistema = new Map(detected.map((item) => [item.ecosystem, item.evidence]));
  const jaTravadas = new Set(Object.keys(lockfile?.skills || {}));
  const sugestoes = [];

  for (const entries of Object.values(index?.categories || {})) {
    for (const entry of entries) {
      if (jaTravadas.has(entry.name)) continue;
      const ecosystem = (entry.ecosystems || []).find((token) => evidencePorEcossistema.has(token));
      if (!ecosystem) continue;
      sugestoes.push({
        name: entry.name,
        version: entry.version,
        ecosystem,
        evidence: evidencePorEcossistema.get(ecosystem),
      });
    }
  }
  return sugestoes;
}

// Motores que sabem receber contexto por hook de início de sessão (ADR-0009, matriz
// verificada por experimento em 2026-08-25).
export const HOOK_ENGINES = ["claude-code", "copilot"];

// Texto que o hook entrega ao agente. Montado APENAS com dado que o MGR apurou: token de
// ecossistema, nome do arquivo-evidência e nome/versão vindos do index. NENHUM byte de
// conteúdo dos arquivos do projeto entra aqui — o canal hook→contexto seria o caminho
// perfeito para escalar "arquivo lido" em "instrução obedecida" (RN-11).
export function hookReport(suggestions, engine) {
  if (!HOOK_ENGINES.includes(engine)) {
    throw new Error(`invalid engine for hook report: ${engine} (expected ${HOOK_ENGINES.join(" | ")})`);
  }
  if (!suggestions.length) return engine === "copilot" ? JSON.stringify({ additionalContext: "" }) : "";

  const linhas = suggestions.map(
    (item) => `- ${item.name}@${item.version} (ecosystem: ${item.ecosystem}, evidence: ${item.evidence})`,
  );
  const texto = [
    "[mgr] Plugin skills available for this project, not installed yet:",
    ...linhas,
    "Install with `mgr add <name>`; it asks for confirmation before writing anything.",
  ].join("\n");

  return engine === "copilot" ? JSON.stringify({ additionalContext: texto }) : texto;
}

// Sugestoes de TODOS os registries configurados. Duas decisoes de dominio moram aqui, nao na
// borda (INV-5/INV-6): skill repetida entre registries fica pela PRIMEIRA ocorrencia, e
// registry fora do ar nao derruba a deteccao — o que ja foi apurado continua valendo, e a
// falha e devolvida em `unreachable` para quem chamou decidir se conta ao usuario.
export async function collectSuggestions(detected, registries, lockfile, { fetchImpl, fetchIndexImpl }) {
  const porNome = new Map();
  const unreachable = [];

  for (const registry of registries) {
    try {
      const index = await fetchIndexImpl(registry.url, { fetchImpl });
      for (const item of suggest(detected, index, lockfile)) {
        if (!porNome.has(item.name)) porNome.set(item.name, item);
      }
    } catch (error) {
      unreachable.push({ registry: registry.name, reason: error.message });
    }
  }
  return { suggestions: [...porNome.values()], unreachable };
}

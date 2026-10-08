// Leitura pura dos argumentos da CLI. Não toca em process, console nem saída: a borda decide o
// que fazer com a flag desconhecida devolvida em `unknownFlag`.
export function parseArgs(argv, { engines }) {
  const flags = { engines: [] };
  const positional = [];
  let unknownFlag = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-y" || a === "--yes") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--engine") flags.engines.push(...argv[++i].split(","));
    else if (a === "--scope") flags.scope = argv[++i];
    else if (a === "--skills-dir") flags.skillsDir = argv[++i];
    else if (a === "--language") flags.language = argv[++i];
    else if (a === "--user-language") flags.userLanguage = argv[++i];
    else if (a === "--arch") flags.arch = argv[++i];
    else if (a === "--project-id") flags.projectId = argv[++i];
    else if (a === "--all-skills") flags.allSkills = true;
    else if (a === "--trusted") flags.trusted = true;
    else if (a === "--hook") flags.hook = argv[++i];
    else if (a === "--no-hooks") flags.noHooks = true;
    else if (a === "--strict") flags.strict = true;
    else if (a === "--all") flags.all = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--model") flags.model = argv[++i];
    else if (a === "--effort") flags.effort = argv[++i];
    else if (a.startsWith("-")) { unknownFlag = a; break; }
    else positional.push(a);
  }
  // compat: --engine both = todos os motores recebidos
  flags.engines = flags.engines.flatMap((e) => (e === "both" ? engines : [e]));
  return { flags, positional, unknownFlag };
}

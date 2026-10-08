// Cola do comando `mgr doctor`. Humble Object: só formatação e exit code; o IO entra por `io` e a
// raiz por `root`. O diagnóstico vive em src/doctor.js.
import * as bundle from "../bundle.js";
import * as diag from "../doctor.js";

// O runtime copiado para o projeto (`bin/mgr-runtime.js`) chama `doctor(base)` sem dizer se o pacote
// esta junto, e a copia nao leva `skills/` nem `shared/`. Em vez de editar o runtime, o comando
// pergunta ao proprio `bundle`: se os dois recursos resolvem, ha fontes; se `pkgDir` lanca, nao ha.
// So o erro de recurso ausente e engolido, e e esse o fato que se quer saber.
function temFontes() {
  try {
    bundle.skillsDir();
    bundle.sharedDir();
    return true;
  } catch {
    return false;
  }
}

// O `fix` de CHECKS fica como contrato (`check:checks` o confere); so a formatacao troca o prefixo
// `mgr ` pelo comando de ciclo de vida de quem chama (DT-15): no runtime nao ha `mgr` no PATH.
const comCicloDeVida = (fix, lifecycle) =>
  fix.startsWith("mgr ") ? `${lifecycle} ${fix.slice("mgr ".length)}` : fix;

// `mgr doctor` — diz se a instalacao esta INTEGRA, e nao so o que esta instalada (U2).
//
// **Nao escreve nada, em nenhum modo.** Nao ha `--fix`: a maioria das correcoes era rodar o
// `mgr update`, e chama-lo passaria `-y` pela pessoa. O comando nomeia a remediacao; a acao e dela.
export function doctor({ root, flags, io, M }) {
  const repo = root;
  const resultado = diag.diagnose(repo, temFontes() ? {} : { sources: null });

  if (resultado.outcome === diag.NO_INSTALL) {
    io.out(M.doctorSemInstalacao);
    return 0;
  }

  const bloqueia = diag.hasDefect(resultado);
  if (flags.json) {
    io.out(JSON.stringify({ schemaVersion: 1, blocks: bloqueia, ...resultado }, null, 2));
    return bloqueia ? 1 : 0;
  }

  const cor = { [diag.DEFECT]: io.style.red, [diag.WARNING]: io.style.yellow, [diag.UNAVAILABLE]: io.style.dim };
  for (const { check, severity, file, expected, found, fix } of resultado.findings) {
    io.out(cor[severity](`${severity === diag.DEFECT ? "x" : "!"} ${check} — ${file}`));
    io.out(`    esperado:  ${expected}`);
    io.out(`    encontrado: ${found}`);
    io.out(fix ? `    resolva com: ${comCicloDeVida(fix, io.lifecycle)}` : io.style.dim("    sem correcao automatica"));
  }

  io.out("");
  io.out(M.doctorResumo(resultado.checks, resultado.findings.length));
  io.out(M.doctorNaoAtesta);
  return bloqueia ? 1 : 0;
}

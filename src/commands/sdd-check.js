import { checkSdd } from "../sdd-check.js";

const CHAVE_DA_FALHA = {
  "no-dir": "sddCheckNoDir",
  "no-constitution": "sddCheckNoConstitution",
  empty: "sddCheckEmpty",
};

const CHAVE_DO_AVISO = {
  "no-review-rules": "sddCheckNoReviewRules",
};

export function sddCheck({ root, io, M, exists, listMd }) {
  const resultado = checkSdd(root, { exists, listMd });

  if (!resultado.ok) {
    io.err(M[CHAVE_DA_FALHA[resultado.reason]]());
    return 1;
  }

  resultado.warnings.forEach((aviso) => io.err(M[CHAVE_DO_AVISO[aviso]]()));
  io.out(M.sddCheckOk(resultado.dir));
  return 0;
}

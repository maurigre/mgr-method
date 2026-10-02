import { existsSync } from "node:fs";

// `specs/` e gitignored neste projeto: em CI e em clone novo a pasta nao existe. Um teste que a
// leia tem de tolerar a ausencia DECLARANDO-A, nunca em silencio — e quem chama ainda deve usar
// `t.skip()`, para o runner dizer "skipped" em vez de "pass". Extraido em 2026-10-02 porque as
// mesmas 9 linhas estavam copiadas em dois arquivos de teste (`QUAL-6`), e a familia seguinte
// criaria a terceira copia.
export const fontePresente = (caminho) => {
  const existe = existsSync(caminho);
  if (!existe) {
    console.error(
      `[declarado] ${caminho} ausente (specs/ e gitignored): este caso NAO foi conferido nesta execucao`,
    );
  }
  return existe;
};

// Classe de uma skill, para a saida dizer POR QUE ela deixou o conjunto declarado. A quarta existe
// para nao devolver sentinela: skill fora dos tres mapas tem classe propria, nao `null`.
//
// Modulo folha (MNT-2, decisao do autor de 2026-11-17, achado R4-1): `src/core/messages.js` precisa so
// destas quatro constantes, e importa-las de `src/core/catalog.js` fechava o ciclo
// `catalog -> errors -> messages -> catalog`. Quem importa de `src/core/catalog.js` continua igual: ele
// as reexporta.
export const CLASS_ARCHITECTURE = "architecture";
export const CLASS_LANGUAGE = "language";
export const CLASS_OPTIONAL = "optional";
export const CLASS_UNCLASSIFIED = "unclassified";

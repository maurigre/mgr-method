// Banner e créditos do CLI. Recebe a tabela de mensagens injetada pela borda
// (mesmo padrão do adaptador de prompts) — o núcleo não decide idioma.
import pc from "picocolors";
import { readVersion } from "./bundle.js";
import { getMessages } from "./messages.js";

const ART = String.raw`
███╗   ███╗ ██████╗ ██████╗       ███╗   ███╗███████╗████████╗██╗  ██╗ ██████╗ ██████╗
████╗ ████║██╔════╝ ██╔══██╗      ████╗ ████║██╔════╝╚══██╔══╝██║  ██║██╔═══██╗██╔══██╗
██╔████╔██║██║  ███╗██████╔╝█████╗██╔████╔██║█████╗     ██║   ███████║██║   ██║██║  ██║
██║╚██╔╝██║██║   ██║██╔══██╗╚════╝██║╚██╔╝██║██╔══╝     ██║   ██╔══██║██║   ██║██║  ██║
██║ ╚═╝ ██║╚██████╔╝██║  ██║      ██║ ╚═╝ ██║███████╗   ██║   ██║  ██║╚██████╔╝██████╔╝
╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝      ╚═╝     ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ `;

export const CONTACT = { author: "Mauri Reis", email: "maurigre@gmail.com" };

// A marca não se traduz (nome próprio, origem da sigla MGR) — decisão do autor.
const TITLE = "MGR-METHOD — Método Governado por Rastreabilidade";

export function printBanner(msg = getMessages("en")) {
  console.log(pc.cyan(ART));
  console.log();
  console.log(pc.bold(`  ${TITLE}`));
  console.log(pc.dim(`  ${msg.bannerTagline}`));
  console.log(pc.dim(`  ${msg.bannerInstaller(readVersion())}`));
  console.log(pc.dim(`  ${msg.bannerCreatedBy(CONTACT.author, CONTACT.email)}`));
  console.log();
}

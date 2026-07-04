// Banner e créditos do CLI.
import pc from "picocolors";
import { readVersion } from "./bundle.js";

const ART = String.raw`
███╗   ███╗  ██████╗  ██████╗
████╗ ████║ ██╔════╝  ██╔══██╗
██╔████╔██║ ██║  ███╗ ██████╔╝
██║╚██╔╝██║ ██║   ██║ ██╔══██╗
██║ ╚═╝ ██║ ╚██████╔╝ ██║  ██║
╚═╝     ╚═╝  ╚═════╝  ╚═╝  ╚═╝`;

export const CONTACT = { author: "Mauri Reis", email: "maurigre@gmail.com" };

export function printBanner() {
  console.log(pc.cyan(ART));
  console.log();
  console.log(pc.bold("  MGR — Método Governado por Rastreabilidade"));
  console.log(pc.dim("  AI Development Framework (SDD para agentes de código)"));
  console.log(pc.dim(`  Installer v${readVersion()}`));
  console.log(pc.dim(`  Criado por ${CONTACT.author} · ${CONTACT.email}`));
  console.log();
}

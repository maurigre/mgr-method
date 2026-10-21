import { spawnSync } from "node:child_process";

// Pid de um processo que ja terminou: o spawnSync so retorna depois que o filho (node -e "") sai,
// e o .pid do resultado e o dele.
export const pidMorto = () => spawnSync(process.execPath, ["-e", ""]).pid;

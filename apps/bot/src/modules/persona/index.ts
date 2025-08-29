import path from "path";
import fs from "fs/promises";
import { pathToFileURL, fileURLToPath } from "url";
import type { Container } from "@pkg/core";
import { TOK } from "../../tokens";

type CommandFile = {
  name: string;
  builder: any; // SlashCommandBuilder
  handle: (ix: any, c: Container) => Promise<void> | void;
};

async function loadCommands(dir: string): Promise<CommandFile[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = dirents.filter(d => d.isFile() && (d.name.endsWith(".ts") || d.name.endsWith(".js")));
  const cmds: CommandFile[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(dir, f.name)).href)).default as CommandFile;
    if (mod?.name && mod.builder && typeof mod.handle === "function") cmds.push(mod);
  }
  return cmds;
}

export default {
  name: "persona",
  slash: () => [], // we’ll collect builders in the deploy script by scanning commands/
  register: async (c: Container) => {
    const router = await c.get(TOK.CommandRouter);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname  = path.dirname(__filename);
    const commandsDir = path.join(__dirname, "commands");

    const commands = await loadCommands(commandsDir);
    for (const cmd of commands) {
      router.register(cmd.builder.name, async (ix) => cmd.handle(ix, c));
    }
    return {};
  }
};

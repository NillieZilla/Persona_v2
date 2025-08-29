import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath, pathToFileURL } from "url";

// ── env / REST
const token   = process.env.DISCORD_TOKEN!;
const appId   = process.env.APP_ID!;
const guildId = process.env.DEV_GUILD_ID!;
const rest = new REST({ version: "10" }).setToken(token);

// ── collect all SlashCommandBuilder JSONs from modules/*/commands/*.ts
async function collectAllCommands(modulesDir: string) {
  const out: any[] = [];

  const dirents = await fs.readdir(modulesDir, { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    if (!d.isDirectory()) continue;

    const commandsDir = path.join(modulesDir, d.name, "commands");
    const files = await fs.readdir(commandsDir, { withFileTypes: true }).catch(() => []);
    for (const f of files) {
      if (!f.isFile()) continue;
      if (!f.name.endsWith(".ts") && !f.name.endsWith(".js")) continue;

      const url = pathToFileURL(path.join(commandsDir, f.name)).href;
      const mod = (await import(url)).default as {
        builder?: SlashCommandBuilder | { toJSON: () => any }
      };

      if (!mod?.builder) continue;

      // Support both real builder instances and plain objects with toJSON
      const json = (mod.builder as any).toJSON ? (mod.builder as any).toJSON() : mod.builder;
      out.push(json);
    }
  }

  // de-dupe by name to avoid collisions if you keep “test” and “real” versions around
  const deduped = Array.from(
    new Map(out.map((c: any) => [c.name, c])).values()
  );

  // sort for determinism (nice for diffs)
  deduped.sort((a: any, b: any) => a.name.localeCompare(b.name));

  return deduped;
}

async function main() {
  const mode = (process.argv[2] || "").toLowerCase();
  if (!token)  throw new Error("DISCORD_TOKEN required");
  if (!appId)  throw new Error("APP_ID required");
  if (!guildId) throw new Error("DEV_GUILD_ID required");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);
  const modulesDir = path.resolve(__dirname, "modules");

  // Build the authoritative command list by scanning modules
  const desiredGuildCommands = await collectAllCommands(modulesDir);
  if (!desiredGuildCommands.length) {
    console.warn("[commands] collected 0 commands — did you create any builders under modules/*/commands/?");
  } else {
    console.log(`[commands] collected ${desiredGuildCommands.length} command(s): ${desiredGuildCommands.map(c => c.name).join(", ")}`);
  }

  switch (mode) {
    case "reset:guild": {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: desiredGuildCommands });
      console.log("[commands] reset guild commands");
      break;
    }
    case "deploy:guild": {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: desiredGuildCommands });
      console.log("[commands] deployed to guild");
      break;
    }
    case "list:guild": {
      const cmds = await rest.get(Routes.applicationGuildCommands(appId, guildId)) as any[];
      console.log(`[commands] guild has ${cmds.length} command(s)`);
      cmds.forEach(c => console.log(` - ${c.name}`));
      break;
    }
    case "clear:guild": {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: [] });
      console.log("[commands] cleared guild commands");
      break;
    }
    default:
      console.log("usage: tsx src/commands.ts deploy:guild | reset:guild | list:guild | clear:guild");
  }
}

main().catch(e => { console.error(e); process.exit(1); });

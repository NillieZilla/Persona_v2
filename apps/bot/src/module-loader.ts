import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import fs from "fs/promises";
import type { Container } from "@pkg/core";

export type StopFn = () => Promise<void>;

export interface AutoModule {
  name: string;
  register: (c: Container, conn: { connection: { url: string } }) =>
    Promise<void | { stop?: () => Promise<void> }>;
  // optional: for deploy collection
  slash?: () => import("discord.js").ApplicationCommandDataResolvable[];
}

const isFile = (p: string) => p.endsWith(".ts") || p.endsWith(".js");
const exists = async (p: string) => !!(await fs.stat(p).catch(() => null));

export async function autoLoadModules(
  c: Container,
  conn: { connection: { url: string } },
  opts: { dir?: string } = {}
): Promise<StopFn[]> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);
  const modulesDir = opts.dir ?? path.resolve(__dirname, "modules");

  let dirents: any[] = [];
  try { dirents = await fs.readdir(modulesDir, { withFileTypes: true }); }
  catch { return []; }

  const candidates: string[] = [];
  for (const d of dirents) {
    const p = path.join(modulesDir, d.name);
    if (d.isFile() && isFile(p)) candidates.push(p);
    if (d.isDirectory()) {
      const idxTs = path.join(p, "index.ts");
      const idxJs = path.join(p, "index.js");
      if (await exists(idxTs)) candidates.push(idxTs);
      else if (await exists(idxJs)) candidates.push(idxJs);
    }
  }

  const stops: StopFn[] = [];
  for (const file of candidates) {
    const url = pathToFileURL(file).href;
    const mod = (await import(url)).default as Partial<AutoModule> | undefined;
    if (!mod || !mod.name || typeof mod.register !== "function") continue;

    const out = await mod.register(c, conn);
    if (out && "stop" in out && typeof out.stop === "function") {
      stops.push(out.stop);
    }
    console.log(`[modules] loaded: ${mod.name}`);
  }
  return stops;
}

/** Collect slash commands from modules (if they expose .slash()) */
export async function collectSlashFromModules(
  opts: { dir?: string } = {}
) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);
  const modulesDir = opts.dir ?? path.resolve(__dirname, "modules");

  let dirents: any[] = [];
  try { dirents = await fs.readdir(modulesDir, { withFileTypes: true }); }
  catch { return []; }

  const candidates: string[] = [];
  for (const d of dirents) {
    const p = path.join(modulesDir, d.name);
    if (d.isFile() && isFile(p)) candidates.push(p);
    if (d.isDirectory()) {
      const idxTs = path.join(p, "index.ts");
      const idxJs = path.join(p, "index.js");
      if (await exists(idxTs)) candidates.push(idxTs);
      else if (await exists(idxJs)) candidates.push(idxJs);
    }
  }

  const all: any[] = [];
  for (const file of candidates) {
    const url = pathToFileURL(file).href;
    const mod = (await import(url)).default as Partial<AutoModule> | undefined;
    if (mod?.slash) all.push(...(mod.slash() ?? []));
  }
  return all;
}

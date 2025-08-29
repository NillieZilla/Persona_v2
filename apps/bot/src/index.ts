import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import { CommandRouter } from "@pkg/core"; // type only
import { makeContainer } from "./di";
import { TOK } from "./tokens";
import { autoLoadModules } from "./module-loader";

/** ────────────────────────────────────────────────────────────────────────────
 *  Logger (safe pretty in dev)
 *  ───────────────────────────────────────────────────────────────────────── */
const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "production" ? undefined : {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:standard" }
  }
});

/** ────────────────────────────────────────────────────────────────────────────
 *  Redis (with loud connect)
 *  ───────────────────────────────────────────────────────────────────────── */
function makeRedis(url: string) {
  const r = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    enableReadyCheck: true,
  });
  r.on("error", (e) => log.error({ err: e?.message }, "[redis] error"));
  r.on("reconnecting", () => log.warn("[redis] reconnecting…"));
  r.on("ready", () => log.info("[redis] ready"));
  return r;
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Env + Discord client
 *  ───────────────────────────────────────────────────────────────────────── */
const token = process.env.DISCORD_TOKEN!;
const redisUrl = process.env.REDIS_URL!;
if (!token) { log.error("Missing DISCORD_TOKEN"); process.exit(1); }
if (!redisUrl) { log.error("Missing REDIS_URL"); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once("clientReady", () => {
  log.info({ user: client.user?.tag }, "[bot] ready");
  client.user?.setPresence({
    activities: [{ name: "persona proxy setup", type: ActivityType.Playing }],
    status: "online",
  });
});

/** ────────────────────────────────────────────────────────────────────────────
 *  Connect Redis + Queues
 *  ───────────────────────────────────────────────────────────────────────── */
const redis = makeRedis(redisUrl);
log.info(`[boot] connecting to Redis at ${redisUrl}`);
await Promise.race([
  redis.connect(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connect timeout (5s)")), 5000)),
]).catch((e) => { log.error({ err: e?.message }, "[boot] Redis connection failed"); process.exit(1); });
log.info("[boot] connected to Redis");

const conn = { connection: { url: redisUrl } };
const pingQueue = new Queue("ping", conn);
const enhanceQueue = new Queue("enhance", conn);

/** ────────────────────────────────────────────────────────────────────────────
 *  DI container + modules
 *  ───────────────────────────────────────────────────────────────────────── */
const container = await makeContainer({
  logger: log,
  client,
  redis,
  enhanceQueue,
  dispatchQueue: new Queue("dispatch", conn), // kept bound for DI; module runs the worker
  pingQueue,
});

// Register modules
const stops = await autoLoadModules(container, conn);


// Single router from DI
const router = await container.get<CommandRouter>(TOK.CommandRouter);

/** ────────────────────────────────────────────────────────────────────────────
 *  Slash command shim → everything goes through the router
 *  ───────────────────────────────────────────────────────────────────────── */
client.on("interactionCreate", async (ix) => {
  if (!ix.isChatInputCommand()) return;
  const handled = await (router as any).dispatch(ix);
  if (!handled) console.warn("[router] no handler for", ix.commandName);
});

/** ────────────────────────────────────────────────────────────────────────────
 *  Shutdown
 *  ───────────────────────────────────────────────────────────────────────── */
const stop = async (code = 0) => {
  try {
    // close app-owned queues
    await pingQueue.close();
    await enhanceQueue.close();
    // ask modules to cleanup
    for (const s of stops) { await s().catch(() => {}); }
    await redis.quit();
    await client.destroy();
  } catch {}
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

client.login(token);

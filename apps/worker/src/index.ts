import "dotenv/config";
import { Worker, Queue, QueueEvents, JobsOptions } from "bullmq";
import { z } from "zod";
import { createHash } from "crypto";
import { Redis } from "ioredis";
import pino from "pino";

/** ────────────────────────────────────────────────────────────────────────────
 *  Logger
 *  ───────────────────────────────────────────────────────────────────────── */
const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "production" ? undefined : {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:standard" }
  }
});

/** ────────────────────────────────────────────────────────────────────────────
 *  Env & Redis connections
 *  ───────────────────────────────────────────────────────────────────────── */
const redisUrl = process.env.REDIS_URL!;
if (!redisUrl) {
  log.error("[worker] Missing REDIS_URL");
  process.exit(1);
}
const conn = { connection: { url: redisUrl } };
const redis = new Redis(redisUrl, { 
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

try {
  await redis.connect();
  log.info("[worker] Redis connected");
} catch (error) {
  log.error({ error: (error as Error).message }, "[worker] Redis connection failed");
  process.exit(1);
}

/** ────────────────────────────────────────────────────────────────────────────
 *  Queues
 *    - ping: demo queue used by /ping
 *    - enhance: bot → worker (raw message)
 *    - dispatch: worker → bot (processed payload for webhook)
 *    - enhance-dlq: dead-letter for failed enhance jobs
 *  ───────────────────────────────────────────────────────────────────────── */
const dispatchQueue = new Queue("dispatch", conn);
const enhanceDLQ   = new Queue("enhance-dlq", conn);

/** ────────────────────────────────────────────────────────────────────────────
 *  Schemas (Zod) for strong boundaries
 *  ───────────────────────────────────────────────────────────────────────── */
const EnhanceIn = z.object({
  guildId: z.string().nullable(),
  channelId: z.string(),
  messageId: z.string(),
  authorId: z.string(),
  raw: z.string(),
});
type EnhanceInT = z.infer<typeof EnhanceIn>;

const EnhanceOut = z.object({
  guildId: z.string().nullable(),
  channelId: z.string(),
  messageId: z.string(),
  persona: z.object({
    name: z.string().min(1).max(80),
    avatarUrl: z.string().url().optional(),
  }),
  text: z.string().min(1),
});
type EnhanceOutT = z.infer<typeof EnhanceOut>;

/** ────────────────────────────────────────────────────────────────────────────
 *  Text normalization & trigger parsing
 *  ───────────────────────────────────────────────────────────────────────── */
function grammarLite(s: string) {
  let t = s.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  if (!/[.!?…]$/.test(t)) t += ".";
  return t;
}

function parseTrigger(raw: string): { persona: string; text: string } | null {
  const trimmed = raw.trim();
  const say = /^;say\s+(.+)/i.exec(trimmed);
  if (say) return { persona: "Proxy", text: grammarLite(say[1]) };
  const named = /^;([a-z0-9_][a-z0-9_\-]*)\s+(.+)$/i.exec(trimmed);
  if (named) return { persona: named[1].slice(0, 80), text: grammarLite(named[2]) };
  return null;
}

const hashText = (s: string) => createHash("sha1").update(s).digest("hex");

/** ────────────────────────────────────────────────────────────────────────────
 *  Worker: enhance → dispatch
 *   - Validates input (EnhanceIn)
 *   - Per-author cooldown (750ms)
 *   - Burst dedupe (2s) on (channel, persona, cleaned text)
 *   - Emits dispatch job (jobId = messageId) with retry/backoff
 *   - On failure: write to enhance:dlq
 *  ───────────────────────────────────────────────────────────────────────── */
const wEnhance = new Worker(
  "enhance",
  async (job) => {
    const incoming = EnhanceIn.parse(job.data) as EnhanceInT;

    // cooldown
    const cdKey = `cd:${incoming.guildId ?? "dm"}:${incoming.channelId}:${incoming.authorId}`;
    const cd = await redis.set(cdKey, "1", "PX", 750, "NX");
    if (cd !== "OK") return { skipped: "author-cooldown" };

    // parse & normalize
    const parsed = parseTrigger(incoming.raw);
    if (!parsed) return { skipped: true };

    const out = EnhanceOut.parse({
      guildId: incoming.guildId,
      channelId: incoming.channelId,
      messageId: incoming.messageId,
      persona: { name: parsed.persona },
      text: parsed.text,
    }) as EnhanceOutT;

    // burst dedupe
    const ttlSec = 2;
    const h = hashText(`${out.channelId}|${out.persona.name}|${out.text}`);
    const dupeKey = `dupe:${out.guildId ?? "dm"}:${out.channelId}:${out.persona.name}:${h}`;
    const set = await redis.set(dupeKey, "1", "EX", ttlSec, "NX");
    if (set !== "OK") return { skipped: "burst-dupe" };

    // dispatch with retry/backoff
    const opts: JobsOptions = {
      jobId: out.messageId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    };
    await dispatchQueue.add("dispatch", out, opts);

    return { persona: out.persona.name, len: out.text.length };
  },
  conn
);

const evEnhance = new QueueEvents("enhance", conn);
evEnhance.on("completed", ({ jobId, returnvalue }) =>
  log.info({ jobId, returnvalue }, "[enhance] completed")
);
evEnhance.on("failed", async ({ jobId, failedReason }) => {
  log.error({ jobId, failedReason }, "[enhance] failed → DLQ");

  // copy to DLQ with metadata
  const enhanceQueue = new Queue("enhance", conn);
  const j = await enhanceQueue.getJob(jobId!);
  if (j) {
    await enhanceDLQ.add("failed", {
      data: j.data,
      failedReason,
      attemptsMade: j.attemptsMade,
      ts: Date.now(),
    }, { removeOnComplete: 1000, removeOnFail: 1000 });
  }
  await enhanceQueue.close();
});

/** ────────────────────────────────────────────────────────────────────────────
 *  Demo: ping worker
 *  ───────────────────────────────────────────────────────────────────────── */
const wPing = new Worker(
  "ping",
  async (job) => {
    log.info({ jobId: job.id, data: job.data }, "[ping] processing");
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true, at: Date.now() };
  },
  conn
);
const evPing = new QueueEvents("ping", conn);
evPing.on("completed", ({ jobId, returnvalue }) =>
  log.info({ jobId, returnvalue }, "[ping] completed")
);
evPing.on("failed", ({ jobId, failedReason }) =>
  log.error({ jobId, failedReason }, "[ping] failed")
);

/** ────────────────────────────────────────────────────────────────────────────
 *  Health check mechanism
 *  ───────────────────────────────────────────────────────────────────────── */
setInterval(async () => {
  try {
    const pong = await redis.ping();
    log.debug({ redis: pong }, "[worker] health check");
  } catch (error) {
    log.error({ error: (error as Error).message }, "[worker] health check failed");
  }
}, 30000); // every 30 seconds

/** ────────────────────────────────────────────────────────────────────────────
 *  Graceful shutdown
 *  ───────────────────────────────────────────────────────────────────────── */
process.on("SIGINT", async () => {
  await Promise.allSettled([
    wEnhance.close(), evEnhance.close(),
    wPing.close(), evPing.close(),
    dispatchQueue.close(), enhanceDLQ.close(),
    redis.quit(),
  ]);
  process.exit(0);
});

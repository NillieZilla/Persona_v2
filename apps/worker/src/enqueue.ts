import "dotenv/config";
import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL!;
const conn = { connection: { url: redisUrl } };

async function main() {
  const q = new Queue("ping", conn);
  const job = await q.add("hello", { time: Date.now() });
  console.log("[enqueue] added job id:", job.id);
  await q.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

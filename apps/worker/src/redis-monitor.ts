import "dotenv/config";
import { Redis } from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(url);

redis.monitor((err, monitor) => {
  if (err) {
    console.error("Failed to start MONITOR:", err);
    process.exit(1);
  }
  if (!monitor) {
    console.error("Monitor is undefined");
    process.exit(1);
  }
  console.log(`[monitor] Connected to ${url}. Streaming commands...`);
  monitor.on("monitor", (time, args, source, db) => {
    // time = unix seconds; args = ["SET","key","val",...]
    const ts = new Date(time * 1000).toISOString().split("T")[1].replace("Z","");
    console.log(`${ts} [db${db}] ${source} > ${args.join(" ")}`);
  });
});

// graceful exit
process.on("SIGINT", async () => { await redis.quit(); process.exit(0); });

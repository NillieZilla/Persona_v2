import type { Container } from "@pkg/core";
import { TOK } from "../../tokens";

export default {
  name: "analytics",
  register: async (c: Container) => {
    const bus = await c.get(TOK.EventBus);
    const off = bus.on("messageProxied", async (e) => {
      // plug into metrics/logging; this is where you'd increment counters, etc.
      // console.log("[analytics] proxied", e.channelId, e.persona);
    });
    return { stop: async () => { off(); } };
  }
};

import type { Middleware } from "@pkg/core";
import type Redis from "ioredis";

export const guildOnly: Middleware = async ({ ix }, next) => {
  if (!ix.guildId) { await ix.reply({ content: "Guild only.", flags: 64 } as any); return; }
  return next();
};

export function requirePerms(...perms: bigint[]): Middleware {
  return async ({ ix }, next) => {
    const ch: any = ix.channel;
    const me = await ch.guild.members.fetchMe();
    const p = ch.permissionsFor(me);
    const ok = perms.every((perm) => p?.has(perm));
    if (!ok) {
      await ix.reply({ content: "Missing permissions.", flags: 64 } as any);
      return;
    }
    return next();
  };
}

export function cooldown(redis: Redis, seconds: number, scope = "cmd"): Middleware {
  return async ({ ix }, next) => {
    const key = `cd:${scope}:${ix.commandName}:${ix.user.id}`;
    const set = await (redis as any).set(key, "1", "EX", seconds, "NX");
    if (set !== "OK") {
      await ix.reply({ content: `Slow down — try again in a few seconds.`, flags: 64 } as any);
      return;
    }
    return next();
  };
}

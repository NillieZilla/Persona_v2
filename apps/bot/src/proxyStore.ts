import { Redis } from "ioredis";

export class ProxyStore {
  constructor(private redis: Redis, private prefix = "proxy:enabled") {}
  private key(guildId: string) { return `${this.prefix}:${guildId}`; }

  async enable(guildId: string, channelId: string) {
    await this.redis.sadd(this.key(guildId), channelId);
  }
  async disable(guildId: string, channelId: string) {
    await this.redis.srem(this.key(guildId), channelId);
  }
  async list(guildId: string) {
    return await this.redis.smembers(this.key(guildId));
  }
  async isEnabled(guildId: string, channelId: string) {
    return (await this.redis.sismember(this.key(guildId), channelId)) === 1;
  }
}

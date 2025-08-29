import { createToken, CommandRouter } from "@pkg/core";
import type pino from "pino";
import type { Client } from "discord.js";
import type Redis from "ioredis";
import type { Queue } from "bullmq";
import type { BotEventBus } from "./events";

export const TOK = {
  Logger:         createToken<pino.Logger>("Logger"),
  Client:         createToken<Client>("Client"),
  Redis:          createToken<Redis>("Redis"),
  EnhanceQueue:   createToken<Queue>("EnhanceQueue"),
  DispatchQueue:  createToken<Queue>("DispatchQueue"),
  PingQueue:      createToken<Queue>("PingQueue"),
  CommandRouter:  createToken<CommandRouter>("CommandRouter"),
  EventBus:       createToken<BotEventBus>("EventBus"),

  // NEW: DI handle for the ProxyStore
  ProxyStore:     createToken<ProxyStore>("ProxyStore"),
};

// You can import ProxyStore's type from the module, but to keep tokens.ts standalone:
export interface ProxyStore {
  enable(guildId: string, channelId: string): Promise<void>;
  disable(guildId: string, channelId: string): Promise<void>;
  list(guildId: string): Promise<string[]>;
  isEnabled(guildId: string, channelId: string): Promise<boolean>;
}

import { Container, CommandRouter, EventBus } from "@pkg/core";
import { TOK } from "./tokens";
import type pino from "pino";
import type { Client } from "discord.js";
import type Redis from "ioredis";
import type { Queue } from "bullmq";
import type { BotEventBus } from "./events";

export async function makeContainer(opts: {
  logger: pino.Logger;
  client: Client;
  redis: Redis;
  enhanceQueue: Queue;
  dispatchQueue: Queue;
  pingQueue: Queue;
}) {
  const c = new Container();

  c.bindValue(TOK.Logger,        opts.logger);
  c.bindValue(TOK.Client,        opts.client);
  c.bindValue(TOK.Redis,         opts.redis);
  c.bindValue(TOK.EnhanceQueue,  opts.enhanceQueue);
  c.bindValue(TOK.DispatchQueue, opts.dispatchQueue);
  c.bindValue(TOK.PingQueue,     opts.pingQueue);
  c.bindValue(TOK.EventBus, new EventBus() as BotEventBus);

  // one router for the whole app
  c.bindValue(TOK.CommandRouter, new CommandRouter());

  return c;
}

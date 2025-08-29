import { EventBus } from "@pkg/core";

export interface BotEvents {
  messageProxied: {
    guildId: string | null;
    channelId: string;
    authorId: string;
    persona: string;
    text: string;
  };
  personaCreated: {
    guildId: string;
    name: string;
    by: string;
  };
}

export type BotEventBus = EventBus<BotEvents>;

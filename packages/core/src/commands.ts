import type { ChatInputCommandInteraction } from "discord.js";
import type { Container } from "./container.js";

export interface CommandContext {
  ix: ChatInputCommandInteraction;
  container: Container;
}
export type SlashHandler = (ctx: CommandContext) => Promise<void> | void;
export type Middleware   = (ctx: CommandContext, next: () => Promise<void>) => Promise<void> | void;

function compose(mw: Middleware[], handler: SlashHandler): SlashHandler {
  return async (ctx) => {
    let i = -1;
    async function dispatch(idx: number): Promise<void> {
      if (idx <= i) throw new Error("next() called multiple times");
      i = idx;
      const fn = idx === mw.length ? handler : mw[idx];
      if (!fn) return;
      await fn(ctx, () => dispatch(idx + 1));
    }
    await dispatch(0);
  };
}

export class CommandRouter {
  private map = new Map<string, { handler: SlashHandler; mw: Middleware[] }>();
  private global: Middleware[] = [];

  use(mw: Middleware) { this.global.push(mw); return this; }

  useFor(name: string, ...mw: Middleware[]) {
    const rec = this.map.get(name);
    if (!rec) this.map.set(name, { handler: async () => {}, mw });
    else rec.mw.push(...mw);
    return this;
  }

  register(name: string, handler: (ix: ChatInputCommandInteraction) => Promise<void> | void) {
    const wrapped: SlashHandler = async ({ ix }) => handler(ix);
    const rec = this.map.get(name) ?? { handler: wrapped, mw: [] as Middleware[] };
    rec.handler = wrapped;
    this.map.set(name, rec);
    return this;
  }

  async dispatch(ix: ChatInputCommandInteraction, container?: Container): Promise<boolean> {
    const rec = this.map.get(ix.commandName);
    if (!rec) return false;
    const ctx: CommandContext = { ix, container: container! };
    const pipeline = compose([...this.global, ...rec.mw], rec.handler);
    await pipeline(ctx);
    return true;
  }
}

// A tiny, typed pub/sub with on/once/off/emit + waitFor (optional timeout)

export type Listener<Payload> = (payload: Payload) => void | Promise<void>;

export class EventBus<TEvents extends Record<string, any>> {
  private map = new Map<keyof TEvents, Set<Listener<any>>>();

  on<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>): () => void {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(fn as any);
    return () => this.off(event, fn);
  }

  once<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>): () => void {
    const off = this.on(event, async (p: TEvents[K]) => {
      try { await fn(p); } finally { off(); }
    });
    return off;
  }

  off<K extends keyof TEvents>(event: K, fn: Listener<TEvents[K]>): void {
    const set = this.map.get(event);
    if (set) set.delete(fn as any);
  }

  removeAll<K extends keyof TEvents>(event?: K): void {
    if (event) this.map.delete(event);
    else this.map.clear();
  }

  async emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void> {
    const set = this.map.get(event);
    if (!set || set.size === 0) return;
    // Run listeners sequentially to keep ordering predictable
    for (const fn of Array.from(set)) {
      await fn(payload);
    }
  }

  // Utility: await the next matching event (with optional predicate/timeout)
  waitFor<K extends keyof TEvents>(
    event: K,
    opts?: { where?: (p: TEvents[K]) => boolean; timeoutMs?: number }
  ): Promise<TEvents[K]> {
    const { where, timeoutMs } = opts ?? {};
    return new Promise<TEvents[K]>((resolve, reject) => {
      const off = this.on(event, (p) => {
        if (!where || where(p)) { off(); clearTimeout(timer); resolve(p); }
      });
      const timer = timeoutMs ? setTimeout(() => {
        off(); reject(new Error(`waitFor timeout on ${String(event)} after ${timeoutMs}ms`));
      }, timeoutMs) : (null as any);
    });
  }
}

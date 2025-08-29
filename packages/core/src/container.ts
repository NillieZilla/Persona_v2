import type { Token } from "./token.js";

type Factory<T> = (c: Container) => T | Promise<T>;
type Binding =
  | { kind: "value"; value: unknown }
  | { kind: "factory"; factory: Factory<unknown>; singleton: boolean; cache?: unknown };

export class Container {
  private map = new Map<symbol, Binding>();
  constructor(private parent?: Container) {}

  child(): Container { return new Container(this); }

  bindValue<T>(token: Token<T>, value: T) {
    this.map.set(token.key, { kind: "value", value });
    return this;
  }

  bindFactory<T>(token: Token<T>, factory: Factory<T>, opts?: { singleton?: boolean }) {
    this.map.set(token.key, { kind: "factory", factory, singleton: !!opts?.singleton });
    return this;
  }

  has<T>(token: Token<T>): boolean {
    if (this.map.has(token.key)) return true;
    return this.parent?.has(token) ?? false;
  }

  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.map.has(token.key)) {
      const b = this.map.get(token.key)!;
      if (b.kind === "value") return b.value as T;
      if (b.kind === "factory") {
        if (b.singleton) {
          if (b.cache === undefined) b.cache = await b.factory(this);
          return b.cache as T;
        } else {
          return await b.factory(this) as T;
        }
      }
    }
    if (this.parent) return this.parent.resolve(token);
    throw new Error(`Token not bound: ${String(token.desc ?? token.key)}`);
  }

  get<T>(token: Token<T>): Promise<T> { return this.resolve(token); }
}

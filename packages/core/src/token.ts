export type Token<T> = { readonly key: symbol; readonly desc?: string };
export function createToken<T>(desc?: string): Token<T> {
  return { key: Symbol(desc), desc };
}

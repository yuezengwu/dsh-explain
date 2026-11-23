import { Context } from '@deepseek-ai/cordis'

/** Resolve the application context across Cordis's string and symbol root APIs. */
export function applicationContext<T extends Context>(ctx: T): T {
  const rootKey = (Context as { readonly root?: symbol }).root
  return Reflect.get(ctx, rootKey ?? 'root') as T
}

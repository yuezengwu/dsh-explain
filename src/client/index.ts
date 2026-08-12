/** Browser half: mount dsh-explain's generated typed Remote contribution. */
import type { Context } from '@deepseek-ai/cordis'
import explainRemote from 'dsh-explain/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from 'dsh-explain/remote'

/** Required service: the TypeRT Client Remote registry and caller. */
export const inject = ['remote']

/** Mount the generated strict codecs for the explain namespace. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await ctx.remote.$mount(explainRemote)
}

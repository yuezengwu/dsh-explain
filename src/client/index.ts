/** Browser half: mount typed Remote and register the global Learning view. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import explainRemote from 'dsh-explain/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-explain/remote'
import { LearningView, type LearningViewInjected } from './LearningView.tsx'
import { GlobalLearningStore } from './learning-store.ts'
import { en, NS, zh } from './locales.ts'
import { LEARNING_VIEW_CSS } from './styles.ts'

/** Required services: typed Remote, locale dictionaries, and conversation slots. */
export const inject = ['remote', 'locale', 'slots']

/** Mount the generated codecs and one Session-scoped view over the global store. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(explainRemote)
  const feature = ctx.inject(['remote.explain', 'locale', 'slots'], (scope) => {
    const learning = new GlobalLearningStore(scope)
    scope.effect(() => () => { learning.dispose() }, 'dsh-explain: learning store')
    scope.effect(() => scope.locale.register(NS, { zh, en }), 'dsh-explain: dictionaries')
    scope.effect(() => {
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-explain'
      style.textContent = LEARNING_VIEW_CSS
      document.head.append(style)
      return () => { style.remove() }
    }, 'dsh-explain: learning view styles')
    const t = scope.locale.bind(NS)
    scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: 'dsh-explain:learning',
      order: 20,
      locale: NS,
      label: () => t('view.learning'),
      inject: (_sessionId: SessionId): LearningViewInjected => ({
        hooks: { learning: learning.store },
        activate: () => learning.mount(),
        loadOlder: () => learning.loadOlder(),
        refresh: () => learning.refresh(),
        feedback: (entry, action) => learning.feedback(entry, action),
        reopen: entry => learning.reopen(entry),
      }),
    }, LearningView))
  })
  try {
    await feature.await()
  } catch (error) {
    await feature.dispose()
    await unmountRemote()
    throw error
  }
  return async () => {
    await feature.dispose()
    await unmountRemote()
  }
}

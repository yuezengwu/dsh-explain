import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { applicationContext } from '../src/context-compat.ts'

it('waits for the application loader rather than a child loader during settings migration', async () => {
  const root = new Context()
  const calls: string[] = []
  root.provide('loader', { await: async () => { calls.push('application') } })
  const child = root.extend({ loader: { await: async () => { calls.push('child') } } }) as Context & {
    loader: { await(): Promise<void> }
  }
  await applicationContext(child).loader.await()
  expect(calls).toEqual(['application'])
  expect(applicationContext(child)).toBe(root)
})

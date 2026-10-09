#!/usr/bin/env node
// Synthetic queue measurements only; no DSH home, sessions, or providers.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  module: { type: 'string', default: fileURLToPath(new URL('../src/queue.ts', import.meta.url)) },
  sample: { type: 'boolean', default: false },
  scenario: { type: 'string', default: 'queued' },
  sources: { type: 'string', default: '1000' },
} })
if (!['queued', 'processed', 'in-flight'].includes(values.scenario)
  || !Number.isSafeInteger(Number(values.sources)) || Number(values.sources) < 1) {
  throw new Error('Expected queued/processed/in-flight and a positive integer source count')
}

function capsule(id, observedAt) {
  return { sourceSessionId: id, observedAt, turn: 1, endSeq: 1,
    userText: 'Synthetic queue fixture.', assistantText: '', tools: [], truncated: false }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

if (values.sample) {
  if (typeof global.gc !== 'function') throw new Error('Samples require node --expose-gc')
  const { CandidateQueue } = await import(pathToFileURL(resolve(values.module)).href)
  const blocked = new Set()
  const warmup = new CandidateQueue()
  for (let i = 0; i < 1000; i++) {
    warmup.push(capsule(`warmup-${i}`, i), 8)
    const candidate = warmup.take(blocked)
    warmup.finish?.(candidate)
  }
  warmup.clear()
  global.gc()
  global.gc()
  const before = process.memoryUsage().heapUsed
  const queue = new CandidateQueue()
  if (values.scenario === 'in-flight') {
    queue.push(capsule('in-flight-source', -1), 8)
    queue.take(blocked)
  }
  const sources = Number(values.sources)
  const started = performance.now()
  for (let i = 0; i < sources; i++) {
    queue.push(capsule(`synthetic-source-${i}`, i), 8)
    if (values.scenario === 'processed') {
      const candidate = queue.take(blocked)
      queue.finish?.(candidate)
    }
  }
  const elapsedMs = performance.now() - started
  global.gc()
  global.gc()
  const heapRetainedBytes = process.memoryUsage().heapUsed - before
  // The fallback permits comparison with the pre-fix queue from git show.
  const retainedSources = queue.retainedSourceCount ?? Reflect.get(queue, 'latestSequence').size
  console.log(JSON.stringify({ pending: queue.size, retainedSources, heapRetainedBytes, elapsedMs }))
} else {
  const measurements = []
  for (const scenario of ['queued', 'processed', 'in-flight']) {
    for (const sources of [1000, 10000]) {
      const samples = []
      for (let i = 0; i < 5; i++) {
        const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url),
          '--sample', '--module', values.module, '--scenario', scenario, '--sources', String(sources)],
        { encoding: 'utf8' })
        if (child.status !== 0) throw new Error(child.stderr || String(child.error))
        samples.push(JSON.parse(child.stdout))
      }
      measurements.push({ scenario, sources, pending: samples[0].pending,
        retainedSources: samples[0].retainedSources,
        heapRetainedBytesMedian: median(samples.map(s => s.heapRetainedBytes)),
        elapsedMsMedian: median(samples.map(s => s.elapsedMs)), samples })
    }
  }
  console.log(JSON.stringify({ node: process.version, queueModule: resolve(values.module),
    pendingLimit: 8, samplesPerCase: 5, measurements }, null, 2))
}

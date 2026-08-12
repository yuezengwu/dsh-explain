#!/usr/bin/env node
import { rmSync } from 'node:fs'

for (const target of ['lib', 'coverage', 'tsconfig.host.tsbuildinfo']) {
  rmSync(target, { force: true, recursive: true })
}

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineModule } from '@aicommerce/core'
import { sample } from '@aicommerce/module-sample'
import { afterAll, expect, test } from 'vitest'
import { repoRoot } from './files.js'
import { run, type Io } from './main.js'

function capture(overrides: Partial<Io> = {}) {
  const out: string[] = []
  const err: string[] = []
  const io: Partial<Io> = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ask: () => Promise.resolve(false),
    ...overrides,
  }
  return { io, out, err }
}

const wrap = (module: string, order: number) =>
  defineModule({
    name: module,
    depends: ['sample'],
    wraps: [{ action: 'sample.greet', module, order, wrap: (input, _ctx, next) => next(input) }],
  })

test('inspect action prints the wraps in order', async () => {
  const install = {
    modules: [sample, wrap('sample-late', 200), wrap('sample-early', 100)],
    migrations: {},
  }
  const { io, out } = capture({ install })
  expect(await run(['inspect', 'action', 'sample.greet'], io)).toBe(0)
  const text = out.join('\n')
  expect(text).toContain('sample.greet')
  expect(text.indexOf('sample-early')).toBeGreaterThan(-1)
  expect(text.indexOf('sample-early')).toBeLessThan(text.indexOf('sample-late'))

  const json = capture({ install })
  expect(await run(['inspect', 'action', 'sample.greet', '--json'], json.io)).toBe(0)
  expect(JSON.parse(json.out.join('\n'))).toMatchObject({
    name: 'sample.greet',
    wraps: [{ module: 'sample-early' }, { module: 'sample-late' }],
  })
})

// Inside the package, so the generated module resolves @aicommerce/core and zod from it.
const scratch = join(repoRoot(), 'packages/cli/.generated')
mkdirSync(scratch, { recursive: true })
const parent = mkdtempSync(join(scratch, 'run-'))
afterAll(() => {
  rmSync(parent, { recursive: true, force: true })
})

test('module create writes a module whose tests pass', async () => {
  const { io, out } = capture()
  expect(await run(['module', 'create', 'gift-wrap', '--dir', parent], io)).toBe(0)
  const dir = join(parent, 'gift-wrap')
  for (const file of [
    'package.json',
    'tsconfig.json',
    'vitest.config.ts',
    'README.md',
    'src/index.ts',
    'src/index.test.ts',
  ]) {
    expect(existsSync(join(dir, file)), file).toBe(true)
  }
  expect(out.join('\n')).toContain('gift-wrap')
  const vitest = spawnSync(join(repoRoot(), 'node_modules/.bin/vitest'), ['run'], {
    cwd: dir,
    encoding: 'utf8',
  })
  expect(vitest.stdout + vitest.stderr).toContain('1 passed')
  expect(vitest.status).toBe(0)
}, 60_000)

test('module create refuses an existing folder or a bad name', async () => {
  mkdirSync(join(parent, 'taken'))
  const taken = capture()
  expect(await run(['module', 'create', 'taken', '--dir', parent], taken.io)).toBe(1)
  expect(taken.err.join('\n')).toContain('already exists')
  for (const name of ['Bad', '1x', 'a', 'has space', '../escape']) {
    const bad = capture()
    expect(await run(['module', 'create', name, '--dir', parent], bad.io)).toBe(2)
  }
  expect(existsSync(join(parent, '../escape'))).toBe(false)
})

test('unknown command exits 2 with usage', async () => {
  const { io, err } = capture()
  expect(await run(['frobnicate'], io)).toBe(2)
  expect(err.join('\n')).toContain('Usage: ai-commerce')
  const flag = capture()
  expect(await run(['inspect', 'action', 'x', '--nope'], flag.io)).toBe(2)
  expect(await run([], capture().io)).toBe(2)
})

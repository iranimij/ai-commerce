import { expect, test } from 'vitest'
import { parseBenchArgs } from './commands/bench.js'
import { parseSeedArgs } from './commands/seed.js'
import { UsageError } from './io.js'
import { run, type Io } from './main.js'

test('seed catalog parses --products', () => {
  expect(parseSeedArgs(['catalog', '--products', '1000000'])).toEqual({ products: 1_000_000 })
  for (const bad of [
    [],
    ['catalog'],
    ['customers', '--products', '10'],
    ['catalog', '--products', '0'],
    ['catalog', '--products', '-5'],
    ['catalog', '--products', '1.5'],
    ['catalog', '--products', '1e3'],
    ['catalog', '--products', 'ten'],
    ['catalog', '--products', '10000001'],
    ['catalog', 'extra', '--products', '10'],
  ]) {
    expect(() => parseSeedArgs(bad), bad.join(' ')).toThrow(UsageError)
  }
})

test('seed refuses without AICOMMERCE_ALLOW_SEED', async () => {
  for (const value of [undefined, '0', 'yes']) {
    const err: string[] = []
    const io: Partial<Io> = {
      env: { AICOMMERCE_ALLOW_SEED: value },
      out: () => undefined,
      err: (line) => err.push(line),
      install: { modules: [], migrations: {} },
    }
    expect(await run(['seed', 'catalog', '--products', '10'], io)).toBe(1)
    expect(err.join('\n')).toContain('AICOMMERCE_ALLOW_SEED=1')
  }
})

test('bench takes search', () => {
  expect(() => {
    parseBenchArgs(['search'])
  }).not.toThrow()
  for (const bad of [[], ['orders'], ['search', 'extra']]) {
    expect(() => {
      parseBenchArgs(bad)
    }, bad.join(' ')).toThrow(UsageError)
  }
})

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveModules } from '@aicommerce/core'
import { DEFAULT_MODULES, loadInstall, moduleList } from '@aicommerce/server'
import { beforeAll, expect, test } from 'vitest'
import { run, type Io } from './main.js'

const fixture = (name: string) =>
  `file:${fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url))}`

// A shop outside the monorepo, so pnpm treats it as a project of its own.
const shop = mkdtempSync(join(tmpdir(), 'aicommerce-shop-'))
beforeAll(() => {
  writeFileSync(join(shop, 'package.json'), '{ "name": "shop", "private": true }\n')
})

function capture(answer: boolean) {
  const out: string[] = []
  const err: string[] = []
  const asked: string[] = []
  const io: Partial<Io> = {
    cwd: shop,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ask: (question) => {
      asked.push(question)
      return Promise.resolve(answer)
    },
  }
  return { io, out, err, asked }
}

const snapshot = () =>
  ['package.json', 'pnpm-lock.yaml', 'aicommerce.config.json'].map((f) =>
    existsSync(join(shop, f)) ? readFileSync(join(shop, f), 'utf8') : null,
  )

test('add prints the declarations of a module', async () => {
  const { io, out, asked } = capture(true)
  expect(await run(['add', fixture('module-gifts')], io)).toBe(0)
  const text = out.join('\n')
  for (const part of [
    'aicommerce-module-gifts 1.2.0',
    'gifts',
    'sample',
    'gifts.wrap',
    'gifts.manage',
    'gifts.api-key',
    'secret',
    'gifts.restock',
    'sample.greet',
    'core.tax',
    '0001_paper.sql',
  ]) {
    expect(text, part).toContain(part)
  }
  expect(text).toMatch(/public.*gifts\.peek|gifts\.peek.*public/i)
  expect(asked).toHaveLength(1)
  expect(JSON.parse(readFileSync(join(shop, 'aicommerce.config.json'), 'utf8'))).toEqual({
    modules: ['aicommerce-module-gifts'],
  })
}, 60_000)

test('an added module is installed but not enabled', async () => {
  const install = await loadInstall(shop)
  expect(install.modules.map((m) => m.name)).toContain('gifts')
  expect(install.migrations.gifts?.[0]?.module).toBe('gifts')
  // Listed is installed, not enabled: a fresh shop's module list does not include it.
  const fresh = resolveModules(install.modules, moduleList(DEFAULT_MODULES)).enabled
  expect(fresh).not.toContain('gifts')
})

test('install scripts never run', () => {
  expect(existsSync(join(shop, 'node_modules/aicommerce-module-gifts'))).toBe(true)
  expect(existsSync(join(shop, 'postinstall-ran'))).toBe(false)
})

test('a rejected add changes nothing', async () => {
  const before = snapshot()
  const { io, err } = capture(false)
  expect(await run(['add', fixture('module-ribbons')], io)).toBe(1)
  expect(err.join('\n')).toContain('Cancelled')
  expect(snapshot()).toEqual(before)
  expect(existsSync(join(shop, 'node_modules/aicommerce-module-ribbons'))).toBe(false)
}, 60_000)

test('a package without a module is refused', async () => {
  const before = snapshot()
  const { io, err } = capture(true)
  expect(await run(['add', fixture('not-a-module'), '--yes'], io)).toBe(1)
  expect(err.join('\n')).toContain('not an AI Commerce module')
  expect(snapshot()).toEqual(before)
  expect(existsSync(join(shop, 'node_modules/not-a-module'))).toBe(false)
}, 60_000)

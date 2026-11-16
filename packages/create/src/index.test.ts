import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEnv } from '@aicommerce/server'
import { afterAll, expect, test } from 'vitest'
import { create } from './index.js'

const root = mkdtempSync(join(tmpdir(), 'aicommerce-create-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Reads .env the way Compose does for these simple KEY=value lines. */
function readDotEnv(dir: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(join(dir, '.env'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

test('create writes a project with fresh secrets', () => {
  const a = join(root, 'a')
  const b = join(root, 'b')
  create(a, { port: 3123 })
  create(b)
  expect(readdirSync(a).sort()).toEqual([
    '.env',
    'README.md',
    'aicommerce.config.json',
    'compose.yaml',
  ])
  const envA = readDotEnv(a)
  const envB = readDotEnv(b)
  for (const key of [
    'AICOMMERCE_SECRET_KEY',
    'AICOMMERCE_AUTH_SECRET',
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
  ]) {
    expect(envA[key], key).toBeTruthy()
    expect(envA[key], key).not.toBe(envB[key])
  }
  // The runtime role and the owner have different passwords.
  expect(new URL(envA.DATABASE_URL ?? '').password).not.toBe(
    new URL(envA.MIGRATION_DATABASE_URL ?? '').password,
  )
  const parsedA = readEnv(envA)
  readEnv(envB)
  expect(parsedA.AICOMMERCE_PUBLIC_URL).toBe('http://localhost:3123')
  expect(parsedA.AICOMMERCE_SECRET_KEY).toHaveLength(32)
  expect(readFileSync(join(a, 'compose.yaml'), 'utf8')).not.toMatch(/\{\{/)
})

test('create refuses a non-empty folder', () => {
  const dir = join(root, 'full')
  create(dir)
  const before = readFileSync(join(dir, '.env'), 'utf8')
  expect(() => {
    create(dir)
  }).toThrow(/not empty/)
  expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before)

  const other = mkdtempSync(join(root, 'other-'))
  writeFileSync(join(other, 'notes.txt'), 'mine')
  expect(() => {
    create(other)
  }).toThrow(/not empty/)
  expect(readdirSync(other)).toEqual(['notes.txt'])
})

test('.env is not readable by others', () => {
  const dir = join(root, 'private')
  create(dir)
  expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
})

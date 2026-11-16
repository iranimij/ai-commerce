import { expect, test } from 'vitest'
import { readEnv } from './env.js'

const valid = {
  DATABASE_URL: 'postgres://app:app@db:5432/aicommerce',
  MIGRATION_DATABASE_URL: 'postgres://owner:owner@db:5432/aicommerce',
  AICOMMERCE_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'),
  AICOMMERCE_AUTH_SECRET: 'x'.repeat(32),
  AICOMMERCE_PUBLIC_URL: 'http://localhost:3000',
}

test('defaults', () => {
  expect(readEnv(valid)).toMatchObject({
    PORT: 3000,
    AICOMMERCE_ROLE: 'all',
    AICOMMERCE_MODULES: ['system', 'access', 'sample'],
    AICOMMERCE_TRUSTED_PROXIES: 0,
  })
})

test('the error names every missing or invalid variable', () => {
  let message = ''
  try {
    readEnv({ AICOMMERCE_SECRET_KEY: 'short', AICOMMERCE_ROLE: 'boss' })
  } catch (error) {
    message = (error as Error).message
  }
  for (const name of [
    'DATABASE_URL',
    'MIGRATION_DATABASE_URL',
    'AICOMMERCE_AUTH_SECRET',
    'AICOMMERCE_PUBLIC_URL',
    'AICOMMERCE_ROLE',
  ]) {
    expect(message).toContain(name)
  }
  expect(message).toContain('AICOMMERCE_SECRET_KEY must be 32 bytes, base64 encoded')
})

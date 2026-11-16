import { randomBytes } from 'node:crypto'
import { expect, test } from 'vitest'
import { decryptSecret, encryptSecret, parseSecretKey } from './crypto.js'

const key = randomBytes(32)

test('round trip, with a fresh IV each time', () => {
  const a = encryptSecret('sk_live_123', key, 'pay.key')
  expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
  expect(a).not.toContain('sk_live')
  expect(encryptSecret('sk_live_123', key, 'pay.key')).not.toBe(a)
  expect(decryptSecret(a, key, 'pay.key')).toBe('sk_live_123')
})

test('a different AAD fails', () => {
  expect(() => decryptSecret(encryptSecret('x', key, 'pay.key'), key, 'pay.other')).toThrow()
})

test('a tampered tag fails', () => {
  const [v, iv, tag, ct] = encryptSecret('x', key, 'k').split('.')
  const bad = Buffer.from(tag ?? '', 'base64url')
  bad[0] = (bad[0] ?? 0) ^ 1
  expect(() => decryptSecret([v, iv, bad.toString('base64url'), ct].join('.'), key, 'k')).toThrow()
})

test('the key must be 32 bytes of base64', () => {
  expect(parseSecretKey(key.toString('base64'))).toEqual(key)
  for (const bad of [undefined, '', 'short', randomBytes(16).toString('base64')]) {
    expect(() => parseSecretKey(bad)).toThrow(
      'AICOMMERCE_SECRET_KEY must be 32 bytes, base64 encoded',
    )
  }
})

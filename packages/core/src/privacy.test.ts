import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { classify, privacyOf, toModel, type ModelPolicy } from './privacy.js'

const s = z.object({
  name: classify(z.string(), 'public'),
  total: classify(z.number(), 'internal'),
  email: z.string(),
  password: classify(z.string(), 'secret'),
  lines: z.array(z.object({ sku: classify(z.string(), 'public'), note: z.string() })),
})
const v = {
  name: 'Lamp',
  total: 99,
  email: 'a@b.c',
  password: 'p',
  lines: [{ sku: 'L1', note: 'gift' }],
}
const none: ModelPolicy = { internalRows: false, personalFields: [] }

describe('privacyOf', () => {
  test('finds the class through wrappers, and is undefined when unclassified', () => {
    expect(privacyOf(classify(z.string(), 'public').optional())).toBe('public')
    expect(privacyOf(z.string())).toBeUndefined()
  })
})

describe('toModel', () => {
  test('unclassified fields are personal and removed', () => {
    const result = toModel(s, v, none)
    expect(result.removed).toEqual(expect.arrayContaining(['email', 'lines[].note']))
    expect(result.value).not.toHaveProperty('email')
  })

  test('internal needs internalRows', () => {
    expect(toModel(s, v, none).value).not.toHaveProperty('total')
    expect(toModel(s, v, { ...none, internalRows: true }).value).toMatchObject({ total: 99 })
  })

  test('a personal field can be allowed by path', () => {
    expect(toModel(s, v, { ...none, personalFields: ['email'] }).value).toMatchObject({
      email: 'a@b.c',
    })
  })

  test('secret is removed even when allowed', () => {
    const result = toModel(s, v, { internalRows: true, personalFields: ['password'] })
    expect(result.value).not.toHaveProperty('password')
    expect(result.removed).toContain('password')
  })

  test('a class on an object applies inside it', () => {
    const pub = classify(z.object({ a: z.string() }), 'public')
    expect(toModel(pub, { a: 'x' }, none).value).toEqual({ a: 'x' })
  })

  test('nothing under secret can be reclassified', () => {
    const schema = z.object({
      creds: classify(z.object({ user: classify(z.string(), 'public') }), 'secret'),
    })
    const result = toModel(schema, { creds: { user: 'u' } }, none)
    expect(result.value).toEqual({})
    expect(result.removed).toEqual(['creds'])
  })

  test('unknown keys never pass', () => {
    const result = toModel(s, { ...v, extra: 'x' }, none)
    expect(result.value).not.toHaveProperty('extra')
    expect(result.removed).toContain('extra')
  })

  test('classes lists what was kept', () => {
    const result = toModel(s, v, none)
    expect(result.classes).toEqual(['public'])
    expect(result.value).toEqual({ name: 'Lamp', lines: [{ sku: 'L1' }] })
  })

  test('kinds it does not walk are one leaf with the nearest class', () => {
    const schema = z.object({ tag: z.union([z.string(), z.number()]) })
    expect(toModel(schema, { tag: 'x' }, none).removed).toEqual(['tag'])
    const pub = z.object({ tag: classify(z.union([z.string(), z.number()]), 'public') })
    expect(toModel(pub, { tag: 'x' }, none).value).toEqual({ tag: 'x' })
  })
})

import { describe, expect, test } from 'vitest'
import { attributeValueSchema, defineAttribute, type AttributeType } from './attributes.js'

const def = (type: AttributeType, options?: string[]) =>
  defineAttribute({ resource: 'note', code: 'x', label: 'X', type, ...(options && { options }) })

describe('attribute value schemas', () => {
  test.each<[AttributeType, string[] | undefined, unknown[], unknown[]]>([
    ['text', undefined, ['', 'x'], [1, 'a'.repeat(10_001)]],
    ['number', undefined, [0, -1.5], [Infinity, Number.NaN, '1']],
    ['boolean', undefined, [true, false], ['true', 0]],
    ['date', undefined, ['2026-11-16'], ['2026-13-01', '16/11/2026', '2026-11-16T10:00:00Z']],
    ['select', ['red', 'blue'], ['red'], ['green', ['red']]],
    ['multiselect', ['red', 'blue'], [['red', 'blue'], []], [['red', 'red'], ['green'], 'red']],
  ])('%s accepts and rejects the right values', (type, options, good, bad) => {
    const schema = attributeValueSchema(def(type, options))
    for (const value of good) expect(schema.safeParse(value).success, String(value)).toBe(true)
    for (const value of bad) expect(schema.safeParse(value).success, String(value)).toBe(false)
  })
})

describe('defineAttribute', () => {
  test('defaults: not required, personal, from a module', () => {
    expect(def('text')).toMatchObject({ required: false, privacy: 'personal', source: 'module' })
  })

  test('a secret attribute, a bad code and a select without options are refused', () => {
    expect(() =>
      defineAttribute({
        resource: 'note',
        code: 'x',
        label: 'X',
        type: 'text',
        privacy: 'secret' as never,
      }),
    ).toThrow()
    expect(() =>
      defineAttribute({ resource: 'note', code: 'Bad', label: 'X', type: 'text' }),
    ).toThrow()
    expect(() => def('select')).toThrow()
    expect(() => def('select', ['a', 'a'])).toThrow()
  })
})

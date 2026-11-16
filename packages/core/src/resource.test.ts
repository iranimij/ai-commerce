import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { classify } from './privacy.js'
import { defineResource, isStructured, resourceActions } from './resource.js'

const fields = z.strictObject({
  title: classify(z.string(), 'public'),
  body: z.string().optional(),
})
const base = { name: 'note', module: 'sample', label: { singular: 'Note', plural: 'Notes' } }

describe('defineResource', () => {
  test('generates seven actions with the right risks and permissions', () => {
    const actions = resourceActions(defineResource({ ...base, fields }))
    expect(Object.fromEntries(actions.map((a) => [a.name, [a.risk, a.permission]]))).toEqual({
      'note.list': ['read', 'note.read'],
      'note.get': ['read', 'note.read'],
      'note.create': ['write', 'note.write'],
      'note.update': ['write', 'note.write'],
      'note.delete': ['destructive', 'note.delete'],
      'note.history': ['read', 'note.read'],
      'note.restore': ['write', 'note.write'],
    })
  })

  test('the table defaults to module and name', () => {
    expect(defineResource({ ...base, name: 'sticky-note', fields }).table).toBe(
      'sample_sticky_note',
    )
  })

  test('a secret field is rejected', () => {
    expect(() =>
      defineResource({
        ...base,
        fields: z.strictObject({ token: classify(z.string(), 'secret') }),
      }),
    ).toThrow('Resource "note" field "token" is secret; store secrets as settings')
  })

  test('a system field name is rejected', () => {
    expect(() => defineResource({ ...base, fields: z.strictObject({ id: z.string() }) })).toThrow(
      'Resource "note" field "id" is reserved',
    )
  })

  test('fields must be strict', () => {
    expect(() => defineResource({ ...base, fields: z.object({ title: z.string() }) })).toThrow(
      'Resource "note" fields must be a z.strictObject',
    )
  })

  test('read: null makes reads public', () => {
    const actions = resourceActions(
      defineResource({ ...base, fields, permissions: { read: null } }),
    )
    const pub = actions.filter((a) => a.permission === null).map((a) => a.name)
    expect(pub.sort()).toEqual(['note.get', 'note.history', 'note.list'])
  })
})

test('structured fields are not filters', () => {
  const shaped = z.strictObject({
    title: z.string(),
    tags: z.array(z.string()).default([]),
    size: z.strictObject({ w: z.number(), h: z.number() }).optional(),
    names: z.record(z.string(), z.string()).optional(),
  })
  expect(
    Object.entries(shaped.shape)
      .filter(([, s]) => isStructured(s))
      .map(([k]) => k),
  ).toEqual(['tags', 'size', 'names'])
  const list = resourceActions(defineResource({ ...base, fields: shaped })).find(
    (a) => a.name === 'note.list',
  )
  const filter = list?.input.shape.filter as z.ZodOptional<z.ZodObject>
  expect(Object.keys(filter.unwrap().shape)).toEqual(['title'])
})

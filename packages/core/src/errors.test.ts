import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from './action.js'
import { systemActor } from './actor.js'
import type { AuditEntry } from './audit.js'
import { ActionError } from './errors.js'
import { createRegistry } from './registry.js'

function setup(error: ActionError) {
  const entries: AuditEntry[] = []
  const onError = vi.fn()
  let rolledBack = false
  const registry = createRegistry({
    onError,
    audit: {
      write: (entry) => {
        entries.push(entry)
        return Promise.resolve()
      },
    },
    transaction: async (fn) => {
      try {
        return await fn()
      } catch (e) {
        rolledBack = true
        throw e
      }
    },
  })
  registry.register(
    defineAction({
      name: 'test.fail',
      description: 'Fails on purpose',
      input: z.object({}),
      output: z.object({}),
      permission: null,
      risk: 'write',
      handler: () => Promise.reject<Record<string, never>>(error),
    }),
  )
  return { registry, entries, onError, rolledBack: () => rolledBack }
}

describe('ActionError', () => {
  test('a handler can fail with conflict', async () => {
    const { registry, entries, onError, rolledBack } = setup(
      new ActionError('conflict', 'Changed meanwhile'),
    )
    const result = await registry.call('test.fail', {}, { actor: systemActor })
    expect(result).toEqual({ ok: false, error: { code: 'conflict', message: 'Changed meanwhile' } })
    expect(onError).not.toHaveBeenCalled()
    expect(entries[0]?.outcome).toBe('conflict')
    expect(rolledBack()).toBe(true)
  })

  test('ActionError issues reach the caller', async () => {
    const issue = {
      code: 'custom' as const,
      path: ['attributes', 'color'],
      message: 'Bad colour',
      input: 'x',
    }
    const { registry } = setup(new ActionError('invalid_input', 'Invalid input', [issue]))
    const result = await registry.call('test.fail', {}, { actor: systemActor })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.issues?.[0]?.path).toEqual(['attributes', 'color'])
  })
})

import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from './action.js'
import { guestActor, type Actor } from './actor.js'
import { redactInput, type AuditEntry, type AuditSink } from './audit.js'
import { createRegistry } from './registry.js'

function memorySink(): AuditSink & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = []
  return {
    entries,
    write: (entry) => {
      entries.push(entry)
      return Promise.resolve()
    },
  }
}

const login = defineAction({
  name: 'auth.login',
  description: 'Log in',
  input: z.object({ email: z.string(), password: z.string() }),
  output: z.object({ ok: z.boolean() }),
  permission: 'auth.login',
  risk: 'write',
  redact: ['password'],
  handler: () => Promise.resolve({ ok: true }),
})

const user: Actor = { type: 'admin', id: 'a1', permissions: new Set(['auth.login']) }

describe('redactInput', () => {
  test('replaces the named keys and keeps the rest', () => {
    expect(redactInput({ email: 'a@b.c', password: 'secret' }, ['password'])).toEqual({
      email: 'a@b.c',
      password: '[redacted]',
    })
  })

  test('does not change the original object', () => {
    const input = { password: 'secret' }
    redactInput(input, ['password'])
    expect(input.password).toBe('secret')
  })

  test('redacts at any depth, and always redacts well-known secret names', () => {
    expect(
      redactInput(
        { user: { password: 'p', name: 'a' }, apiKey: 'k', items: [{ access_token: 't' }] },
        [],
      ),
    ).toEqual({
      user: { password: '[redacted]', name: 'a' },
      apiKey: '[redacted]',
      items: [{ access_token: '[redacted]' }],
    })
  })

  test('input that is not an object is never stored as is', () => {
    expect(redactInput('secret', ['password'])).toBe('[non-object input]')
    expect(redactInput(['secret'], [])).toBe('[non-object input]')
  })
})

describe('registry audit hook', () => {
  test('every outcome is written once, with the actor and duration', async () => {
    const sink = memorySink()
    const registry = createRegistry({ audit: sink })
    registry.register(login)

    await registry.call('auth.login', { email: 'a', password: 'p' }, { actor: user })
    await registry.call('auth.login', { email: 'a', password: 'p' }, { actor: guestActor })
    await registry.call('auth.login', { email: 'a' }, { actor: user })
    await registry.call('nope.nope', { password: 'p' }, { actor: user })

    expect(sink.entries.map((e) => e.outcome)).toEqual([
      'ok',
      'forbidden',
      'invalid_input',
      'not_found',
    ])
    expect(sink.entries[0]).toMatchObject({
      actorType: 'admin',
      actorId: 'a1',
      onBehalfOf: null,
      action: 'auth.login',
    })
    expect(sink.entries[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('secrets are redacted, also when the input is invalid', async () => {
    const sink = memorySink()
    const registry = createRegistry({ audit: sink })
    registry.register(login)
    await registry.call('auth.login', { email: 'a', password: 'p' }, { actor: user })
    await registry.call('auth.login', { password: 'p', extra: 1 }, { actor: user })
    expect(sink.entries[0]?.input).toEqual({ email: 'a', password: '[redacted]' })
    expect(sink.entries[1]?.input).toEqual({ '[invalid input]': ['password', 'extra'] })
  })

  test('the input of an unknown action is not stored', async () => {
    const sink = memorySink()
    const registry = createRegistry({ audit: sink })
    await registry.call('nope.nope', { password: 'p' }, { actor: user })
    expect(sink.entries[0]?.input).toEqual({})
  })

  test('the AI acting for an admin is recorded', async () => {
    const sink = memorySink()
    const registry = createRegistry({ audit: sink })
    registry.register(login)
    const ai: Actor = { ...user, onBehalfOf: 'a1' }
    await registry.call('auth.login', { email: 'a', password: 'p' }, { actor: ai })
    expect(sink.entries[0]?.onBehalfOf).toBe('a1')
  })

  test('a failing audit sink does not change the result and is reported', async () => {
    const onAuditError = vi.fn()
    const registry = createRegistry({
      audit: { write: () => Promise.reject(new Error('disk full')) },
      onAuditError,
    })
    registry.register(login)
    const result = await registry.call('auth.login', { email: 'a', password: 'p' }, { actor: user })
    expect(result.ok).toBe(true)
    expect(onAuditError).toHaveBeenCalledOnce()
  })
})

describe('registry transaction hook', () => {
  test('the handler runs inside the transaction', async () => {
    let inside = false
    const registry = createRegistry({
      transaction: async (fn) => {
        inside = true
        try {
          return await fn()
        } finally {
          inside = false
        }
      },
    })
    let seen = false
    registry.register(
      defineAction({
        name: 'tx.check',
        description: 'Records whether it ran in a transaction',
        input: z.object({}),
        output: z.object({}),
        permission: null,
        risk: 'write',
        handler: () => {
          seen = inside
          return Promise.resolve({})
        },
      }),
    )
    await registry.call('tx.check', {}, { actor: guestActor })
    expect(seen).toBe(true)
  })

  test('read actions skip the transaction', async () => {
    let used = 0
    const registry = createRegistry({
      transaction: (fn) => {
        used++
        return fn()
      },
    })
    registry.register(
      defineAction({
        name: 'tx.read',
        description: 'A read',
        input: z.object({}),
        output: z.object({}),
        permission: null,
        risk: 'read',
        handler: () => Promise.resolve({}),
      }),
    )
    await registry.call('tx.read', {}, { actor: guestActor })
    expect(used).toBe(0)
  })
})

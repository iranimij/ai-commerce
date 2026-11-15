// Tests for the findings of the M0a whole-branch review.
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import type { ActionDefinition } from './action.js'
import { systemActor } from './actor.js'
import { createApp } from './app.js'
import type { AuditEntry, AuditSink } from './audit.js'
import { createEventBus, defineEvent } from './events.js'
import { defineModule } from './module.js'
import { createRegistry } from './registry.js'

const quiet = { onError: () => undefined }
const actor = { actor: systemActor }

function action(overrides: Partial<ActionDefinition> = {}): ActionDefinition {
  return {
    name: 'test.run',
    description: 'Test action',
    input: z.object({}),
    output: z.object({}),
    permission: null,
    risk: 'write',
    handler: () => Promise.resolve({}),
    ...overrides,
  }
}

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

describe('nested input is strict', () => {
  test('register rejects a nested object that would drop unknown keys', () => {
    const r = createRegistry(quiet)
    expect(() => {
      r.register(action({ input: z.object({ address: z.object({ city: z.string() }) }) }))
    }).toThrow('Action "test.run" input: the object at "address" must be a z.strictObject')
  })

  test('also inside arrays and optional fields', () => {
    const r = createRegistry(quiet)
    expect(() => {
      r.register(action({ input: z.object({ items: z.array(z.object({ sku: z.string() })) }) }))
    }).toThrow('the object at "items[]"')
    expect(() => {
      r.register(action({ input: z.object({ meta: z.object({}).optional() }) }))
    }).toThrow('the object at "meta"')
  })

  test('an unknown nested key is rejected as invalid input', async () => {
    const r = createRegistry(quiet)
    r.register(action({ input: z.object({ address: z.strictObject({ city: z.string() }) }) }))
    const result = await r.call('test.run', { address: { city: 'Berlin', isAdmin: true } }, actor)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
})

describe('output is checked inside the transaction', () => {
  test('a handler returning bad output does not commit', async () => {
    let committed = false
    const r = createRegistry({
      ...quiet,
      transaction: async (fn) => {
        const value = await fn()
        committed = true
        return value
      },
    })
    r.register(
      action({ output: z.object({ id: z.string() }), handler: () => Promise.resolve({ id: 1 }) }),
    )
    const result = await r.call('test.run', {}, actor)
    expect(result).toMatchObject({ ok: false, error: { code: 'handler_error' } })
    expect(committed).toBe(false)
  })
})

describe('handler errors are reported', () => {
  test('onError receives the error and the action name', async () => {
    const onError = vi.fn()
    const r = createRegistry({ onError })
    const boom = new Error('boom')
    r.register(action({ handler: () => Promise.reject(boom) }))
    await r.call('test.run', {}, actor)
    expect(onError).toHaveBeenCalledWith(boom, { action: 'test.run', actorType: 'system' })
  })
})

describe('async refinements', () => {
  test('are awaited, and the call still returns a result and is audited', async () => {
    const audit = memorySink()
    const r = createRegistry({ ...quiet, audit })
    r.register(
      action({ input: z.object({ email: z.string().refine((v) => Promise.resolve(v !== 'x')) }) }),
    )
    await expect(r.call('test.run', { email: 'x' }, actor)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })
    await expect(r.call('test.run', { email: 'y' }, actor)).resolves.toMatchObject({ ok: true })
    expect(audit.entries).toHaveLength(2)
  })
})

describe('events emitted by a handler', () => {
  const placed = defineEvent('test.placed', z.object({ id: z.string() }))

  function setup(make: (order: string[]) => ActionDefinition['handler']) {
    const order: string[] = []
    const events = createEventBus()
    events.subscribe({
      event: placed,
      module: 'listener',
      handler: () => {
        order.push('subscriber')
        return Promise.resolve()
      },
    })
    const r = createRegistry({ ...quiet, events })
    r.register(action({ handler: make(order) }))
    return { r, order }
  }

  test('are delivered after the call has finished', async () => {
    const { r, order } = setup((order) => async (_input, ctx) => {
      await ctx.events.emit(placed, { id: '1' })
      order.push('handler done')
      return {}
    })
    await r.call('test.run', {}, actor)
    expect(order).toEqual(['handler done', 'subscriber'])
  })

  test('are dropped when the call fails', async () => {
    const { r, order } = setup(() => async (_input, ctx) => {
      await ctx.events.emit(placed, { id: '1' })
      throw new Error('after emitting')
    })
    await r.call('test.run', {}, actor)
    expect(order).toEqual([])
  })

  test('a bad payload still fails at emit time', async () => {
    const { r } = setup(() => async (_input, ctx) => {
      await ctx.events.emit(placed, { id: 1 } as never)
      return {}
    })
    expect(await r.call('test.run', {}, actor)).toMatchObject({ ok: false })
  })
})

describe('what the audit log stores', () => {
  test('invalid input is stored as its key names only, never its values', async () => {
    const audit = memorySink()
    const r = createRegistry({ ...quiet, audit })
    r.register(action({ input: z.object({ email: z.string() }) }))
    await r.call('test.run', { email: 'a', pasword: 'hunter2' }, actor)
    expect(audit.entries[0]?.input).toEqual({ '[invalid input]': ['email', 'pasword'] })
  })

  test('large input is not stored', async () => {
    const audit = memorySink()
    const r = createRegistry({ ...quiet, audit })
    r.register(action({ input: z.object({ text: z.string() }) }))
    await r.call('test.run', { text: 'x'.repeat(20_000) }, actor)
    expect(audit.entries[0]?.input).toBe('[input too large]')
  })
})

describe('createApp', () => {
  test('passes audit, transaction and error hooks to its registry', async () => {
    const audit = memorySink()
    let transactions = 0
    const app = createApp({
      modules: [defineModule({ name: 'test', actions: [action()] })],
      enabled: ['test'],
      audit,
      transaction: (fn) => {
        transactions++
        return fn()
      },
      onError: () => undefined,
    })
    await app.registry.call('test.run', {}, actor)
    expect(audit.entries).toHaveLength(1)
    expect(transactions).toBe(1)
  })
})

describe('shared state cannot be changed', () => {
  test('shared actors cannot gain permissions', async () => {
    const { can, guestActor } = await import('./actor.js')
    expect(() => (guestActor.permissions as Set<string>).add('*')).toThrow(TypeError)
    expect(can(guestActor, 'x')).toBe(false)
  })

  test('a wrap cannot change ctx', async () => {
    const r = createRegistry(quiet)
    r.register(action())
    r.addWrap({
      action: 'test.run',
      module: 'w',
      order: 1,
      wrap: (input, ctx, next) => {
        ;(ctx as { actor: unknown }).actor = systemActor
        return next(input)
      },
    })
    expect(await r.call('test.run', {}, actor)).toMatchObject({
      ok: false,
      error: { code: 'handler_error' },
    })
  })

  test('a wrap calling next twice fails the call', async () => {
    let runs = 0
    const r = createRegistry(quiet)
    r.register(
      action({
        handler: () => {
          runs++
          return Promise.resolve({})
        },
      }),
    )
    r.addWrap({
      action: 'test.run',
      module: 'w',
      order: 1,
      wrap: async (input, _ctx, next) => {
        await next(input)
        return next(input)
      },
    })
    expect(await r.call('test.run', {}, actor)).toMatchObject({
      ok: false,
      error: { code: 'handler_error' },
    })
    expect(runs).toBe(1)
  })
})

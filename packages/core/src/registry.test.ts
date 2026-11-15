import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from './action.js'
import { guestActor, systemActor, type Actor } from './actor.js'
import { createRegistry } from './registry.js'

const admin = (permissions: string[]): Actor => ({
  type: 'admin',
  id: 'admin-1',
  permissions: new Set(permissions),
})

function setup() {
  const refundHandler = vi.fn((input: { orderId: string; reason: string }) =>
    Promise.resolve({ refunded: input.orderId }),
  )
  const refund = defineAction({
    name: 'order.refund',
    description: 'Refund a paid order',
    input: z.object({ orderId: z.string(), reason: z.string() }),
    output: z.object({ refunded: z.string() }),
    permission: 'sales.order.refund',
    risk: 'destructive',
    handler: refundHandler,
  })
  const ping = defineAction({
    name: 'catalog.ping',
    description: 'Check that the catalog answers',
    input: z.object({}),
    output: z.object({ pong: z.literal(true) }),
    permission: null,
    risk: 'read',
    handler: () => Promise.resolve({ pong: true as const }),
  })
  const registry = createRegistry()
  registry.register(refund)
  registry.register(ping)
  return { registry, refundHandler }
}

const validRefund = { orderId: '1042', reason: 'damaged' }

describe('registry.call', () => {
  test('public read action succeeds for a guest', async () => {
    const { registry } = setup()
    const result = await registry.call('catalog.ping', {}, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { pong: true } })
  })

  test('unknown action returns not_found', async () => {
    const { registry } = setup()
    const result = await registry.call('order.explode', {}, { actor: systemActor })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not_found')
  })

  test('missing field returns invalid_input with issues', async () => {
    const { registry, refundHandler } = setup()
    const result = await registry.call(
      'order.refund',
      { orderId: '1042' },
      { actor: admin(['*']), confirmed: true },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_input')
      expect(result.error.issues?.[0]?.path).toEqual(['reason'])
    }
    expect(refundHandler).not.toHaveBeenCalled()
  })

  test('unknown extra key returns invalid_input', async () => {
    const { registry, refundHandler } = setup()
    const result = await registry.call(
      'order.refund',
      { ...validRefund, hack: 1 },
      { actor: admin(['*']), confirmed: true },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_input')
    expect(refundHandler).not.toHaveBeenCalled()
  })

  test('actor without permission gets forbidden', async () => {
    const { registry, refundHandler } = setup()
    const result = await registry.call('order.refund', validRefund, {
      actor: admin(['catalog.product.read']),
      confirmed: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    expect(refundHandler).not.toHaveBeenCalled()
  })

  test('a guest cannot call a protected action', async () => {
    const { registry } = setup()
    const result = await registry.call('order.refund', validRefund, {
      actor: guestActor,
      confirmed: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
  })

  test('wildcard permission is allowed', async () => {
    const { registry } = setup()
    const result = await registry.call('order.refund', validRefund, {
      actor: admin(['*']),
      confirmed: true,
    })
    expect(result).toEqual({ ok: true, output: { refunded: '1042' } })
  })

  test('destructive action needs confirmation for an admin', async () => {
    const { registry, refundHandler } = setup()
    const result = await registry.call('order.refund', validRefund, { actor: admin(['*']) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('confirmation_required')
    expect(refundHandler).not.toHaveBeenCalled()
  })

  test('destructive action runs when confirmed', async () => {
    const { registry, refundHandler } = setup()
    await registry.call('order.refund', validRefund, { actor: admin(['*']), confirmed: true })
    expect(refundHandler).toHaveBeenCalledOnce()
  })

  test('the system actor needs no confirmation', async () => {
    const { registry, refundHandler } = setup()
    const result = await registry.call('order.refund', validRefund, { actor: systemActor })
    expect(result.ok).toBe(true)
    expect(refundHandler).toHaveBeenCalledOnce()
  })

  test('handler error is reported without leaking its message', async () => {
    const registry = createRegistry()
    registry.register(
      defineAction({
        name: 'order.fail',
        description: 'Always fails',
        input: z.object({}),
        output: z.object({}),
        permission: null,
        risk: 'read',
        handler: () => Promise.reject<Record<string, never>>(new Error('db password is x')),
      }),
    )
    const result = await registry.call('order.fail', {}, { actor: guestActor })
    expect(result).toEqual({
      ok: false,
      error: { code: 'handler_error', message: 'Action failed' },
    })
  })

  test('output that violates the schema is a handler_error', async () => {
    const registry = createRegistry()
    registry.register(
      defineAction({
        name: 'order.count',
        description: 'Count orders',
        input: z.object({}),
        output: z.object({ count: z.number() }),
        permission: null,
        risk: 'read',
        // Deliberately wrong at runtime, as a buggy module might be.
        handler: () => Promise.resolve({ count: 'many' } as unknown as { count: number }),
      }),
    )
    const result = await registry.call('order.count', {}, { actor: guestActor })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('handler_error')
  })
})

describe('registry.register', () => {
  test('registering the same name twice throws', () => {
    const { registry } = setup()
    expect(() => {
      registry.register(
        defineAction({
          name: 'catalog.ping',
          description: 'Duplicate',
          input: z.object({}),
          output: z.object({}),
          permission: null,
          risk: 'read',
          handler: () => Promise.resolve({}),
        }),
      )
    }).toThrow('Action "catalog.ping" is already registered')
  })

  test('a name that is not module.verb throws', () => {
    const registry = createRegistry()
    for (const name of ['Refund', 'order', 'order.', 'Order.refund']) {
      expect(() => {
        registry.register(
          defineAction({
            name,
            description: 'Bad name',
            input: z.object({}),
            output: z.object({}),
            permission: null,
            risk: 'read',
            handler: () => Promise.resolve({}),
          }),
        )
      }).toThrow(`Invalid action name "${name}"`)
    }
  })

  test('get and list return registered actions', () => {
    const { registry } = setup()
    expect(registry.get('catalog.ping')?.risk).toBe('read')
    expect(registry.list().map((a) => a.name)).toEqual(['order.refund', 'catalog.ping'])
  })
})

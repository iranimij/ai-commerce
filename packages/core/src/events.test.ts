import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { createEventBus, defineEvent } from './events.js'

const orderPlaced = defineEvent('order.placed', z.object({ orderId: z.string() }))

describe('event bus', () => {
  test('subscribers receive the payload in subscription order', async () => {
    const bus = createEventBus()
    const calls: string[] = []
    bus.subscribe({
      event: orderPlaced,
      module: 'email',
      handler: (p) => {
        calls.push(`email:${p.orderId}`)
        return Promise.resolve()
      },
    })
    bus.subscribe({
      event: orderPlaced,
      module: 'stock',
      handler: (p) => {
        calls.push(`stock:${p.orderId}`)
        return Promise.resolve()
      },
    })
    await bus.emit(orderPlaced, { orderId: '1042' })
    expect(calls).toEqual(['email:1042', 'stock:1042'])
  })

  test('a throwing subscriber does not stop the others and is reported to onError', async () => {
    const onError = vi.fn()
    const bus = createEventBus({ onError })
    const after = vi.fn(() => Promise.resolve())
    bus.subscribe({
      event: orderPlaced,
      module: 'broken',
      handler: () => Promise.reject(new Error('boom')),
    })
    bus.subscribe({ event: orderPlaced, module: 'stock', handler: after })
    await bus.emit(orderPlaced, { orderId: '1042' })
    expect(after).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      event: 'order.placed',
      module: 'broken',
    })
  })

  test('emit rejects a payload that violates the schema', async () => {
    const bus = createEventBus()
    const handler = vi.fn(() => Promise.resolve())
    bus.subscribe({ event: orderPlaced, module: 'email', handler })
    await expect(
      bus.emit(orderPlaced, { orderId: 42 } as unknown as { orderId: string }),
    ).rejects.toThrow('Invalid payload for event "order.placed"')
    expect(handler).not.toHaveBeenCalled()
  })

  test('emitting an event with no subscribers does nothing', async () => {
    const bus = createEventBus()
    await expect(bus.emit(orderPlaced, { orderId: '1' })).resolves.toBeUndefined()
  })

  test('subscribers() lists modules for inspect', () => {
    const bus = createEventBus()
    bus.subscribe({ event: orderPlaced, module: 'email', handler: () => Promise.resolve() })
    expect(bus.subscribers('order.placed')).toEqual([{ module: 'email' }])
    expect(bus.subscribers('order.cancelled')).toEqual([])
  })
})

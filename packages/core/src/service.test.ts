import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from './action.js'
import { systemActor } from './actor.js'
import { createApp } from './app.js'
import { defineModule } from './module.js'
import { defineService, provide } from './service.js'

interface Clock {
  now(): string
}
const clock = defineService<Clock>('test.clock')

const user = defineModule({
  name: 'user',
  actions: [
    defineAction({
      name: 'user.time',
      description: 'Tells the time',
      input: z.object({}),
      output: z.object({ now: z.string() }),
      permission: null,
      risk: 'read',
      handler: (_input, ctx) => Promise.resolve({ now: ctx.service(clock).now() }),
    }),
  ],
})

const fixed = (module: string, now: string) => provide(clock, module, { now: () => now })

describe('services', () => {
  test('a module replaces a default service', async () => {
    const fake = defineModule({ name: 'fake-clock', provides: [fixed('fake-clock', 'fake')] })
    const app = createApp({
      modules: [user, fake],
      enabled: ['user', 'fake-clock'],
      services: [fixed('app', 'real')],
    })
    const result = await app.registry.call('user.time', {}, { actor: systemActor })
    expect(result).toEqual({ ok: true, output: { now: 'fake' } })
    expect(app.inspect('service', 'test.clock')).toEqual({
      provider: 'fake-clock',
      replaced: ['app'],
    })
  })

  test('an unprovided service throws a named error', async () => {
    const onError = vi.fn()
    const app = createApp({ modules: [user], enabled: ['user'], onError })
    const result = await app.registry.call('user.time', {}, { actor: systemActor })
    expect(result).toMatchObject({ ok: false, error: { code: 'handler_error' } })
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe(
      'Service "test.clock" is not provided',
    )
  })

  test('two unrelated modules providing one service fail at startup', () => {
    const a = defineModule({ name: 'a', provides: [fixed('a', 'a')] })
    const b = defineModule({ name: 'b', provides: [fixed('b', 'b')] })
    expect(() => createApp({ modules: [a, b], enabled: ['a', 'b'] })).toThrow(
      'Modules "a" and "b" both provide service "test.clock"; one must depend on the other',
    )
  })

  test('the dependent module wins', async () => {
    const a = defineModule({ name: 'a', provides: [fixed('a', 'a')] })
    const b = defineModule({ name: 'b', depends: ['a'], provides: [fixed('b', 'b')] })
    const app = createApp({ modules: [user, b, a], enabled: ['user', 'b', 'a'] })
    const result = await app.registry.call('user.time', {}, { actor: systemActor })
    expect(result).toEqual({ ok: true, output: { now: 'b' } })
  })

  test('a module may only provide services under its own name', () => {
    const a = defineModule({ name: 'a', provides: [fixed('b', 'x')] })
    expect(() => createApp({ modules: [a], enabled: ['a'] })).toThrow(
      'Module "a" declares a service provision that belongs to module "b"',
    )
  })
})

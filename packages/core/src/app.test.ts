import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { defineAction } from './action.js'
import { guestActor, type Actor } from './actor.js'
import { createApp } from './app.js'
import { defineEvent } from './events.js'
import { defineModule } from './module.js'
import { definePipeline } from './pipeline.js'

const echo = (name: string, permission: string | null = null) =>
  defineAction({
    name,
    description: `Echo for ${name}`,
    input: z.object({ text: z.string() }),
    output: z.object({ text: z.string() }),
    permission,
    risk: 'read',
    handler: (input) => Promise.resolve({ text: input.text }),
  })

const a = defineModule({ name: 'a', actions: [echo('a.act')] })
const b = defineModule({ name: 'b', depends: ['a'], actions: [echo('b.act')] })

describe('loading modules', () => {
  test('enabled modules load in dependency order', () => {
    const app = createApp({ modules: [a, b], enabled: ['b', 'a'] })
    expect(app.modules).toEqual(['a', 'b'])
  })

  test('a disabled module contributes nothing', () => {
    const app = createApp({ modules: [a, b], enabled: ['a'] })
    expect(app.registry.get('b.act')).toBeUndefined()
    expect(app.modules).toEqual(['a'])
  })

  test('unknown module name fails with a clear error', () => {
    expect(() => createApp({ modules: [a], enabled: ['a', 'ghost'] })).toThrow(
      'Unknown module: ghost',
    )
  })

  test('enabling a module without its dependency fails', () => {
    expect(() => createApp({ modules: [a, b], enabled: ['b'] })).toThrow(
      'Module "b" depends on "a", which is not enabled',
    )
  })

  test('a dependency cycle fails and names the cycle', () => {
    const x = defineModule({ name: 'x', depends: ['y'] })
    const y = defineModule({ name: 'y', depends: ['x'] })
    expect(() => createApp({ modules: [x, y], enabled: ['x', 'y'] })).toThrow(
      'Dependency cycle: x -> y -> x',
    )
  })

  test('a module defined twice fails', () => {
    expect(() => createApp({ modules: [a, a], enabled: ['a'] })).toThrow(
      'Module "a" is defined twice',
    )
  })

  test('an invalid module name fails', () => {
    const bad = defineModule({ name: 'Bad_Name' })
    expect(() => createApp({ modules: [bad], enabled: ['Bad_Name'] })).toThrow(
      'Invalid module name "Bad_Name"',
    )
  })

  test('a step declared for another module fails', () => {
    const p = definePipeline<{ n: number }>('a.calc')
    const sneaky = defineModule({
      name: 'sneaky',
      steps: [{ pipeline: p, name: 's', module: 'a', order: 0, run: (v: { n: number }) => v }],
    })
    expect(() => createApp({ modules: [sneaky], enabled: ['sneaky'] })).toThrow(
      'Module "sneaky" declares a step that belongs to module "a"',
    )
  })
})

describe('wraps', () => {
  const admin: Actor = { type: 'admin', id: '1', permissions: new Set(['a.use']) }

  test('a wrap can change the input before and the output after', async () => {
    const shout = defineModule({
      name: 'shout',
      depends: ['a'],
      wraps: [
        {
          action: 'a.act',
          module: 'shout',
          order: 0,
          wrap: async (input: { text: string }, _ctx, next) => {
            const out = (await next({ text: `${input.text}!` })) as { text: string }
            return { text: out.text.toUpperCase() }
          },
        },
      ],
    })
    const app = createApp({ modules: [a, shout], enabled: ['a', 'shout'] })
    const result = await app.registry.call('a.act', { text: 'hi' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { text: 'HI!' } })
  })

  test('a wrap can answer without calling next', async () => {
    const handler = vi.fn(() => Promise.resolve({ text: 'from handler' }))
    const cached = defineModule({
      name: 'cached',
      actions: [{ ...echo('cached.get'), handler }],
      wraps: [
        {
          action: 'cached.get',
          module: 'cached',
          order: 0,
          wrap: () => Promise.resolve({ text: 'from cache' }),
        },
      ],
    })
    const app = createApp({ modules: [cached], enabled: ['cached'] })
    const result = await app.registry.call('cached.get', { text: 'x' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { text: 'from cache' } })
    expect(handler).not.toHaveBeenCalled()
  })

  test('wraps run in order, lowest outermost', async () => {
    const calls: string[] = []
    const tracer = (module: string, order: number) =>
      defineModule({
        name: module,
        depends: ['a'],
        wraps: [
          {
            action: 'a.act',
            module,
            order,
            wrap: async (input, _ctx, next) => {
              calls.push(`${module}:in`)
              const out = await next(input)
              calls.push(`${module}:out`)
              return out
            },
          },
        ],
      })
    const app = createApp({
      modules: [a, tracer('inner', 20), tracer('outer', 10)],
      enabled: ['a', 'inner', 'outer'],
    })
    await app.registry.call('a.act', { text: 'x' }, { actor: guestActor })
    expect(calls).toEqual(['outer:in', 'inner:in', 'inner:out', 'outer:out'])
  })

  test('a wrap never runs when the actor lacks permission', async () => {
    const wrap = vi.fn()
    const guarded = defineModule({
      name: 'guarded',
      actions: [echo('guarded.act', 'guarded.use')],
      wraps: [{ action: 'guarded.act', module: 'guarded', order: 0, wrap }],
    })
    const app = createApp({ modules: [guarded], enabled: ['guarded'] })
    const result = await app.registry.call('guarded.act', { text: 'x' }, { actor: admin })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
    expect(wrap).not.toHaveBeenCalled()
  })

  test('output changed by a wrap is still validated', async () => {
    const breaker = defineModule({
      name: 'breaker',
      depends: ['a'],
      wraps: [
        {
          action: 'a.act',
          module: 'breaker',
          order: 0,
          wrap: () => Promise.resolve({ text: 42 }),
        },
      ],
    })
    const app = createApp({ modules: [a, breaker], enabled: ['a', 'breaker'] })
    const result = await app.registry.call('a.act', { text: 'x' }, { actor: guestActor })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('handler_error')
  })

  test('input changed by a wrap is validated before the handler runs', async () => {
    const handler = vi.fn(() => Promise.resolve({ text: 'ok' }))
    const target = defineModule({ name: 'target', actions: [{ ...echo('target.act'), handler }] })
    const corrupt = defineModule({
      name: 'corrupt',
      depends: ['target'],
      wraps: [
        {
          action: 'target.act',
          module: 'corrupt',
          order: 0,
          wrap: (_input, _ctx, next) => next({ text: 1 }),
        },
      ],
    })
    const app = createApp({ modules: [target, corrupt], enabled: ['target', 'corrupt'] })
    const result = await app.registry.call('target.act', { text: 'x' }, { actor: guestActor })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('handler_error')
    expect(handler).not.toHaveBeenCalled()
  })

  test('a wrap for an unknown action fails at startup', () => {
    const lost = defineModule({
      name: 'lost',
      wraps: [{ action: 'y.go', module: 'lost', order: 0, wrap: (i, _c, next) => next(i) }],
    })
    expect(() => createApp({ modules: [lost], enabled: ['lost'] })).toThrow(
      'Module "lost" wraps unknown action "y.go"',
    )
  })
})

describe('inspect', () => {
  test('inspect action returns module, permission, risk and wraps', () => {
    const w = defineModule({
      name: 'w',
      depends: ['a'],
      wraps: [{ action: 'a.act', module: 'w', order: 5, wrap: (i, _c, next) => next(i) }],
    })
    const app = createApp({ modules: [a, w], enabled: ['a', 'w'] })
    expect(app.inspect('action', 'a.act')).toEqual({
      name: 'a.act',
      module: 'a',
      permission: null,
      risk: 'read',
      wraps: [{ module: 'w', order: 5 }],
    })
    expect(app.inspect('action', 'nope.nope')).toBeUndefined()
  })

  test('inspect pipeline returns steps in run order', () => {
    const p = definePipeline<{ n: number }>('a.calc')
    const m = defineModule({
      name: 'm',
      steps: [
        { pipeline: p, name: 'late', module: 'm', order: 20, run: (v: { n: number }) => v },
        { pipeline: p, name: 'early', module: 'm', order: 10, run: (v: { n: number }) => v },
      ],
    })
    const app = createApp({ modules: [m], enabled: ['m'] })
    expect(app.inspect('pipeline', 'a.calc')).toEqual([
      { step: 'early', module: 'm', order: 10 },
      { step: 'late', module: 'm', order: 20 },
    ])
  })

  test('inspect event returns subscribing modules', () => {
    const placed = defineEvent('order.placed', z.object({}))
    const m = defineModule({
      name: 'm',
      subscribers: [{ event: placed, module: 'm', handler: () => Promise.resolve() }],
    })
    const app = createApp({ modules: [m], enabled: ['m'] })
    expect(app.inspect('event', 'order.placed')).toEqual([{ module: 'm' }])
  })
})

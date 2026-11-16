import { createApp, defineModule, defineStep, guestActor } from '@aicommerce/core'
import { describe, expect, test } from 'vitest'
import { greeted, greeting, greetLater, sample } from './index.js'

// What a second, independent module would write to change the sample's behaviour.
const loud = defineModule({
  name: 'sample-loud',
  depends: ['sample'],
  steps: [
    defineStep({
      pipeline: greeting,
      name: 'upper-case',
      module: 'sample-loud',
      order: 100,
      run: (value) => ({ text: value.text.toUpperCase() }),
    }),
  ],
})

describe('sample module', () => {
  test('sample.greet works through the registry', async () => {
    const app = createApp({ modules: [sample], enabled: ['sample'] })
    const result = await app.registry.call('sample.greet', { name: 'Ada' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { greeting: 'Hello, Ada' } })
  })

  test('another module changes the result through the pipeline', async () => {
    const app = createApp({ modules: [sample, loud], enabled: ['sample', 'sample-loud'] })
    const result = await app.registry.call('sample.greet', { name: 'Ada' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { greeting: 'HELLO, ADA' } })
  })

  test('with sample-loud disabled the result is unchanged', async () => {
    const app = createApp({ modules: [sample, loud], enabled: ['sample'] })
    const result = await app.registry.call('sample.greet', { name: 'Ada' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { greeting: 'Hello, Ada' } })
  })
})

describe('sample module extension points', () => {
  test('a subscriber in another module hears sample.greeted after the call', async () => {
    const heard: string[] = []
    const listener = defineModule({
      name: 'sample-listener',
      depends: ['sample'],
      subscribers: [
        {
          event: greeted,
          module: 'sample-listener',
          handler: (payload: { name: string }) => {
            heard.push(payload.name)
            return Promise.resolve()
          },
        },
      ],
    })
    const app = createApp({ modules: [sample, listener], enabled: ['sample', 'sample-listener'] })
    await app.registry.call('sample.greet', { name: 'Ada' }, { actor: guestActor })
    expect(heard).toEqual(['Ada'])
  })

  test('a wrap in another module changes sample.greet without touching its code', async () => {
    const polite = defineModule({
      name: 'sample-polite',
      depends: ['sample'],
      wraps: [
        {
          action: 'sample.greet',
          module: 'sample-polite',
          order: 100,
          wrap: async (input, _ctx, next) => {
            const out = (await next(input)) as { greeting: string }
            return { greeting: `${out.greeting}, welcome` }
          },
        },
      ],
    })
    const app = createApp({ modules: [sample, polite], enabled: ['sample', 'sample-polite'] })
    const result = await app.registry.call('sample.greet', { name: 'Ada' }, { actor: guestActor })
    expect(result).toEqual({ ok: true, output: { greeting: 'Hello, Ada, welcome' } })
  })

  test('the greet-later job is listed and calls sample.greet', async () => {
    const app = createApp({ modules: [sample], enabled: ['sample'] })
    expect(app.jobs().map((j) => j.name)).toEqual(['sample.greet-later'])
    const calls: string[] = []
    await greetLater.handler(
      { name: 'Ada' },
      {
        jobId: 'j1',
        attempt: 1,
        service: (def) => app.service(def),
        call: async (name, input) => {
          calls.push(name)
          return app.registry.call(name, input, { actor: guestActor })
        },
      },
    )
    expect(calls).toEqual(['sample.greet'])
  })
})

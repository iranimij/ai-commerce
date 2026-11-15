import { createApp, defineModule, defineStep, guestActor } from '@aicommerce/core'
import { describe, expect, test } from 'vitest'
import { greeting, sample } from './index.js'

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

import { fileURLToPath } from 'node:url'
import {
  classify,
  defineAction,
  defineEvent,
  defineJob,
  defineModule,
  definePipeline,
  defineResource,
  defineSetting,
  settings,
} from '@aicommerce/core'
import type { MigrationSource } from '@aicommerce/db'
import { z } from 'zod'

export const sampleMigrations: MigrationSource = {
  module: 'sample',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

/** A resource: seven actions, revisions and history, from one definition. */
export const note = defineResource({
  name: 'note',
  module: 'sample',
  label: { singular: 'Note', plural: 'Notes' },
  fields: z.strictObject({
    title: classify(z.string().min(1).max(200), 'public'),
    body: classify(z.string().max(10_000), 'internal').optional(),
    pinned: classify(z.boolean(), 'public').default(false),
  }),
  attributes: true,
})

/**
 * An extension point other modules can add steps to. This is how one module changes another's
 * result without editing its code.
 */
export const greeting = definePipeline<{ text: string }>('sample.greeting')

/** A setting a merchant can change; `sample.greet` reads it. */
export const greetingWord = defineSetting({
  key: 'sample.greeting-word',
  module: 'sample',
  label: 'Greeting word',
  schema: z.string().min(1).max(50),
  default: 'Hello',
  privacy: 'public',
  scope: 'global',
})

/** A secret setting: stored encrypted, never shown again once set. */
export const webhookSecret = defineSetting({
  key: 'sample.webhook-secret',
  module: 'sample',
  label: 'Webhook secret',
  schema: z.string().min(16).max(200),
  privacy: 'secret',
  scope: 'global',
})

/** Emitted after a greeting; subscribers run once the call has succeeded. */
export const greeted = defineEvent('sample.greeted', z.object({ name: z.string() }))

export const greet = defineAction({
  name: 'sample.greet',
  description: 'Greet someone by name',
  input: z.object({ name: z.string().min(1).max(100) }),
  output: z.object({ greeting: z.string() }),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const word = (await ctx.service(settings).get(greetingWord)) ?? 'Hello'
    const { value } = await ctx.pipelines.run(greeting, { text: `${word}, ${input.name}` })
    await ctx.events.emit(greeted, { name: input.name })
    return { greeting: value.text }
  },
})

/** A background job; it writes through an action, so its work is audited. */
export const greetLater = defineJob({
  name: 'sample.greet-later',
  module: 'sample',
  description: 'Greet someone in the background',
  payload: z.strictObject({ name: z.string().min(1).max(100) }),
  handler: async (payload, ctx) => {
    const result = await ctx.call('sample.greet', payload)
    if (!result.ok) throw new Error(result.error.message)
  },
})

export const sample = defineModule({
  name: 'sample',
  actions: [greet],
  resources: [note],
  settings: [greetingWord, webhookSecret],
  jobs: [greetLater],
})

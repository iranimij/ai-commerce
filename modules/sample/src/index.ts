import { fileURLToPath } from 'node:url'
import {
  classify,
  defineAction,
  defineModule,
  definePipeline,
  defineResource,
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

export const greet = defineAction({
  name: 'sample.greet',
  description: 'Greet someone by name',
  input: z.object({ name: z.string().min(1).max(100) }),
  output: z.object({ greeting: z.string() }),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const { value } = await ctx.pipelines.run(greeting, { text: `Hello, ${input.name}` })
    return { greeting: value.text }
  },
})

export const sample = defineModule({
  name: 'sample',
  actions: [greet],
  resources: [note],
})

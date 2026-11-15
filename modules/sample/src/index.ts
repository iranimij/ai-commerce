import { defineAction, defineModule, definePipeline } from '@aicommerce/core'
import { z } from 'zod'

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
})

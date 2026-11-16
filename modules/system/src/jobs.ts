import { ActionError, defineAction, jobs } from '@aicommerce/core'
import { z } from 'zod'

const status = z.enum(['pending', 'running', 'done', 'failed'])

export const listJobs = defineAction({
  name: 'job.list',
  description: 'List background jobs, newest first',
  input: z.object({
    status: status.optional(),
    cursor: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        key: z.string().nullable(),
        status,
        attempts: z.number().int(),
        maxAttempts: z.number().int(),
        runAt: z.string(),
        lastError: z.string().nullable(),
        createdAt: z.string(),
        doneAt: z.string().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  permission: 'job.read',
  risk: 'read',
  handler: (input, ctx) =>
    ctx.service(jobs).list({
      ...(input.status && { status: input.status }),
      ...(input.cursor && { cursor: input.cursor }),
      limit: input.limit,
    }),
})

export const retryJob = defineAction({
  name: 'job.retry',
  description: 'Run a failed job again, starting with no attempts',
  input: z.object({ id: z.uuid() }),
  output: z.object({}),
  permission: 'job.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const result = await ctx.service(jobs).retry(input.id)
    if (result === 'not_found') throw new ActionError('not_found', 'Job not found')
    if (result === 'not_failed')
      throw new ActionError('conflict', 'Only a failed job can be retried')
    return {}
  },
})

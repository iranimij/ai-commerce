import type { z } from 'zod'
import type { ActionContext } from './action.js'
import type { Page } from './resource.js'
import type { Result } from './result.js'
import { defineService } from './service.js'
import { defOf } from './zod-def.js'

const NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

export interface JobContext {
  jobId: string
  /** 1 on the first run. */
  attempt: number
  service: ActionContext['service']
  /** Runs an action as the system actor. Jobs write through actions, so writes are audited. */
  call(name: string, input: unknown): Promise<Result<unknown>>
}

export interface JobDefinition<P extends z.ZodObject = z.ZodObject> {
  name: string
  module: string
  description: string
  payload: P
  maxAttempts: number
  timeoutSeconds: number
  handler: (payload: z.infer<P>, ctx: JobContext) => Promise<void>
}

export interface JobInput<P extends z.ZodObject> extends Omit<
  JobDefinition<P>,
  'maxAttempts' | 'timeoutSeconds'
> {
  /** 1 to 25. Default 5. */
  maxAttempts?: number
  /** Default 300. */
  timeoutSeconds?: number
}

export function defineJob<P extends z.ZodObject>(def: JobInput<P>): JobDefinition<P> {
  if (!NAME.test(def.name)) throw new Error(`Invalid job name "${def.name}"`)
  if (defOf(def.payload).catchall === undefined) {
    throw new Error(`Job "${def.name}" payload must be a z.strictObject`)
  }
  const maxAttempts = def.maxAttempts ?? 5
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 25) {
    throw new Error(`Job "${def.name}" maxAttempts must be 1 to 25`)
  }
  const timeoutSeconds = def.timeoutSeconds ?? 300
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error(`Job "${def.name}" timeoutSeconds must be a positive integer`)
  }
  return { ...def, maxAttempts, timeoutSeconds }
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface JobInfo {
  id: string
  name: string
  key: string | null
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAt: string
  lastError: string | null
  createdAt: string
  doneAt: string | null
}

export interface JobQueue {
  /**
   * Validates the payload (a bad one throws) and stores the job in the current transaction, so a
   * call that rolls back never leaves a job behind. With a `key`, a job of the same name and key
   * that is still pending or running is reported instead of enqueued twice.
   */
  enqueue<P extends z.ZodObject>(
    job: JobDefinition<P>,
    payload: z.input<P>,
    options?: { runAt?: Date; key?: string },
  ): Promise<{ id: string; duplicate: boolean }>
  /** Newest first. Payloads are not included. */
  list(query: { status?: JobStatus; cursor?: string; limit: number }): Promise<Page<JobInfo>>
  /** Moves a failed job back to pending with no attempts. */
  retry(id: string): Promise<'ok' | 'not_found' | 'not_failed'>
}

export const jobs = defineService<JobQueue>('core.jobs')

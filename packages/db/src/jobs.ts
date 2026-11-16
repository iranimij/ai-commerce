import { randomUUID } from 'node:crypto'
import {
  systemActor,
  type App,
  type JobContext,
  type JobInfo,
  type JobQueue,
} from '@aicommerce/core'
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from './client.js'
import { decodeCursor, encodeCursor } from './cursor.js'
import { iso } from './revisions.js'

type Row = Record<string, unknown>

const nullable = (value: unknown) => (typeof value === 'string' ? value : null)

const toInfo = (row: Row): JobInfo => ({
  id: String(row.id),
  name: String(row.name),
  key: nullable(row.key),
  status: row.status as JobInfo['status'],
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  runAt: String(row.__run_at),
  lastError: nullable(row.last_error),
  createdAt: String(row.__created),
  doneAt: nullable(row.__done),
})

const INFO = sql`id, name, key, status, attempts, max_attempts, last_error,
  ${iso('run_at')} as "__run_at", ${iso('created_at')} as "__created",
  case when done_at is null then null else ${iso('done_at')} end as "__done"`

export function createPgJobQueue(database: Database): JobQueue {
  const run = async (query: SQL): Promise<Row[]> => await database.current().execute(query)
  return {
    async enqueue(job, payload, options = {}) {
      const value = job.payload.parse(payload)
      const key = options.key ?? null
      const runAt = options.runAt ? sql`${options.runAt.toISOString()}::timestamptz` : sql`now()`
      const [row] = await run(sql`insert into job
          (name, payload, key, max_attempts, timeout_seconds, run_at)
        values (${job.name}, ${JSON.stringify(value)}::jsonb, ${key}, ${job.maxAttempts},
          ${job.timeoutSeconds}, ${runAt})
        on conflict (name, key) where status in ('pending', 'running') do nothing
        returning id`)
      if (row) return { id: String(row.id), duplicate: false }
      const [existing] = await run(sql`select id from job
        where name = ${job.name} and key = ${key} and status in ('pending', 'running')`)
      return { id: String(existing?.id), duplicate: true }
    },

    async list({ status, cursor, limit }) {
      const where: SQL[] = []
      if (status) where.push(sql`status = ${status}`)
      if (cursor) {
        const [at, id] = decodeCursor(cursor)
        where.push(sql`(created_at, id) < (${at}::timestamptz, ${id}::uuid)`)
      }
      const rows = await run(sql`select ${INFO} from job
        ${where.length > 0 ? sql`where ${sql.join(where, sql` and `)}` : sql``}
        order by created_at desc, id desc limit ${limit + 1}`)
      const items = rows.slice(0, limit).map(toInfo)
      const last = items.at(-1)
      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null,
      }
    },

    async retry(id) {
      const [row] = await run(sql`select status from job where id = ${id} for update`)
      if (!row) return 'not_found'
      if (row.status !== 'failed') return 'not_failed'
      await run(sql`update job set status = 'pending', attempts = 0, run_at = now(),
        last_error = null, updated_at = now() where id = ${id}`)
      return 'ok'
    },
  }
}

export interface WorkerOptions {
  database: Database
  app: App
  /** Jobs claimed per round. Default 4. */
  concurrency?: number
  /** Wait between rounds that found nothing. Default 1000. */
  pollIntervalMs?: number
  /** Job failures and worker errors. Default: console.error. */
  log?: (message: string, error?: unknown) => void
}

export interface Worker {
  /** Runs one round and returns how many jobs it ran. */
  runOnce(): Promise<number>
  start(): void
  /** Finishes the round in progress, then stops. */
  stop(): Promise<void>
}

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000)

export function createWorker(options: WorkerOptions): Worker {
  const { database, app } = options
  const concurrency = options.concurrency ?? 4
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const log =
    options.log ??
    ((message: string, error?: unknown) => {
      console.error(message, error)
    })
  const workerId = randomUUID()
  // Outside any call's transaction: a job's writes go through ctx.call.
  const run = async (query: SQL): Promise<Row[]> => await database.db.execute(query)

  const execute = async (row: Row): Promise<void> => {
    const id = String(row.id)
    const def = app.jobs().find((j) => j.name === row.name)
    const ctx: JobContext = {
      jobId: id,
      attempt: Number(row.attempts),
      service: (def) => app.service(def),
      call: (name, input) => app.registry.call(name, input, { actor: systemActor }),
    }
    let timer: NodeJS.Timeout | undefined
    try {
      if (!def) throw new Error(`Job "${String(row.name)}" is not enabled`)
      const payload: unknown = def.payload.parse(row.payload)
      await Promise.race([
        def.handler(payload as never, ctx),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Timed out after ${String(def.timeoutSeconds)} s`))
          }, def.timeoutSeconds * 1000)
        }),
      ])
      await run(sql`update job set status = 'done', done_at = now(), updated_at = now(),
        locked_at = null, locked_by = null, last_error = null
        where id = ${id} and locked_by = ${workerId}`)
    } catch (error) {
      log(`Job ${String(row.name)} ${id} failed`, error)
      await run(sql`update job set
          status = case when attempts >= max_attempts then 'failed' else 'pending' end,
          run_at = now() + least(10 * power(2, attempts - 1), 3600) * interval '1 second',
          last_error = ${errorMessage(error)}, updated_at = now(),
          locked_at = null, locked_by = null
        where id = ${id} and locked_by = ${workerId}`)
    } finally {
      clearTimeout(timer)
    }
  }

  const runOnce = async (): Promise<number> => {
    // A worker that died mid-job leaves it running; give it back after its timeout.
    await run(sql`update job set
        status = case when attempts >= max_attempts then 'failed' else 'pending' end,
        last_error = 'Timed out: the worker running it stopped', locked_at = null,
        locked_by = null, updated_at = now()
      where status = 'running'
        and locked_at < now() - timeout_seconds * interval '1 second'`)
    const names = app.jobs().map((j) => j.name)
    if (names.length === 0) return 0
    const claimed = await run(sql`update job set status = 'running', attempts = attempts + 1,
        locked_at = now(), locked_by = ${workerId}, updated_at = now()
      where id in (
        select id from job
        where status = 'pending' and run_at <= now()
          and name in (${sql.join(
            names.map((n) => sql`${n}`),
            sql`, `,
          )})
        order by run_at
        limit ${concurrency}
        for update skip locked)
      returning id, name, payload, attempts`)
    await Promise.all(claimed.map(execute))
    return claimed.length
  }

  // An object, so the loop sees stop() flip it.
  const state = { running: false }
  const isRunning = () => state.running
  let loop: Promise<void> | undefined
  let wake: (() => void) | undefined

  return {
    runOnce,
    start() {
      if (state.running) return
      state.running = true
      loop = (async () => {
        while (state.running) {
          const count = await runOnce().catch((error: unknown) => {
            log('Worker round failed', error)
            return 0
          })
          // stop() may have been called during the round.
          if (count === 0 && isRunning()) {
            await new Promise<void>((resolve) => {
              wake = resolve
              setTimeout(resolve, pollIntervalMs)
            })
          }
        }
      })()
    },
    async stop() {
      state.running = false
      wake?.()
      await loop
    },
  }
}

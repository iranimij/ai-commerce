import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { createApp } from './app.js'
import { defineJob } from './jobs.js'
import { defineModule } from './module.js'

const job = (overrides: Record<string, unknown> = {}) =>
  defineJob({
    name: 'work.ping',
    module: 'work',
    description: 'Ping',
    payload: z.strictObject({ n: z.number() }),
    handler: () => Promise.resolve(),
    ...overrides,
  })

describe('defineJob', () => {
  test('defaults: 5 attempts and a 300 s timeout', () => {
    expect(job()).toMatchObject({ maxAttempts: 5, timeoutSeconds: 300 })
  })

  test('refuses a bad name, a non-strict payload and attempts outside 1 to 25', () => {
    expect(() => job({ name: 'ping' })).toThrow('Invalid job name "ping"')
    expect(() => job({ payload: z.object({ n: z.number() }) })).toThrow(
      'Job "work.ping" payload must be a z.strictObject',
    )
    expect(() => job({ maxAttempts: 0 })).toThrow('maxAttempts')
    expect(() => job({ maxAttempts: 26 })).toThrow('maxAttempts')
  })
})

describe('jobs in the app', () => {
  test('app.jobs() lists the jobs of enabled modules only', () => {
    const work = defineModule({ name: 'work', jobs: [job()] })
    expect(
      createApp({ modules: [work], enabled: ['work'] })
        .jobs()
        .map((j) => j.name),
    ).toEqual(['work.ping'])
    expect(createApp({ modules: [work], enabled: [] }).jobs()).toEqual([])
  })

  test('a job outside the module namespace is refused', () => {
    const other = defineModule({ name: 'other', jobs: [job({ module: 'other' })] })
    expect(() => createApp({ modules: [other], enabled: ['other'] })).toThrow(
      'Module "other" cannot declare job "work.ping": namespace "work" is not declared by module "other"',
    )
  })
})

# Jobs

A job is background work with retries, run by the worker (`AICOMMERCE_ROLE=worker` or `all`).

Example: `sample.greet-later` in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts);
the worker behaviour is tested in
[`packages/db/src/jobs.integration.test.ts`](../../packages/db/src/jobs.integration.test.ts).

```ts
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
// from a handler:
await ctx.service(jobs).enqueue(greetLater, { name: 'Ada' }, { key: 'greet-ada' })
```

## Rules that bite

- Enqueue joins the call's transaction: a call that rolls back leaves no job.
- A job runs outside any transaction and writes through `ctx.call`, as the system actor, so its
  work is audited.
- On failure it is retried after `min(10 s × 2^(attempt − 1), 1 h)`, up to `maxAttempts`
  (default 5), then marked failed; `job.retry` runs it again.
- A job may run more than once (a worker can die mid-job): make handlers idempotent.
- `timeoutSeconds` (default 300) cuts a run short; a job left running by a dead worker is picked up
  again after it.
- With a `key`, a second enqueue while the first is pending or running is reported as a duplicate.

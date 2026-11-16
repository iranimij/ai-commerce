import { readFileSync } from 'node:fs'
import type { AdminAuth } from '@aicommerce/auth'
import { createApp } from '@aicommerce/core'
import type { Database, RateLimiter } from '@aicommerce/db'
import { expect, test } from 'vitest'
import { createServer } from './server.js'
import { firstPartyModules } from './wiring.js'

// Every first-party module, all enabled: what could ever be public.
const app = createApp({
  modules: firstPartyModules,
  enabled: firstPartyModules.map((m) => m.name),
  onError: () => undefined,
})
const reviewed = JSON.parse(
  readFileSync(new URL('../security/public-actions.json', import.meta.url), 'utf8'),
) as string[]

test('the public actions are exactly the reviewed list', () => {
  const actual = app.registry
    .list()
    .filter((a) => a.permission === null)
    .map((a) => a.name)
    .sort()
  // A new public action must be reviewed and added to security/public-actions.json.
  // setup.* are public by design: each handler checks the one-time token or a signed-in owner,
  // the server limits token guesses per address (per admin when signed in), and all refuse once
  // setup is finished. media.file-info gives only an image's width, for the public image route.
  expect(actual).toEqual([...reviewed].sort())
})

test('each public action answers bad input with 400, never 500', async () => {
  const guest: Partial<AdminAuth> = {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    session: () => Promise.resolve(null),
  }
  const server = createServer({
    app,
    auth: guest as AdminAuth,
    database: { client: () => Promise.resolve([]) } as unknown as Database,
    rateLimiter: {
      hit: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }),
      prune: () => Promise.resolve(),
    } satisfies RateLimiter,
    publicUrl: 'http://localhost:3000',
    production: false,
    audit: { write: () => Promise.resolve() },
    log: () => undefined,
  })
  const send = (name: string, body: string) =>
    server.request(`http://localhost:3000/api/actions/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  for (const name of reviewed) {
    expect((await send(name, JSON.stringify({ input: 42 }))).status).toBe(400)
    expect((await send(name, '{"input": {"__proto__": {}}}')).status).toBe(400)
    // Over the 1 MiB limit, the server refuses before the action sees it.
    expect((await send(name, JSON.stringify({ input: 'x'.repeat(2_000_000) }))).status).toBe(413)
  }
})

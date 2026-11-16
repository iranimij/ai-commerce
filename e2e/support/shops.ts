import { mkdirSync, readFileSync } from 'node:fs'
import { connect, createServer, type Server } from 'node:net'
import { test as base } from '@playwright/test'

// compose.yaml runs shops e2e-shop-0 to e2e-shop-<E2E_SHOPS - 1>. Shop 0 is never set up; each
// other shop goes to one test, which then has a fresh install to itself.
const SHOPS = Number(process.env.E2E_SHOPS ?? '0')
const CLAIMS = '/tmp/e2e-shops'
const port = (shop: number) => 3300 + shop

/**
 * Forwards localhost:3300+n to shop n. The browser then talks to localhost, a secure context, so
 * the shop's Secure cookies work over plain HTTP as they do for a shop owner on their own machine.
 */
export async function forwardShops(): Promise<() => Promise<void>> {
  mkdirSync(CLAIMS, { recursive: true })
  const servers: Server[] = []
  for (let shop = 0; shop < SHOPS; shop++) {
    const server = createServer((socket) => {
      const upstream = connect(3000, `e2e-shop-${String(shop)}`)
      socket.pipe(upstream).pipe(socket)
      socket.on('error', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
    })
    await new Promise<void>((resolve) => server.listen(port(shop), '127.0.0.1', resolve))
    servers.push(server)
  }
  return async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))))
  }
}

const logOf = (shop: number) => `/logs/shop${String(shop)}.log`

/** The shop's log so far: the server's and the admin's output. */
export function shopLog(shop: number): string {
  try {
    return readFileSync(logOf(shop), 'utf8')
  } catch {
    return ''
  }
}

/** The setup link the shop printed at startup, once it is in the log. */
export async function setupLink(shop: number, timeout = 120_000): Promise<string> {
  const deadline = Date.now() + timeout
  for (;;) {
    const link = /http:\/\/\S+\/setup\?token=[\w-]+/.exec(shopLog(shop))?.[0]
    if (link) return link
    if (Date.now() > deadline) {
      throw new Error(`Shop ${String(shop)} printed no setup link:\n${shopLog(shop)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

// mkdir is atomic, so two workers never get the same shop.
function claim(): number {
  for (let shop = 1; shop < SHOPS; shop++) {
    try {
      mkdirSync(`${CLAIMS}/${String(shop)}`)
      return shop
    } catch {
      // Taken by another test.
    }
  }
  throw new Error('No fresh shop left: add one to compose.yaml and e2e/db.sql, and raise E2E_SHOPS')
}

export interface Shop {
  /** http://localhost:<port>, the shop's AICOMMERCE_PUBLIC_URL. */
  origin: string
  /** The printed setup link, with the token. */
  link: string
}

async function open(shop: number): Promise<Shop> {
  const link = await setupLink(shop)
  return { origin: new URL(link).origin, link }
}

export const test = base.extend<{ shop: Shop; untouched: Shop; shopNumber: number }>({
  shopNumber: [
    // Playwright reads the fixtures a fixture needs from its first parameter, so it must be a pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const shop = claim()
      await use(shop)
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach(`shop${String(shop)}.log`, { body: shopLog(shop) })
      }
    },
    { scope: 'test' },
  ],
  /** A fresh install of this test's own. */
  shop: async ({ shopNumber }, use) => {
    await use(await open(shopNumber))
  },
  /** A shop nobody sets up; for tests that only look. */
  // eslint-disable-next-line no-empty-pattern
  untouched: async ({}, use) => {
    await use(await open(0))
  },
})

export { expect } from '@playwright/test'

import { randomBytes } from 'node:crypto'
import {
  attributeStore,
  createApp,
  guestActor,
  provide,
  resourceStore,
  settings,
  type App,
  type ModuleDefinition,
} from '@aicommerce/core'
import {
  createDb,
  createDbAuditSink,
  createPgAttributeStore,
  createPgResourceStore,
  createPgSettings,
  databaseEnv,
  databaseService,
  parseEnv,
  parseSecretKey,
  type Database,
} from '@aicommerce/db'
import { parse, table, UsageError, type Io } from '../io.js'
import { installedModules } from '../modules.js'
import { SEED_ATTRIBUTES, SEED_NOUNS } from './seed.js'

const RUNS = 200

/** Budgets of spec 5.7, p95 in milliseconds. */
const BUDGET = { query: 300, suggest: 100 }

export function parseBenchArgs(argv: string[]): void {
  const { positionals } = parse(argv, {})
  if (positionals.length !== 1 || positionals[0] !== 'search') {
    throw new UsageError('bench takes search')
  }
}

/** The app with what search reads through: resources, attributes, settings and the database. */
export function searchApp(
  database: Database,
  modules: readonly ModuleDefinition[],
  enabled: string[],
  secretKey: Buffer,
): App {
  return createApp({
    modules: [...modules],
    enabled,
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(databaseService, 'app', database),
      provide(settings, 'app', createPgSettings(database, { secretKey }).reader),
    ],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
  })
}

/** Runs the five shapes `runs` times each through `app.registry.call` and prints p50 and p95. */
export async function benchSearch(
  app: App,
  database: Database,
  runs: number,
  out: (line: string) => void,
): Promise<{ shape: string; p50: number; p95: number; budget: number }[]> {
  const call = async (name: string, input: object) => {
    const result = await app.registry.call(name, input, { actor: guestActor })
    if (!result.ok) throw new Error(`${name}: ${result.error.code}: ${result.error.message}`)
    return result.output as { nextCursor: string | null }
  }
  const tops = (
    await database.client`select id from catalog_category where parent_id is null
      order by position, id`
  ).map((r) => String(r.id))
  if (tops.length === 0) throw new Error('No categories: run ai-commerce seed catalog first')
  const options = (code: string) => SEED_ATTRIBUTES.find((a) => a.code === code)?.options ?? []
  const [colors, materials] = [options('color'), options('material')]
  const at = <T>(list: readonly T[], k: number) => list[k % list.length] as T
  const base = { currency: 'EUR' }

  // The cursor to page 5 of each top-level category, made before timing.
  const page5 = new Map<string, string>()
  for (const categoryId of tops) {
    let cursor: string | null = null
    for (let page = 1; page < 5; page++) {
      const found: { nextCursor: string | null } = await call('search.query', {
        ...base,
        categoryId,
        ...(cursor !== null && { cursor }),
      })
      cursor = found.nextCursor
    }
    if (cursor !== null) page5.set(categoryId, cursor)
  }

  // A typo: the second and third letters swapped ("shrit").
  const typo = (w: string) =>
    w.length > 3 ? `${w[0] ?? ''}${w[2] ?? ''}${w[1] ?? ''}${w.slice(3)}` : w
  const shapes: { shape: string; name: string; budget: number; input: (k: number) => object }[] = [
    { shape: 'keyword', name: 'search.query', budget: BUDGET.query, input: (k) => ({ ...base, q: at(SEED_NOUNS, k) }) },
    {
      shape: 'keyword + 2 filters',
      name: 'search.query',
      budget: BUDGET.query,
      input: (k) => ({
        ...base,
        q: at(SEED_NOUNS, k),
        filters: { color: [at(colors, k)], material: [at(materials, k)] },
      }),
    },
    {
      shape: 'category, price sort',
      name: 'search.query',
      budget: BUDGET.query,
      input: (k) => ({ ...base, categoryId: at(tops, k), sort: 'price-asc' }),
    },
    {
      shape: 'category, page 5',
      name: 'search.query',
      budget: BUDGET.query,
      input: (k) => {
        const categoryId = at(tops, k)
        const cursor = page5.get(categoryId)
        return { ...base, categoryId, ...(cursor !== undefined && { cursor }) }
      },
    },
    {
      shape: 'suggest',
      name: 'search.suggest',
      budget: BUDGET.suggest,
      input: (k) => {
        const word = at(SEED_NOUNS, k)
        return { q: k % 2 === 0 ? word.slice(0, 4) : typo(word) }
      },
    },
  ] // prettier-ignore

  const results = []
  for (const s of shapes) {
    const times: number[] = []
    for (let k = 0; k < runs; k++) {
      const input = s.input(k)
      const started = performance.now()
      await call(s.name, input)
      times.push(performance.now() - started)
    }
    times.sort((a, b) => a - b)
    const pct = (p: number) => times[Math.max(0, Math.ceil(p * times.length) - 1)] ?? 0
    const r = { shape: s.shape, p50: pct(0.5), p95: pct(0.95), budget: s.budget }
    out(`${r.shape}: p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`)
    results.push(r)
  }
  out('')
  for (const line of table(
    results.map((r) => ({
      shape: r.shape,
      calls: runs,
      'p50 ms': r.p50.toFixed(1),
      'p95 ms': r.p95.toFixed(1),
      'p95 budget': `< ${String(r.budget)}`,
      within: r.p95 < r.budget ? 'yes' : 'NO',
    })),
  ))
    out(line)
  return results
}

/** `ai-commerce bench search`, against the shop's database as the runtime role. */
export async function bench(argv: string[], io: Io): Promise<number> {
  parseBenchArgs(argv)
  const env = parseEnv(databaseEnv, io.env)
  const database = createDb(env.DATABASE_URL)
  try {
    const enabled = await installedModules(database, io)
    if (!enabled.includes('search')) throw new Error('The search module is off: switch it on first')
    // Search reads no secret setting; a random key serves when none is set.
    const key = io.env.AICOMMERCE_SECRET_KEY
    const app = searchApp(
      database,
      io.install.modules,
      enabled,
      key ? parseSecretKey(key) : randomBytes(32),
    )
    await benchSearch(app, database, RUNS, io.out)
    return 0
  } finally {
    await database.close()
  }
}

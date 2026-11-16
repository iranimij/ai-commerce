import {
  ActionError,
  appInfo,
  attributeStore,
  defineService,
  settings,
  visibleAttributes,
  type ActionContext,
} from '@aicommerce/core'
import { databaseService } from '@aicommerce/db'
import { localize, type Price } from '@aicommerce/module-catalog'
import { shopLanguage } from '@aicommerce/module-setup'
import { sql, type SQL } from 'drizzle-orm'

export type SearchSort = 'relevance' | 'price-asc' | 'price-desc' | 'name' | 'newest'

export interface SearchQuery {
  q?: string | undefined
  categoryId?: string | undefined
  /** By attribute code: AND across codes, OR within one. */
  filters: Record<string, string[]>
  /** In minor units of `currency`. */
  price?: { min?: number | undefined; max?: number | undefined } | undefined
  currency?: string | undefined
  locale: string
  sort: SearchSort
  cursor?: string | undefined
  limit: number
  /** The attribute codes to count values of. */
  facets: string[]
}

export interface SearchResult {
  /** Product ids, in order. */
  ids: string[]
  total: number
  /** Value counts per code of `SearchQuery.facets`; each ignores that code's own filter. */
  facets: { code: string; counts: { value: string; count: number }[] }[]
  nextCursor: string | null
}

export interface Suggestions {
  products: { id: string; slug: string; name: string }[]
  categories: { id: string; name: string }[]
}

/**
 * Where products are indexed and searched (spec 5.7). The default keeps a PostgreSQL table; a
 * module may provide another (OpenSearch, say). Every method runs inside the calling action, so
 * `ctx` reaches that call's transaction, settings and attributes.
 */
export interface SearchEngine {
  /** Brings these products' documents in step with the catalog; a missing product is removed. */
  index(ctx: ActionContext, productIds: readonly string[]): Promise<void>
  remove(ctx: ActionContext, productIds: readonly string[]): Promise<void>
  /** Removes the documents of products that no longer exist; the last step of a rebuild. */
  prune(ctx: ActionContext): Promise<void>
  query(ctx: ActionContext, q: SearchQuery): Promise<SearchResult>
  suggest(ctx: ActionContext, q: string, locale: string): Promise<Suggestions>
}

export const searchEngine = defineService<SearchEngine>('search.engine')

type Row = Record<string, unknown>

const rows = async (ctx: ActionContext, query: SQL): Promise<Row[]> =>
  await ctx.service(databaseService).current().execute(query)

/** `in ${anyOf(ids)}`: a list of uuids as one parameter. */
const anyOf = (ids: readonly string[]) =>
  sql`(select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`

// The extensions live in `public` (see the migration), so every schema reaches them by name.
const unaccent = (text: SQL) => sql`public.unaccent('public.unaccent'::regdictionary, ${text})`

/** Suggestions need at least this word similarity (pg_trgm): "shrit" to "Shirt" is 0.33. */
const SIMILAR = 0.3

async function language(ctx: ActionContext): Promise<string> {
  return (await ctx.service(settings).get(shopLanguage)) ?? 'en'
}

/** The text search configuration: stemmed English for an English shop, `simple` otherwise. */
const configOf = (lang: string) => (lang === 'en' ? 'english' : 'simple')

/**
 * For each of `ids`, the category and its ancestors, when every one of them is enabled; a hidden
 * category is left out.
 */
async function visibleChains(ctx: ActionContext, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map()
  const found = await rows(
    ctx,
    sql`with recursive up as (
        select id as origin, id, parent_id, enabled, 0 as depth
        from catalog_category where id in ${anyOf(ids)}
        union all
        select up.origin, c.id, c.parent_id, c.enabled, up.depth + 1
        from catalog_category c join up on c.id = up.parent_id where up.depth < 50)
      select origin, id, parent_id, enabled from up order by origin, depth`,
  )
  const chains = new Map<string, Row[]>()
  for (const row of found) {
    const chain = chains.get(String(row.origin)) ?? []
    chain.push(row)
    chains.set(String(row.origin), chain)
  }
  const out = new Map<string, string[]>()
  for (const [origin, chain] of chains) {
    if (chain.at(-1)?.parent_id === null && chain.every((c) => c.enabled === true)) {
      out.set(
        origin,
        chain.map((c) => String(c.id)),
      )
    }
  }
  return out
}

type Translations = Record<string, Record<string, string | undefined> | undefined>

const textsOf = (value: unknown): string[] =>
  typeof value === 'string' || typeof value === 'number'
    ? [String(value)]
    : Array.isArray(value)
      ? value.flatMap(textsOf)
      : []

async function index(ctx: ActionContext, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const products = await rows(
    ctx,
    sql`select id, type, sku, name, status, short_description, description, prices, category_ids,
        attributes, translations, created_at
      from catalog_product where id in ${anyOf(ids)}`,
  )
  const found = new Set(products.map((p) => String(p.id)))
  await remove(
    ctx,
    ids.filter((id) => !found.has(id)),
  )
  if (products.length === 0) return

  const variants = new Map<string, Row[]>()
  for (const v of await rows(
    ctx,
    sql`select product_id, sku, options, prices from catalog_product_variant
      where enabled and product_id in ${anyOf([...found])}`,
  )) {
    const list = variants.get(String(v.product_id)) ?? []
    list.push(v)
    variants.set(String(v.product_id), list)
  }
  const chains = await visibleChains(ctx, [
    ...new Set(products.flatMap((p) => p.category_ids as string[])),
  ])
  const defs = [
    ...ctx.service(appInfo).moduleAttributes('product'),
    ...(await ctx.service(attributeStore).list('product')),
  ]
  // Every select value is kept, whatever its privacy: search.query only offers public ones.
  const facetDefs = defs.filter((d) => d.type === 'select' || d.type === 'multiselect')
  // Only public values can be searched for, so a search never reveals a private one.
  const publicDefs = defs.filter((d) => d.privacy === 'public')
  const lang = await language(ctx)

  const docs = products.map((p) => {
    const id = String(p.id)
    const own = variants.get(id) ?? []
    const t = (p.translations ?? {}) as Translations
    const translated = (key: string) => Object.values(t).flatMap((x) => textsOf(x?.[key]))
    const names = Object.fromEntries(
      Object.entries(t).flatMap(([locale, x]) => (x?.name ? [[locale, x.name]] : [])),
    )

    const facets: Record<string, Set<string>> = {}
    const add = (code: string, value: unknown) => {
      for (const v of textsOf(value)) (facets[code] ??= new Set()).add(v)
    }
    const attrs = visibleAttributes(facetDefs, (p.attributes ?? {}) as Record<string, unknown>)
    for (const [code, value] of Object.entries(attrs)) add(code, value)
    for (const v of own) {
      for (const [code, value] of Object.entries(v.options as Record<string, string>))
        add(code, value)
    }

    const prices: Record<string, number> = {}
    const lists =
      p.type === 'simple'
        ? [p.prices as Price[]]
        : own.map((v) => (v.prices ?? p.prices) as Price[])
    for (const price of lists.flat()) {
      const low = prices[price.currency]
      if (price.channel === undefined && (low === undefined || price.amount < low)) {
        prices[price.currency] = price.amount
      }
    }

    const searchable = visibleAttributes(
      publicDefs,
      (p.attributes ?? {}) as Record<string, unknown>,
    )
    return {
      id,
      status: p.status,
      name: p.name,
      names,
      created_at: p.created_at,
      a: [String(p.name), ...translated('name')].join(' '),
      b: [
        String(p.sku),
        ...own.map((v) => String(v.sku)),
        ...Object.values(searchable).flatMap(textsOf),
        ...own.flatMap((v) => Object.values(v.options as Record<string, string>)),
      ].join(' '),
      c: [...textsOf(p.short_description), ...translated('shortDescription')].join(' '),
      d: [...textsOf(p.description), ...translated('description')].join(' '),
      categories: [...new Set((p.category_ids as string[]).flatMap((c) => chains.get(c) ?? []))],
      facets: Object.fromEntries(Object.entries(facets).map(([k, v]) => [k, [...v]])),
      prices,
    }
  })

  const config = sql`${configOf(lang)}::regconfig`
  const weighted = (column: string, weight: string) =>
    sql`setweight(to_tsvector(${config}, ${unaccent(sql.raw(`d.${column}`))}), ${weight}::"char")`
  await rows(
    ctx,
    sql`insert into search_document
        (product_id, status, name, names, created_at, tsv, suggest, categories, facets, prices)
      select d.id, d.status, d.name, d.names, d.created_at,
        ${weighted('a', 'A')} || ${weighted('b', 'B')} || ${weighted('c', 'C')} || ${weighted('d', 'D')},
        ${unaccent(sql`d.a`)}, d.categories, d.facets, d.prices
      from jsonb_to_recordset(${JSON.stringify(docs)}::jsonb) as d(id uuid, status text,
        name text, names jsonb, created_at timestamptz, a text, b text, c text, d text,
        categories jsonb, facets jsonb, prices jsonb)
      on conflict (product_id) do update set status = excluded.status, name = excluded.name,
        names = excluded.names, created_at = excluded.created_at, tsv = excluded.tsv,
        suggest = excluded.suggest, categories = excluded.categories, facets = excluded.facets,
        prices = excluded.prices`,
  )
}

async function remove(ctx: ActionContext, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await rows(ctx, sql`delete from search_document where product_id in ${anyOf(ids)}`)
}

/**
 * The words before the last, and the last word if it is still being typed (it ends the query and
 * is made of letters and digits only), which then also matches as a prefix.
 */
export function splitLast(q: string): { head: string; last?: string } {
  const last = /[\p{L}\p{M}\p{N}]+$/u.exec(q)?.[0]
  return last ? { head: q.slice(0, -last.length), last } : { head: q }
}

/**
 * The tsquery for `q`, as its canonical text: `websearch_to_tsquery` of the whole query, or of the
 * words before the last with the last word's lexemes as prefixes. Each lexeme is quoted with its
 * quotes and backslashes escaped, so no input can change the query's structure.
 */
async function tsqueryOf(ctx: ActionContext, q: string, config: string): Promise<string> {
  const cfg = sql`${config}::regconfig`
  const whole = sql`websearch_to_tsquery(${cfg}, ${unaccent(sql`${q}`)})`
  const { head, last } = splitLast(q)
  const query = last
    ? sql`${whole} || (websearch_to_tsquery(${cfg}, ${unaccent(sql`${head}`)}) && coalesce(
        (select string_agg('''' || replace(replace(lexeme, '\\', '\\\\'), '''', '''''') || ''':*', ' & ')
          from unnest(to_tsvector(${cfg}, ${unaccent(sql`${last}`)})))::tsquery, ''::tsquery))`
    : whole
  const [row] = await rows(ctx, sql`select (${query})::text as q`)
  return (row?.q as string | null | undefined) ?? ''
}

interface Sort {
  key: (tq: string) => SQL
  /** The key as the cursor carries it, when not the key itself. */
  text?: SQL
  desc: boolean
  /** The cast of a cursor's value, and the values a cursor may carry. */
  cast: string
  valid: (value: string) => boolean
}

const MAX_AMOUNT = Number.MAX_SAFE_INTEGER
const integer = (v: string) => /^-?\d{1,16}$/.test(v)
const sorts = (currency: string, locale: string): Record<SearchSort, Sort> => ({
  relevance: {
    key: (tq) => sql`round(ts_rank(tsv, ${tq}::tsquery)::numeric, 6)`,
    desc: true,
    cast: 'numeric',
    valid: (v) => /^\d{1,10}(\.\d{1,10})?$/.test(v),
  },
  // Without a price in the currency: last, both ways.
  'price-asc': {
    key: () => sql`coalesce((prices->>${currency})::bigint, ${MAX_AMOUNT}::bigint)`,
    desc: false,
    cast: 'bigint',
    valid: integer,
  },
  'price-desc': {
    key: () => sql`coalesce((prices->>${currency})::bigint, -1)`,
    desc: true,
    cast: 'bigint',
    valid: integer,
  },
  name: {
    key: () => sql`coalesce(names->>${locale}, name)`,
    desc: false,
    cast: 'text',
    valid: (v) => v.length <= 1000,
  },
  newest: {
    key: () => sql`created_at`,
    text: sql`to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    desc: true,
    cast: 'timestamptz',
    valid: (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v,
  },
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Keyset cursors: base64url JSON of `{ s: sort, k: sort value, id }`. */
function decodeCursor(cursor: string, sort: SearchSort, def: Sort): { k: string; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<string, unknown>
    const { s, k, id } = value
    if (
      s === sort &&
      typeof k === 'string' &&
      !k.includes('\0') &&
      def.valid(k) &&
      typeof id === 'string' &&
      UUID.test(id)
    ) {
      return { k, id }
    }
  } catch {
    // Falls through to the error below.
  }
  throw new ActionError('invalid_input', 'Invalid cursor')
}

const encodeCursor = (s: SearchSort, k: unknown, id: string) =>
  Buffer.from(JSON.stringify({ s, k: String(k), id })).toString('base64url')

async function query(ctx: ActionContext, q: SearchQuery): Promise<SearchResult> {
  const empty: SearchResult = { ids: [], total: 0, facets: [], nextCursor: null }
  const tq = q.q ? await tsqueryOf(ctx, q.q, configOf(await language(ctx))) : undefined
  // Only stop words or punctuation: nothing can match.
  if (tq === '') return empty
  const sort: SearchSort = q.sort === 'relevance' && tq === undefined ? 'newest' : q.sort
  const def = sorts(q.currency ?? '', q.locale)[sort]
  const cursor = q.cursor === undefined ? undefined : decodeCursor(q.cursor, sort, def)

  const base: SQL[] = [sql`status = 'active'`]
  if (tq !== undefined) base.push(sql`tsv @@ ${tq}::tsquery`)
  if (q.categoryId) base.push(sql`categories @> ${JSON.stringify([q.categoryId])}::jsonb`)
  const price = sql`(prices->>${q.currency ?? ''})::bigint`
  if (q.price?.min !== undefined) base.push(sql`${price} >= ${q.price.min}`)
  if (q.price?.max !== undefined) base.push(sql`${price} <= ${q.price.max}`)
  const filter = (code: string, values: string[]) =>
    sql`(${sql.join(
      values.map((v) => sql`facets @> ${JSON.stringify({ [code]: [v] })}::jsonb`),
      sql` or `,
    )})`
  const where = (except?: string) =>
    sql.join(
      [
        ...base,
        ...Object.entries(q.filters)
          .filter(([code]) => code !== except)
          .map(([code, values]) => filter(code, values)),
      ],
      sql` and `,
    )

  const key = def.key(tq ?? '')
  const dir = sql.raw(def.desc ? 'desc' : 'asc')
  const after = cursor
    ? sql`and (${key}, product_id) ${sql.raw(def.desc ? '<' : '>')}
        (${cursor.k}::${sql.raw(def.cast)}, ${cursor.id}::uuid)`
    : sql``

  const free = q.facets.filter((c) => !(c in q.filters))
  const filtered = q.facets.filter((c) => c in q.filters)
  const counts = [
    ...(free.length > 0
      ? [
          sql`select f.key as code, v.value, count(*)::int as n
            from search_document, jsonb_each(facets) f, jsonb_array_elements_text(f.value) v
            where ${where()} and f.key in (select jsonb_array_elements_text(${JSON.stringify(free)}::jsonb))
            group by f.key, v.value`,
        ]
      : []),
    // Each filtered code is counted without its own filter, so its other values stay offered.
    ...filtered.map(
      (code) =>
        sql`select ${code}::text as code, v.value, count(*)::int as n
          from search_document, jsonb_array_elements_text(facets->${code}) v
          where ${where(code)} group by v.value`,
    ),
  ]

  const [page, total, facetRows] = await Promise.all([
    rows(
      ctx,
      sql`select product_id, ${def.text ?? key} as k from search_document where ${where()} ${after}
        order by ${key} ${dir}, product_id ${dir} limit ${q.limit + 1}`,
    ),
    rows(ctx, sql`select count(*)::int as n from search_document where ${where()}`),
    counts.length > 0 ? rows(ctx, sql.join(counts, sql` union all `)) : Promise.resolve([]),
  ])
  const more = page.length > q.limit
  const shown = page.slice(0, q.limit)
  const last = shown.at(-1)
  const facets = new Map<string, { value: string; count: number }[]>()
  for (const row of facetRows) {
    const list = facets.get(String(row.code)) ?? []
    list.push({ value: String(row.value), count: Number(row.n) })
    facets.set(String(row.code), list)
  }
  return {
    ids: shown.map((r) => String(r.product_id)),
    total: Number(total[0]?.n ?? 0),
    facets: [...facets].map(([code, list]) => ({ code, counts: list })),
    nextCursor: more && last ? encodeCursor(sort, last.k, String(last.product_id)) : null,
  }
}

async function suggest(ctx: ActionContext, q: string, locale: string): Promise<Suggestions> {
  const term = unaccent(sql`${q}`)
  const fallback = await language(ctx)
  // Nearest first by word similarity (the GiST index), then only those similar enough.
  const near = await rows(
    ctx,
    sql`select s.product_id, p.name, p.slug, p.translations from (
        select product_id, suggest operator(public.<->>) ${term} as distance
        from search_document where status = 'active'
        order by suggest operator(public.<->>) ${term}, product_id limit 6) s
      join catalog_product p on p.id = s.product_id and p.status = 'active'
      where s.distance <= ${1 - SIMILAR}
      order by s.distance, s.product_id`,
  )
  // shortcut: compares every enabled category's names; index them if a shop has thousands.
  const categories = await rows(
    ctx,
    sql`select id, name, slug, translations from (
        select id, name, slug, translations, public.word_similarity(${term}, ${unaccent(
          sql`concat_ws(' ', name, (select string_agg(value->>'name', ' ')
            from jsonb_each(coalesce(translations, '{}'::jsonb))))`,
        )}) as similarity
        from catalog_category where enabled) c
      where similarity >= ${SIMILAR} order by similarity desc, name, id limit 20`,
  )
  const visible = await visibleChains(
    ctx,
    categories.map((c) => String(c.id)),
  )
  const named = (row: Row) =>
    localize(
      {
        name: String(row.name),
        slug: String(row.slug),
        ...(row.translations ? { translations: row.translations } : {}),
      },
      locale,
      fallback,
    )
  return {
    products: near.map((row) => {
      const { name, slug } = named(row)
      return { id: String(row.product_id), slug, name }
    }),
    categories: categories
      .filter((c) => visible.has(String(c.id)))
      .slice(0, 4)
      .map((row) => ({ id: String(row.id), name: named(row).name })),
  }
}

export const postgresSearchEngine: SearchEngine = {
  index,
  remove,
  prune: async (ctx) => {
    await rows(
      ctx,
      sql`delete from search_document d
        where not exists (select 1 from catalog_product p where p.id = d.product_id)`,
    )
  },
  query,
  suggest,
}

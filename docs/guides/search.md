# Search

The `search` module finds active products by words, category, attribute filters and price, with
filter counts, five sort orders, cursor paging and suggestions as the visitor types. It keeps a
`search_document` row per product in step with the catalog, inside each catalog write's
transaction, and answers through the replaceable `searchEngine` service. Code:
[`modules/search/src`](../../modules/search/src), tests in
[`search.integration.test.ts`](../../modules/search/src/search.integration.test.ts).

```ts
const call = (name: string, input: unknown) => app.registry.call(name, input, { actor })

// Any product write is indexed at once, in the same transaction.
await call('product.create', {
  values: {
    type: 'simple',
    sku: 'OX-1',
    name: 'Blue Oxford Shirt',
    status: 'active',
    prices: [{ currency: 'EUR', amount: 4900 }],
    categoryIds: [shirtsId],
  },
  attributes: { color: 'blue' }, // a public select attribute: a filter
})

// As a visitor (no permission needed):
const page = await call('search.query', {
  q: 'oxford shi', // the last word also matches as a prefix
  categoryId: menId, // includes subcategories
  filters: { color: ['blue', 'navy'], size: ['m'] }, // AND across codes, OR within one
  price: { min: 1000, max: 8000 }, // minor units of the currency
  sort: 'price-asc', // relevance (default with q) | price-asc | price-desc | name | newest
  limit: 24,
})
// page.output: { items: ProductCard[], total, facets: [{ code, label, options: [{ value, count, swatch? }] }], nextCursor }
await call('search.query', {
  q: 'oxford shi',
  categoryId: menId,
  sort: 'price-asc',
  cursor: page.output.nextCursor,
})
await call('search.suggest', { q: 'shrit' }) // { products: [{ id, slug, name }], categories: [{ id, name }] }

// As an admin with search.manage, after switching search back on:
await call('search.reindex', {}) // { jobId, duplicate }; the worker runs search.rebuild
```

| Name                   | What it does                                                                       | Permission      |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------- |
| `search.query`         | Products by words, category, filters and price; facets; cursor paging              | public          |
| `search.suggest`       | `{ q (2..100), locale? }` → up to 6 products and 4 categories, typos allowed       | public          |
| `search.reindex`       | Enqueues the job `search.rebuild` (once: a second call while it waits is reported) | `search.manage` |
| `search.reindex-page`  | `{ after? }` → indexes the next 500 products by id; the job's step                 | `search.manage` |
| `searchEngine` service | `index`, `remove`, `prune`, `query`, `suggest`, each given the calling `ctx`       | (code only)     |

## The `search_document` table

One row per product, written by the engine and, for the benchmark, by `COPY`
([`0001_search.sql`](../../modules/search/migrations/0001_search.sql)). Nothing is computed by a
trigger, so a row written directly must be complete:

| Column       | Type             | Holds                                                                               |
| ------------ | ---------------- | ----------------------------------------------------------------------------------- |
| `product_id` | `uuid` key       | The product                                                                         |
| `status`     | `text`           | The product's status; only `active` is ever returned                                |
| `name`       | `text`           | The product's own name (sort `name`)                                                |
| `names`      | `jsonb`          | Translated names: `{"fa": "..."}` (sort `name` in that locale)                      |
| `created_at` | `timestamptz(3)` | The product's (sort `newest`)                                                       |
| `tsv`        | `tsvector`       | Names A, SKUs and public attribute values B, short descriptions C, descriptions D   |
| `suggest`    | `text`           | Every name, unaccented, for `pg_trgm`                                               |
| `categories` | `jsonb`          | `["<uuid>", ...]`: the visible categories and all their ancestors                   |
| `facets`     | `jsonb`          | `{"color": ["red", "blue"]}`: select and multiselect values, enabled variants' too  |
| `prices`     | `jsonb`          | `{"EUR": 1900}`: the lowest channel-free amount per currency, enabled variants' too |

Indexes: GIN on `tsv`, GIN `jsonb_path_ops` on `categories` and `facets`, GiST
`gist_trgm_ops(siglen = 256)` on `suggest`, and a B-tree on `(created_at, product_id)`.

A second table, `search_word (word text primary key)` with a GiST trigram index, holds every
distinct `simple` lexeme of `suggest` (the words of the names, unaccented and lower-cased). The
engine adds a document's words when it indexes it and never removes one; a row written directly
must add its words too. Timings on 1,000,000 products: [`docs/benchmarks/m1a.md`](../benchmarks/m1a.md).

## Rules that bite

- Off means absent: with `search` off, catalog writes are not indexed. **After switching search
  back on, call `search.reindex`.** The same after changing the shop language (it picks the text
  search configuration) or making an attribute public or private (only public values are
  searchable). Until then results are stale; they never show a product that is no longer active,
  because the cards come from the catalog.
- The rebuild indexes 500 products per call, each in its own transaction, and removes documents of
  products that are gone. It is safe to run again.
- Words use the `english` configuration (stemmed: "shirts" finds "Shirt") when the shop language
  is `en`, and `simple` otherwise; accents are removed (`unaccent`). Names in every locale are in
  one document, so a Persian word finds a product with a Persian translation whatever `locale`
  asks for; `locale` sets the language of the cards and of the `name` sort.
- The query is `websearch_to_tsquery` (quotes, `or`, `-word`), plus the last word as a prefix
  while it is being typed (it ends the query with a letter or digit). Its lexemes are quoted and
  escaped; nothing the visitor types becomes tsquery syntax. A query of only stop words or
  punctuation finds nothing.
- Suggestions first correct each typed word: a word within 0.34 word distance of a known name
  word (any prefix of 2 letters or more is) stays as typed; otherwise it becomes the nearest known
  word if that is within 0.7, or is dropped. The 6 products nearest to the corrected text follow;
  among products equally near, which 6 come back is not fixed. Categories are matched on the text
  as typed.
- Filters are public `select` and `multiselect` attributes on `product`; any other code is
  `invalid_input`. Each facet's counts ignore that facet's own filter, so the other values stay
  offered. A variant's options count only while it is enabled.
- Price filters and sorts use the asked currency (default: the shop currency), never converted. A
  product without a price in it is left out by a price filter and sorts last both ways.
- The cursor belongs to its sort; another sort or a cursor that was not issued is `invalid_input`.
  With `q`, paging is stable while the index does not change.
- A category filter includes subcategories. A disabled category, or one under a disabled one,
  matches nothing. Moving or switching a category reindexes its products and its descendants', in
  pages of 500, inside that write.
- The wraps run at order 10, inside the catalog's own rules (order 0): a write that the catalog
  refuses afterwards rolls the index back with it.
- To use another engine, provide `searchEngine` from a module that depends on `search`. Every
  method gets the calling action's `ctx`, so it can read the catalog in the same transaction.
- `pg_trgm` and `unaccent` are installed in the `public` schema, and the code calls them as
  `public.*`. A database that has them in another schema must move them.

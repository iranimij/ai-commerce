# M1a benchmark: search on 1,000,000 products

Spec 5.7 budget: p95 under 300 ms for every `search.query` shape and under 100 ms for
`search.suggest`. Measured on 2026-11-16 with `ai-commerce bench search` (see
[the CLI guide](../guides/cli.md#seed-and-benchmark-development-only)).

## Machine

| What                | Value                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host                | Apple M4 Max (14 cores), 36 GB RAM, macOS 26                                                                                                                             |
| Docker              | Docker Desktop 27.5.1: 11 CPUs and 16.3 GiB for the VM                                                                                                                   |
| PostgreSQL          | `postgres:17` image (17.12), the compose `db` service, untuned                                                                                                           |
| PostgreSQL settings | `shared_buffers` 128 MB, `work_mem` 4 MB, `effective_cache_size` 4 GB, `maintenance_work_mem` 64 MB, `random_page_cost` 4, `max_parallel_workers_per_gather` 2, `jit` on |
| Client              | The CLI in the compose `app` container, through `app.registry.call` as a visitor                                                                                         |

The settings are the image defaults: a small shop's database, not a tuned one. The table and
indexes (2.5 GB) do not fit in `shared_buffers`, so most reads come from the OS page cache.

## Data

`ai-commerce seed catalog --products 1000000`:

- 1,000,000 products (100,000 configurable with 4 variants each: 400,000 variants), 1,400,000
  SKUs, 200 categories (20 top-level, 180 below), 5 public select attributes (brand 50 values,
  colour 12, material 8, pattern 8, size 8). 950,000 active, 50,000 drafts.
- Names are an adjective, a colour (simple products only), a material and one of 50 nouns, so a
  keyword such as "shirt" matches about 19,000 active products and a top-level category about
  47,500.
- **Seed time: 100.1 s** (COPY in transactions of 10,000 products, search documents built in SQL).
- **Database size: 2,472 MB** after the seed (`search_document` 1,225 MB with its indexes,
  `catalog_product` 912 MB); 2,483 MB after the fix below.

## Shapes

200 calls each, one after another, each a different value:

| Shape                | Input                                                                           |
| -------------------- | ------------------------------------------------------------------------------- |
| keyword              | `q`: one of the 50 nouns                                                        |
| keyword + 2 filters  | the same, with `filters: { color: [one], material: [one] }`                     |
| category, price sort | a top-level category (about 47,500 matches), `sort: 'price-asc'`                |
| category, page 5     | a top-level category, default sort (newest), page 5 by cursor (made beforehand) |
| suggest              | half the first 4 letters of a noun ("jack"), half a typo ("jcaket")             |

Every `search.query` call also counts the total and all five facets exactly.

## Results (ms)

| Shape                | Before p50 | Before p95 | After p50 | After p95 | Budget (p95) | Within |
| -------------------- | ---------: | ---------: | --------: | --------: | -----------: | ------ |
| keyword              |      111.9 |      137.5 |     110.1 |     124.6 |        < 300 | yes    |
| keyword + 2 filters  |       51.4 |       63.3 |      51.2 |      65.2 |        < 300 | yes    |
| category, price sort |      153.2 |      167.0 |     152.6 |     165.9 |        < 300 | yes    |
| category, page 5     |      153.2 |      210.1 |     149.4 |     191.4 |        < 300 | yes    |
| suggest              |      265.0 |     1032.5 |       1.5 |       6.6 |        < 100 | yes    |

Every shape is within budget after the fix. The `search.query` shapes did not change (their code
did not); the differences are run-to-run noise. One run while another project's test suite was
using the same Docker VM gave p95 402.7 ms (keyword) and 398.6 ms (category, price sort): the
budget holds on a machine that is not shared, with little margin for the category shape.

The total and facet counts stay exact: no shape needed an estimate, so `search.query` has no
`totalEstimated` or `facetsEstimated` flag yet. The heaviest part of a top-level category call is
the page query sorted by price (216 ms cold, about 40,000 buffers read: there is no index for the
price sort, so every match is read and the top 25 kept), then the facet counts (120 ms) and the
total (81 ms); the three run in parallel.

## The fix: suggestions

`search.suggest` asked for the 6 nearest documents by word similarity
(`order by suggest <->> term, product_id limit 6`) on the GiST trigram index. Two causes:

1. **The id tie-break.** Thousands of products share the nearest distance (every "… Shirt" is
   equally near "shir"), and the incremental sort on `product_id` must read every tie before it
   can return 6 rows.
2. **A lossy index.** With the default 12-byte signature, 30-character names fill the signature,
   so a nearest-first scan cannot rule out most of the index; a typo, whose best match is far,
   reads most of it.

Before (`order by suggest <->> 'shir', product_id limit 6`):

```text
Limit (actual time=452.540..452.541 rows=6)
  Buffers: shared hit=2431 read=33826
  -> Incremental Sort  Sort Key: (suggest <->> 'shir'), product_id
     -> Index Scan using search_document_suggest (actual time=137.496..449.419 rows=19047)
Execution Time: 456.033 ms

Typo 'jakcet': Buffers: shared hit=9380 read=26833, Execution Time: 302.035 ms
```

Without the tie-break but with the 12-byte index, a prefix took 80–109 ms (8,143 buffers) and the
typo still 352 ms (36,213 buffers).

The fix (`modules/search/migrations/0002_suggest_signature.sql`, `0003_search_word.sql`,
`engine.ts`):

- The GiST index uses `gist_trgm_ops(siglen = 256)`: 136 MB instead of 127 MB.
- The inner scan orders by distance only; the 6 rows are then ordered by distance and id.
- A new table `search_word` holds every distinct word of the product names (100 words here; a
  real shop has thousands, not millions). Each typed word that is not within 0.34 of a known
  word (a prefix of 2 letters or more always is) is replaced by its nearest word when one is
  within 0.7, and dropped otherwise. A typo then becomes a close match, so the scan stops at once.

After:

```text
search_word, nearest to 'jcaket':        Buffers: shared hit=26, Execution Time: 0.202 ms
search_document, nearest to 'jacket':    Buffers: shared hit=30, Execution Time: 0.200 ms
search_document, nearest to 'shir':      Buffers: shared hit=29, Execution Time: 0.094 ms
```

All 14 search integration tests stay green, including `'suggest tolerates a typo'` and
`'Persian words are found'`.

## Repeat it

```sh
docker compose down -v   # an empty database
./dev pnpm install && ./dev pnpm build && ./dev pnpm db:roles
./dev sh -c 'AICOMMERCE_MODULES=system,access,search node packages/cli/dist/bin.js migrate'
./dev ai-commerce module enable search
./dev env AICOMMERCE_ALLOW_SEED=1 node packages/cli/dist/bin.js seed catalog --products 1000000
./dev ai-commerce bench search
```

# M1a: Catalog, Media, Search and SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M1a gives a shop a catalog that every later surface (dashboard, storefront, chat, MCP) works through, all as actions:

- simple and configurable products with variants, categories, attribute sets and swatches;
- prices in several currencies, a media gallery with uploaded images and video links, and related products;
- full-text search with filters, sorting and suggestions;
- clean URLs, redirects on rename, meta tags, structured data and a sitemap;
- sample data, offered on the setup page.

**Architecture:**

- `packages/core` and `packages/db`: resources can hold structured fields (arrays and objects, stored as `jsonb`); a unique violation becomes `conflict`; attribute options can carry swatches.
- `modules/media`: uploads are validated, re-encoded to WebP at fixed widths and stored through a replaceable `files` service (local disk by default). The server serves them at `/api/media/...`.
- `modules/catalog`: the resources `category`, `attribute-set`, `product` and `product-variant`, the rules that keep them consistent (as wraps on its own actions) and the public read actions the storefront uses.
- `modules/search` and `modules/seo`: each keeps its own tables in step with the catalog through wraps on the catalog's write actions. Both run inside the call's transaction, so an index or a URL is never out of step with a committed write. Search sits behind a replaceable `searchEngine` service with a PostgreSQL default (spec 5.7).

**Tech Stack:** already in use, plus `sharp` (image decoding and re-encoding) and the PostgreSQL extensions `pg_trgm` and `unaccent` (both in the `postgres:17` image).

**Spec:** `docs/superpowers/specs/2026-11-15-ai-commerce-design.md`. The sections that matter most:

- 6 · M1, and 4.4 ("Schemas are channel-aware, translatable and multi-currency from M1");
- 3a ("Undo anything"), 3d (related products and search, with their non-AI fallbacks);
- 4.2 and 4.2a (resources, attributes, wraps, services);
- 5.1 (file uploads), 5.7 (adapters, cursors, the large data set);
- 13 (parity map) and 15 (Magento and Shopware lessons).

Also read `PROGRESS.md`, especially "Rules for code written on top of M0b", and the guides `docs/guides/resources.md` and `attributes.md`.

M1 is split into three plans. This is the first.

| Plan      | Covers                                                                                                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1a, this | Structured fields, media, catalog, search, SEO, sample data and the 1,000,000-product benchmark                                                                                                                                                                                         |
| M1b       | Dashboard (navigation, generated screens for every resource, settings, activity log, undo, command palette), storefront and default theme (home, category, search, product), inline editing                                                                                             |
| M1c       | AI: provider adapter (Gemini, then Claude and OpenAI by configuration), chat bar, tools from the registry, artifacts, confirm cards, trust levels, privacy digests, stand-ins, outbound log, locks, Private mode, writing help, meaning-based search and related products, MCP endpoint |

**Rulings in this plan.** Recorded in `docs/decisions/log.md` and Notion 10 when M1a closes.

- **Prices** are a list on the product and on a variant: `{ currency, amount, channel? }`, `amount` in minor units (cents). This is channel-aware and multi-currency without a separate table. The storefront in M1 shows the shop currency; showing others arrives in M6.
- **Translations** are a `translations` field: `{ [locale]: { name?, description?, ... } }`. Read actions return the requested locale with a fallback to the shop language. Managing languages arrives in M6.
- **Stock** waits for M2, with the cart (spec 4.4: one quantity per product behind the inventory interface).
- **Descriptions are Markdown**, never HTML, so a description cannot carry a script. The storefront renders a safe subset in M1b.
- **URLs:** a product is `/<slug>`, a category `/<parent-slug>/<slug>`. Both share one path table, so they can never collide. Reserved first segments: `api`, `admin`, `search`, `cart`, `checkout`, `account`, `media`, `_next`, `sitemap.xml`, `robots.txt`.
- **Facets:** every `public` `select` or `multiselect` attribute on `product` is a filter. A per-attribute "filterable" switch waits until a merchant asks for one.
- **Search language:** `english` text search configuration when the shop language is `en`, `simple` otherwise, with `unaccent`; `pg_trgm` for suggestions and typos.
- **Uploads go through an action**, as base64 in JSON, at most 10 MB decoded, so the chat and MCP can upload too.
- **The benchmark seed writes with SQL `COPY`**, not through actions. It is a development tool that refuses to run unless `AICOMMERCE_ALLOW_SEED=1`.

## Global Constraints

- Docker only: every command runs as `./dev <command>`. Nothing is installed on the host.
- Node 24, TypeScript `strict`, ES modules, package scope `@aicommerce/*`, MIT.
- New dependencies: pin an exact version published at least 14 days earlier; read its documentation for that version.
- One pull request per task, merged without asking once every check is green (`ci`, `e2e`, `image`, `audit`), never merged red. Never chain a merge after a local test run.
- No Claude or Anthropic attribution in commits or pull requests.
- Testing: unit tests for logic; integration tests against real PostgreSQL, one schema per test file, for every action (success, permission denied, invalid input); end-to-end tests for every user flow.
- `packages/core` imports no database, HTTP, auth, i18n or UI library.
- Every path to data goes through an action. Every public action (`permission: null`) is listed in `apps/server/security/public-actions.json` and returns only what a visitor may see: never a `draft` or `archived` product, never a disabled category or variant.
- Every field has a privacy class (spec 3g). Catalog fields are `public` unless stated.
- Lists are paginated by cursor; nothing loads a whole table (spec 5.7).
- Every visible string goes through `packages/i18n`; English and Persian.
- Off means absent: when `search` or `seo` is off, catalog writes still work, and switching the module back on is followed by `search.reindex` or `seo.rebuild`.
- The sample third-party module's contract test stays green.

## Review Focus

1. **Renaming a product twice, or back.** A → B → C makes both `/a` and `/b` redirect to `/c` in one hop; A → B → A leaves `/a` live and `/b` redirecting to `/a`, with no loop. (Task 5: `'renames redirect in one hop'`, `'renaming back removes the redirect'`)
2. **Names that are not ASCII.** A product named "پیراهن آبی" gets a usable slug, not an empty one, and searching "پیراهن" finds it. (Task 3: `'a Persian name gets a Persian slug'`; Task 4: `'Persian words are found'`)
3. **Something a product points to is gone.** A deleted media file, a merchant attribute deleted after a configurable product used it, a category that is now disabled: the public read actions still answer, without the missing part, instead of failing. (Task 3: `'product-view skips what no longer exists'`)
4. **A hostile upload.** HTML or an SVG with a script renamed to `.jpg`, a 30,000 × 30,000 pixel image, a truncated JPEG, more than 10 MB: each is refused with `invalid_input` and leaves no file and no row behind. (Task 2: `'refuses files that are not the images they claim'`, `'refuses a decompression bomb'`)
5. **Search input that breaks queries.** An empty query, only stop words, `"&|!:*()'`, a 10,000-character string, an unknown filter code, `limit: 10000`: each gives results or `invalid_input`, never a 500. (Task 4: `'search survives hostile input'`)

---

### Task 1: Structured fields, unique conflicts and swatches (`core`, `db`, `modules/system`)

Can run in parallel with Task 2.

**Files:**

- Modify:
  - `packages/core/src/resource.ts`: structured fields in the record and input schemas; `filterSchema` keeps skipping them.
  - `packages/db/src/resources.ts`: write structured values as `jsonb`; map unique violations.
  - `packages/core/src/attributes.ts`: `swatches`.
  - `modules/system/src/attributes.ts` and the attribute store in `packages/db/src/attributes.ts`.
- Create:
  - `packages/db/migrations/core/0008_attribute_swatches.sql` (use the next free number): `alter table attribute add column swatches jsonb`.
  - Tests next to each changed file.

**Interfaces:**

- Produces:
  - A resource field whose schema (after `.optional()` and `.default()`) is a `z.array`, `z.strictObject` or `z.record` is stored in a `jsonb` column and read back as the same value. Nested objects must still be `z.strictObject`.
  - On create, update and restore, a PostgreSQL unique violation (`23505`) becomes `ActionError('conflict', '<Label singular> with this <field> already exists')`. The field comes from the constraint name `<table>_<column>_key` (the default name for `unique` in a migration), in camelCase; with any other name, the message says "already exists" without a field.
  - `attributeInput.swatches?: Record<string, { color: string } | { file: string }>`: `color` matches `/^#[0-9a-f]{6}$/i`, `file` is a uuid (a media file). Allowed only for `select` and `multiselect`; every key must be one of `options`. `AttributeDefinition.swatches?` carries it, and `attribute.list` returns it.

- [ ] **Step 1: Write the failing tests.** Unit: `'structured fields are not filters'`. Integration, on a test resource with `tags: z.array(z.string())` and `size: z.strictObject({ w: z.number(), h: z.number() }).optional()`:
  - `'structured fields round-trip through create, update, history and restore'`;
  - `'update replaces a structured field as a whole'`;
  - `'a duplicate unique value is a conflict naming the field'` (code `conflict`, message contains "code");
  - `'swatches must name options'` (`invalid_input`, path `['swatches']`);
  - `'swatches round-trip through attribute.create and attribute.list'`.
- [ ] **Step 2: Run them.** `./dev pnpm test test:integration`. Expected: FAIL.
- [ ] **Step 3: Implement.** Decide "structured" once from the unwrapped Zod type (one helper used by both packages), and write it with the existing `json()` helper.
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration`. Expected: PASS. Update `docs/guides/resources.md` and `attributes.md` ("Rules that bite": structured fields replace as a whole; unique columns give `conflict`).
- [ ] **Step 5: Commit** `feat(core): structured resource fields, unique conflicts and swatches`, then open the PR and merge it.

### Task 2: Media uploads (`modules/media`, `apps/server`)

Can run in parallel with Task 1.

**Files:**

- Create:
  - `modules/media/` (package `@aicommerce/module-media`, the same layout as `modules/sample`): `src/index.ts`, `src/files.ts`, `src/images.ts`, `migrations/0001_media_file.sql`, unit and integration tests, and a few small fixture images under `src/fixtures/`.
- Modify:
  - `apps/server/src/wiring.ts`: add the module and its migrations.
  - `apps/server/src/server.ts`: the route `GET /api/media/:id/:width` (and its `bodyLimit` for `media.upload`).
  - `apps/server/security/public-actions.json`.

**Interfaces:**

- Produces:
  - Service `files = defineService<FileStore>('media.files')`, where `FileStore = { put(key: string, data: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | null>; delete(key: string): Promise<void> }`. The default is `createDiskFileStore(dir)`, with `dir` from `AICOMMERCE_FILES_DIR` (default `/var/lib/aicommerce/files`; the compose file and the image mount a volume there). Keys are `<id>/<width>.webp`; no key can leave `dir`.
  - Resource `media-file`: fields `filename` (max 255), `contentType` (`image/webp`), `width`, `height`, `bytes`, `sha256` (unique), `alt` (max 500, optional); all scalar, so this task does not wait for Task 1. The stored widths are `widthsFor(width: number): number[]`, exported: those of 320, 640, 1280 and 2048 below the original's width, plus the original's width capped at 2048. Created only through `media.upload`; the generated `media-file.create` is not exposed (give the resource a create permission no role holds, `media.internal`). `update` may change only `alt` and `filename`.
  - `media.upload` (write, permission `media.write`): input `{ filename, data: base64 string, alt? }` → the `media-file` record. Accepts JPEG, PNG, WebP, AVIF and GIF (first frame), detected from the bytes, never from the name or a declared type. At most 10 MB decoded and 50 megapixels. Strips all metadata (EXIF, GPS), re-encodes to WebP at `widthsFor(width)`, and keeps no original. The same bytes uploaded twice return the existing record.
  - `media.url(id: string, width: number): string` → `/api/media/<id>/<width>`, exported for the catalog and storefront.
  - `GET /api/media/:id/:width` (public): the nearest stored width at or above the one asked for; `content-type: image/webp`, `cache-control: public, max-age=31536000, immutable`, `x-content-type-options: nosniff`; 404 for an unknown id. It reads the record with the public action `media.file-info` (`{ id }` → `{ width }`), so the path to data stays an action.

- [ ] **Step 1: Write the failing tests.** Integration:
  - `'upload stores WebP at each width up to the original'` (a 1500 px wide PNG gives 320, 640, 1280, 1500; a 200 px one gives 200);
  - `'upload strips metadata'` (a JPEG with GPS EXIF comes back with none);
  - `'the same image twice returns one record'`;
  - `'refuses files that are not the images they claim'`: HTML named `.jpg`, an SVG with `<script>`, a truncated JPEG; each `invalid_input`, and no file and no row are left;
  - `'refuses a decompression bomb'`: a 30,000 × 30,000 PNG header;
  - `'refuses more than 10 MB'`;
  - `'disk keys cannot leave the files directory'` (unit, `../x`);
  - `'the media route serves the nearest width and 404s an unknown id'` (server integration);
  - permission denied and invalid input for `media.upload`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with `sharp`: `failOn: 'error'`, `limitInputPixels: 50_000_000`, `.rotate()` before resizing, `.webp({ quality: 82 })`. Write the files after the row is inserted and delete them if the call fails, so nothing is left when the transaction rolls back.
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration build`, and build the image (`docker build -f docker/Dockerfile .`): `sharp` must load in it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(media): image uploads, re-encoded and served`, then open the PR and merge it.

### Task 3: Catalog (`modules/catalog`)

After Tasks 1 and 2.

**Files:**

- Create: `modules/catalog/` (package `@aicommerce/module-catalog`): `src/index.ts`, `src/resources.ts`, `src/rules.ts` (the wraps), `src/views.ts` (public read actions), `src/slug.ts`, `src/localize.ts`, `migrations/0001_catalog.sql`, unit and integration tests.
- Modify: `apps/server/src/wiring.ts`, `apps/server/security/public-actions.json`, `packages/i18n` catalogs (labels).

**Interfaces:**

- Consumes: Task 1 structured fields and `conflict`; Task 2 `media-file` and `media.url`; `shopCurrency` and `shopLanguage` from `@aicommerce/module-setup`; the core `attributeStore` service.
- Produces, module `catalog` (`depends: ['media']`):
  - Shared field types, exported: `Price = { currency: string (ISO 4217, 3 upper-case letters); amount: number (int ≥ 0, minor units); compareAt?: number; channel?: string }`; `MediaEntry = { kind: 'image'; file: uuid; alt?: string } | { kind: 'video'; url: string (https, host youtube.com, youtu.be or vimeo.com) }`; `Link = { kind: 'related' | 'upsell' | 'crosssell'; product: uuid }`.
  - Resource `category`: `name`, `slug` (optional on input), `parentId?`, `position` (int, default 0), `enabled` (default true), `description?` (Markdown, max 50,000), `metaTitle?`, `metaDescription?`, `translations?`.
  - Resource `attribute-set`: `name` (unique), `codes: string[]` (attribute codes on `product`).
  - Resource `product` (`attributes: true`): `type: 'simple' | 'configurable'`, `sku` (unique, max 64), `name` (max 255), `slug?`, `status: 'draft' | 'active' | 'archived'` (default `draft`), `shortDescription?`, `description?`, `prices: Price[]`, `configurableAttributes?: string[]`, `categoryIds: uuid[]` (default `[]`), `media: MediaEntry[]` (default `[]`), `links: Link[]` (default `[]`), `attributeSetId?`, `metaTitle?`, `metaDescription?`, `translations?`.
  - Resource `product-variant`: `productId`, `sku`, `options: Record<code, option>`, `prices?: Price[]` (the product's when absent), `media: MediaEntry[]` (default `[]`), `enabled` (default true), `position` (default 0).
  - `translations` is `Record<locale, Partial<{ name, slug, shortDescription, description, metaTitle, metaDescription }>>`, locale matching `/^[a-z]{2}(-[A-Z]{2})?$/`.
  - The rules, as wraps on catalog's own `create`, `update` and `restore` actions (and `delete` where said):
    - `slug` defaults to `slugify(name)`; on a clash, `-2`, `-3`, and so on. `slugify(text: string): string` keeps Unicode letters and digits, lower-cases, and joins words with `-`; it falls back to `item` only when nothing is left.
    - SKUs are unique across products and variants, held by a `catalog_sku (sku text primary key)` table, so the guarantee does not depend on a race.
    - A `simple` product needs at least one price; `configurableAttributes` (1 to 3 codes of `select` attributes on `product`) is required for `configurable` and refused for `simple`.
    - At most one price per (currency, channel).
    - Every `categoryIds`, `file`, `links.product` and `attributeSetId` must exist; a product cannot link to itself.
    - A category cannot be its own ancestor; deleting a category with children or products is `conflict`, naming the count.
    - A variant's `options` must give exactly the parent's `configurableAttributes`, each an existing option, and no two variants of a product may have the same options (`conflict`).
    - Deleting a product deletes its variants through `product-variant.delete`, so each has a revision.
  - Public read actions (`permission: null`, `risk: 'read'`), each taking `locale?` (default the shop language) and `currency?` (default the shop currency), localized with `localize(record, locale, fallback)`:
    - `catalog.product-view { id }` → the active product with `price: { amount, currency, compareAt?, from: boolean }` (for a configurable product, the lowest enabled variant price, `from: true`), media with URLs, enabled variants with their options and swatches, `breadcrumbs` (the first enabled category's path), `specifications` (the attribute-set's attributes with values, labels included), and `related` (up to 8 cards: the product's `related` links, else active products from the same first category). Anything that no longer exists is left out.
    - `catalog.category-view { id }` → the enabled category, its enabled children and breadcrumbs.
    - `catalog.menu {}` → the enabled category tree to depth 3, ordered by `position`, then name.
  - `ProductCard = { id, slug, name, price, image?: { url, alt } }`, exported, and used by Task 4.

- [ ] **Step 1: Write the failing tests.** Unit: `'slugify'` (`'Blue Shirt!'` → `'blue-shirt'`); `'a Persian name gets a Persian slug'` (`'پیراهن آبی'` → `'پیراهن-آبی'`); `'localize falls back field by field'`. Integration, each through `app.call`:
  - `'create, update, delete and restore a product, with revisions'`;
  - `'a duplicate slug gets a suffix'`; `'a duplicate SKU is a conflict, across products and variants'`;
  - `'a simple product needs a price'`; `'a configurable product needs select attributes'`;
  - `'variants must give the parent options, once each'`;
  - `'references must exist'` (category, file, link, attribute set; a self-link);
  - `'a category cannot be its own ancestor'`; `'a category with products cannot be deleted'`;
  - `'deleting a product deletes its variants with revisions'`;
  - `'product-view hides drafts and archived products'` (`not_found`);
  - `'product-view gives the lowest variant price as from'`;
  - `'product-view localizes with a fallback'`;
  - `'product-view skips what no longer exists'` (a deleted media file, a deleted merchant attribute, a disabled category);
  - `'related falls back to the same category'`;
  - `'menu is the enabled tree in order'`;
  - permission denied and invalid input for each resource's `create`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Indexes in the migration: unique `sku` and `slug` on `catalog_product`, unique `slug` per `parent_id` on `catalog_category` (use `nulls not distinct`), `catalog_product_variant (product_id)`, and GIN on `catalog_product.category_ids`.
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration`. Expected: PASS. The contract test and the OpenAPI test still pass.
- [ ] **Step 5: Commit** `feat(catalog): products, variants, categories and attribute sets`, then open the PR and merge it.

### Task 4: Search (`modules/search`)

After Task 3. Can run in parallel with Task 5.

**Files:**

- Create: `modules/search/` (package `@aicommerce/module-search`): `src/index.ts`, `src/engine.ts` (the service and its PostgreSQL implementation), `src/sync.ts` (the wraps), `migrations/0001_search.sql`, tests.
- Modify: `apps/server/src/wiring.ts`, `apps/server/security/public-actions.json`.

**Interfaces:**

- Consumes: Task 3 resources, `ProductCard`, and the `catalog_*` tables (read only).
- Produces, module `search` (`depends: ['catalog']`):
  - Service `searchEngine = defineService<SearchEngine>('search.engine')`: `{ index(productIds: string[]): Promise<void>; remove(productIds: string[]): Promise<void>; query(q: SearchQuery): Promise<SearchResult>; suggest(q: string, locale: string): Promise<Suggestions> }`. The PostgreSQL implementation keeps a `search_document` table: product id, status, `tsv` per locale (name weight A, SKU and attribute values B, short description C, description D), category ids including ancestors, facet values (including those of enabled variants), prices and the sort keys.
  - Wraps keep it in step, in the same transaction: `product.*` writes index or remove that product; `product-variant.*` writes reindex the parent; `category.update` that changes `parentId` or `enabled` reindexes that category's products and its descendants' (in pages of 500).
  - `search.query` (public read): input `{ q?: string (max 200), categoryId?: uuid, filters?: Record<code, string[]> (at most 20 codes), price?: { min?: int; max?: int }, currency?, locale?, sort?: 'relevance' | 'price-asc' | 'price-desc' | 'name' | 'newest' (default `relevance`with`q`, else `newest`), cursor?, limit?: int 1..48 (default 24) }` → `{ items: ProductCard[]; total: number; facets: { code; label; options: { value; count; swatch? }[] }[]; nextCursor: string | null }`. Only active products. Filters are AND across codes and OR within one code; facet counts for a code ignore that code's own filter. The cursor is keyset on (sort value, id).
  - `search.suggest` (public read): `{ q: string (2..100), locale? }` → `{ products: { id, slug, name }[] (≤ 6); categories: { id, name }[] (≤ 4) }`, prefix and typo tolerant (`pg_trgm`).
  - `search.reindex` (write, permission `search.manage`): enqueues the job `search.rebuild`, which indexes every product in pages of 500 through the engine.

- [ ] **Step 1: Write the failing tests.** Integration:
  - `'a new active product is found at once'` and `'a draft is never found'`;
  - `'filters are AND across codes and OR within one'`;
  - `'facet counts ignore their own filter'`;
  - `'a variant colour is a filter on its product'`;
  - `'a category filter includes subcategories, and moving a category reindexes'`;
  - `'price sort and filter use the asked currency'`;
  - `'paging by cursor returns every match once'` (60 products, limit 24, each sort);
  - `'suggest tolerates a typo'` (`'shrit'` finds "Shirt");
  - `'Persian words are found'`;
  - `'search survives hostile input'` (the inputs in Review Focus 5);
  - `'a rolled-back product write leaves the index unchanged'`;
  - `'reindex rebuilds a wiped index'`;
  - permission denied for `search.reindex`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Build the `tsquery` with `websearch_to_tsquery` and add `:*` prefix matching on the last word; never build it by string concatenation. The migration creates `pg_trgm` and `unaccent` with `create extension if not exists`.
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(search): full-text search with filters, sorting and suggestions`, then open the PR and merge it.

### Task 5: SEO (`modules/seo`)

After Task 3. Can run in parallel with Task 4.

**Files:**

- Create: `modules/seo/` (package `@aicommerce/module-seo`): `src/index.ts`, `src/paths.ts` (the wraps), `src/meta.ts`, `src/json-ld.ts`, `src/sitemap.ts`, `migrations/0001_seo.sql`, tests.
- Modify: `apps/server/src/wiring.ts`, `apps/server/security/public-actions.json`.

**Interfaces:**

- Consumes: Task 3 resources and `catalog.product-view`.
- Produces, module `seo` (`depends: ['catalog']`):
  - Table `seo_path (path text primary key, locale text, kind text, record_id uuid)`: the live path of each active product and enabled category. Kept in step by wraps on `product.*` and `category.*` writes. A category's path change (slug or parent) moves its descendants too.
  - Resource `redirect` (permission `seo.write`): `from` (unique path), `to` (a path on this shop: starts with `/`, not `//`, no scheme, so it can never send a visitor elsewhere), `status: 301 | 302` (default 301), `auto: boolean`. When a live path changes, the wrap creates an `auto` redirect from the old path through `ctx.call('redirect.create')`, so it is audited and has a revision. Redirects pointing to the old path are repointed, so every redirect is one hop, and a redirect whose `from` becomes live again is deleted.
  - Creating a product or category whose path is taken, or starts with a reserved segment (see the rulings), is `conflict`, naming what holds it.
  - `seo.resolve` (public read): `{ path }` → `{ kind: 'product' | 'category'; id } | { kind: 'redirect'; to; status }`, or `not_found`.
  - `seo.meta` (public read): `{ kind, id, locale? }` → `{ title, description, canonical, robots }`. Title: `metaTitle`, else the name, then " | " and the shop name. Description: `metaDescription`, else the short description with Markdown removed, cut at a word to at most 160 characters.
  - `productJsonLd(view: ProductView, baseUrl: string): object` (schema.org `Product` with `Offer` or `AggregateOffer`) and `breadcrumbJsonLd(...)`, exported pure functions for the storefront.
  - `seo.sitemap` (public read): `{ page?: int ≥ 1 }` → `{ urls: { loc, lastmod }[]; pages: number }`, at most 50,000 URLs per page, ordered by path.
  - `seo.rebuild` (write, `seo.manage`): enqueues `seo.rebuild-paths`, which rebuilds `seo_path` from the catalog.

- [ ] **Step 1: Write the failing tests.** Unit: `'meta description is cut at a word'`; `'product JSON-LD uses AggregateOffer for variants'`. Integration:
  - `'resolve finds products and categories'`;
  - `'renames redirect in one hop'` (A → B → C);
  - `'renaming back removes the redirect'` (A → B → A);
  - `'a category rename moves its subcategories'`;
  - `'a taken or reserved path is a conflict'` (a product slug equal to a category path; `search`);
  - `'a redirect must point to a path on this shop'` (`https://evil.example`, `//evil.example`, `/\evil.example`: each `invalid_input`);
  - `'drafts and disabled categories have no live path'`;
  - `'sitemap pages hold at most 50,000 URLs'` (with a lowered limit passed in the test);
  - `'a rolled-back rename changes nothing'`;
  - `'rebuild restores the paths'`;
  - permission denied for `redirect.create`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seo): clean URLs, redirects, meta, structured data and sitemap`, then open the PR and merge it.

### Task 6: Sample data, offered on the setup page

After Tasks 4 and 5.

**Files:**

- Create: `modules/catalog/src/sample-data.ts` (+ integration test), `modules/catalog/src/sample-images.ts` (images drawn from SVG at install time, so no image files are shipped).
- Modify: `apps/admin/src/steps/` (the extras step), `apps/admin` messages (English and Persian), `e2e/` (the setup test).

**Interfaces:**

- Produces: `catalog.install-sample` (write, permission `catalog.manage`): creates, through `ctx.call` so search and SEO see them, the attributes `color` (with swatches) and `size`, an attribute set "Clothing", 8 categories in two levels, 30 simple and 6 configurable products (with 4 to 9 variants each), images, related links and a Persian translation of every name. A second call is `conflict` ("Sample data is already installed"). Returns the counts.
- The extras step gets the checkbox "Add sample products", off by default; when ticked, finishing setup calls `catalog.install-sample` after `setup.finish` and shows the counts on the done screen. If it fails, setup is still finished and the done screen says so with a retry.

- [ ] **Step 1: Write the failing tests.** Integration: `'install-sample creates a browsable catalog'` (`search.query` returns 36 active products; `seo.resolve` finds one; `catalog.menu` has 8 categories); `'install-sample twice is a conflict'`. E2E (desktop and mobile): `'setup with sample data shows the counts'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration` and `./dev e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): sample data from the setup page`, then open the PR and merge it.

### Task 7: The 1,000,000-product benchmark

After Task 4.

**Files:**

- Create: `packages/cli/src/commands/seed.ts`, `packages/cli/src/commands/bench.ts` (+ unit tests for argument parsing), `docs/benchmarks/m1a.md`.

**Interfaces:**

- `ai-commerce seed catalog --products <n>` (refuses without `AICOMMERCE_ALLOW_SEED=1`): writes `n` products (a tenth configurable with 4 variants each), 200 categories, 5 select attributes and their search documents with SQL `COPY`, in batches of 10,000, printing progress.
- `ai-commerce bench search`: runs 200 calls of each of five shapes through `app.call` (a keyword; a keyword with two filters; a category with price sort; a category, page 5 by cursor; `suggest`) and prints p50 and p95 per shape.
- Budget (spec 5.7) on 1,000,000 products: p95 under 300 ms for every `search.query` shape and under 100 ms for `suggest`.

- [ ] **Step 1: Write the failing tests** for argument parsing and the refusal without `AICOMMERCE_ALLOW_SEED`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, then seed 1,000,000 products in the dev database and run the benchmark.
- [ ] **Step 4: Record the numbers** in `docs/benchmarks/m1a.md`, with the machine. If a shape is over budget, fix the cause (an index, a plan) with the numbers before and after; a facet count may be estimated above 100,000 matches only if the result says so (`facetsEstimated: true`, added to `search.query`'s output with a test).
- [ ] **Step 5: Commit** `feat(cli): catalog seed and search benchmark`, then open the PR and merge it.

### Task 8: Guides, threat model, decisions, API QA

**Files:**

- Create: `docs/guides/catalog.md`, `media.md`, `search.md`, `seo.md` (each with a runnable example and "Rules that bite"); `docs/security/threat-model-m1a.md`.
- Modify: `docs/guides/README.md`, `docs/decisions/log.md` (this plan's rulings and the implementer rulings), `PROGRESS.md`.

- [ ] **Step 1: Write the guides and the threat model.** The threat model covers uploads (types, bombs, metadata, paths), public read actions (what a visitor can see), search input, redirects (no open redirect), and the cost of wraps on every catalog write.
- [ ] **Step 2: API QA** against `docker compose up server` with sample data: walk every public action with good and bad input, a rename chain, a large upload and a hostile one, and switching `search` and `seo` off and on followed by reindex and rebuild. Log each bug, fix it with a test, retest. File the report in Notion under 08 · Testing and QA. The browser QA gate runs at the end of M1, when there are screens.
- [ ] **Step 3: Run** `./dev pnpm format:check lint typecheck test test:integration` and `./dev e2e`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: M1a guides, threat model, decisions and QA report`, then open the PR and merge it.

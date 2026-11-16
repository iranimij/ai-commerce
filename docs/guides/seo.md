# SEO

The `seo` module gives every active product and visible category a clean URL, redirects the old
URL when one moves, and answers the storefront's questions about meta tags, structured data and
the sitemap. Code: [`modules/seo/src`](../../modules/seo/src), tests in
[`seo.integration.test.ts`](../../modules/seo/src/seo.integration.test.ts).

```ts
const call = (name: string, input: unknown) => app.registry.call(name, input, { actor })

const men = await call('category.create', { values: { name: 'Men' } }) // /men
await call('category.create', { values: { name: 'Shirts', parentId: men.output.id } }) // /men/shirts
const tee = await call('product.create', {
  values: { type: 'simple', sku: 'TEE', name: 'Tee', slug: 'a', status: 'active', prices },
}) // /a

// A new slug moves the page; the old path redirects in one hop, however often it moves.
await call('product.update', { id, version: 1, values: { slug: 'b' } }) // /a → /b
await call('product.update', { id, version: 2, values: { slug: 'c' } }) // /a → /c, /b → /c

// As a visitor (no permission needed):
await call('seo.resolve', { path: '/c' }) // { kind: 'product', id }
await call('seo.resolve', { path: '/a' }) // { kind: 'redirect', to: '/c', status: 301 }
await call('seo.meta', { kind: 'product', id }) // { title: 'Tee | Acme', description, canonical: '/c', robots }
await call('seo.sitemap', { page: 1 }) // { urls: [{ loc: '/c', lastmod }, ...], pages: 1 }

// In the storefront, from catalog.product-view's output:
productJsonLd(view, 'https://shop.example') // schema.org Product with Offer or AggregateOffer
breadcrumbJsonLd(view.breadcrumbs, 'https://shop.example', { name: view.name, slug: view.slug })
```

| Name                                | What it does                                                              | Permission                  |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| `redirect.*`                        | Redirects: `from` and `to` (paths on this shop), `status`, `auto`         | `seo.read`/`write`/`delete` |
| `seo.resolve`                       | `{ path }` → `{ kind, id }` or `{ kind: 'redirect', to, status }`         | public                      |
| `seo.meta`                          | `{ kind, id, locale? }` → `{ title, description, canonical, robots }`     | public                      |
| `seo.sitemap`                       | `{ page?, size? }` → `{ urls: { loc, lastmod }[], pages }`, by path       | public                      |
| `seo.rebuild`                       | Rebuilds every path in the background (job `seo.rebuild-paths`)           | `seo.manage`                |
| `seo.rebuild-paths`                 | The same, now, in one transaction                                         | `seo.manage`                |
| `productJsonLd`, `breadcrumbJsonLd` | Pure functions for the storefront's `<script type="application/ld+json">` | (code)                      |
| `describeText(markdown, max?)`      | Markdown as one line of plain text, cut at a word (default 160)           | (code)                      |

Tables: `seo_path` (`path` primary key, `kind`, `record_id`) holds the live paths, kept in step by
wraps (order 10, inside the catalog's own rules) on `product.*` and `category.*` writes, in the
same transaction. `seo_redirect` is the `redirect` resource.

## Rules that bite

- A product is `/<slug>`; a category is the slugs of its path, top first: `/men/shirts/linen`.
  Only an explicit new `slug` (or a new `parentId`) moves a page; renaming does not.
- Products and categories share `seo_path`, so a product slug equal to a top-level category's is
  `conflict`, naming who holds it. So is a first segment in `RESERVED` (`api`, `admin`, `search`,
  `cart`, `checkout`, `account`, `media`, ...), even for a generated slug: give another `slug`.
- Only active products and categories whose whole path is enabled have a path. A draft holds
  nothing, so publishing it is where a clash shows. Going out of sight (draft, archived, disabled,
  deleted) removes the path without a redirect.
- A moved page gets an `auto` redirect through `redirect.create`, as the same caller: the caller
  needs `seo.write`, or the move is `forbidden`. Redirects into the old path are repointed, so
  every redirect is one hop; a redirect whose `from` is live again is deleted (with a revision,
  not through the destructive `redirect.delete`). A to-and-back rename leaves no loop.
- A redirect's `to` and `from` start with `/`, never `//` or `/\`, and hold no spaces, backslashes
  or control characters: no scheme, no host, so it cannot send a visitor to another site. `from`
  cannot be a live page and `to` cannot lead back to `from`.
- `seo.resolve` accepts the path as typed or percent-encoded (`/%D9%BE...`), and checks the record
  is still visible. Paths and redirects are case-sensitive; a trailing `/` is another path.
- `canonical` and the sitemap's `loc` are paths: the storefront adds its own origin, as it passes
  `baseUrl` to the JSON-LD functions. The sitemap protocol allows 50,000 URLs per file.
- Title: `metaTitle`, else the name, then `|` and `shop.name`. Description: `metaDescription`
  as written, else the short description (the description for a category) as plain text, cut at a
  word to 160 characters.
- `AggregateOffer` covers the enabled variants with a price in the view's currency (low, high,
  count); a simple product gets one `Offer`; no price, no offer. Stock arrives in M2.
- Paths use the record's own slug. Translated slugs get paths when languages arrive (M6);
  `seo_path.locale` is null until then.
- Off means absent: with `seo` off, catalog writes still work but `seo_path` is not kept. After
  switching it back on, run `seo.rebuild`. A rebuild does not create redirects for what moved
  while it was off, and when a product's slug equals a top-level category's, the category wins.

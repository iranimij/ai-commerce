import type { Crumb, ProductView } from '@aicommerce/module-catalog'
import { describeText } from './meta.js'

const CONTEXT = 'https://schema.org'

/** A minor-unit amount as schema.org wants it: "19.00" for EUR, "1900" for JPY. */
function major(amount: number, currency: string): string {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  return (amount / 10 ** digits).toFixed(digits)
}

/**
 * schema.org `Product` for a product page: one `Offer`, or an `AggregateOffer` over the enabled
 * variants that have a price. `baseUrl` is the storefront's origin.
 */
export function productJsonLd(view: ProductView, baseUrl: string): Record<string, unknown> {
  const url = new URL(`/${view.slug}`, baseUrl).href
  const description = describeText(view.shortDescription ?? view.description ?? '')
  const images = view.media.flatMap((m) =>
    m.kind === 'image' ? [new URL(m.url, baseUrl).href] : [],
  )
  const prices = view.variants.flatMap((v) => (v.price ? [v.price] : []))
  const amounts = prices.map((p) => p.amount)
  const [first] = prices
  const offers =
    view.type === 'configurable' && first
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: first.currency,
          lowPrice: major(Math.min(...amounts), first.currency),
          highPrice: major(Math.max(...amounts), first.currency),
          offerCount: prices.length,
        }
      : view.price && {
          '@type': 'Offer',
          priceCurrency: view.price.currency,
          price: major(view.price.amount, view.price.currency),
          url,
        }
  return {
    '@context': CONTEXT,
    '@type': 'Product',
    name: view.name,
    sku: view.sku,
    ...(description && { description }),
    url,
    ...(images.length > 0 && { image: images }),
    ...(offers && { offers }),
  }
}

/**
 * schema.org `BreadcrumbList` from a view's breadcrumbs (top first), with the product last when
 * it is a product page.
 */
export function breadcrumbJsonLd(
  crumbs: readonly Crumb[],
  baseUrl: string,
  product?: { name: string; slug: string },
): Record<string, unknown> {
  const items = crumbs.map((c, i) => ({
    name: c.name,
    path: `/${crumbs
      .slice(0, i + 1)
      .map((x) => x.slug)
      .join('/')}`,
  }))
  if (product) items.push({ name: product.name, path: `/${product.slug}` })
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: new URL(item.path, baseUrl).href,
    })),
  }
}

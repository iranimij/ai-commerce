import type { ProductView } from '@aicommerce/module-catalog'
import { describe, expect, test } from 'vitest'
import { breadcrumbJsonLd, describeText, productJsonLd } from './index.js'

describe('meta', () => {
  test('meta description is cut at a word', () => {
    const text = 'Soft cotton shirt with long sleeves and a relaxed fit. '.repeat(5)
    const cut = describeText(`# Our shirt\n\n**${text}**`)
    expect(cut.length).toBeLessThanOrEqual(160)
    expect(cut).toMatch(/^Our shirt Soft cotton shirt .* \S+…$/)
    // Whole words only: the text without the ellipsis is a prefix ending at a word.
    const kept = cut.slice(0, -1)
    expect(`Our shirt ${text}`.startsWith(`${kept} `)).toBe(true)

    expect(describeText('Short and *sweet*.')).toBe('Short and sweet.')
    expect(
      describeText('![Front](/a.jpg) A [link](https://x.example) and `code`\n> quoted\n- item'),
    ).toBe('Front A link and code quoted item')
    // One word longer than the limit is cut inside it.
    expect(describeText('x'.repeat(300))).toHaveLength(160)
    expect(describeText('')).toBe('')
    // Hostile Markdown stays fast.
    const started = performance.now()
    describeText('![\\'.repeat(20_000) + '![]('.repeat(20_000) + '<'.repeat(20_000))
    expect(performance.now() - started).toBeLessThan(200)
  })
})

const view = (over: Partial<ProductView> = {}): ProductView => ({
  id: 'p1',
  type: 'simple',
  sku: 'TEE',
  slug: 'blue-tee',
  name: 'Blue Tee',
  shortDescription: 'A **soft** tee',
  price: { amount: 1900, currency: 'EUR', from: false },
  media: [
    { kind: 'image', id: 'f1', url: '/api/media/f1/1280', alt: 'Front', width: 800, height: 600 },
    { kind: 'video', url: 'https://youtu.be/x' },
  ],
  options: [],
  variants: [],
  breadcrumbs: [],
  specifications: [],
  related: [],
  ...over,
})

describe('structured data', () => {
  test('product JSON-LD uses AggregateOffer for variants', () => {
    const variant = (id: string, amount: number | null) => ({
      id,
      sku: id,
      options: { color: id },
      price: amount === null ? null : { amount, currency: 'EUR', from: false },
      media: [],
    })
    const ld = productJsonLd(
      view({
        type: 'configurable',
        price: { amount: 1900, currency: 'EUR', from: true },
        variants: [
          variant('red', 2500),
          variant('blue', 1900),
          variant('green', 1900),
          variant('none', null),
        ],
      }),
      'https://shop.example/',
    )
    expect(ld).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Blue Tee',
      sku: 'TEE',
      description: 'A soft tee',
      url: 'https://shop.example/blue-tee',
      image: ['https://shop.example/api/media/f1/1280'],
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'EUR',
        lowPrice: '19.00',
        highPrice: '25.00',
        offerCount: 3,
      },
    })
  })

  test('a simple product has one Offer, in the currency’s own decimals', () => {
    expect(productJsonLd(view(), 'https://shop.example').offers).toEqual({
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: '19.00',
      url: 'https://shop.example/blue-tee',
    })
    const yen = productJsonLd(
      view({ price: { amount: 1900, currency: 'JPY', from: false } }),
      'https://shop.example',
    )
    expect(yen.offers).toMatchObject({ price: '1900', priceCurrency: 'JPY' })
    // No price in the currency: no offer.
    expect(productJsonLd(view({ price: null }), 'https://shop.example')).not.toHaveProperty(
      'offers',
    )
    expect(productJsonLd(view({ slug: 'پیراهن' }), 'https://shop.example').url).toBe(
      'https://shop.example/%D9%BE%DB%8C%D8%B1%D8%A7%D9%87%D9%86',
    )
  })

  test('breadcrumb JSON-LD lists the category paths, then the product', () => {
    const crumbs = [
      { id: 'c1', slug: 'men', name: 'Men' },
      { id: 'c2', slug: 'shirts', name: 'Shirts' },
    ]
    expect(
      breadcrumbJsonLd(crumbs, 'https://shop.example', { name: 'Blue Tee', slug: 'blue-tee' }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Men', item: 'https://shop.example/men' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Shirts',
          item: 'https://shop.example/men/shirts',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Blue Tee',
          item: 'https://shop.example/blue-tee',
        },
      ],
    })
  })
})

import { ActionError, defineAction, settings, type HandlerErrorCode } from '@aicommerce/core'
import { shopCurrency } from '@aicommerce/module-setup'
import { z } from 'zod'
import { sampleImage, type Shape } from './sample-images.js'

const COLORS = {
  Black: '#1f2933',
  White: '#f5f5f4',
  Navy: '#1e3a5f',
  Red: '#b91c1c',
  Green: '#2f6b3a',
  Grey: '#8a8f98',
  Beige: '#d6c4a8',
  Yellow: '#e0b23b',
}
type Color = keyof typeof COLORS
const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const
type Size = (typeof SIZES)[number]

/** key, name, Persian name, parent key. Product names must not be "clothing" or "accessories". */
const CATEGORIES: [Shape | 'clothing' | 'accessories', string, string, string | null][] = [
  ['clothing', 'Clothing', 'پوشاک', null],
  ['tops', 'Tops', 'بالاپوش', 'clothing'],
  ['bottoms', 'Bottoms', 'پایین‌پوش', 'clothing'],
  ['outerwear', 'Outerwear', 'لباس بیرون', 'clothing'],
  ['accessories', 'Accessories', 'اکسسوری', null],
  ['bags', 'Bags', 'کیف', 'accessories'],
  ['hats', 'Hats', 'کلاه', 'accessories'],
  ['scarves', 'Scarves', 'شال و روسری', 'accessories'],
]

/** name, Persian name, category, price in minor units, color. */
const SIMPLE: [string, string, Shape, number, Color][] = [
  ['Classic Cotton Tee', 'تی‌شرت نخی کلاسیک', 'tops', 1900, 'White'],
  ['Striped Linen Shirt', 'پیراهن کتان راه‌راه', 'tops', 4900, 'Navy'],
  ['Oxford Button-Down', 'پیراهن آکسفورد', 'tops', 5500, 'White'],
  ['Relaxed Polo', 'پولوی راحت', 'tops', 3900, 'Green'],
  ['Merino Crew Sweater', 'پلیور یقه‌گرد مرینو', 'tops', 8900, 'Grey'],
  ['Ribbed Tank Top', 'تاپ کبریتی', 'tops', 1500, 'Black'],
  ['Slim Chinos', 'شلوار کتان جذب', 'bottoms', 5900, 'Beige'],
  ['Straight Leg Jeans', 'شلوار جین راسته', 'bottoms', 6900, 'Navy'],
  ['Pleated Wool Trousers', 'شلوار پشمی پیلی‌دار', 'bottoms', 9900, 'Grey'],
  ['Drawstring Joggers', 'شلوار اسلش بندی', 'bottoms', 4500, 'Black'],
  ['Denim Shorts', 'شلوارک جین', 'bottoms', 3500, 'Navy'],
  ['Quilted Vest', 'جلیقه‌ی لحافی', 'outerwear', 7900, 'Green'],
  ['Waxed Field Jacket', 'کاپشن واکسی', 'outerwear', 18900, 'Beige'],
  ['Wool Overcoat', 'پالتوی پشمی', 'outerwear', 24900, 'Black'],
  ['Packable Rain Shell', 'بارانی تاشو', 'outerwear', 9900, 'Yellow'],
  ['Canvas Tote', 'کیف پارچه‌ای', 'bags', 2500, 'Beige'],
  ['Leather Backpack', 'کوله‌پشتی چرمی', 'bags', 14900, 'Black'],
  ['Weekend Duffel', 'ساک سفر', 'bags', 11900, 'Navy'],
  ['Crossbody Pouch', 'کیف دوشی کوچک', 'bags', 3900, 'Red'],
  ['Laptop Sleeve', 'کاور لپ‌تاپ', 'bags', 2900, 'Grey'],
  ['Market Basket', 'سبد خرید', 'bags', 3400, 'Yellow'],
  ['Wool Beanie', 'کلاه بافتنی پشمی', 'hats', 2400, 'Red'],
  ['Canvas Bucket Hat', 'کلاه باکت', 'hats', 2900, 'Beige'],
  ['Baseball Cap', 'کلاه نقاب‌دار', 'hats', 1900, 'Navy'],
  ['Straw Sun Hat', 'کلاه حصیری', 'hats', 3900, 'Yellow'],
  ['Felt Fedora', 'کلاه شاپو', 'hats', 6900, 'Grey'],
  ['Cashmere Scarf', 'شال کشمیر', 'scarves', 12900, 'Grey'],
  ['Silk Square Scarf', 'روسری ابریشمی', 'scarves', 7900, 'Red'],
  ['Chunky Knit Scarf', 'شال‌گردن بافتنی', 'scarves', 4900, 'Green'],
  ['Cotton Bandana', 'دستمال‌گردن نخی', 'scarves', 900, 'White'],
]

/** name, Persian name, category, price, colors × sizes (each pair is a variant). */
const CONFIGURABLE: [string, string, Shape, number, Color[], Size[]][] = [
  ['Everyday Hoodie', 'هودی روزمره', 'tops', 5900, ['Grey', 'Navy'], ['S', 'M']],
  ['Heavyweight Sweatshirt', 'سویشرت ضخیم', 'tops', 6400, ['Black', 'Grey'], ['S', 'M', 'L']],
  [
    'Organic Pique Polo',
    'پولوی پیکه‌ی ارگانیک',
    'tops',
    4400,
    ['White', 'Navy', 'Green'],
    ['S', 'M', 'L'],
  ],
  ['Stretch Denim', 'شلوار جین کشی', 'bottoms', 7400, ['Navy', 'Black'], ['S', 'M', 'L', 'XL']],
  ['Puffer Jacket', 'کاپشن پف‌دار', 'outerwear', 16900, ['Black'], [...SIZES]],
  ['Linen Overshirt', 'اورشرت کتان', 'outerwear', 6900, ['Beige', 'Green', 'Navy'], ['M', 'L']],
]

const CLOTHING: readonly Shape[] = ['tops', 'bottoms', 'outerwear']
const HANDLER_CODES = new Set(['invalid_input', 'not_found', 'conflict', 'forbidden'])
const SKU = (n: number) => `SAMPLE-${String(n).padStart(3, '0')}`

const counts = z.object({
  attributes: z.number().int(),
  categories: z.number().int(),
  products: z.number().int(),
  variants: z.number().int(),
  images: z.number().int(),
})

export const installSample = defineAction({
  name: 'catalog.install-sample',
  description:
    'Add a sample catalog (clothing and accessories, with colours, sizes, images and Persian names) to try the shop with; once only',
  input: z.strictObject({}),
  output: counts,
  permission: 'catalog.manage',
  risk: 'write',
  handler: async (_input, ctx) => {
    // Every write goes through its action, so the catalog rules, search and seo all see it.
    const run = async (name: string, input: unknown) => {
      const result = await ctx.call(name, input)
      if (!result.ok) {
        const { code, message, issues } = result.error
        const message_ = `${name}: ${message}`
        if (!HANDLER_CODES.has(code)) throw new Error(message_)
        throw new ActionError(code as HandlerErrorCode, message_, issues)
      }
      return result.output as { id: string; items?: unknown[] }
    }
    const already = await run('product.list', { filter: { sku: SKU(1) }, limit: 1 })
    if (already.items?.length) throw new ActionError('conflict', 'Sample data is already installed')
    const currency = await ctx.service(settings).get(shopCurrency)
    if (!currency) throw new ActionError('conflict', 'Choose the shop currency first')
    return install(run, currency)
  },
})

type Run = (name: string, input: unknown) => Promise<{ id: string }>

async function install(run: Run, currency: string): Promise<z.infer<typeof counts>> {
  const attribute = { resource: 'product', type: 'select', privacy: 'public' }
  await run('attribute.create', {
    ...attribute,
    code: 'color',
    label: 'Color',
    options: Object.keys(COLORS),
    swatches: Object.fromEntries(Object.entries(COLORS).map(([name, color]) => [name, { color }])),
  })
  await run('attribute.create', { ...attribute, code: 'size', label: 'Size', options: SIZES })
  const set = await run('attribute-set.create', {
    values: { name: 'Clothing', codes: ['color', 'size'] },
  })

  const categories = new Map<string, string>()
  for (const [position, [key, name, fa, parent]] of CATEGORIES.entries()) {
    const { id } = await run('category.create', {
      values: {
        name,
        position,
        translations: { fa: { name: fa } },
        ...(parent && { parentId: categories.get(parent) }),
      },
    })
    categories.set(key, id)
  }

  let sku = 0
  let variants = 0
  const images = new Set<string>()
  const last = new Map<Shape, string>()
  const product = async (
    [name, fa, shape, amount, color]: [string, string, Shape, number, Color],
    extra: { values?: object; attributes?: object },
  ) => {
    const file = await run('media.upload', {
      filename: `${shape}-${String(sku + 1)}.png`,
      data: (await sampleImage(shape, COLORS[color], sku + 1)).toString('base64'),
      alt: name,
    })
    images.add(file.id)
    const previous = last.get(shape)
    const { id } = await run('product.create', {
      values: {
        sku: SKU(++sku),
        name,
        status: 'active',
        prices: [{ currency, amount }],
        categoryIds: [categories.get(shape)],
        media: [{ kind: 'image', file: file.id }],
        // Each one points to the one before it in its category.
        links: previous ? [{ kind: 'related', product: previous }] : [],
        ...(CLOTHING.includes(shape) && { attributeSetId: set.id }),
        translations: { fa: { name: fa } },
        ...extra.values,
      },
      ...(extra.attributes && { attributes: extra.attributes }),
    })
    last.set(shape, id)
    return id
  }

  for (const row of SIMPLE) {
    await product(row, { values: { type: 'simple' }, attributes: { color: row[4] } })
  }
  for (const [name, fa, shape, amount, colors, sizes] of CONFIGURABLE) {
    const parent = await product([name, fa, shape, amount, colors[0] ?? 'Black'], {
      values: { type: 'configurable', configurableAttributes: ['color', 'size'] },
    })
    const parentSku = SKU(sku)
    for (const color of colors) {
      for (const size of sizes) {
        await run('product-variant.create', {
          values: {
            productId: parent,
            sku: `${parentSku}-${color.toUpperCase()}-${size}`,
            options: { color, size },
            position: variants++,
          },
        })
      }
    }
  }
  return {
    attributes: 2,
    categories: CATEGORIES.length,
    products: sku,
    variants,
    images: images.size,
  }
}

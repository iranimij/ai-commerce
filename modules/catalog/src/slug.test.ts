import { expect, test } from 'vitest'
import { isSlug, slugify } from './slug.js'

test('slugify', () => {
  expect(slugify('Blue Shirt!')).toBe('blue-shirt')
  expect(slugify('  Café   au lait -- 2 ')).toBe('café-au-lait-2')
  expect(slugify('!!!')).toBe('item')
  expect(slugify('')).toBe('item')
  expect(slugify('x'.repeat(300))).toHaveLength(200)
  expect(isSlug('blue-shirt')).toBe(true)
  expect(isSlug('Blue-Shirt')).toBe(false)
  expect(isSlug('blue--shirt')).toBe(false)
  expect(isSlug('-blue')).toBe(false)
})

test('a Persian name gets a Persian slug', () => {
  expect(slugify('پیراهن آبی')).toBe('پیراهن-آبی')
  expect(isSlug('پیراهن-آبی')).toBe(true)
  // Persian digits are digits, and the zero-width non-joiner is not a letter.
  expect(slugify('کفش‌ها ۴۲')).toBe('کفش-ها-۴۲')
})

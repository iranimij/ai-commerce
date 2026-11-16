import { expect, test } from 'vitest'
import { defineModule } from './module.js'
import { dependentsOf, PRESETS, resolveModules } from './presets.js'

const all = [
  defineModule({ name: 'system', label: 'System', required: true }),
  defineModule({ name: 'access', label: 'Access', required: true }),
  defineModule({ name: 'catalog', label: 'Catalog' }),
  defineModule({ name: 'cart', label: 'Cart', depends: ['catalog'] }),
  defineModule({ name: 'checkout', label: 'Checkout', depends: ['cart'] }),
  defineModule({ name: 'blog', label: 'Blog' }),
]

test('resolveModules adds required modules and dependencies, and says why', () => {
  expect(resolveModules(all, ['checkout'])).toEqual({
    enabled: ['system', 'access', 'catalog', 'cart', 'checkout'],
    added: [
      { module: 'system', requiredBy: null },
      { module: 'access', requiredBy: null },
      { module: 'catalog', requiredBy: 'cart' },
      { module: 'cart', requiredBy: 'checkout' },
    ],
  })
  expect(resolveModules(all, ['system', 'access', 'blog']).added).toEqual([])
})

test('an unknown module is refused', () => {
  expect(() => resolveModules(all, ['nope'])).toThrow('Unknown module "nope"')
})

test('minimal is the required modules; full is every module', () => {
  expect(PRESETS.minimal(all)).toEqual(['system', 'access'])
  expect(PRESETS.full(all)).toEqual(['system', 'access', 'catalog', 'cart', 'checkout', 'blog'])
})

test('dependentsOf lists enabled modules that need it, directly or not', () => {
  const enabled = ['system', 'access', 'catalog', 'cart', 'checkout']
  expect(dependentsOf(all, enabled, 'catalog')).toEqual(['cart', 'checkout'])
  expect(dependentsOf(all, ['system', 'access', 'catalog'], 'catalog')).toEqual([])
})

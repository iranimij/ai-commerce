import { expect, test } from 'vitest'
import { localize } from './localize.js'

test('localize falls back field by field', () => {
  const record = {
    name: 'Shirt',
    description: 'Cotton',
    translations: { fa: { name: 'پیراهن' }, de: { name: 'Hemd', description: 'Baumwolle' } },
  }
  expect(localize(record, 'fa', 'de')).toEqual({ name: 'پیراهن', description: 'Baumwolle' })
  expect(localize(record, 'fa', 'en')).toEqual({ name: 'پیراهن', description: 'Cotton' })
  expect(localize(record, 'it', 'en')).toEqual({ name: 'Shirt', description: 'Cotton' })
  expect(localize({ name: 'Shirt' }, 'fa', 'en')).toEqual({ name: 'Shirt' })
})

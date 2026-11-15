import { expect, test } from 'vitest'
import { VERSION } from './index.js'

test('core exposes its version', () => {
  expect(VERSION).toBe('0.0.0')
})

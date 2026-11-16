import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { createSettingsReader, defineSetting, type SettingSource } from './settings.js'

const word = defineSetting({
  key: 'shop.word',
  module: 'shop',
  label: 'Word',
  schema: z.string().min(1),
  default: 'Hello',
  privacy: 'public',
  scope: 'channel',
})

const source = (rows: Record<string, unknown>): SettingSource => ({
  read: (key, channel) => {
    const id = channel ? `${key}@${channel}` : key
    return Promise.resolve(id in rows ? { value: rows[id] } : undefined)
  },
})

describe('settings reader', () => {
  test('the channel value wins, then the global value, then the default', async () => {
    const reader = createSettingsReader(source({ 'shop.word': 'Hi', 'shop.word@de': 'Hallo' }))
    expect(await reader.get(word, { channel: 'de' })).toBe('Hallo')
    expect(await reader.get(word, { channel: 'fr' })).toBe('Hi')
    expect(await reader.get(word)).toBe('Hi')
    expect(await createSettingsReader(source({})).get(word)).toBe('Hello')
  })

  test('a global setting ignores the channel', async () => {
    const global = defineSetting({ ...word, key: 'shop.global', scope: 'global' })
    const reader = createSettingsReader(source({ 'shop.global': 'G', 'shop.global@de': 'C' }))
    expect(await reader.get(global, { channel: 'de' })).toBe('G')
  })

  test('a stored value that no longer validates gives the default and is reported once', async () => {
    const onError = vi.fn()
    const reader = createSettingsReader(source({ 'shop.word': '' }), onError)
    expect(await reader.get(word)).toBe('Hello')
    expect(await reader.get(word)).toBe('Hello')
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('defineSetting', () => {
  test('a secret setting cannot have a default', () => {
    expect(() => defineSetting({ ...word, privacy: 'secret' })).toThrow(
      'Setting "shop.word" is secret and cannot have a default',
    )
  })

  test('the key must look like an action name, and the default must be valid', () => {
    expect(() => defineSetting({ ...word, key: 'word' })).toThrow('Invalid setting key "word"')
    expect(() => defineSetting({ ...word, default: '' })).toThrow()
  })

  test('permission defaults to setting.manage', () => {
    expect(word.permission).toBe('setting.manage')
  })
})

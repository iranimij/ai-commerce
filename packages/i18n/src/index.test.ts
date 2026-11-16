import { expect, test } from 'vitest'
import {
  createTranslator,
  defineMessages,
  directionOf,
  negotiateLocale,
  SUPPORTED_LOCALES,
} from './index.js'

const setup = defineMessages('setup', {
  title: 'Set up your shop',
  modules: '{count, plural, one {# module} other {# modules}}',
  hello: 'Hello, {name}',
})

test('t formats ICU arguments and plurals', () => {
  const { t } = createTranslator({ locale: 'en', catalogs: [setup] })
  expect(t('setup.modules', { count: 1 })).toBe('1 module')
  expect(t('setup.modules', { count: 3 })).toBe('3 modules')
  expect(t('setup.hello', { name: 'Ada' })).toBe('Hello, Ada')
})

test('a missing translation falls back to English and reports once', () => {
  const missing: string[] = []
  const { t } = createTranslator({
    locale: 'fa',
    catalogs: [setup],
    translations: { fa: { 'setup.title': 'فروشگاه خود را راه‌اندازی کنید' } },
    onMissing: (key, locale) => missing.push(`${locale}:${key}`),
  })
  expect(t('setup.title')).toBe('فروشگاه خود را راه‌اندازی کنید')
  expect(t('setup.hello', { name: 'Ada' })).toBe('Hello, Ada')
  expect(t('setup.hello', { name: 'Ada' })).toBe('Hello, Ada')
  expect(missing).toEqual(['fa:setup.hello'])
})

test('an unknown key throws', () => {
  const { t, has } = createTranslator({ locale: 'en', catalogs: [setup] })
  expect(() => t('nope.x')).toThrow('Unknown message key "nope.x"')
  expect(has('nope.x')).toBe(false)
  expect(has('setup.title')).toBe(true)
})

test('fa is rtl, en is ltr', () => {
  expect(directionOf('fa')).toBe('rtl')
  expect(directionOf('fa-IR')).toBe('rtl')
  expect(directionOf('en')).toBe('ltr')
  expect(createTranslator({ locale: 'fa', catalogs: [] }).dir).toBe('rtl')
  expect(SUPPORTED_LOCALES).toEqual(['en', 'fa'])
})

test('negotiateLocale picks fa-IR as fa and falls back to en', () => {
  expect(negotiateLocale('fa-IR,fa;q=0.9,en;q=0.8', SUPPORTED_LOCALES)).toBe('fa')
  expect(negotiateLocale('de-DE,fr;q=0.5', SUPPORTED_LOCALES)).toBe('en')
  expect(negotiateLocale('de;q=0.9,fa;q=0.5', SUPPORTED_LOCALES)).toBe('fa')
  expect(negotiateLocale(null, SUPPORTED_LOCALES)).toBe('en')
})

test('a translation with different ICU arguments than English is rejected', () => {
  expect(() =>
    createTranslator({
      locale: 'fa',
      catalogs: [setup],
      translations: { fa: { 'setup.hello': 'سلام {user}' } },
    }),
  ).toThrow('Translation fa "setup.hello" uses arguments {user}, English uses {name}')
})

test('two catalogs with the same namespace are rejected', () => {
  expect(() =>
    createTranslator({ locale: 'en', catalogs: [setup, defineMessages('setup', { x: 'x' })] }),
  ).toThrow('Message namespace "setup" is defined twice')
})

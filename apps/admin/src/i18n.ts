import { createTranslator, defineMessages, type Translator } from '@aicommerce/i18n'
import en from '../messages/en.json' with { type: 'json' }
import fa from '../messages/fa.json' with { type: 'json' }

export type T = Translator['t']

// The JSON files group keys by namespace; the translator wants `namespace.key`.
const catalogs = Object.entries(en).map(([namespace, keys]) => defineMessages(namespace, keys))
const flat = (messages: Record<string, Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(messages).flatMap(([ns, keys]) =>
      Object.entries(keys).map(([key, text]) => [`${ns}.${key}`, text]),
    ),
  )
const translations = { fa: flat(fa) }

export const translatorFor = (locale: string): Translator =>
  createTranslator({ locale, catalogs, translations })

export const LOCALE_COOKIE = 'aicommerce-locale'
export const THEME_COOKIE = 'aicommerce-theme'

/** First-party modules are translated here; any other module shows the label it ships with. */
export function moduleText(t: T, m: { name: string; label: string; description: string }) {
  return Object.hasOwn(en.modules, m.name)
    ? { label: t(`modules.${m.name}`), description: t(`modules.${m.name}Hint`) }
    : { label: m.label, description: m.description }
}

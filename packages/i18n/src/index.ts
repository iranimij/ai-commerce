import { IntlMessageFormat } from 'intl-messageformat'
import { directionOf } from './locales.js'

export { directionOf, negotiateLocale, SUPPORTED_LOCALES, type SupportedLocale } from './locales.js'

/** English messages of one namespace; keys are used as `namespace.key`. */
export interface MessageCatalog<M extends Record<string, string> = Record<string, string>> {
  namespace: string
  english: M
}

export function defineMessages<const M extends Record<string, string>>(
  namespace: string,
  english: M,
): MessageCatalog<M> {
  return { namespace, english }
}

export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>

export interface Translator {
  locale: string
  dir: 'ltr' | 'rtl'
  /** A property, not a method, so `const { t } = translator` works. */
  t: (key: string, values?: MessageValues) => string
  has: (key: string) => boolean
}

export interface TranslatorOptions {
  locale: string
  catalogs: MessageCatalog[]
  /** Per locale, `namespace.key` to the translated ICU message. */
  translations?: Record<string, Record<string, string>>
  /** Reported once per key and locale when a translation is missing. */
  onMissing?: (key: string, locale: string) => void
}

interface AstNode {
  type: number
  value?: string
  options?: Record<string, { value: AstNode[] }>
  children?: AstNode[]
}

// Argument names used anywhere in a message, including inside plural and select branches.
function argumentsOf(message: string, locale: string): string[] {
  const names = new Set<string>()
  const walk = (nodes: AstNode[]) => {
    for (const node of nodes) {
      // 0 is literal text and 7 is `#`; every other node type names an argument.
      if (node.type !== 0 && node.type !== 7 && typeof node.value === 'string')
        names.add(node.value)
      for (const option of Object.values(node.options ?? {})) walk(option.value)
      if (node.children) walk(node.children)
    }
  }
  walk(new IntlMessageFormat(message, locale).getAst())
  return [...names].sort()
}

export function createTranslator(options: TranslatorOptions): Translator {
  const { locale } = options
  const english = new Map<string, string>()
  for (const catalog of options.catalogs) {
    if ([...english.keys()].some((k) => k.startsWith(`${catalog.namespace}.`))) {
      throw new Error(`Message namespace "${catalog.namespace}" is defined twice`)
    }
    for (const [key, message] of Object.entries(catalog.english)) {
      english.set(`${catalog.namespace}.${key}`, message)
    }
  }
  const translated = options.translations?.[locale] ?? {}
  for (const [key, message] of Object.entries(translated)) {
    const source = english.get(key)
    if (source === undefined) continue
    const theirs = argumentsOf(message, locale)
    const ours = argumentsOf(source, 'en')
    if (theirs.join() !== ours.join()) {
      const list = (names: string[]) => names.map((n) => `{${n}}`).join(', ') || 'none'
      throw new Error(
        `Translation ${locale} "${key}" uses arguments ${list(theirs)}, English uses ${list(ours)}`,
      )
    }
  }

  const formatters = new Map<string, IntlMessageFormat>()
  const reported = new Set<string>()
  const formatter = (key: string): IntlMessageFormat => {
    let f = formatters.get(key)
    if (!f) {
      const source = english.get(key)
      if (source === undefined) throw new Error(`Unknown message key "${key}"`)
      const message = translated[key]
      if (message === undefined && locale !== 'en' && !reported.has(key)) {
        reported.add(key)
        options.onMissing?.(key, locale)
      }
      f =
        message === undefined
          ? new IntlMessageFormat(source, 'en')
          : new IntlMessageFormat(message, locale)
      formatters.set(key, f)
    }
    return f
  }

  return {
    locale,
    dir: directionOf(locale),
    t: (key, values) => String(formatter(key).format(values)),
    has: (key) => english.has(key),
  }
}

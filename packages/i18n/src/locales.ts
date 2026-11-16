/** Locales the product ships translations for. English is the source and the fallback. */
export const SUPPORTED_LOCALES = ['en', 'fa'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur', 'yi', 'ckb', 'dv', 'sd', 'ug'])

export function directionOf(locale: string): 'ltr' | 'rtl' {
  const language = (locale.split(/[-_]/)[0] ?? '').toLowerCase()
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'
}

/** The best supported locale for an Accept-Language header; English when nothing matches. */
export function negotiateLocale(
  acceptLanguage: string | null,
  supported: readonly string[],
): string {
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = Number(
        params
          .find((p) => p.trim().startsWith('q='))
          ?.trim()
          .slice(2) ?? 1,
      )
      return { tag: tag.toLowerCase(), q: Number.isFinite(q) ? q : 0, index }
    })
    .filter((w) => w.tag && w.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { tag } of wanted) {
    const exact = supported.find((s) => s.toLowerCase() === tag)
    if (exact) return exact
    const base = supported.find((s) => s.toLowerCase() === tag.split('-')[0])
    if (base) return base
  }
  return supported.includes('en') ? 'en' : (supported[0] ?? 'en')
}

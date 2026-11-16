import { negotiateLocale, SUPPORTED_LOCALES } from '@aicommerce/i18n'
import type { Theme } from '@aicommerce/ui'
import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, THEME_COOKIE } from '../src/i18n'

/** The language from the switcher's cookie, else Accept-Language; the theme from its cookie. */
export async function preferences(): Promise<{ locale: string; theme: Theme }> {
  const jar = await cookies()
  const chosen = jar.get(LOCALE_COOKIE)?.value ?? ''
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(chosen)
    ? chosen
    : negotiateLocale((await headers()).get('accept-language'), SUPPORTED_LOCALES)
  const theme = jar.get(THEME_COOKIE)?.value
  return { locale, theme: theme === 'light' || theme === 'dark' ? theme : 'system' }
}

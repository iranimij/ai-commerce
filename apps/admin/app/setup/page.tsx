import type { Metadata } from 'next'
import { translatorFor } from '../../src/i18n'
import { SetupFlow } from '../../src/SetupFlow'
import { preferences } from '../preferences'

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await preferences()
  return { title: translatorFor(locale).t('setup.title'), robots: { index: false } }
}

export default async function SetupPage() {
  const { locale, theme } = await preferences()
  return <SetupFlow locale={locale} theme={theme} />
}

import { directionOf } from '@aicommerce/i18n'
import type { ReactNode } from 'react'
import { preferences } from './preferences'
import './globals.css'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, theme } = await preferences()
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      {...(theme !== 'system' && { 'data-theme': theme })}
    >
      <body>{children}</body>
    </html>
  )
}

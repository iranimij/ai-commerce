import { createContext, useContext, type ReactNode } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type Direction = 'ltr' | 'rtl'

const UiContext = createContext<{ dir: Direction }>({ dir: 'ltr' })

export const useDirection = (): Direction => useContext(UiContext).dir

export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(' ')

export interface UiProviderProps {
  /** From the locale: `directionOf(locale)` in @aicommerce/i18n. */
  dir?: Direction
  /** `system` follows the operating system's setting. */
  theme?: Theme
  children: ReactNode
}

export function UiProvider({ dir = 'ltr', theme = 'system', children }: UiProviderProps) {
  return (
    <UiContext.Provider value={{ dir }}>
      <div
        dir={dir}
        {...(theme !== 'system' && { 'data-theme': theme })}
        className="bg-bg text-fg font-sans"
      >
        {children}
      </div>
    </UiContext.Provider>
  )
}

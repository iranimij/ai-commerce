'use client'
import { SUPPORTED_LOCALES } from '@aicommerce/i18n'
import {
  Card,
  Logo,
  Select,
  Spinner,
  Stepper,
  ThemeToggle,
  UiProvider,
  type Theme,
} from '@aicommerce/ui'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { action } from './api'
import { LOCALE_COOKIE, THEME_COOKIE, translatorFor } from './i18n'
import { DatabaseStep } from './steps/DatabaseStep'
import { DoneStep } from './steps/DoneStep'
import { ExtrasStep } from './steps/ExtrasStep'
import { FeaturesStep } from './steps/FeaturesStep'
import { OwnerStep, type Credentials } from './steps/OwnerStep'
import { ShopStep } from './steps/ShopStep'
import { TwoFactorStep } from './steps/TwoFactorStep'

interface Status {
  finished: boolean
  next: 'owner' | 'two-factor' | 'shop' | 'modules' | 'done'
  database: { ok: boolean; version: string | null }
}
type View =
  'database' | Exclude<Status['next'], 'done'> | 'extras' | 'done' | 'finished' | 'no-token'

const TOKEN_KEY = 'aicommerce-setup-token'
const STEP_OF: Record<View, string> = {
  database: 'database',
  'no-token': 'database',
  owner: 'owner',
  'two-factor': 'owner',
  shop: 'shop',
  modules: 'features',
  extras: 'extras',
  done: 'done',
  finished: 'done',
}

// sessionStorage throws when storage is blocked; the token then lives for this page only.
function takeToken(): string | null {
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('token')
  try {
    if (fromUrl) sessionStorage.setItem(TOKEN_KEY, fromUrl)
    else return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    // Keep going with the token from the URL.
  }
  // Out of the address bar, history and screenshots.
  url.searchParams.delete('token')
  window.history.replaceState(null, '', url)
  return fromUrl
}

const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`
}

export function SetupFlow({ locale, theme: initialTheme }: { locale: string; theme: Theme }) {
  const { t, dir } = useMemo(() => translatorFor(locale), [locale])
  const router = useRouter()
  const [theme, setTheme] = useState(initialTheme)
  // undefined until read in the browser.
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [status, setStatus] = useState<Status | null>(null)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [enabled, setEnabled] = useState<string[]>([])
  const main = useRef<HTMLElement>(null)

  const load = useCallback(async () => {
    setFailed(false)
    const result = await action<Status>('setup.status', {})
    if (!result.ok) {
      setFailed(true)
      return
    }
    const s = result.output
    setStatus(s)
    if (s.finished) {
      setView('finished')
      return
    }
    if (!token) {
      // Without the token only a signed-in owner (with 2FA) may go on.
      const me = (await fetch('/api/me')
        .then((r) => r.json())
        .catch(() => null)) as { permissions?: string[] } | null
      if (!me?.permissions?.includes('*')) {
        setView('no-token')
        return
      }
    }
    setView(s.next === 'owner' ? 'database' : s.next === 'done' ? 'finished' : s.next)
  }, [token])

  useEffect(() => {
    setToken(takeToken())
  }, [])
  useEffect(() => {
    if (token !== undefined) void load()
  }, [token, load])
  // Each new step is announced from its start, for keyboard and screen-reader users.
  useEffect(() => {
    if (view) main.current?.focus()
  }, [view])

  const chooseTheme = (next: Theme) => {
    setTheme(next)
    setCookie(THEME_COOKIE, next)
    if (next === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = next
  }
  const chooseLocale = (next: string) => {
    setCookie(LOCALE_COOKIE, next)
    // The server renders <html lang dir> again; this page's state is kept.
    router.refresh()
  }

  let content
  if (failed) {
    content = <DatabaseStep t={t} database={null} onContinue={() => undefined} onRetry={load} />
  } else if (view === null || token === undefined) {
    content = <Spinner label={t('common.loading')} />
  } else if (view === 'database') {
    content = (
      <DatabaseStep
        t={t}
        database={status?.database ?? null}
        onContinue={() => {
          setView('owner')
        }}
        onRetry={load}
      />
    )
  } else if (view === 'owner') {
    content = (
      <OwnerStep
        t={t}
        token={token}
        onCreated={(c) => {
          setCredentials(c)
          setView('two-factor')
        }}
      />
    )
  } else if (view === 'two-factor') {
    content = (
      <TwoFactorStep
        t={t}
        credentials={credentials}
        onDone={() => {
          setCredentials(null)
          setView('shop')
        }}
      />
    )
  } else if (view === 'shop') {
    content = (
      <ShopStep
        t={t}
        token={token}
        locale={locale}
        onSaved={() => {
          setView('modules')
        }}
      />
    )
  } else if (view === 'modules') {
    content = (
      <FeaturesStep
        t={t}
        token={token}
        onChosen={() => {
          setView('extras')
        }}
      />
    )
  } else if (view === 'extras') {
    content = (
      <ExtrasStep
        t={t}
        token={token}
        onFinished={(e) => {
          setEnabled(e)
          setView('done')
        }}
      />
    )
  } else if (view === 'done' || view === 'finished') {
    content = <DoneStep t={t} locale={locale} enabled={view === 'done' ? enabled : null} />
  } else {
    content = (
      <Card title={t('setup.noTokenTitle')}>
        <p>{t('setup.noTokenBody')}</p>
      </Card>
    )
  }

  return (
    <UiProvider dir={dir} theme={theme}>
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-3">
            <Logo label={t('common.brand')} wordmark={t('common.brand')} size={32} />
            <h1 className="text-2xl font-semibold">{t('setup.title')}</h1>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={t('common.language')}
              value={locale}
              onValueChange={chooseLocale}
              // Each language in its own name, so a reader finds theirs.
              options={SUPPORTED_LOCALES.map((l) => ({
                value: l,
                label: new Intl.DisplayNames([l], { type: 'language' }).of(l) ?? l,
              }))}
            />
            <ThemeToggle
              label={t('common.theme')}
              value={theme}
              onChange={chooseTheme}
              labels={{
                light: t('common.themeLight'),
                dark: t('common.themeDark'),
                system: t('common.themeSystem'),
              }}
            />
          </div>
        </header>
        <Stepper
          label={t('setup.steps')}
          current={view ? STEP_OF[view] : 'database'}
          steps={[
            { id: 'database', label: t('setup.stepDatabase') },
            { id: 'owner', label: t('setup.stepOwner') },
            { id: 'shop', label: t('setup.stepShop') },
            { id: 'features', label: t('setup.stepFeatures') },
            { id: 'extras', label: t('setup.stepExtras') },
            { id: 'done', label: t('setup.stepDone') },
          ]}
        />
        <main ref={main} tabIndex={-1} className="outline-none">
          {content}
        </main>
      </div>
    </UiProvider>
  )
}

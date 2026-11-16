import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { UiProvider } from '@aicommerce/ui'
import type { ReactElement } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import en from '../messages/en.json' with { type: 'json' }
import fa from '../messages/fa.json' with { type: 'json' }
import { translatorFor } from './i18n'
import { SetupFlow } from './SetupFlow'
import { DatabaseStep } from './steps/DatabaseStep'
import { DoneStep } from './steps/DoneStep'
import { ExtrasStep } from './steps/ExtrasStep'
import { FeaturesStep } from './steps/FeaturesStep'
import { OwnerStep } from './steps/OwnerStep'
import { ShopStep } from './steps/ShopStep'
import { TwoFactorStep } from './steps/TwoFactorStep'

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const { t } = translatorFor('en')

/** Answers each action by name; anything unlisted never answers, so a step stays loading. */
function stubActions(answers: Record<string, { status?: number; body: unknown }>) {
  const fetch = vi.fn((url: string) => {
    const answer = answers[url.replace(/^\/api\/(actions\/)?/, '')]
    if (!answer) return new Promise<Response>(() => undefined)
    return Promise.resolve(Response.json(answer.body, { status: answer.status ?? 200 }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sentTo = (fetch: ReturnType<typeof stubActions>, name: string): unknown => {
  const call = fetch.mock.calls.find(([url]) => url === `/api/actions/${name}`) as
    [string, RequestInit] | undefined
  return call && (JSON.parse(call[1].body as string) as { input: unknown }).input
}

const describedText = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ')

test('the features step ticks dependencies and says why', async () => {
  const module = (name: string, depends: string[] = [], required = false) => ({
    name,
    label: name.charAt(0).toUpperCase() + name.slice(1),
    description: `About ${name}`,
    enabled: required,
    required,
    depends,
  })
  const fetch = stubActions({
    'module.list': {
      body: {
        ok: true,
        output: [module('core', [], true), module('catalog', ['media']), module('media')],
      },
    },
    'setup.choose-modules': {
      body: { ok: true, output: { enabled: ['core', 'catalog', 'media'], added: [] } },
    },
  })
  const onChosen = vi.fn()
  render(<FeaturesStep t={t} token="the-token" onChosen={onChosen} />)
  const user = userEvent.setup()

  await user.click(screen.getByRole('radio', { name: new RegExp(t('features.custom')) }))
  await user.click(await screen.findByRole('checkbox', { name: 'Catalog' }))

  const media = screen.getByRole('checkbox', { name: 'Media' })
  expect(media.getAttribute('aria-checked')).toBe('true')
  expect(media.hasAttribute('disabled')).toBe(true)
  expect(describedText(media)).toContain(t('features.neededBy', { module: 'Catalog' }))

  const core = screen.getByRole('checkbox', { name: 'Core' })
  expect(core.getAttribute('aria-checked')).toBe('true')
  expect(describedText(core)).toContain(t('features.alwaysOn'))

  // Unticking the module that needed it frees the dependency again.
  await user.click(screen.getByRole('checkbox', { name: 'Catalog' }))
  expect(media.getAttribute('aria-checked')).toBe('false')
  expect(media.hasAttribute('disabled')).toBe(false)

  await user.click(screen.getByRole('checkbox', { name: 'Catalog' }))
  await user.click(screen.getByRole('button', { name: t('common.continue') }))
  await waitFor(() => {
    expect(onChosen).toHaveBeenCalled()
  })
  expect(sentTo(fetch, 'setup.choose-modules')).toEqual({
    token: 'the-token',
    modules: ['catalog'],
  })
})

test('the owner step shows server errors next to the right field', async () => {
  const fetch = stubActions({
    'setup.create-owner': {
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'Invalid input',
          issues: [{ path: ['email'], message: 'Invalid email address' }],
        },
      },
    },
  })
  render(<OwnerStep t={t} token="the-token" onCreated={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(t('owner.email')), 'owner@example')
  await user.type(screen.getByLabelText(t('owner.name')), 'Ada')
  await user.type(screen.getByLabelText(t('owner.password')), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: t('owner.submit') }))

  const email = screen.getByLabelText(t('owner.email'))
  await waitFor(() => {
    expect(email.getAttribute('aria-invalid')).toBe('true')
  })
  expect(describedText(email)).toContain(t('owner.emailInvalid'))
  expect(screen.getByLabelText(t('owner.name')).getAttribute('aria-invalid')).toBeNull()
  expect(screen.getByLabelText(t('owner.password')).getAttribute('aria-invalid')).toBeNull()
  expect(sentTo(fetch, 'setup.create-owner')).toEqual({
    token: 'the-token',
    email: 'owner@example',
    name: 'Ada',
    password: 'correct horse battery',
  })

  // A conflict is not about one field: it is said above the form.
  stubActions({
    'setup.create-owner': {
      status: 409,
      body: { ok: false, error: { code: 'conflict', message: 'An owner already exists' } },
    },
  })
  await user.click(screen.getByRole('button', { name: t('owner.submit') }))
  expect((await screen.findByRole('alert')).textContent).toContain(t('owner.exists'))
})

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })

const keysOf = (messages: Record<string, Record<string, string>>) =>
  new Set(
    Object.entries(messages).flatMap(([ns, keys]) => Object.keys(keys).map((k) => `${ns}.${k}`)),
  )

test('every message key used exists in en and fa', () => {
  const root = join(import.meta.dirname, '..')
  const used = new Set<string>()
  for (const file of [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'app'))]) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([^']+)'/g)) {
      used.add(match[1] ?? '')
    }
  }
  expect(used.size).toBeGreaterThan(40)
  const english = keysOf(en)
  const persian = keysOf(fa)
  expect([...used].filter((k) => !english.has(k))).toEqual([])
  expect([...used].filter((k) => !persian.has(k))).toEqual([])
  // A Persian key English does not have is stale.
  expect([...persian].filter((k) => !english.has(k))).toEqual([])
})

test('no step renders an untranslated string', () => {
  const keyPattern = new RegExp(`\\b(?:${Object.keys(en).join('|')})\\.[a-zA-Z]`)
  // Nothing answers, so each step shows its first screen.
  stubActions({})
  for (const locale of ['en', 'fa']) {
    const { t } = translatorFor(locale)
    const steps: ReactElement[] = [
      <DatabaseStep
        key="1"
        t={t}
        database={{ ok: true, version: '17.6' }}
        onContinue={vi.fn()}
        onRetry={vi.fn()}
      />,
      <DatabaseStep key="2" t={t} database={null} onContinue={vi.fn()} onRetry={vi.fn()} />,
      <OwnerStep key="3" t={t} token="x" onCreated={vi.fn()} />,
      <TwoFactorStep key="4" t={t} credentials={null} onDone={vi.fn()} />,
      <ShopStep key="5" t={t} token="x" locale={locale} onSaved={vi.fn()} />,
      <FeaturesStep key="6" t={t} token="x" onChosen={vi.fn()} />,
      <ExtrasStep key="7" t={t} token="x" onFinished={vi.fn()} />,
      <DoneStep key="8" t={t} locale={locale} enabled={['system', 'access']} />,
      <DoneStep key="9" t={t} locale={locale} enabled={null} />,
    ]
    for (const step of steps) {
      const { container, unmount } = render(
        <UiProvider dir={translatorFor(locale).dir}>{step}</UiProvider>,
      )
      const labels = [...container.querySelectorAll('[aria-label]')].map((e) =>
        e.getAttribute('aria-label'),
      )
      const text = [container.textContent, ...labels].join(' ')
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text).not.toMatch(keyPattern)
      unmount()
    }
  }
})

test('the setup-link hint names a service of the shop compose file', () => {
  const compose = readFileSync(
    join(import.meta.dirname, '../../../packages/create/templates/compose.yaml'),
    'utf8',
  )
  for (const messages of [en, fa]) {
    const service = /docker compose logs ([a-z-]+)/.exec(messages.setup.noTokenBody)?.[1]
    expect(compose).toMatch(new RegExp(`^  ${service ?? '(none)'}:$`, 'm'))
  }
})

// Found end to end: history.replaceState ran before Next.js took over the history, so the next
// router.refresh() (switching the language) put the token back into the address bar.
test('the token leaves the address bar through the router', async () => {
  window.history.replaceState(null, '', '/setup?token=the-token&x=1')
  stubActions({
    'setup.status': {
      body: { ok: true, output: { finished: false, next: 'owner', database: { ok: true } } },
    },
  })
  render(<SetupFlow locale="en" theme="system" />)
  await waitFor(() => {
    expect(router.replace).toHaveBeenCalledWith('/setup?x=1', { scroll: false })
  })
  expect(sessionStorage.getItem('aicommerce-setup-token')).toBe('the-token')
})

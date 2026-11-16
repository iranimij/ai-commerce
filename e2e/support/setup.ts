import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import type { Shop } from './shops'
import { totp } from './totp'

/** The admin's own strings, so the same steps run in any language. */
export type Messages = typeof import('../../apps/admin/messages/en.json')
export const messages = (locale: string): Messages =>
  JSON.parse(
    readFileSync(new URL(`../../apps/admin/messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Messages

export const OWNER = {
  email: 'owner@example.com',
  name: 'Shop Owner',
  password: 'a long and unguessable password',
}

export type Step =
  'database' | 'owner' | 'two-factor' | 'two-factor key' | 'shop' | 'features' | 'extras' | 'done'

const heading = (page: Page, text: string) => page.getByRole('heading', { name: text, exact: true })

/** Picks an option of a select, opened by its label: the named one, or the first. */
async function pick(page: Page, label: string, option?: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  if (option) await page.getByRole('option', { name: option, exact: true }).click()
  // Opening highlights the first option; Enter takes it, wherever the long list has scrolled to.
  else await page.keyboard.press('Enter')
}

type At = (step: Step) => Promise<void>
const nothing: At = () => Promise.resolve()

/** Turns on 2FA from the start of its step, signing in first after a reload. */
export async function turnOnTwoFactor(
  page: Page,
  m: Messages,
  { at = nothing, signIn = false }: { at?: At; signIn?: boolean } = {},
) {
  if (signIn) {
    await page.getByLabel(m.owner.email, { exact: true }).fill(OWNER.email)
    await page.getByLabel(m.owner.password, { exact: true }).fill(OWNER.password)
  }
  await page.getByRole('button', { name: m.twoFactor.start }).click()
  const key = page.locator('dd')
  await expect(key).toBeVisible()
  await at('two-factor key')
  await page.getByLabel(m.twoFactor.code, { exact: true }).fill(totp(await key.innerText()))
  await page.getByRole('button', { name: m.twoFactor.verify }).click()
}

/**
 * The whole setup page, from the printed link to done, as the owner would click it. `at` runs as
 * each step appears, before anything on it is touched.
 */
export async function install(
  page: Page,
  shop: Shop,
  {
    preset,
    locale = 'en',
    at = nothing,
  }: { preset: 'minimal' | 'full'; locale?: 'en' | 'fa'; at?: At },
) {
  const m = messages(locale)
  await page.goto(shop.link)
  if (locale !== 'en') {
    // The language menu lists each language in its own name.
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale
    await expect(heading(page, messages('en').database.title)).toBeVisible()
    await pick(page, messages('en').common.language, name)
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
  }
  // The token is kept for this tab only, never in the address bar, even after a language switch.
  await expect(page).not.toHaveURL(/token=/)
  await expect(heading(page, m.database.title)).toBeVisible()
  await at('database')
  await page.getByRole('button', { name: m.common.continue }).click()

  await expect(heading(page, m.owner.title)).toBeVisible()
  await at('owner')
  await page.getByLabel(m.owner.email, { exact: true }).fill(OWNER.email)
  await page.getByLabel(m.owner.name, { exact: true }).fill(OWNER.name)
  await page.getByLabel(m.owner.password, { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: m.owner.submit }).click()

  await expect(heading(page, m.twoFactor.title)).toBeVisible()
  await at('two-factor')
  await turnOnTwoFactor(page, m, { at })

  await expect(heading(page, m.shop.title)).toBeVisible()
  await at('shop')
  await page.getByLabel(m.shop.name, { exact: true }).fill('Orbit Goods')
  await pick(page, m.shop.country)
  await pick(page, m.shop.currency)
  await page.getByRole('button', { name: m.shop.submit }).click()

  await expect(heading(page, m.features.title)).toBeVisible()
  await at('features')
  await page
    .getByRole('radio', { name: preset === 'full' ? m.features.full : m.features.minimal })
    .check()
  await page.getByRole('button', { name: m.common.continue }).click()

  await expect(heading(page, m.extras.title)).toBeVisible()
  await at('extras')
  await page.getByRole('button', { name: m.extras.finish }).click()

  await expect(heading(page, m.done.title)).toBeVisible()
  await at('done')
}

/** Calls an action through the admin's /api, with the page's session, as the browser would. */
export type Result<O> = { ok: true; output: O } | { ok: false; error: { code: string } }

export async function call<O = unknown>(
  page: Page,
  shop: Shop,
  name: string,
  input: object,
  confirmed?: boolean,
): Promise<Result<O>> {
  const response = await page.request.post(`${shop.origin}/api/actions/${name}`, {
    data: { input, ...(confirmed !== undefined && { confirmed }) },
    headers: { origin: shop.origin },
  })
  return (await response.json()) as Result<O>
}

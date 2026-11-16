import type { Page } from '@playwright/test'
import { expectAccessible } from './support/axe'
import { call, install, messages, OWNER, turnOnTwoFactor } from './support/setup'
import { expect, test } from './support/shops'

const en = messages('en')
const PRESETS = {
  minimal: ['access', 'setup', 'system'],
  full: ['access', 'catalog', 'media', 'sample', 'seo', 'setup', 'system'],
}

for (const preset of ['minimal', 'full'] as const) {
  test(`a fresh install reaches a working shop with ${preset}`, async ({ page, shop }) => {
    await install(page, shop, { preset })
    const me: unknown = await (await page.request.get(`${shop.origin}/api/me`)).json()
    expect(me).toMatchObject({
      actor: { type: 'admin' },
      permissions: ['*'],
      twoFactorRequired: false,
    })
    const list = await call<{ name: string; enabled: boolean }[]>(page, shop, 'module.list', {})
    if (!list.ok) throw new Error(`module.list failed: ${list.error.code}`)
    expect(
      list.output
        .filter((m) => m.enabled)
        .map((m) => m.name)
        .sort(),
    ).toEqual(PRESETS[preset])
  })
}

test('the setup page without the token explains how to get it', async ({ page, untouched }) => {
  await page.goto(`${untouched.origin}/setup`)
  await expect(
    page.getByRole('heading', { name: en.setup.noTokenTitle, exact: true }),
  ).toBeVisible()
  // The service of the shop's compose.yaml (packages/create/templates).
  await expect(page.getByText('docker compose logs shop')).toBeVisible()
})

test('setup resumes after a reload at the 2FA step', async ({ page, shop }) => {
  await page.goto(shop.link)
  await page.getByRole('button', { name: en.common.continue }).click()
  await page.getByLabel(en.owner.email, { exact: true }).fill(OWNER.email)
  await page.getByLabel(en.owner.name, { exact: true }).fill(OWNER.name)
  await page.getByLabel(en.owner.password, { exact: true }).fill(OWNER.password)
  await page.getByRole('button', { name: en.owner.submit }).click()
  await expect(page.getByRole('heading', { name: en.twoFactor.title, exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: en.twoFactor.title, exact: true })).toBeVisible()
  await expect(page.getByText(en.twoFactor.signIn)).toBeVisible()
  await turnOnTwoFactor(page, en, { signIn: true })
  await expect(page.getByRole('heading', { name: en.shop.title, exact: true })).toBeVisible()
})

const noSideways = async (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('the setup page works right-to-left in Persian', async ({ page, shop }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await install(page, shop, {
    preset: 'full',
    locale: 'fa',
    at: async (step) => {
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      expect(await noSideways(page), `${step} scrolls sideways at 390 px`).toBe(true)
    },
  })
})

test('every setup step passes axe in light and dark', async ({ page, shop }) => {
  await install(page, shop, {
    preset: 'minimal',
    at: async (step) => {
      for (const theme of [en.common.themeLight, en.common.themeDark]) {
        await page.getByRole('button', { name: theme, exact: true }).click()
        await expectAccessible(page, `${step} in ${theme}`)
      }
    },
  })
})

test('after setup the page says setup is finished', async ({ page, browser, shop }) => {
  await install(page, shop, { preset: 'minimal' })
  // With the old link, and in a new browser with no session and no token.
  await page.goto(shop.link)
  await expect(
    page.getByRole('heading', { name: en.setup.finishedTitle, exact: true }),
  ).toBeVisible()
  const stranger = await browser.newPage()
  await stranger.goto(`${shop.origin}/setup`)
  await expect(
    stranger.getByRole('heading', { name: en.setup.finishedTitle, exact: true }),
  ).toBeVisible()
  await stranger.close()
})

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, type Page } from '@playwright/test'
import type { AxeResults } from 'axe-core'

const source = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/** Runs axe (WCAG 2.1 A and AA) on the page as it is and fails with every violation. */
export async function expectAccessible(page: Page, where: string) {
  // evaluate is not bound by the page's CSP, which would block an injected <script>.
  await page.evaluate(source)
  const results = await page.evaluate(() =>
    (window as unknown as { axe: { run: (options: object) => Promise<AxeResults> } }).axe.run({
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    }),
  )
  const violations = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
  expect(violations, where).toEqual([])
}

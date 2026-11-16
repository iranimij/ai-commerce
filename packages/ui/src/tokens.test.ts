import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')

// The custom properties declared in the first block whose selector matches.
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No block "${selector}"`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
  )
}

const brand = block(read('./brand.css'), ':root')
const tokens = read('./tokens.css')
const themes = {
  light: { ...brand, ...block(tokens, ":root,\n[data-theme='light']") },
  dark: { ...brand, ...block(tokens, "[data-theme='dark']") },
}

function hex(vars: Record<string, string>, name: string): string {
  let value = vars[name] ?? ''
  for (let i = 0; i < 5 && value.startsWith('var('); i++) value = vars[value.slice(4, -1)] ?? ''
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a hex colour: "${value}"`)
  return value
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Text colour on background colour.
const PAIRS = [
  ['--ai-fg', '--ai-bg'],
  ['--ai-fg', '--ai-surface'],
  ['--ai-muted', '--ai-bg'],
  ['--ai-muted', '--ai-surface'],
  ['--ai-accent', '--ai-surface'],
  ['--ai-accent', '--ai-bg'],
  ['--ai-accent-fg', '--ai-accent'],
  ['--ai-danger', '--ai-surface'],
  ['--ai-danger-fg', '--ai-danger'],
  ['--ai-success', '--ai-surface'],
  ['--ai-warning', '--ai-surface'],
  ['--ai-info', '--ai-surface'],
]

test.each(Object.entries(themes))('text contrast is at least 4.5:1 (%s)', (_theme, vars) => {
  const low = PAIRS.map(([fg = '', bg = '']) => [fg, bg, contrast(hex(vars, fg), hex(vars, bg))])
    .filter(([, , ratio]) => (ratio as number) < 4.5)
    .map(([fg, bg, ratio]) => `${String(fg)} on ${String(bg)}: ${(ratio as number).toFixed(2)}`)
  expect(low).toEqual([])
})

test('the dark theme also follows the system setting, with the same values', () => {
  expect(tokens).toMatch(
    /@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme='light'\]\)/,
  )
  expect(block(tokens, ":root:not([data-theme='light'])")).toEqual(
    block(tokens, "[data-theme='dark']"),
  )
})

test('tokens use logical properties only', () => {
  const css = read('./tokens.css') + read('./tailwind.css')
  expect(css).not.toMatch(/(margin|padding|border)-(left|right)|text-align:\s*(left|right)/)
})

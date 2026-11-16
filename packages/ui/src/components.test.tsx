import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { useState, type ReactNode } from 'react'
import { afterEach, expect, test } from 'vitest'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Logo,
  RadioCards,
  Select,
  Spinner,
  Stepper,
  TextField,
  ThemeToggle,
  UiProvider,
} from './index.js'

afterEach(cleanup)

test('TextField links its label, hint and error', () => {
  render(<TextField label="Shop name" hint="Shown to customers" error="Required" />)
  const input = screen.getByLabelText('Shop name')
  const described = (input.getAttribute('aria-describedby') ?? '').split(' ')
  const texts = described.map((id) => document.getElementById(id)?.textContent)
  expect(texts).toEqual(['Shown to customers', 'Required'])
  expect(input.getAttribute('aria-invalid')).toBe('true')
})

test('Button shows busy state and blocks double submit', async () => {
  let calls = 0
  let release: () => void = () => undefined
  const onClick = () => {
    calls++
    return new Promise<void>((resolve) => (release = resolve))
  }
  render(
    <Button onClick={onClick} busyLabel="Saving">
      Save
    </Button>,
  )
  const button = screen.getByRole('button', { name: /Save/ })
  const user = userEvent.setup()
  await user.click(button)
  await user.click(button)
  expect(calls).toBe(1)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(screen.getByRole('status').textContent).toBe('Saving')
  release()
  await screen.findByRole('button', { name: 'Save' })
  expect(button.getAttribute('aria-busy')).toBeNull()
})

test('Logo is named for screen readers and drops the orbit trail when small', () => {
  const { container } = render(
    <>
      <Logo label="AI Commerce" size={128} />
      <Logo label="AI Commerce" size={24} wordmark="AI Commerce" />
    </>,
  )
  const [large, small] = screen.getAllByRole('img', { name: 'AI Commerce' })
  expect(large?.querySelector('[data-part=trail]')).not.toBeNull()
  expect(small?.querySelector('[data-part=trail]')).toBeNull()
  expect(container.textContent).toBe('AI Commerce')
})

function Presets() {
  const [value, setValue] = useState('minimal')
  return (
    <RadioCards
      label="Start with"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'minimal', title: 'Minimal', description: 'Only what every shop needs' },
        { value: 'full', title: 'Full', description: 'Every module' },
      ]}
    />
  )
}

test('RadioCards is keyboard operable with arrow keys', async () => {
  render(<Presets />)
  const user = userEvent.setup()
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Minimal/ }))
  // Held down, as in a browser: the group moves focus a tick later and checks while the key is down.
  await user.keyboard('{ArrowDown>}')
  const full = screen.getByRole('radio', { name: /Full/ })
  await waitFor(() => {
    expect(full.getAttribute('aria-checked')).toBe('true')
  })
  await user.keyboard('{/ArrowDown}')
  expect(document.activeElement).toBe(full)
})

function Everything() {
  return (
    <>
      <Button>Go</Button>
      <Button variant="secondary">Back</Button>
      <Button variant="danger">Delete</Button>
      <TextField label="Email" hint="We never share it" />
      <TextField label="Password" error="Too short" type="password" />
      <Select
        label="Country"
        value="NL"
        onValueChange={() => undefined}
        options={[
          { value: 'NL', label: 'Netherlands' },
          { value: 'DE', label: 'Germany' },
        ]}
      />
      <Checkbox label="Send me updates" checked={false} onCheckedChange={() => undefined} />
      <Presets />
      <Alert tone="info" title="Note">
        Saved
      </Alert>
      <Alert tone="danger" title="Error">
        Failed
      </Alert>
      <Card title="Shop">Body</Card>
      <Stepper
        label="Setup steps"
        current="shop"
        steps={[
          { id: 'owner', label: 'Owner' },
          { id: 'shop', label: 'Shop' },
          { id: 'modules', label: 'Modules' },
        ]}
      />
      <Spinner label="Loading" />
      <Logo label="AI Commerce" wordmark="AI Commerce" />
      <EmptyState title="No orders yet" description="They will show here" />
      <ThemeToggle
        label="Theme"
        value="system"
        onChange={() => undefined}
        labels={{ light: 'Light', dark: 'Dark', system: 'System' }}
      />
    </>
  )
}

const variants: [string, (c: ReactNode) => ReactNode][] = [
  ['light', (c) => <UiProvider theme="light">{c}</UiProvider>],
  ['dark', (c) => <UiProvider theme="dark">{c}</UiProvider>],
  [
    'rtl',
    (c) => (
      <UiProvider theme="light" dir="rtl">
        {c}
      </UiProvider>
    ),
  ],
]

test.each(variants)('every component passes axe: %s', async (_name, wrap) => {
  const { container } = render(<main>{wrap(<Everything />)}</main>)
  // jsdom has no layout, so contrast is checked from the token values in tokens.test.ts.
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(result.violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`)).toEqual([])
})

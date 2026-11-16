import { expect, test } from 'vitest'
import { supervise } from './supervisor.js'

const node = (code: string) => ({ name: 'child', command: process.execPath, args: ['-e', code] })
const forever = node(`process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)`)

test('the supervisor stops the others and fails when a child dies', async () => {
  const { done } = supervise([node('setTimeout(() => process.exit(3), 100)'), forever])
  expect(await done).toBe(3)
})

test('a child that exits cleanly on its own is still a failure', async () => {
  const { done } = supervise([node(''), forever])
  expect(await done).toBe(1)
})

test('the supervisor stops its children on SIGTERM', async () => {
  const { stop, done } = supervise([forever, forever])
  setTimeout(() => {
    stop('SIGTERM')
  }, 200)
  expect(await done).toBe(0)
})

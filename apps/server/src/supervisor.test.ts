import { expect, test } from 'vitest'
import { processes, supervise } from './supervisor.js'

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

test('with the admin, it takes the public PORT and proxies to the server on the next port', () => {
  const [server, admin] = processes({ PORT: '8080' }, 'main.js', 'admin.js')
  expect(server).toMatchObject({ name: 'server', args: ['main.js'], env: { PORT: '8081' } })
  expect(admin).toMatchObject({
    name: 'admin',
    args: ['admin.js'],
    env: { PORT: '8080', HOSTNAME: '0.0.0.0', AICOMMERCE_SERVER_URL: 'http://127.0.0.1:8081' },
  })
})

test('without the admin, or as a worker, only the server runs, on PORT', () => {
  expect(processes({}, 'main.js', null)).toEqual([
    { name: 'server', command: process.execPath, args: ['main.js'], env: {} },
  ])
  expect(processes({ AICOMMERCE_ROLE: 'worker' }, 'main.js', 'admin.js')).toHaveLength(1)
})

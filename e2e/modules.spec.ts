import { call, install } from './support/setup'
import { expect, test } from './support/shops'

test('sample off and on keeps its notes', async ({ page, shop }) => {
  await install(page, shop, { preset: 'full' })
  const titles = async () => {
    const result = await call<{ items: { title: string }[] }>(page, shop, 'note.list', {})
    return result.ok ? result.output.items.map((n) => n.title) : result.error.code
  }
  expect(await call(page, shop, 'note.create', { values: { title: 'Keep me' } })).toMatchObject({
    ok: true,
  })

  // Destructive: the API asks for a confirmation.
  expect(await call(page, shop, 'module.disable', { name: 'sample' })).toMatchObject({
    ok: false,
    error: { code: 'confirmation_required' },
  })
  expect(await call(page, shop, 'module.disable', { name: 'sample' }, true)).toMatchObject({
    ok: true,
  })
  // Every process reloads its modules when it hears the change.
  await expect.poll(titles).toBe('not_found')

  expect(await call(page, shop, 'module.enable', { name: 'sample' })).toMatchObject({ ok: true })
  await expect.poll(titles).toEqual(['Keep me'])
})

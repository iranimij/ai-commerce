import type { ResourceRecord } from '@aicommerce/core'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { BASE, createTestServer } from './testkit.js'

let t: Awaited<ReturnType<typeof createTestServer>>

beforeAll(async () => {
  t = await createTestServer({ modules: ['system', 'access', 'media'] })
})
afterAll(async () => {
  await t.stop()
  await t.database.drop()
})

const get = (path: string) => t.server.request(`${BASE}${path}`)

test('the media route serves the nearest width and 404s an unknown id', async () => {
  const png = await sharp({
    create: { width: 1500, height: 20, channels: 3, background: '#336699' },
  })
    .png()
    .toBuffer()
  const result = await t.app.registry.call(
    'media.upload',
    { filename: 'wide.png', data: png.toString('base64') },
    { actor: { type: 'admin', id: 'admin-1', permissions: new Set(['media.write']) } },
  )
  if (!result.ok) throw new Error(result.error.message)
  const { id } = result.output as ResourceRecord

  for (const [asked, served] of [
    [100, 320],
    [320, 320],
    [500, 640],
    [1400, 1500],
    [4000, 1500],
  ]) {
    const response = await get(`/api/media/${id}/${String(asked)}`)
    expect(response.status, String(asked)).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: served })
  }

  for (const path of [
    '/api/media/00000000-0000-4000-8000-000000000000/320',
    '/api/media/not-a-uuid/320',
    `/api/media/${id}/0`,
    `/api/media/${id}/abc`,
    `/api/media/${id}/99999`,
  ]) {
    const response = await get(path)
    expect(response.status, path).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

test('media.upload takes a body over 1 MiB; other actions do not', async () => {
  const body = { input: { filename: 'x.png', data: 'A'.repeat(2_000_000) } }
  // Through the body limit, then refused: guests cannot upload.
  expect((await t.post('/api/actions/media.upload', body)).status).toBe(401)
  expect((await t.post('/api/actions/media.file-info', body)).status).toBe(413)
  const huge = { input: { filename: 'x.png', data: 'A'.repeat(15 * 1024 * 1024) } }
  expect((await t.post('/api/actions/media.upload', huge)).status).toBe(413)
})

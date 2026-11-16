import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import {
  attributeStore,
  createApp,
  guestActor,
  provide,
  resourceStore,
  type Actor,
  type ResourceRecord,
  type Result,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgAttributeStore,
  createPgResourceStore,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { createDiskFileStore, files, media, mediaMigrations, type FileStore } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
let dir: string
// Set to make the next put throw, as a full disk would.
let failPut = 0
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, mediaMigrations], { log: () => undefined })
  dir = await mkdtemp(join(tmpdir(), 'media-'))
  const disk = createDiskFileStore(dir)
  const flaky: FileStore = {
    ...disk,
    put: (key, data) => {
      if (failPut > 0 && --failPut === 0) return Promise.reject(new Error('Disk full'))
      return disk.put(key, data)
    },
  }
  app = createApp({
    modules: [media],
    enabled: ['media'],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(files, 'app', flaky),
    ],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  failPut = 0
  await database.client`truncate media_media_file`
  await rm(dir, { recursive: true, force: true })
})

const call = (name: string, input: unknown, actor: Actor = admin) =>
  app.registry.call(name, input, { actor })

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T = ResourceRecord>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
const noisy = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
const upload = (data: Uint8Array, filename = 'photo.png', actor: Actor = admin) =>
  call('media.upload', { filename, data: Buffer.from(data).toString('base64') }, actor)

/** Every file under the files directory, relative to it. */
async function stored(): Promise<string[]> {
  try {
    return (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
      .sort()
  } catch {
    return []
  }
}
const rows = async () =>
  Number((await database.client`select count(*)::int as n from media_media_file`)[0]?.n)

/** A PNG that claims the given size: a valid header and almost no pixel data. */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(1 + width * 3))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('upload stores WebP at each width up to the original', async () => {
  const wide = output(await upload(await solid(1500, 100).png().toBuffer()))
  expect(wide).toMatchObject({
    filename: 'photo.png',
    contentType: 'image/webp',
    width: 1500,
    height: 100,
    version: 1,
  })
  const small = output(await upload(await solid(200, 50).png().toBuffer(), 'small.png'))
  expect(await stored()).toEqual(
    [
      `${wide.id}/1280.webp`,
      `${wide.id}/1500.webp`,
      `${wide.id}/320.webp`,
      `${wide.id}/640.webp`,
      `${small.id}/200.webp`,
    ].sort(),
  )
  for (const width of [320, 640, 1280, 1500]) {
    const meta = await sharp(await readFile(join(dir, wide.id, `${String(width)}.webp`))).metadata()
    expect(meta).toMatchObject({ format: 'webp', width })
  }
  // No original is kept.
  expect((await stored()).every((f) => f.endsWith('.webp'))).toBe(true)
})

test('upload strips metadata', async () => {
  const jpeg = await noisy(400, 300)
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Someone' }, IFD3: { GPSLatitudeRef: 'N' } })
    .toBuffer()
  expect((await sharp(jpeg).metadata()).exif).toBeDefined()
  const file = output(await upload(jpeg, 'gps.jpg'))
  const meta = await sharp(await readFile(join(dir, file.id, '400.webp'))).metadata()
  expect(meta.format).toBe('webp')
  expect(meta.exif).toBeUndefined()
  expect(meta.xmp).toBeUndefined()
  expect(meta.iptc).toBeUndefined()
})

test('upload turns the image the way its EXIF orientation says', async () => {
  // 300 wide as stored, 200 wide once turned (orientation 6: rotate 90 degrees).
  const jpeg = await solid(300, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const file = output(await upload(jpeg, 'turned.jpg'))
  expect(file).toMatchObject({ width: 200, height: 300 })
  expect(await stored()).toEqual([`${file.id}/200.webp`])
})

test('accepts JPEG, PNG, WebP, AVIF and GIF', async () => {
  const image = () => noisy(64, 48)
  for (const data of [
    await image().jpeg().toBuffer(),
    await image().png().toBuffer(),
    await image().webp().toBuffer(),
    await image().avif().toBuffer(),
    await image().gif().toBuffer(),
  ]) {
    expect(output(await upload(data, 'any.bin'))).toMatchObject({ width: 64, height: 48 })
  }
  expect(await rows()).toBe(5)
})

test('the same image twice returns one record', async () => {
  const png = await solid(300, 300).png().toBuffer()
  const first = output(await upload(png, 'one.png'))
  const second = output(await upload(png, 'two.png'))
  expect(second).toEqual(first)
  expect(await rows()).toBe(1)
})

test('refuses files that are not the images they claim', async () => {
  const jpeg = await noisy(400, 400).jpeg().toBuffer()
  const tiff = await noisy(20, 20).tiff().toBuffer()
  for (const [name, data] of [
    ['page.jpg', Buffer.from('<!doctype html><html><script>alert(1)</script></html>')],
    [
      'logo.jpg',
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
      ),
    ],
    ['cut.jpg', jpeg.subarray(0, Math.floor(jpeg.length / 2))],
    ['scan.png', tiff],
    ['empty.png', Buffer.alloc(0)],
  ] as const) {
    expect(await upload(data, name), name).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })
  }
  expect(await rows()).toBe(0)
  expect(await stored()).toEqual([])
})

test('refuses a decompression bomb', async () => {
  const bomb = pngHeader(30_000, 30_000)
  expect((await sharp(bomb, { limitInputPixels: false }).metadata()).width).toBe(30_000)
  expect(await upload(bomb, 'bomb.png')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input', message: expect.stringContaining('megapixels') as unknown },
  })
  expect(await rows()).toBe(0)
  expect(await stored()).toEqual([])
})

test('refuses more than 10 MB', async () => {
  expect(await upload(Buffer.alloc(10 * 1024 * 1024 + 1, 1), 'big.png')).toMatchObject({
    ok: false,
    error: { code: 'invalid_input', message: expect.stringContaining('10 MB') as unknown },
  })
  expect(await rows()).toBe(0)
})

test('a failed file write leaves no file and no row', async () => {
  failPut = 2
  expect(await upload(await solid(1000, 10).png().toBuffer())).toMatchObject({
    ok: false,
    error: { code: 'handler_error' },
  })
  expect(await rows()).toBe(0)
  expect(await stored()).toEqual([])
})

test('media.upload: permission denied and invalid input', async () => {
  const png = await solid(10, 10).png().toBuffer()
  const reader: Actor = { type: 'admin', id: 'r', permissions: new Set(['media.read']) }
  for (const actor of [guestActor, reader]) {
    expect(await upload(png, 'x.png', actor)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  }
  for (const input of [
    { data: png.toString('base64') },
    { filename: '', data: png.toString('base64') },
    { filename: 'x.png', data: 'not base64!' },
    { filename: 'x.png', data: png.toString('base64'), alt: 'a'.repeat(501) },
  ]) {
    expect(await call('media.upload', input)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })
  }
  expect(await rows()).toBe(0)
})

test('the upload is audited without its data', async () => {
  output(await upload(await solid(10, 10).png().toBuffer(), 'a.png'))
  const [audit] = await database.client`select * from audit_log order by id desc limit 1`
  expect(audit).toMatchObject({ action: 'media.upload', outcome: 'ok' })
  expect(JSON.stringify(audit?.input)).not.toContain('iVBOR')
})

test('media-file.create is refused; update changes only alt and filename', async () => {
  expect(
    await call('media-file.create', {
      values: {
        filename: 'x.webp',
        contentType: 'image/webp',
        width: 1,
        height: 1,
        bytes: 1,
        sha256: 'a'.repeat(64),
      },
    }),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  const file = output(await upload(await solid(10, 10).png().toBuffer()))
  expect(
    await call('media-file.update', { id: file.id, version: 1, values: { width: 5000 } }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(
    output(
      await call('media-file.update', {
        id: file.id,
        version: 1,
        values: { alt: 'A blue square', filename: 'square.png' },
      }),
    ),
  ).toMatchObject({ alt: 'A blue square', filename: 'square.png', width: 10, version: 2 })
})

test('media.file-info is public and gives the width; an unknown id is not_found', async () => {
  const file = output(await upload(await solid(700, 10).png().toBuffer()))
  expect(await call('media.file-info', { id: file.id }, guestActor)).toEqual({
    ok: true,
    output: { width: 700 },
  })
  expect(
    await call('media.file-info', { id: '00000000-0000-4000-8000-000000000000' }, guestActor),
  ).toMatchObject({ ok: false, error: { code: 'not_found' } })
  expect(await call('media.file-info', { id: 'x' }, guestActor)).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})

test('a deleted file can be restored, and its images are still there', async () => {
  const file = output(await upload(await solid(10, 10).png().toBuffer()))
  output(
    await app.registry.call(
      'media-file.delete',
      { id: file.id, version: 1 },
      { actor: admin, confirmed: true },
    ),
  )
  expect(await call('media.file-info', { id: file.id }, guestActor)).toMatchObject({ ok: false })
  const history = output<{ items: { id: string; action: string }[] }>(
    await call('media-file.history', { id: file.id }),
  )
  const created = history.items.find((r) => r.action === 'media.upload')?.id ?? ''
  output(await call('media-file.restore', { revisionId: created }))
  expect(output(await call('media.file-info', { id: file.id }, guestActor))).toEqual({ width: 10 })
  expect(await stored()).toEqual([`${file.id}/10.webp`])
})

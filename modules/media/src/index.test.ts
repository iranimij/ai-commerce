import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDiskFileStore, mediaUrl, servedWidth, widthsFor } from './index.js'

describe('widths', () => {
  test('widthsFor keeps the fixed widths below the original, plus the original capped at 2048', () => {
    expect(widthsFor(200)).toEqual([200])
    expect(widthsFor(320)).toEqual([320])
    expect(widthsFor(1500)).toEqual([320, 640, 1280, 1500])
    expect(widthsFor(2048)).toEqual([320, 640, 1280, 2048])
    expect(widthsFor(6000)).toEqual([320, 640, 1280, 2048])
  })

  test('servedWidth is the nearest stored width at or above the one asked for', () => {
    expect(servedWidth(1500, 1)).toBe(320)
    expect(servedWidth(1500, 320)).toBe(320)
    expect(servedWidth(1500, 321)).toBe(640)
    expect(servedWidth(1500, 1400)).toBe(1500)
    expect(servedWidth(1500, 4000)).toBe(1500)
  })

  test('mediaUrl', () => {
    expect(mediaUrl('abc', 640)).toBe('/api/media/abc/640')
  })
})

describe('disk file store', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('put, get and delete round-trip; a missing key is null', async () => {
    const store = createDiskFileStore(join(dir, 'files'))
    await store.put('a/320.webp', new Uint8Array([1, 2, 3]))
    expect(await store.get('a/320.webp')).toEqual(new Uint8Array([1, 2, 3]))
    await store.delete('a/320.webp')
    expect(await store.get('a/320.webp')).toBeNull()
    await store.delete('a/320.webp')
  })

  test('disk keys cannot leave the files directory', async () => {
    const store = createDiskFileStore(join(dir, 'files'))
    for (const key of ['../x', 'a/../../x', '/etc/passwd', '', '.', 'a/..']) {
      await expect(store.put(key, new Uint8Array([1]))).rejects.toThrow('files directory')
      await expect(store.get(key)).rejects.toThrow('files directory')
      await expect(store.delete(key)).rejects.toThrow('files directory')
    }
    await expect(readFile(join(dir, 'x'))).rejects.toThrow('ENOENT')
  })
})

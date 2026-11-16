import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  ActionError,
  classify,
  defineAction,
  defineModule,
  defineResource,
  resourceStore,
  type ActionWrap,
  type ResourceRecord,
} from '@aicommerce/core'
import type { MigrationSource } from '@aicommerce/db'
import { z } from 'zod'
import { files } from './files.js'
import { encodeImage, MAX_BYTES } from './images.js'

export { createDiskFileStore, files, type FileStore } from './files.js'
export { MAX_BYTES, MAX_PIXELS, servedWidth, widthsFor } from './images.js'

export const mediaMigrations: MigrationSource = {
  module: 'media',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

/** Where a stored image is served; `width` is rounded up to the nearest stored width. */
export const mediaUrl = (id: string, width: number) => `/api/media/${id}/${String(width)}`

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')
const filename = pub(z.string().min(1).max(255))
const alt = pub(z.string().max(500))

/** An uploaded image. Created only by `media.upload`; its files are WebP at `widthsFor(width)`. */
export const mediaFile = defineResource({
  name: 'media-file',
  module: 'media',
  label: { singular: 'Media file', plural: 'Media files' },
  fields: z.strictObject({
    filename,
    contentType: pub(z.enum(['image/webp'])),
    /** Of the original, after EXIF orientation. */
    width: pub(z.number().int().positive()),
    height: pub(z.number().int().positive()),
    /** Of the upload. */
    bytes: pub(z.number().int().positive()),
    /** Of the upload: the same bytes again give the same record. */
    sha256: pub(z.string().regex(/^[0-9a-f]{64}$/)),
    alt: alt.optional(),
  }),
  permissions: { read: 'media.read', write: 'media.write', delete: 'media.delete' },
})

const record = mediaFile.fields.extend({
  id: pub(z.string()),
  version: pub(z.number().int()),
  createdAt: pub(z.string()),
  updatedAt: pub(z.string()),
  attributes: z.record(z.string(), z.unknown()),
})

// Base64 of MAX_BYTES; the decoded size is checked again after decoding.
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4

export const upload = defineAction({
  name: 'media.upload',
  description:
    'Upload an image (JPEG, PNG, WebP, AVIF or GIF, at most 10 MB and 50 megapixels). It is re-encoded to WebP without its metadata.',
  input: z.object({
    filename,
    data: z.base64().max(MAX_BASE64),
    alt: alt.optional(),
  }),
  output: record,
  permission: 'media.write',
  risk: 'write',
  redact: ['data'],
  handler: async (input, ctx) => {
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length > MAX_BYTES) throw new ActionError('invalid_input', 'The file is over 10 MB')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const store = ctx.service(resourceStore)
    const [existing] = (await store.list(mediaFile, { filter: { sha256 }, limit: 1 })).items
    if (existing) return existing as z.infer<typeof record>
    const image = await encodeImage(bytes)
    const created = await store.create(
      mediaFile,
      {
        filename: input.filename,
        contentType: 'image/webp',
        width: image.width,
        height: image.height,
        bytes: bytes.length,
        sha256,
        ...(input.alt !== undefined && { alt: input.alt }),
      },
      {},
      { action: ctx.actionName, actor: ctx.actor },
    )
    // After the row, so a failed write rolls the row back; the files written so far are removed.
    // shortcut: a failure after this handler (commit) leaves the files behind; sweep orphans if seen.
    const disk = ctx.service(files)
    const written: string[] = []
    try {
      for (const { width, data } of image.images) {
        const key = `${created.id}/${String(width)}.webp`
        written.push(key)
        await disk.put(key, data)
      }
    } catch (error) {
      await Promise.all(written.map((key) => disk.delete(key).catch(() => undefined)))
      throw error
    }
    return created as z.infer<typeof record>
  },
})

export const fileInfo = defineAction({
  name: 'media.file-info',
  description: 'The width of an uploaded image, for serving it',
  input: z.object({ id: z.uuid() }),
  output: z.object({ width: pub(z.number().int()) }),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const found = await ctx.service(resourceStore).get(mediaFile, input.id)
    if (!found) throw new ActionError('not_found', 'Media file not found')
    return { width: found.width as number }
  },
})

const EDITABLE = new Set(['alt', 'filename'])

const guards: ActionWrap[] = [
  {
    // Files come from media.upload only, which checks and re-encodes them.
    action: 'media-file.create',
    module: 'media',
    order: 0,
    wrap: () => Promise.reject(new ActionError('forbidden', 'Add images with media.upload')),
  },
  {
    action: 'media-file.update',
    module: 'media',
    order: 0,
    wrap: (input: { values: Partial<ResourceRecord> }, _ctx, next) => {
      const fixed = Object.keys(input.values).filter((k) => !EDITABLE.has(k))
      if (fixed.length > 0) {
        throw new ActionError('invalid_input', 'Only alt and filename can be changed')
      }
      return next(input)
    },
  },
]

export const media = defineModule({
  name: 'media',
  label: 'Media',
  description: 'Image uploads, re-encoded to WebP and served at fixed widths',
  actions: [upload, fileInfo],
  resources: [mediaFile],
  wraps: guards,
})

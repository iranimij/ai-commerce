import { ActionError } from '@aicommerce/core'
import sharp, { type Metadata } from 'sharp'

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_PIXELS = 50_000_000
const WIDTHS = [320, 640, 1280, 2048]
const LARGEST = 2048
// 'truncated' is implied by 'error'; the pixel limit guards the decoder as well as our own check.
const DECODE = { failOn: 'error', limitInputPixels: MAX_PIXELS } as const

/** The widths stored for an image `width` pixels wide, smallest first. */
export function widthsFor(width: number): number[] {
  const top = Math.min(width, LARGEST)
  return [...WIDTHS.filter((w) => w < top), top]
}

/** The stored width served when `asked` is requested: the nearest at or above, else the largest. */
export function servedWidth(width: number, asked: number): number {
  const stored = widthsFor(width)
  return stored.find((w) => w >= asked) ?? (stored.at(-1) as number)
}

export interface EncodedImage {
  /** After EXIF orientation. */
  width: number
  height: number
  /** One WebP per `widthsFor(width)`, with no metadata. */
  images: { width: number; data: Buffer }[]
}

const notAnImage = () =>
  new ActionError('invalid_input', 'The file is not a JPEG, PNG, WebP, AVIF or GIF image')

/** Checks the bytes are an image we accept, then re-encodes it to WebP at every stored width. */
export async function encodeImage(data: Uint8Array): Promise<EncodedImage> {
  // The header only, without the pixel limit, so an oversized image gets its own message below.
  let meta: Metadata
  try {
    meta = await sharp(data, { ...DECODE, limitInputPixels: false }).metadata()
  } catch {
    throw notAnImage()
  }
  // The format comes from the bytes. SVG, TIFF and HEIC decode too, but are refused.
  const accepted =
    ['jpeg', 'png', 'webp', 'gif'].includes(meta.format) ||
    (meta.format === 'heif' && meta.compression === 'av1')
  if (!accepted) throw notAnImage()
  if (meta.width * meta.height > MAX_PIXELS) {
    throw new ActionError('invalid_input', 'The image is over 50 megapixels')
  }
  const { width, height } = meta.autoOrient
  const images: EncodedImage['images'] = []
  try {
    // One at a time: each decode of a large image holds its pixels in memory.
    for (const w of widthsFor(width)) {
      const out = await sharp(data, DECODE)
        .rotate()
        .resize({ width: w })
        .webp({ quality: 82 })
        .toBuffer()
      images.push({ width: w, data: out })
    }
  } catch {
    throw new ActionError('invalid_input', 'The image is damaged or incomplete')
  }
  return { width, height, images }
}

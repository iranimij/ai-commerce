import sharp from 'sharp'

/** One flat silhouette per sample category, on a 512 × 512 canvas. No text: fonts vary by host. */
const SHAPES = {
  tops: '<path d="M176 72 L120 96 L56 168 L104 216 L144 184 V440 H368 V184 L408 216 L456 168 L392 96 L336 72 Q256 136 176 72 Z"/>',
  bottoms:
    '<path d="M160 64 H352 L384 448 H288 L256 200 L224 448 H128 Z"/><rect x="160" y="64" width="192" height="32"/>',
  outerwear:
    '<path d="M176 64 L96 112 L64 448 H200 L224 152 L256 216 L288 152 L312 448 H448 L416 112 L336 64 L256 160 Z"/>',
  bags: '<path d="M184 176 V136 Q256 56 328 136 V176" fill="none" stroke-width="24"/><rect x="104" y="176" width="304" height="256" rx="24"/>',
  hats: '<path d="M144 320 Q144 128 256 128 Q368 128 368 320 Z"/><ellipse cx="256" cy="336" rx="192" ry="40"/>',
  scarves:
    '<path d="M144 96 H368 V176 Q256 232 144 176 Z"/><path d="M200 200 L248 216 L232 448 H168 Z"/><path d="M264 216 L320 200 L352 432 H288 Z"/>',
} as const
export type Shape = keyof typeof SHAPES

/** A PNG of the shape in `color` on a light background whose hue comes from `seed`. */
export function sampleImage(shape: Shape, color: string, seed: number): Promise<Buffer> {
  const background = `hsl(${String((seed * 47) % 360)}, 30%, 82%)`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${background}"/>
    <g fill="${color}" stroke="${color}" stroke-linejoin="round">${SHAPES[shape]}</g>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

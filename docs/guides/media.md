# Media

The `media` module takes image uploads, checks them, re-encodes them to WebP at fixed widths and
serves them. Code: [`modules/media/src/index.ts`](../../modules/media/src/index.ts), tests in
[`modules/media/src/media.integration.test.ts`](../../modules/media/src/media.integration.test.ts).

```ts
import { mediaUrl } from '@aicommerce/module-media'

const result = await app.registry.call(
  'media.upload',
  { filename: 'shirt.jpg', data: base64OfTheFile, alt: 'A blue shirt' },
  { actor },
)
// result.output is the media-file record; its images are at:
mediaUrl(result.output.id, 640) // '/api/media/<id>/640'
```

| Name                            | What it does                                                     | Permission    |
| ------------------------------- | ---------------------------------------------------------------- | ------------- |
| `media.upload`                  | `{ filename, data (base64), alt? }` → the `media-file` record    | `media.write` |
| `media.file-info`               | `{ id }` → `{ width }`, for the image route                      | public        |
| `media-file.*`                  | The resource: list, get, update (`alt`, `filename`), history ... | `media.*`     |
| `GET /api/media/:id/:width`     | The stored WebP nearest at or above `width`, cached for a year   | public        |
| `files` service (`media.files`) | Where the WebP files live: `put`, `get`, `delete` by key         | (code only)   |

## Rules that bite

- The type comes from the bytes, never the name. Accepted: JPEG, PNG, WebP, AVIF and GIF (first
  frame only). SVG, TIFF, HEIC, HTML and anything damaged or cut short are `invalid_input`.
- Limits: 10 MiB decoded and 50 megapixels. The HTTP body for `media.upload` may be 14 MiB (the
  base64 and the JSON around it); every other action keeps the 1 MiB limit.
- No original is kept. The stored widths are `widthsFor(width)`: 320, 640, 1280 and 2048 below
  the original's width, plus the original's width capped at 2048. EXIF orientation is applied
  first, so `width` and `height` are as the image is seen. All metadata (EXIF, GPS, XMP) is gone.
- The same bytes uploaded again return the existing record, unchanged, even with another
  filename or alt.
- `media-file.create` always answers `forbidden`: records come from `media.upload` only.
  `media-file.update` may change only `alt` and `filename`.
- Deleting a `media-file` keeps its images on disk, so `restore` brings it back whole. The route
  stops serving them as soon as the record is gone.
- Image URLs never change content, so they are cached as `immutable`. To change an image, upload
  a new one.
- Files live in `AICOMMERCE_FILES_DIR` (default `/var/lib/aicommerce/files`, a volume in
  `compose.yaml` and in generated shops). `ai-commerce backup` saves the database only: back up
  the files volume too.
- To store files elsewhere (S3, for example), provide `files` from your own module. A key that
  would leave the directory throws in the disk store; keep that rule in yours.
- Uploads are re-encoded inside the call's transaction, so a large upload holds a database
  connection for its encoding time.

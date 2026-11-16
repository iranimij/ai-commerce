const MAX = 200

/**
 * Lower-case Unicode letters, digits and marks, words joined by `-`, at most 200 characters.
 * A name with none of those gives `item`.
 */
export function slugify(text: string): string {
  const joined = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+/, '')
  // By code point, so a letter outside the BMP is never cut in half.
  const slug = Array.from(joined).slice(0, MAX).join('').replace(/-+$/, '')
  return slug || 'item'
}

/** A slug is what slugify leaves unchanged. */
export const isSlug = (text: string): boolean => text.length > 0 && slugify(text) === text

type Translations = Record<string, Record<string, string | undefined> | undefined>

/**
 * The record in `locale`, field by field: its translation, else the `fallback` locale's (the
 * shop language), else the record's own value. `translations` itself is left out.
 */
export function localize<T extends Record<string, unknown>>(
  record: T,
  locale: string,
  fallback: string,
): Omit<T, 'translations'> {
  const { translations, ...out } = record as T & { translations?: Translations }
  for (const t of [translations?.[fallback], translations?.[locale]]) {
    for (const [key, value] of Object.entries(t ?? {})) {
      if (value !== undefined) (out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

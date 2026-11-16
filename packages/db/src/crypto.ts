import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const KEY_ERROR = 'AICOMMERCE_SECRET_KEY must be 32 bytes, base64 encoded'

/** Decodes AICOMMERCE_SECRET_KEY; startup fails on anything but 32 bytes of base64. */
export function parseSecretKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(KEY_ERROR)
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error(KEY_ERROR)
  return key
}

/**
 * AES-256-GCM with a random 12-byte IV. The AAD binds the ciphertext to where it is stored, so a
 * value copied to another setting cannot be decrypted. Format: `v1.<iv>.<tag>.<ciphertext>`.
 */
export function encryptSecret(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

export function decryptSecret(token: string, key: Buffer, aad: string): string {
  const [version, iv, tag, ct, ...rest] = token.split('.')
  if (version !== 'v1' || !iv || !tag || ct === undefined || rest.length > 0) {
    throw new Error('Unknown secret format')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
    authTagLength: 16,
  })
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  )
}

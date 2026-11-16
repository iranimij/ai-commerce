import { Secret, TOTP } from 'otpauth'

/** The current code for the key the 2FA step shows (Base32, grouped in fours). */
export const totp = (key: string) =>
  new TOTP({ secret: Secret.fromBase32(key.replace(/\s/g, '')) }).generate()

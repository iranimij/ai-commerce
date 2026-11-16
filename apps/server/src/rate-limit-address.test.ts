import { expect, test } from 'vitest'
import { rateLimitAddress } from './server.js'

test.each([
  ['203.0.113.7', '203.0.113.7'],
  ['::ffff:203.0.113.7', '203.0.113.7'],
  ['2001:db8:77:1::5', '2001:db8:77:1::/64'],
  ['2001:0db8:0077:0001:ffff:0:0:1', '2001:db8:77:1::/64'],
  ['2001:db8::1', '2001:db8:0:0::/64'],
  ['::1', '0:0:0:0::/64'],
  ['fe80::1%eth0', 'fe80:0:0:0::/64'],
  ['unknown', 'unknown'],
])('%s is limited as %s', (ip, key) => {
  expect(rateLimitAddress(ip)).toBe(key)
})

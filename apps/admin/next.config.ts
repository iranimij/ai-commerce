import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// The /api proxy and the CSP (it needs a nonce per request) are in proxy.ts.
const config: NextConfig = {
  poweredByHeader: false,
  // The production image runs .next/standalone/apps/admin/server.js with only the files it uses;
  // tracing starts at the repository root so the workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  headers: () =>
    Promise.resolve([
      {
        // The server sets its own headers on /api.
        source: '/((?!api/).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // The setup token arrives in the URL: never pass it on as a Referer.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]),
}

export default config

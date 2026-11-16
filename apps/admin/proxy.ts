import { NextResponse, type NextRequest } from 'next/server'

// Read at run time: next.config rewrites are fixed at build time, and one build must work
// against whatever server address the deployment uses.
const server = process.env.AICOMMERCE_SERVER_URL ?? 'http://localhost:3000'
const dev = process.env.NODE_ENV === 'development'

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  // Same origin for the browser, so the session cookie, CSRF and Origin rules stay as they are.
  // The health checks too: in the image the admin holds the public port.
  if (pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/readyz') {
    return NextResponse.rewrite(new URL(pathname + search, server))
  }

  // A fresh nonce per page; Next.js adds it to its own scripts.
  const nonce = btoa(crypto.randomUUID())
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Radix renders style attributes on the server (the hidden native <select>); attributes
    // cannot run script, and <style> elements still need the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  const headers = new Headers(request.headers)
  headers.set('content-security-policy', csp)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }

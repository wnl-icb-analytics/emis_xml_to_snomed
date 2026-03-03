import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Skip middleware for static files and Next.js internals
  if (
    pathname.startsWith('/_next/static') ||
    pathname.startsWith('/_next/image') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Allow access to login page
  if (pathname === '/login') {
    return NextResponse.next();
  }

  // Allow access to auth API
  if (pathname.startsWith('/api/auth/login')) {
    return NextResponse.next();
  }

  // Allow access to internal API routes (called from authenticated client-side code)
  if (pathname.startsWith('/api/xml/parse') || pathname.startsWith('/api/terminology/')) {
    return NextResponse.next();
  }

  // Check if user is authenticated
  const authToken = request.cookies.get('auth-token');

  // Redirect to login if not authenticated
  if (!authToken) {
    console.log(`[Middleware] Redirecting unauthenticated user from ${pathname} to /login`);
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT API routes
     * API routes (especially /api/xml/parse) need to bypass middleware
     * to avoid body size limits being applied
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};


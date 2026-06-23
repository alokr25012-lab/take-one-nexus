import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';


/**
 * Routes that require authentication AND email verification
 * (messaging is gated behind verification to prevent spam)
 */
const VERIFIED_ONLY_ROUTES = [
  '/leaderboard',
  '/crew.htm',
  '/project.htm',
  '/scripts.htm'
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protected routes for all authenticated users
  const isProtectedRoute =
    pathname.startsWith('/chat') ||
    (pathname.startsWith('/profile') && !request.nextUrl.searchParams.has('id')) ||
    pathname.startsWith('/developer');

  const isAdminRoute = pathname.startsWith('/admin');

  if (isProtectedRoute || isAdminRoute) {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      // Redirect to login, preserve the intended destination
      const loginUrl = new URL('/?auth=login', request.url);
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }

    try {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        throw new Error('JWT_SECRET is not configured');
      }
      const secret = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secret);

      const userRole = (payload.role as string || '').toLowerCase();
      const userSecondaryRole = (payload.secondary_role as string || '').toLowerCase();
      const isAdminRole = userRole === 'admin' || userSecondaryRole === 'admin' || userSecondaryRole === 'founder';

      if (isAdminRoute) {
        if (!isAdminRole) {
          return NextResponse.redirect(new URL('/?error=unauthorized', request.url));
        }
      }

      if (pathname.startsWith('/developer')) {
        if (!isAdminRole) {
          return NextResponse.redirect(new URL('/?error=unauthorized', request.url));
        }
      }

      const isVerifiedRoute = VERIFIED_ONLY_ROUTES.some(r => pathname.startsWith(r));
      if (isVerifiedRoute && !isAdminRole) {
        const emailVerified = payload.email_verified;
        // Grant access when email_verified is explicitly true or 1 (from legacy database integer formats).
        // Legacy tokens lacking the field (undefined/null) are also blocked.
        if (emailVerified !== true && emailVerified !== 1) {
          const url = new URL('/', request.url);
          url.searchParams.set('verify', 'required');
          return NextResponse.redirect(url);
        }
      }

      return NextResponse.next();
    } catch (error) {
      console.error('Middleware JWT verification failed:', error);
      // Token invalid/expired — clear stale cookie and redirect to login
      const response = NextResponse.redirect(new URL('/?auth=login', request.url));
      response.cookies.delete('token');
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*', 
    '/chat/:path*', 
    '/profile/:path*', 
    '/developer/:path*',
    '/leaderboard/:path*',
    '/crew.htm',
    '/project.htm',
    '/scripts.htm'
  ],
};
